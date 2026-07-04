import { LLMClient, ChatMessage } from '../clients/llm.client.js';
import { UserPreferenceRepository, UserPreference } from '../repositories/userPreference.repository.js';
import { Message, Sender, PreferenceCategory } from '../types/index.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getRecentMessages } from '../utils/index.js';

export interface ExtractedPreference {
  category: PreferenceCategory;
  key: string;
  value: unknown;
  confidence: number; // 0-100
}

export interface PreferenceExtractionResult {
  preferences: ExtractedPreference[];
  processed: boolean;
  error?: string;
}

export interface UserProfile {
  senderId: string;
  communication: {
    formality?: 'formal' | 'casual' | 'mixed';
    verbosity?: 'concise' | 'detailed' | 'mixed';
    humor?: boolean;
    emojis?: boolean;
    language?: string;
    timezone?: string;
  };
  interests: {
    topics?: string[];
    avoidTopics?: string[];
    expertise?: Record<string, 'beginner' | 'intermediate' | 'expert'>;
  };
  behavior: {
    responseTime?: 'immediate' | 'patient';
    questionStyle?: 'direct' | 'exploratory';
    preferredTime?: string;
  };
  context: {
    name?: string;
    nickname?: string;
    occupation?: string;
    location?: string;
    currentProjects?: string[];
  };
}

interface ExtractedData {
  preferences?: Array<{
    category: string;
    key: string;
    value: unknown;
    confidence: number;
  }>;
}

const PREFERENCE_EXTRACTION_PROMPT = `Analyze this conversation and extract any user preferences or personal information.

Categories and their keys:
- communication: formality (formal/casual/mixed), verbosity (concise/detailed/mixed), humor (boolean), emojis (boolean), language (ISO code), timezone
- interests: topics (array of strings), avoidTopics (array of strings), expertise (object with topic: level)
- behavior: responseTime (immediate/patient), questionStyle (direct/exploratory), preferredTime (time range)
- context: name, nickname, occupation, location, currentProjects (array)

Rules:
- Only extract EXPLICIT or STRONGLY IMPLIED preferences
- Be conservative with confidence scores (0.0-1.0)
- Focus on stable preferences, not temporary states
- Extract information that helps personalize future conversations
- For arrays, only include items explicitly mentioned
- Skip if information is unclear or ambiguous

IMPORTANT JSON FORMAT REQUIREMENTS:
- Return STRICT VALID JSON ONLY
- NO comments in JSON (no parentheses, no //, no /* */)
- NO trailing commas
- All property names must be quoted
- NO explanatory text outside the JSON structure

Return a JSON object with this exact structure:
{
  "preferences": [
    {"category": "communication|interests|behavior|context", "key": "...", "value": ..., "confidence": 0.0-1.0}
  ]
}

If no preferences found, return: {"preferences": []}

Conversation:`;

export class UserPreferenceService {
  private llmClient: LLMClient;
  private preferenceRepo: UserPreferenceRepository;

  constructor(
    llmClient: LLMClient,
    preferenceRepo: UserPreferenceRepository
  ) {
    this.llmClient = llmClient;
    this.preferenceRepo = preferenceRepo;
  }

