import { createLogger } from '../utils/logger.js';
import type { Chat } from '../types/index.js';

const logger = createLogger('LanguagePreferenceService');

export interface LanguagePreferenceResult {
  detected: boolean;
  language: string;
  originalText: string;
  confidence?: number;
}

export interface LanguageDetectionConfidence {
  germanScore: number;
  englishScore: number;
  spanishScore: number;
  confidence: number;
  detectedLanguage: string;
}

export interface LanguageDetectionPatterns {
  [pattern: string]: string;
}

/**
 * Language Preference Service
 *
 * Detects and persists user language preferences across conversations.
 * Supports language switch requests and automatic detection.
 */
export class LanguagePreferenceService {
  // Track language detection history for confidence scoring
  private detectionHistory: Map<string, string[]> = new Map();
  private maxHistorySize = 10;

  private readonly LANGUAGE_PATTERNS: LanguageDetectionPatterns = {
    // English requests
    'speak english': 'en',
    'talk english': 'en',
    'in english': 'en',
    'english please': 'en',
    'english mode': 'en',
    'switch to english': 'en',
    'use english': 'en',

    // German requests
    'sprech deutsch': 'de',
    'sprich deutsch': 'de',
    'in deutsch': 'de',
    'auf deutsch': 'de',
    'deutsch bitte': 'de',
    'deutsch mode': 'de',
    'zu deutsch wechseln': 'de',
    'nutze deutsch': 'de',
    'spreche deutsch': 'de', // typo
    'sprich auf deutsch': 'de',

    // Spanish requests
    'habla español': 'es',
    'habla espanol': 'es',
    'en español': 'es',
    'español por favor': 'es',
    'modo español': 'es',
    'cambia a español': 'es',
  };

  /**
   * Detect language switch request in user message
   *
   * @param text - User message text
   * @returns Detection result with detected language or null if no switch
   */
  detectLanguageSwitch(text: string): LanguagePreferenceResult | null {
    const lowerText = text.toLowerCase().trim();

    // Check each pattern with improved matching
    for (const [pattern, language] of Object.entries(this.LANGUAGE_PATTERNS)) {
      // Use word boundary matching for more precise detection
      // Replace spaces with word boundary regex (\b) for better matching
      const regexPattern = new RegExp(`\\b${pattern.replace(/\s+/g, '\\b\\s+\\b')}\\b`, 'i');

      if (regexPattern.test(lowerText)) {
        logger.info('[LanguagePreference] Detected language switch request', {
          pattern,
          language,
          originalText: text.substring(0, 50),
          matchedPattern: regexPattern.source,
        });

        return {
          detected: true,
          language,
          originalText: text,
        };
      }
    }

    return null;
  }

  /**
   * Auto-detect language from message content
   * Uses simple heuristics (English/German focus) with confidence scoring
   *
   * @param text - Message text to analyze
   * @returns Detected language code with confidence ('en', 'de', 'es', or 'unknown')
   */
  autoDetectLanguage(text: string): string {
    const result = this.autoDetectLanguageWithConfidence(text);
    return result.detectedLanguage;
  }

