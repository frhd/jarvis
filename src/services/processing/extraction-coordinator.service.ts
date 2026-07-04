/**
 * Extraction Coordinator Service
 *
 * Coordinates memory and preference extraction from messages.
 * Extracted from ProcessorService to follow single responsibility principle.
 *
 * Key responsibilities:
 * - Extract memories from messages (async, non-blocking)
 * - Extract user preferences from messages (async, non-blocking)
 * - Provide context for better extraction quality
 * - Retry failed extractions with exponential backoff
 * - Track extraction status per message
 */

import type { Message, Sender } from '../../types/index.js';
import { MemoryService } from '../memory.service.js';
import { UserPreferenceService } from '../userPreference.service.js';
import { MessageRepository } from '../../repositories/message.repository.js';
import { logger } from '../../utils/logger.js';
import { isOllamaOverloaded, getOllamaActiveRequests } from '../../utils/ollama-load-tracker.js';

export interface ExtractionResult {
  memoriesExtracted: number;
  preferencesExtracted: number;
}

export interface ExtractionStatus {
  messageId: string;
  memoryStatus: 'pending' | 'processing' | 'completed' | 'failed';
  preferenceStatus: 'pending' | 'processing' | 'completed' | 'failed';
  memoryAttempts: number;
  preferenceAttempts: number;
  memoryError?: string;
  preferenceError?: string;
  lastAttemptAt?: Date;
}