  /**
   * Extract and store preferences from a message
   */
  async extractAndStore(
    message: Message,
    sender: Sender,
    conversationContext?: Message[]
  ): Promise<PreferenceExtractionResult> {
    if (!appConfig.memory.enabled) {
      return { preferences: [], processed: false };
    }

    if (!message.text || message.text.trim().length === 0) {
      return { preferences: [], processed: false };
    }

    try {
      // Build context from recent messages if available (messages are in descending order)
      let contextText = '';
      if (conversationContext && conversationContext.length > 0) {
        const recentMessages = getRecentMessages(conversationContext, 5);
        contextText = recentMessages
          .map((m) => `${m.isBot ? 'Assistant' : 'User'}: ${m.text}`)
          .join('\n');
        contextText += '\n';
      }

      // Extract preferences using LLM
      const extractedPreferences = await this.extractPreferences(
        contextText + `User: ${message.text}`
      );

      if (extractedPreferences.length === 0) {
        return { preferences: [], processed: true };
      }

      // Filter by minimum confidence
      const confidentPreferences = extractedPreferences.filter(
        (p) => p.confidence >= appConfig.memory.minConfidence
      );

      if (confidentPreferences.length === 0) {
        return { preferences: extractedPreferences, processed: true };
      }

      // Store each extracted preference
      const storedPreferences: ExtractedPreference[] = [];
      for (const pref of confidentPreferences) {
        try {
          await this.preferenceRepo.upsert({
            senderId: sender.id,
            category: pref.category,
            key: pref.key,
            value: JSON.stringify(pref.value),
            confidence: Math.round(pref.confidence),
            sourceMessageIds: JSON.stringify([message.id]),
          });

          storedPreferences.push(pref);
          logger.info('[UserPreference] Stored preference', {
            senderId: sender.id,
            category: pref.category,
            key: pref.key,
            confidence: pref.confidence,
          });
        } catch (error) {
          logger.error('[UserPreference] Failed to store preference', {
            preference: pref,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return { preferences: storedPreferences, processed: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[UserPreference] Extraction failed', { error: errorMessage });
      return { preferences: [], processed: false, error: errorMessage };
    }
  }

  /**
   * Extract preferences from text using LLM
   */
  private async extractPreferences(text: string): Promise<ExtractedPreference[]> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: PREFERENCE_EXTRACTION_PROMPT,
      },
      {
        role: 'user',
        content: text,
      },
    ];

    const response = await this.llmClient.chat(messages, undefined, {
      maxTokens: appConfig.llm.extractionMaxTokens,
    });

    try {
      // Parse JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[UserPreference] No JSON found in extraction response');
        return [];
      }

      // Sanitize JSON to handle LLM comments and non-standard JSON
      const sanitizedJson = this.sanitizeJson(jsonMatch[0]);
      const parsed: ExtractedData = JSON.parse(sanitizedJson);

      if (!parsed.preferences || !Array.isArray(parsed.preferences)) {
        return [];
      }

      const validCategories: PreferenceCategory[] = ['communication', 'interests', 'behavior', 'context'];

      // Validate and normalize preferences
      return parsed.preferences
        .filter(
          (p) =>
            p &&
            typeof p.key === 'string' &&
            p.key.trim().length > 0 &&
            validCategories.includes(p.category as PreferenceCategory) &&
            p.value !== undefined &&
            p.value !== null
        )
        .map((p) => ({
          category: p.category as PreferenceCategory,
          key: p.key.trim(),
          value: p.value,
          confidence: Math.max(0, Math.min(100, Math.round((p.confidence || 0.5) * 100))),
        }));
    } catch (error) {
      logger.error('[UserPreference] Failed to parse extraction response', {
        response: response.content,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Try partial recovery from truncated JSON
      const recovered = this.tryRecoverPartialPreferences(response.content);
      if (recovered.length > 0) {
        logger.info('[UserPreference] Recovered partial preferences from truncated response', {
          recoveredCount: recovered.length,
        });
      }
      return recovered;
    }
  }

  /**
   * Attempt to recover partial preferences from a truncated JSON response.
   * This handles cases where LLM responses are cut off due to token limits.
   */
  private tryRecoverPartialPreferences(content: string): ExtractedPreference[] {
    const preferences: ExtractedPreference[] = [];

    try {
      // Pattern to match individual preference objects even in truncated JSON
      // Matches: {"category": "...", "key": "...", "value": ..., "confidence": 0.x}
      const prefPattern = /\{\s*"category"\s*:\s*"(\w+)"\s*,\s*"key"\s*:\s*"([^"]*(?:\\"[^"]*"[^"]*)*)"\s*,\s*"value"\s*:\s*([^,}\]]+?)\s*,\s*"confidence"\s*:\s*([\d.]+)\s*\}/g;

      let match;
      while ((match = prefPattern.exec(content)) !== null) {
        const [, category, keyRaw, valueRaw, confidenceRaw] = match;
        const validCategories: PreferenceCategory[] = ['communication', 'interests', 'behavior', 'context'];

        if (validCategories.includes(category as PreferenceCategory) && keyRaw && keyRaw.trim().length > 0) {
          // Try to parse the value - could be string, number, boolean, or array
          let parsedValue: unknown;
          try {
            parsedValue = JSON.parse(valueRaw.trim());
          } catch {
            // If not valid JSON, use as string
            parsedValue = valueRaw.trim().replace(/\\"/g, '"');
          }

          preferences.push({
            category: category as PreferenceCategory,
            key: keyRaw.replace(/\\"/g, '"').trim(),
            value: parsedValue,
            confidence: Math.max(0, Math.min(100, Math.round((parseFloat(confidenceRaw) || 0.5) * 100))),
          });
        }
      }

      return preferences;
    } catch (error) {
      logger.warn('[UserPreference] Partial preference recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Sanitize JSON string to handle LLM-generated comments and non-standard JSON
   *
   * This handles cases where the LLM adds comments like:
   * - "en-US" (implied)
   * - trailing commas
   * - unquoted property names (in some cases)
   */
  private sanitizeJson(jsonString: string): string {
    let sanitized = jsonString;

    // Remove inline comments like "(implied)", "(default)", etc.
    // Pattern: matches (text) that's not inside quotes
    sanitized = sanitized.replace(/(?<!\\)"\([^)]*\)/g, '');

    // Remove // comments (but not inside strings)
    sanitized = sanitized.replace(/\s*\/\/.*$/gm, '');
    // Remove /* */ comments (but not inside strings)
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing commas before closing brackets/braces
    sanitized = sanitized.replace(/,\s*([}\]])/g, '$1');

    // Remove quotes around numeric values (LLMs sometimes do this)
    sanitized = sanitized.replace(/"(\d+(\.\d+)?)"(?=\s*[,}\]])/g, '$1');

    // Handle boolean values (some LLMs use true/false instead of "true"/"false")
    sanitized = sanitized.replace(/"(\b(true|false|null)\b)"(?=\s*[,}\]])/g, '$1');

    // Ensure all property names are quoted (basic unquoted key handling)
    sanitized = sanitized.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    return sanitized.trim();
  }