  /**
   * Auto-detect language from message content with confidence scoring
   * Uses simple heuristics (English/German focus) with confidence scoring
   *
   * @param text - Message text to analyze
   * @returns Detection result with language and confidence
   */
  autoDetectLanguageWithConfidence(text: string): LanguageDetectionConfidence {
    const lowerText = text.toLowerCase();

    // German-specific patterns
    const germanPatterns = [
      /\b(ich|du|er|sie|es|wir|ih|euch)\b/i,  // pronouns
      /\b(der|die|das|dem|den|ein|eine|einen|kein)\b/i,  // articles
      /\b(haben|sein|werden|können|müssen|sollen)\b/i,  // modal verbs
      /\b(nicht|ja|nein|doch|mal|halt|eben|schon)\b/i,  // particles
      /\b(bitte|danke|entschuldigung|hallo|guten tag|guten morgen)\b/i,  // common phrases
      /ä|ö|ü|ß/,  // German umlauts and eszett
    ];

    // English-specific patterns
    const englishPatterns = [
      /\b(i|you|he|she|it|we|they)\b/i,  // pronouns
      /\b(the|a|an|this|that|these|those)\b/i,  // articles/demonstratives
      /\b(have|be|can|must|should|will|would)\b/i,  // modal verbs
      /\b(not|yes|no|maybe|please|thanks|sorry)\b/i,  // common words
      /\b(hello|hi|hey|good morning|good afternoon|good evening)\b/i,  // greetings
    ];

    // Spanish-specific patterns
    const spanishPatterns = [
      /\b(él|ella|usted|nosotros|ellos)\b/i,  // pronouns
      /\b(el|la|los|las|un|una|unos|unas)\b/i,  // articles
      /\b(tener|ser|poder|deber|querer)\b/i,  // modal verbs
      /\b(no|sí|por favor|gracias|disculpe|hola|buenos días)\b/i,  // common words
      /ñ|á|é|í|ó|ú/,  // Spanish special characters
    ];

    let germanScore = 0;
    let englishScore = 0;
    let spanishScore = 0;

    // Score German patterns
    for (const pattern of germanPatterns) {
      if (pattern.test(lowerText)) {
        germanScore++;
      }
    }

    // Score English patterns
    for (const pattern of englishPatterns) {
      if (pattern.test(lowerText)) {
        englishScore++;
      }
    }

    // Score Spanish patterns
    for (const pattern of spanishPatterns) {
      if (pattern.test(lowerText)) {
        spanishScore++;
      }
    }

    // Check for umlauts (strong German indicator)
    if (/ä|ö|ü|ß/.test(lowerText)) {
      germanScore += 3;
    }

    // Check for Spanish characters (strong Spanish indicator)
    if (/ñ|á|é|í|ó|ú/.test(lowerText)) {
      spanishScore += 3;
    }

    // Determine language based on scores
    let detectedLanguage = 'unknown';
    let confidence = 0;

    const maxScore = Math.max(germanScore, englishScore, spanishScore);
    const totalScore = germanScore + englishScore + spanishScore;

    if (totalScore === 0) {
      return {
        germanScore: 0,
        englishScore: 0,
        spanishScore: 0,
        confidence: 0,
        detectedLanguage: 'unknown',
      };
    }

    if (germanScore > englishScore && germanScore > spanishScore) {
      detectedLanguage = 'de';
      confidence = Math.round((germanScore / totalScore) * 100);
    } else if (englishScore > germanScore && englishScore > spanishScore) {
      detectedLanguage = 'en';
      confidence = Math.round((englishScore / totalScore) * 100);
    } else if (spanishScore > germanScore && spanishScore > englishScore) {
      detectedLanguage = 'es';
      confidence = Math.round((spanishScore / totalScore) * 100);
    } else if (germanScore === englishScore && germanScore > spanishScore) {
      // Tie between German and English - check for umlauts as tiebreaker
      detectedLanguage = /ä|ö|ü|ß/.test(lowerText) ? 'de' : 'en';
      confidence = Math.round((germanScore / totalScore) * 100);
    } else if (englishScore === germanScore && englishScore > spanishScore) {
      detectedLanguage = 'en';
      confidence = Math.round((englishScore / totalScore) * 100);
    } else {
      detectedLanguage = 'en'; // Default to English for uncertain cases
      confidence = Math.round((maxScore / totalScore) * 100);
    }

    // Log confidence scores for debugging
    logger.debug('[LanguagePreference] Auto-detection confidence', {
      germanScore,
      englishScore,
      spanishScore,
      totalScore,
      detectedLanguage,
      confidence,
    });

    return {
      germanScore,
      englishScore,
      spanishScore,
      confidence,
      detectedLanguage,
    };
  }

