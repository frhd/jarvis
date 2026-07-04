/**
 * Comic Generator Service
 *
 * Generates personalized, high-quality jokes with anti-repetition tracking.
 * Uses Claude for higher quality humor generation.
 */

import type { Message, Sender } from '../../types/index.js';
import type {
  JokeStyle,
  JokeCategory,
  JokeGenerationContext,
  JokeGenerationResult,
} from '../../types/comic.types.js';
import {
  JOKE_STYLE_KEYWORDS,
  JOKE_STYLE_PROMPTS,
  JOKE_CATEGORY_PROMPTS,
} from '../../types/comic.types.js';
import { ClaudeClient } from '../../clients/claude.client.js';
import { JokeHistoryRepository, hashJokeContent } from '../../repositories/jokeHistory.repository.js';
import { logger } from '../../utils/logger.js';

/**
 * Default configuration for joke generation
 */
const DEFAULT_CONFIG = {
  recentJokesLimit: 50,       // How many recent jokes to check for duplicates
  defaultStyle: 'mixed' as JokeStyle,
  defaultCategory: 'general' as JokeCategory,
  maxResponseLength: 500,      // Max characters for generated joke
};

export interface ComicGeneratorConfig {
  recentJokesLimit?: number;
  defaultStyle?: JokeStyle;
  defaultCategory?: JokeCategory;
  maxResponseLength?: number;
}

/**
 * Comic Generator Service
 *
 * Core logic:
 * 1. Build exclusion list from recent joke hashes
 * 2. Detect style hint from user message
 * 3. Select category based on user preferences
 * 4. Build personalized prompt with user context
 * 5. Generate via Claude (higher quality humor)
 * 6. Hash and store joke for future deduplication
 */
export class ComicGeneratorService {
  private config: typeof DEFAULT_CONFIG;