  /**
   * Get all preferences for a sender as a structured profile
   */
  async getProfile(senderId: string): Promise<UserProfile> {
    const preferencesMap = await this.preferenceRepo.getPreferencesMap(senderId);

    return {
      senderId,
      communication: (preferencesMap.communication || {}) as UserProfile['communication'],
      interests: (preferencesMap.interests || {}) as UserProfile['interests'],
      behavior: (preferencesMap.behavior || {}) as UserProfile['behavior'],
      context: (preferencesMap.context || {}) as UserProfile['context'],
    };
  }

  /**
   * Get all preferences for a sender
   */
  async getPreferences(senderId: string): Promise<UserPreference[]> {
    return await this.preferenceRepo.findBySenderId(senderId);
  }

  /**
   * Get preferences by category
   */
  async getPreferencesByCategory(
    senderId: string,
    category: PreferenceCategory
  ): Promise<UserPreference[]> {
    return await this.preferenceRepo.findByCategory(senderId, category);
  }

  /**
   * Get a specific preference
   */
  async getPreference(
    senderId: string,
    category: PreferenceCategory,
    key: string
  ): Promise<unknown | null> {
    const pref = await this.preferenceRepo.findByKey(senderId, category, key);
    if (!pref) return null;

    try {
      return JSON.parse(pref.value);
    } catch {
      return pref.value;
    }
  }

  /**
   * Manually update a preference
   */
  async updatePreference(
    senderId: string,
    category: PreferenceCategory,
    key: string,
    value: unknown,
    confidence: number = 100
  ): Promise<UserPreference> {
    return await this.preferenceRepo.upsert({
      senderId,
      category,
      key,
      value: JSON.stringify(value),
      confidence,
      sourceMessageIds: null,
    });
  }