  /**
   * Detect language from recent messages and calculate confidence
   * Useful for automatic language preference updates
   *
   * @param messages - Array of recent message texts
   * @returns Most likely language with confidence score
   */
  detectLanguageFromMessages(messages: string[]): { language: string; confidence: number } {
    if (messages.length === 0) {
      return { language: 'en', confidence: 0 };
    }

    let germanCount = 0;
    let englishCount = 0;
    let spanishCount = 0;
    let totalConfidence = 0;

    for (const message of messages) {
      const result = this.autoDetectLanguageWithConfidence(message);
      if (result.detectedLanguage === 'de') {
        germanCount++;
        totalConfidence += result.confidence;
      } else if (result.detectedLanguage === 'en') {
        englishCount++;
        totalConfidence += result.confidence;
      } else if (result.detectedLanguage === 'es') {
        spanishCount++;
        totalConfidence += result.confidence;
      }
    }

    const totalCount = messages.length;
    const avgConfidence = totalCount > 0 ? Math.round(totalConfidence / totalCount) : 0;

    // Determine most common language
    const maxCount = Math.max(germanCount, englishCount, spanishCount);

    if (maxCount === 0) {
      return { language: 'en', confidence: 0 };
    }

    let language = 'en';
    if (germanCount === englishCount && germanCount > spanishCount) {
      // Tie between German and English - need additional context
      language = 'en';
    } else if (germanCount > englishCount && germanCount > spanishCount) {
      language = 'de';
    } else if (englishCount >= germanCount && englishCount >= spanishCount) {
      language = 'en';
    } else if (spanishCount > germanCount && spanishCount > englishCount) {
      language = 'es';
    }

    return {
      language,
      confidence: avgConfidence,
    };
  }

  /**
   * Add detection to history for confidence tracking
   */
  addToHistory(chatId: string, language: string): void {
    if (!this.detectionHistory.has(chatId)) {
      this.detectionHistory.set(chatId, []);
    }

    const history = this.detectionHistory.get(chatId)!;
    history.push(language);

    // Keep history size bounded
    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    logger.debug('[LanguagePreference] Added to detection history', {
      chatId,
      language,
      historySize: history.length,
    });
  }

  /**
   * Get most detected language from history
   */
  getMostDetectedLanguage(chatId: string): { language: string; count: number } | null {
    const history = this.detectionHistory.get(chatId);
    if (!history || history.length === 0) {
      return null;
    }

    const counts: Record<string, number> = {};
    for (const lang of history) {
      counts[lang] = (counts[lang] || 0) + 1;
    }

    let maxCount = 0;
    let mostDetected = 'en';

    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        mostDetected = lang;
      }
    }

    return {
      language: mostDetected,
      count: maxCount,
    };
  }

  /**
   * Clear detection history for a chat
   */
  clearHistory(chatId: string): void {
    this.detectionHistory.delete(chatId);
    logger.debug('[LanguagePreference] Cleared detection history', { chatId });
  }

  /**
   * Generate language context for LLM system prompt
   *
   * @param language - Language code
   * @returns Context string for system prompt
   */
  getLanguageContext(language: string): string {
    const languageNames: Record<string, string> = {
      en: 'English',
      de: 'German',
      es: 'Spanish',
      unknown: 'English',
    };

    const langName = languageNames[language] || 'English';

    return `RESPOND IN: ${langName} (user's preferred language)

Important language instructions:
- Use ${langName} for all responses
- Match the user's language style (formal/casual)
- For code/technical terms, keep original English terms
- If unsure, default to ${langName}`;
  }

  /**
   * Validate language code
   *
   * @param language - Language code to validate
   * @returns True if language is supported
   */
  isValidLanguage(language: string): boolean {
    const supportedLanguages = ['en', 'de', 'es', 'fr', 'it', 'pt'];
    return supportedLanguages.includes(language.toLowerCase());
  }

  /**
   * Get language name from code
   *
   * @param language - Language code
   * @returns Human-readable language name
   */
  getLanguageName(language: string): string {
    const languageNames: Record<string, string> = {
      en: 'English',
      de: 'German',
      es: 'Spanish',
      fr: 'French',
      it: 'Italian',
      pt: 'Portuguese',
      unknown: 'English',
    };

    return languageNames[language.toLowerCase()] || 'English';
  }
}

// Export singleton instance
export const languagePreferenceService = new LanguagePreferenceService();
