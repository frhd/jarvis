import type { Message, Chat } from '../../types/index.js';
import type { IChatRepository } from '../../interfaces/repositories.js';
import { logger } from '../../utils/logger.js';
import { languagePreferenceService } from '../languagePreference.service.js';
import {
  MIN_SEARCH_QUERY_LENGTH,
  LANGUAGE_DETECTION_MESSAGE_COUNT,
  LANGUAGE_CONFIDENCE_THRESHOLD_PERCENT,
  LANGUAGE_PATTERN_MIN_COUNT,
} from './llm-router.constants.js';

/**
 * Dependencies required for language preference operations.
 *
 * The cache is passed by reference so updates persist on the owning service.
 */
export interface LanguageDeps {
  chatRepository: IChatRepository | null;
  /** Per-chat language preferences (in-memory cache) */
  cache: Map<string, string>;
}

/**
 * Handle language detection and preference updates from message
 *
 * @param deps - Language dependencies (chat repository, cache)
 * @param message - The message to analyze for language
 * @param chat - Optional chat for storing preferences
 * @param conversationHistory - Recent messages for auto-detection
 */
export async function handleLanguageDetection(
  deps: LanguageDeps,
  message: Message,
  chat: Chat | undefined,
  conversationHistory: Message[]
): Promise<void> {
  if (!message.text || !chat) {
    return;
  }

  // First, check for explicit language switch request
  const languageSwitch = languagePreferenceService.detectLanguageSwitch(message.text);
  if (languageSwitch) {
    // Store the language preference for this chat (persist to database)
    await setLanguagePreference(deps, chat.id, languageSwitch.language);
    // Clear history when explicit switch is detected
    languagePreferenceService.addToHistory(chat.id, languageSwitch.language);
    logger.info('[LLMRouter] Language switch detected, updating preference', {
      chatId: chat.id,
      newLanguage: languageSwitch.language,
    });
    return;
  }

  // Skip auto-detection if no conversation history
  if (conversationHistory.length === 0) {
    return;
  }

  // Auto-detect language from recent messages (including current)
  const recentMessages = conversationHistory
    .filter(m => m.text && m.text.trim().length > MIN_SEARCH_QUERY_LENGTH)
    .slice(0, LANGUAGE_DETECTION_MESSAGE_COUNT)
    .map(m => m.text!);

  const autoDetect = languagePreferenceService.detectLanguageFromMessages(recentMessages);

  // Add to history
  languagePreferenceService.addToHistory(chat.id, autoDetect.language);

  // Check if we have enough history to make a confident decision
  if (autoDetect.confidence <= LANGUAGE_CONFIDENCE_THRESHOLD_PERCENT) {
    return;
  }

  // Get most detected language from history
  const mostDetected = languagePreferenceService.getMostDetectedLanguage(chat.id);
  if (!mostDetected || mostDetected.count < LANGUAGE_PATTERN_MIN_COUNT) {
    return;
  }

  // Only update if there's a clear pattern and different from current
  const currentPref = chat.preferredLanguage || 'unknown';
  if (currentPref !== mostDetected.language) {
    await setLanguagePreference(deps, chat.id, mostDetected.language);
    logger.info('[LLMRouter] Auto-detected language preference, updating', {
      chatId: chat.id,
      detectedLanguage: mostDetected.language,
      count: mostDetected.count,
      confidence: autoDetect.confidence,
    });
  }
}

/**
 * Get language preference for a chat
 * Returns stored preference or 'en' as default
 * First checks in-memory cache, then database
 */
export async function getLanguagePreference(deps: LanguageDeps, chatId: string): Promise<string> {
  // Check in-memory cache first
  if (deps.cache.has(chatId)) {
    return deps.cache.get(chatId)!;
  }

  // Fall back to database
  if (deps.chatRepository) {
    try {
      const chat = await deps.chatRepository.findById(chatId);
      if (chat && chat.preferredLanguage) {
        // Cache the result
        deps.cache.set(chatId, chat.preferredLanguage);
        return chat.preferredLanguage;
      }
    } catch (error) {
      logger.warn('[LLMRouter] Failed to fetch language preference from database', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return 'en'; // Default to English
}

/**
 * Update language preference for a chat
 * Persists to database and updates in-memory cache
 */
export async function setLanguagePreference(
  deps: LanguageDeps,
  chatId: string,
  language: string
): Promise<void> {
  // Update in-memory cache
  deps.cache.set(chatId, language);

  // Persist to database
  if (deps.chatRepository) {
    try {
      await deps.chatRepository.updatePreferredLanguage(chatId, language);
      logger.info('[LLMRouter] Language preference persisted to database', {
        chatId,
        language,
      });
    } catch (error) {
      logger.warn('[LLMRouter] Failed to persist language preference to database', {
        chatId,
        language,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