  /**
   * Delete a specific preference
   */
  async deletePreference(
    senderId: string,
    category: PreferenceCategory,
    key: string
  ): Promise<boolean> {
    const pref = await this.preferenceRepo.findByKey(senderId, category, key);
    if (!pref) return false;
    return await this.preferenceRepo.delete(pref.id);
  }

  /**
   * Delete all preferences for a sender
   */
  async deleteAllPreferences(senderId: string): Promise<number> {
    return await this.preferenceRepo.deleteBySenderId(senderId);
  }

  /**
   * Build a context string from preferences for LLM prompts
   */
  async buildContextString(senderId: string): Promise<string> {
    const profile = await this.getProfile(senderId);
    const parts: string[] = [];

    // Communication style
    if (Object.keys(profile.communication).length > 0) {
      const comm = profile.communication;
      const commParts: string[] = [];
      if (comm.formality) commParts.push(`prefers ${comm.formality} communication`);
      if (comm.verbosity) commParts.push(`likes ${comm.verbosity} responses`);
      if (comm.humor !== undefined) commParts.push(comm.humor ? 'appreciates humor' : 'prefers serious tone');
      if (comm.emojis !== undefined) commParts.push(comm.emojis ? 'likes emojis' : 'prefers no emojis');
      if (comm.language) commParts.push(`primary language: ${comm.language}`);
      if (comm.timezone) commParts.push(`timezone: ${comm.timezone}`);
      if (commParts.length > 0) {
        parts.push(`Communication: ${commParts.join(', ')}`);
      }
    }

    // Interests
    if (Object.keys(profile.interests).length > 0) {
      const interests = profile.interests;
      const intParts: string[] = [];
      if (interests.topics && interests.topics.length > 0) {
        intParts.push(`interested in: ${interests.topics.join(', ')}`);
      }
      if (interests.avoidTopics && interests.avoidTopics.length > 0) {
        intParts.push(`avoid topics: ${interests.avoidTopics.join(', ')}`);
      }
      if (interests.expertise && Object.keys(interests.expertise).length > 0) {
        const expertiseStr = Object.entries(interests.expertise)
          .map(([topic, level]) => `${topic} (${level})`)
          .join(', ');
        intParts.push(`expertise: ${expertiseStr}`);
      }
      if (intParts.length > 0) {
        parts.push(`Interests: ${intParts.join('; ')}`);
      }
    }

    // Context
    if (Object.keys(profile.context).length > 0) {
      const ctx = profile.context;
      const ctxParts: string[] = [];
      if (ctx.name) ctxParts.push(`name: ${ctx.name}`);
      if (ctx.nickname) ctxParts.push(`goes by: ${ctx.nickname}`);
      if (ctx.occupation) ctxParts.push(`occupation: ${ctx.occupation}`);
      if (ctx.location) ctxParts.push(`location: ${ctx.location}`);
      if (ctx.currentProjects && ctx.currentProjects.length > 0) {
        ctxParts.push(`working on: ${ctx.currentProjects.join(', ')}`);
      }
      if (ctxParts.length > 0) {
        parts.push(`Context: ${ctxParts.join(', ')}`);
      }
    }

    if (parts.length === 0) {
      return '';
    }

    return `User profile:\n${parts.join('\n')}`;
  }

  /**
   * Get preference statistics for a sender
   */
  async getStats(senderId: string): Promise<{
    totalPreferences: number;
    byCategory: Record<PreferenceCategory, number>;
    averageConfidence: number;
  }> {
    const preferences = await this.getPreferences(senderId);

    const byCategory: Record<PreferenceCategory, number> = {
      communication: 0,
      interests: 0,
      behavior: 0,
      context: 0,
    };

    let totalConfidence = 0;

    for (const pref of preferences) {
      byCategory[pref.category as PreferenceCategory]++;
      totalConfidence += pref.confidence;
    }

    return {
      totalPreferences: preferences.length,
      byCategory,
      averageConfidence: preferences.length > 0 ? totalConfidence / preferences.length : 0,
    };
  }
}
