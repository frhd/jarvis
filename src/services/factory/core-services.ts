/**
 * Core Services Factory
 *
 * This module instantiates and exports core service instances that form the foundation
 * of the application. These services have minimal dependencies and are used throughout
 * the system.
 *
 * Core services include:
 * - FilterService: Chat/sender filtering based on allow/block rules
 * - MediaService: Media file handling and storage
 * - TelegramService: Telegram client wrapper
 * - LLMService: LLM client wrapper and response management
 * - MessageLengthService: Message length tracking and oversized message handling
 * - ContactService: Contact management and LLM context integration
 */

import { FilterService } from '../filter.service.js';
import { MediaService } from '../media.service.js';
import { TelegramService } from '../telegram.service.js';
import { LLMService } from '../llm.service.js';
import { MessageLengthService } from '../messageLength.service.js';
import { ContactService } from '../contact.service.js';
import { DeduplicationService } from '../deduplication.service.js';
import { ResponseDeduplicationService } from '../response-deduplication.service.js';
import { IdentityService } from '../identity.service.js';
import {
  chatFilterRepository,
  llmResponseRepository,
  contactRepository,
  userRepository,
  platformIdentityRepository,
  unifiedConversationRepository,
} from '../../repositories/index.js';

/**
 * Filter service for chat and sender filtering
 * Manages allow/block rules with priority-based filtering
 */
export const filterService = new FilterService(chatFilterRepository);

/**
 * Media service for handling media downloads and storage
 * Manages photos, documents, voice, video, and audio files
 */
export const mediaService = new MediaService();

/**
 * Deduplication service for preventing redundant message processing
 * Uses content hashing within time windows to detect duplicate messages
 */
export const deduplicationService = new DeduplicationService({
  windowMs: 60_000, // 60 seconds
  enabled: true,
  notifyOnDuplicate: true,
  notifyMessage: "I heard you the first time! 😄",
});

/**
 * Response deduplication service for preventing duplicate responses
 * Uses content hashing within time windows to detect duplicate responses
 */
export const responseDeduplicationService = new ResponseDeduplicationService({
  windowMs: 300_000, // 5 minutes
  enabled: true,
});

/**
 * Telegram service for Telegram client operations
 * Provides wrapper around TDLib for message sending and client management
 * Only instantiated when Telegram is enabled (requires API_ID/API_HASH)
 */
import { appConfig } from '../../config/index.js';
export const telegramService: TelegramService = appConfig.telegram.enabled
  ? new TelegramService()
  : (null as unknown as TelegramService);

/**
 * LLM service for LLM client operations and response management
 * Provides wrapper around Ollama and response persistence
 */
export const llmService = new LLMService(llmResponseRepository);

/**
 * Message length service for tracking and handling oversized messages
 * Manages message length metrics, summarization, and truncation
 */
export const messageLengthService = new MessageLengthService();

/**
 * Contact service for managing user contacts
 * Handles contact lookup, save, deletion, and LLM context integration
 */
export const contactService = new ContactService(contactRepository);

/**
 * Identity service for platform-agnostic user/conversation resolution
 * Resolves platform-specific IDs into unified internal IDs
 */
export const identityService = new IdentityService(
  userRepository,
  platformIdentityRepository,
  unifiedConversationRepository
);