  constructor(
    private claudeClient: ClaudeClient,
    private jokeHistoryRepo: JokeHistoryRepository,
    config?: ComicGeneratorConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a personalized joke for the user
   */
  async generateJoke(
    message: Message,
    sender: Sender | null,
    context: Partial<JokeGenerationContext> = {}
  ): Promise<JokeGenerationResult> {
    const startTime = Date.now();

    try {
      // 1. Build exclusion list from recent jokes
      const excludedJokeHashes = await this.getExcludedHashes(context.senderId ?? sender?.id ?? null);
      context.excludedJokeHashes = excludedJokeHashes;

      // 2. Detect style hint from user message
      const styleHint = context.styleHint ?? this.detectStyleHint(message.text || '');
      context.styleHint = styleHint;

      // 3. Determine category (use provided or detect from preferences)
      const category = context.preferredCategories?.[0] ?? this.config.defaultCategory;

      // 4. Build the prompt
      const prompt = this.buildJokePrompt(context, sender);

      // 5. Generate via Claude
      const response = await this.claudeClient.chat(prompt);

      if (!response.success || !response.content) {
        return {
          success: false,
          style: styleHint ?? this.config.defaultStyle,
          category,
          jokeHash: '',
          error: response.error || 'Failed to generate joke',
          durationMs: Date.now() - startTime,
        };
      }

      // Clean up the response (remove quotes, extra whitespace)
      let joke = this.cleanJokeResponse(response.content);

      // Truncate if too long
      if (joke.length > this.config.maxResponseLength) {
        joke = joke.substring(0, this.config.maxResponseLength - 3) + '...';
      }

      // 6. Hash the joke
      const jokeHash = hashJokeContent(joke);

      // 7. Store in history
      await this.jokeHistoryRepo.createEntry({
        senderId: context.senderId ?? sender?.id ?? null,
        chatId: context.chatId ?? message.chatId,
        jokeContent: joke,
        style: styleHint ?? this.config.defaultStyle,
        categoryId: category,
      });

      const durationMs = Date.now() - startTime;

      logger.info('[ComicGenerator] Joke generated', {
        messageId: message.id,
        style: styleHint,
        category,
        jokeHash: jokeHash.substring(0, 8),
        durationMs,
        jokeLength: joke.length,
      });

      return {
        success: true,
        joke,
        style: styleHint ?? this.config.defaultStyle,
        category,
        jokeHash,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ComicGenerator] Failed to generate joke', {
        messageId: message.id,
        error: errorMessage,
      });

      return {
        success: false,
        style: this.config.defaultStyle,
        category: this.config.defaultCategory,
        jokeHash: '',
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get list of joke hashes to exclude (recent jokes for this sender)
   */
  private async getExcludedHashes(senderId: string | null): Promise<string[]> {
    if (!senderId) return [];

    try {
      return await this.jokeHistoryRepo.getJokeHashesForSender(
        senderId,
        this.config.recentJokesLimit
      );
    } catch (error) {
      logger.warn('[ComicGenerator] Failed to get excluded hashes', {
        senderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Detect joke style hint from user message
   */
  detectStyleHint(messageText: string): JokeStyle | undefined {
    const text = messageText.toLowerCase();

    // Check each style's keywords
    for (const [style, patterns] of Object.entries(JOKE_STYLE_KEYWORDS)) {
      if (style === 'mixed') continue; // Skip 'mixed' - it's the default

      for (const pattern of patterns) {
        if (pattern.test(text)) {
          logger.debug('[ComicGenerator] Detected style hint', { style, pattern: pattern.source });
          return style as JokeStyle;
        }
      }
    }

    return undefined;
  }

  /**
   * Build the prompt for joke generation
   */
  private buildJokePrompt(
    context: Partial<JokeGenerationContext>,
    sender: Sender | null
  ): string {
    // Get style-specific prompt
    const style = context.styleHint ?? this.config.defaultStyle;
    const stylePrompt = JOKE_STYLE_PROMPTS[style];

    // Get category-specific addition
    const category = context.preferredCategories?.[0] ?? this.config.defaultCategory;
    const categoryPrompt = JOKE_CATEGORY_PROMPTS[category];

    // Build personalization context
    let personalization = '';
    if (sender?.firstName) {
      personalization += `The user's name is ${sender.firstName}. `;
    }
    if (context.recentTopics && context.recentTopics.length > 0) {
      personalization += `Recent conversation topics: ${context.recentTopics.slice(0, 3).join(', ')}. `;
    }

    // Build exclusion instruction
    let exclusionInstruction = '';
    if (context.excludedJokeHashes && context.excludedJokeHashes.length > 0) {
      exclusionInstruction = `
IMPORTANT: Generate a completely ORIGINAL joke. Do NOT repeat themes or jokes similar to ones told recently.
Be creative and come up with something fresh and unexpected.
`;
    }

    // Assemble the full prompt
    const prompt = `${stylePrompt}${categoryPrompt}

${personalization}

${exclusionInstruction}

Generate ONLY the joke itself, no explanations or commentary. Keep it concise and funny.`;

    return prompt.trim();
  }

  /**
   * Clean up the joke response
   */
  private cleanJokeResponse(response: string): string {
    let joke = response.trim();

    // Remove surrounding quotes if present
    if (
      (joke.startsWith('"') && joke.endsWith('"')) ||
      (joke.startsWith("'") && joke.endsWith("'"))
    ) {
      joke = joke.slice(1, -1);
    }

    // Remove common AI prefixes
    const prefixes = [
      /^here's a (joke|dad joke|pun|clever joke|one[- ]liner)[^.]*:\s*/i,
      /^sure!?\s*here's[^:]*:\s*/i,
      /^(alright|okay|ok)[,!]\s*here's[^:]*:\s*/i,
      /^joke:\s*/i,
    ];

    for (const prefix of prefixes) {
      joke = joke.replace(prefix, '');
    }

    // Remove trailing explanations
    const trailingPatterns = [
      /\s*[-–—]\s*(hope you (like|enjoy) it|get it\??|ha\s*ha)\s*\.?$/i,
      /\s*\([^)]*\)\s*$/,  // Trailing parentheticals
    ];

    for (const pattern of trailingPatterns) {
      joke = joke.replace(pattern, '');
    }

    return joke.trim();
  }
}