export interface ExtractionCoordinatorConfig {
  contextWindowSize: number;
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_CONFIG: ExtractionCoordinatorConfig = {
  contextWindowSize: 5,
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * ExtractionCoordinatorService
 *
 * Coordinates extraction of memories and preferences from user messages.
 * Both operations run asynchronously in the background to avoid blocking
 * message processing.
 *
 * Features:
 * - Retry logic with exponential backoff (up to 3 attempts)
 * - Status tracking per message
 * - Extraction metrics for monitoring
 */
export class ExtractionCoordinatorService {
  private config: ExtractionCoordinatorConfig;
  private extractionStatuses: Map<string, ExtractionStatus> = new Map();

  constructor(
    private memoryService: MemoryService | null,
    private userPreferenceService: UserPreferenceService | null,
    private messageRepository: MessageRepository,
    config?: Partial<ExtractionCoordinatorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.2 * exponentialDelay; // ±10% jitter
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get extraction status for a message
   */
  getExtractionStatus(messageId: string): ExtractionStatus | undefined {
    return this.extractionStatuses.get(messageId);
  }

  /**
   * Get all extraction statuses (for monitoring)
   */
  getAllStatuses(): ExtractionStatus[] {
    return Array.from(this.extractionStatuses.values());
  }

  /**
   * Get extraction statistics
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    avgAttempts: number;
  } {
    const statuses = this.getAllStatuses();
    const completed = statuses.filter(
      s => s.memoryStatus === 'completed' && s.preferenceStatus === 'completed'
    ).length;
    const failed = statuses.filter(
      s => s.memoryStatus === 'failed' || s.preferenceStatus === 'failed'
    ).length;
    const pending = statuses.filter(
      s => s.memoryStatus === 'pending' || s.memoryStatus === 'processing' ||
           s.preferenceStatus === 'pending' || s.preferenceStatus === 'processing'
    ).length;
    const totalAttempts = statuses.reduce(
      (sum, s) => sum + s.memoryAttempts + s.preferenceAttempts, 0
    );

    return {
      total: statuses.length,
      pending,
      completed,
      failed,
      avgAttempts: statuses.length > 0 ? totalAttempts / (statuses.length * 2) : 0,
    };
  }

  /**
   * Clear old statuses (keep last 1000)
   */
  private pruneStatuses(): void {
    if (this.extractionStatuses.size > 1000) {
      const entries = Array.from(this.extractionStatuses.entries());
      entries.sort((a, b) => {
        const aTime = a[1].lastAttemptAt?.getTime() ?? 0;
        const bTime = b[1].lastAttemptAt?.getTime() ?? 0;
        return aTime - bTime;
      });
      // Remove oldest entries
      const toRemove = entries.slice(0, entries.length - 1000);
      for (const [key] of toRemove) {
        this.extractionStatuses.delete(key);
      }
    }
  }

  /**
   * Extract all relevant information from a message
   *
   * Both memory and preference extraction are run asynchronously
   * to avoid blocking message processing. Includes retry logic
   * with exponential backoff.
   *
   * @param message - The message to extract from
   * @param sender - The sender of the message
   */
  extractAll(message: Message, sender: Sender, identityOptions?: { userId?: string; conversationId?: string }): void {
    if (!this.config.enabled) {
      return;
    }

    // Initialize status tracking for this message
    this.extractionStatuses.set(message.id, {
      messageId: message.id,
      memoryStatus: 'pending',
      preferenceStatus: 'pending',
      memoryAttempts: 0,
      preferenceAttempts: 0,
      lastAttemptAt: new Date(),
    });

    // Prune old statuses periodically
    this.pruneStatuses();

    // Run both extractions in parallel, non-blocking
    this.extractMemoriesAsync(message, sender, identityOptions);
    this.extractPreferencesAsync(message, sender);
  }

  /**
   * Extract memories asynchronously (non-blocking) with retry logic
   *
   * Fetches recent context for better extraction quality and stores
   * extracted facts in the memory system. Retries up to maxRetries
   * times with exponential backoff.
   *
   * @param message - The message to extract memories from
   * @param sender - The sender of the message
   */
  extractMemoriesAsync(message: Message, sender: Sender, identityOptions?: { userId?: string; conversationId?: string }): void {
    if (!this.memoryService) return;

    // Skip if Ollama is already overloaded — memory extraction is non-critical background work
    if (isOllamaOverloaded()) {
      logger.debug('[ExtractionCoordinator] Skipping memory extraction (Ollama busy)', {
        messageId: message.id,
        activeRequests: getOllamaActiveRequests(),
      });
      const status = this.extractionStatuses.get(message.id);
      if (status) {
        status.memoryStatus = 'failed';
        status.memoryError = 'Skipped: Ollama overloaded';
      }
      return;
    }

    // Run in background with retry logic
    (async () => {
      const status = this.extractionStatuses.get(message.id);
      if (status) {
        status.memoryStatus = 'processing';
      }

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          if (status) {
            status.memoryAttempts = attempt + 1;
            status.lastAttemptAt = new Date();
          }

          // Fetch recent context for better extraction
          const context = await this.messageRepository.findRecentByChatId(
            message.chatId,
            this.config.contextWindowSize
          );

          const result = await this.memoryService!.extractAndStore(
            message,
            context,
            identityOptions
          );

          // Success
          if (status) {
            status.memoryStatus = 'completed';
            delete status.memoryError;
          }

          if (result.facts.length > 0) {
            logger.info('[ExtractionCoordinator] Extracted memories', {
              messageId: message.id,
              factCount: result.facts.length,
              attempt: attempt + 1,
            });
          }
          return; // Exit on success
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (status) {
            status.memoryError = errorMessage;
          }

          // Check if we should retry
          if (attempt < this.config.maxRetries - 1) {
            const delay = this.calculateBackoffDelay(attempt);
            logger.warn('[ExtractionCoordinator] Memory extraction failed, retrying', {
              messageId: message.id,
              attempt: attempt + 1,
              maxRetries: this.config.maxRetries,
              nextRetryDelayMs: delay,
              error: errorMessage,
            });
            await this.sleep(delay);
          } else {
            // Final failure
            if (status) {
              status.memoryStatus = 'failed';
            }
            logger.error('[ExtractionCoordinator] Memory extraction failed after all retries', {
              messageId: message.id,
              totalAttempts: attempt + 1,
              error: errorMessage,
            });
          }
        }
      }
    })().catch(err => {
      logger.warn('[ExtractionCoordinator] Unhandled error in memory extraction', {
        messageId: message.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });
  }

  /**
   * Extract preferences asynchronously (non-blocking) with retry logic
   *
   * Fetches recent context for better extraction quality and stores
   * extracted preferences in the user preference system. Retries up to
   * maxRetries times with exponential backoff.
   *
   * @param message - The message to extract preferences from
   * @param sender - The sender of the message
   */
  extractPreferencesAsync(message: Message, sender: Sender): void {
    if (!this.userPreferenceService) return;

    // Skip if Ollama is already overloaded — preference extraction is non-critical background work
    if (isOllamaOverloaded()) {
      logger.debug('[ExtractionCoordinator] Skipping preference extraction (Ollama busy)', {
        messageId: message.id,
        activeRequests: getOllamaActiveRequests(),
      });
      const status = this.extractionStatuses.get(message.id);
      if (status) {
        status.preferenceStatus = 'failed';
        status.preferenceError = 'Skipped: Ollama overloaded';
      }
      return;
    }

    // Run in background with retry logic
    (async () => {
      const status = this.extractionStatuses.get(message.id);
      if (status) {
        status.preferenceStatus = 'processing';
      }

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          if (status) {
            status.preferenceAttempts = attempt + 1;
            status.lastAttemptAt = new Date();
          }

          // Fetch recent context for better extraction
          const context = await this.messageRepository.findRecentByChatId(
            message.chatId,
            this.config.contextWindowSize
          );

          const result = await this.userPreferenceService!.extractAndStore(
            message,
            sender,
            context
          );

          // Success
          if (status) {
            status.preferenceStatus = 'completed';
            delete status.preferenceError;
          }

          if (result.preferences.length > 0) {
            logger.info('[ExtractionCoordinator] Extracted preferences', {
              messageId: message.id,
              preferenceCount: result.preferences.length,
              attempt: attempt + 1,
            });
          }
          return; // Exit on success
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (status) {
            status.preferenceError = errorMessage;
          }

          // Check if we should retry
          if (attempt < this.config.maxRetries - 1) {
            const delay = this.calculateBackoffDelay(attempt);
            logger.warn('[ExtractionCoordinator] Preference extraction failed, retrying', {
              messageId: message.id,
              attempt: attempt + 1,
              maxRetries: this.config.maxRetries,
              nextRetryDelayMs: delay,
              error: errorMessage,
            });
            await this.sleep(delay);
          } else {
            // Final failure
            if (status) {
              status.preferenceStatus = 'failed';
            }
            logger.error('[ExtractionCoordinator] Preference extraction failed after all retries', {
              messageId: message.id,
              totalAttempts: attempt + 1,
              error: errorMessage,
            });
          }
        }
      }
    })().catch(err => {
      logger.warn('[ExtractionCoordinator] Unhandled error in preference extraction', {
        messageId: message.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });
  }

  /**
   * Check if extraction is enabled and services are available
   */
  isEnabled(): boolean {
    return this.config.enabled && (this.memoryService !== null || this.userPreferenceService !== null);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ExtractionCoordinatorConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[ExtractionCoordinator] Configuration updated', { config: this.config });
  }
}
