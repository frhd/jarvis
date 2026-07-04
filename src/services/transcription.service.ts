/**
 * Transcription Service
 *
 * Handles voice message transcription using the Whisper API.
 * Integrates with VoiceProcessingService and MessageRepository
 * for async transcription with database persistence.
 * Provides user feedback via VoiceTranscriptionFeedbackService.
 */

import { createLogger } from '../utils/logger';
import { VoiceProcessingService } from './voiceProcessing.service';
import { MessageRepository } from '../repositories/message.repository';
import { appConfig } from '../config';
import { Message } from '../types';
import type { VoiceTranscriptionFeedbackService } from './voiceTranscriptionFeedback.service';

const logger = createLogger('TranscriptionService');

export interface TranscriptionResult {
  success: boolean;
  transcript?: string;
  language?: string;
  durationMs?: number;
  error?: string;
  errorCategory?: 'network' | 'file_access' | 'service_unavailable' | 'timeout' | 'transcript_empty' | 'unknown';
}

export class TranscriptionService {
  private transcriptionCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private lastHealthCheck: Date | null = null;
  private isHealthy = true;

  constructor(
    private voiceProcessingService: VoiceProcessingService,
    private messageRepository: MessageRepository,
    private feedbackService: VoiceTranscriptionFeedbackService | null = null
  ) {}

  /**
   * Set the feedback service (for dependency injection)
   */
  setFeedbackService(feedbackService: VoiceTranscriptionFeedbackService): void {
    this.feedbackService = feedbackService;
    logger.info('[Transcription] Feedback service set');
  }

  /**
   * Get transcription health status
   */
  getHealthStatus(): {
    isHealthy: boolean;
    totalTranscriptions: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    lastHealthCheck: Date | null;
  } {
    const successRate = this.transcriptionCount > 0
      ? (this.successCount / this.transcriptionCount) * 100
      : 100;

    return {
      isHealthy: this.isHealthy,
      totalTranscriptions: this.transcriptionCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
      lastHealthCheck: this.lastHealthCheck,
    };
  }

  /**
   * Categorize transcription error
   */
  private categorizeError(error: string): TranscriptionResult['errorCategory'] {
    const lowerError = error.toLowerCase();

    if (lowerError.includes('enoent') || lowerError.includes('no such file')) {
      return 'file_access';
    }
    if (lowerError.includes('econnrefused') || lowerError.includes('connection refused')) {
      return 'service_unavailable';
    }
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return 'timeout';
    }
    if (lowerError.includes('network') || lowerError.includes('econnreset')) {
      return 'network';
    }
    if (lowerError.includes('empty') || lowerError.includes('no text')) {
      return 'transcript_empty';
    }

    return 'unknown';
  }

  /**
   * Transcribe a voice message asynchronously (non-blocking).
   * Marks the message as pending and processes in the background.
   *
   * @param message - The message to transcribe
   * @param telegramChatId - The actual Telegram chat ID (not the internal UUID). Required for sending feedback messages.
   */
  transcribeAsync(message: Message, telegramChatId?: string | number): void {
    if (!appConfig.whisper.enabled) {
      logger.debug('[Transcription] Whisper disabled, skipping transcription');
      return;
    }

    if (message.mediaType !== 'voice' || !message.mediaPath) {
      logger.debug('[Transcription] Not a voice message or no media path', {
        messageId: message.id,
        mediaType: message.mediaType,
      });
      return;
    }

    // Fire and forget - don't await
    // Note: Voice received feedback is sent by TranscriptionCoordinatorService
    // to avoid duplicate notifications
    (async () => {
      try {
        await this.transcribe(message, telegramChatId);
      } catch (error) {
        logger.error('[Transcription] Async transcription failed', {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
  }

  /**
   * Transcribe a voice message synchronously.
   * Returns the transcription result.
   *
   * @param message - The message to transcribe
   * @param telegramChatId - The actual Telegram chat ID (not the internal UUID). Required for sending feedback messages.
   */
  async transcribe(message: Message, telegramChatId?: string | number): Promise<TranscriptionResult> {
    this.transcriptionCount++;
    this.lastHealthCheck = new Date();

    if (!message.mediaPath) {
      this.failureCount++;
      logger.error('[Transcription] No media path provided', {
        messageId: message.id,
      });
      return { success: false, error: 'No media path', errorCategory: 'file_access' };
    }

    try {
      // Mark as processing
      await this.messageRepository.markTranscriptProcessing(message.id);

      logger.info('[Transcription] Starting', {
        messageId: message.id,
        mediaPath: message.mediaPath,
        totalTranscriptions: this.transcriptionCount,
      });

      const startTime = Date.now();

      // Call Whisper API through VoiceProcessingService
      const result = await this.voiceProcessingService.transcribe(message.mediaPath, {
        responseFormat: 'json',
      });

      const durationMs = Date.now() - startTime;

      // Check for empty transcript
      if (!result.text || result.text.trim().length === 0) {
        this.failureCount++;
        await this.messageRepository.markTranscriptFailed(message.id, 'Empty transcript returned');

        logger.warn('[Transcription] Empty transcript', {
          messageId: message.id,
          durationMs,
        });

        // Send feedback on empty transcript
        if (this.feedbackService && (telegramChatId || message.chatId)) {
          this.feedbackService.onTranscriptionFailed(
            telegramChatId || message.chatId,
            message.telegramMessageId,
            'Empty transcript returned',
            'transcript_empty'
          ).catch((error) => {
            logger.error('[Transcription] Failed to send failure feedback', {
              messageId: message.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        }

        return {
          success: false,
          error: 'Empty transcript returned',
          errorCategory: 'transcript_empty',
          durationMs,
        };
      }

      // Update database with transcription result
      await this.messageRepository.updateTranscript(message.id, {
        transcript: result.text,
        language: result.language,
        durationMs,
      });

      this.successCount++;
      this.isHealthy = this.successCount > (this.failureCount * 0.8); // Healthy if success rate > 44%

      logger.info('[Transcription] Completed', {
        messageId: message.id,
        textLength: result.text.length,
        language: result.language,
        durationMs,
        healthStatus: this.getHealthStatus(),
      });

      // Send feedback on successful transcription
      if (this.feedbackService && (telegramChatId || message.chatId)) {
        logger.debug('[Transcription] Sending transcription completion feedback', {
          messageId: message.id,
          chatId: telegramChatId || message.chatId,
          feedbackServiceAvailable: true,
        });
        this.feedbackService.onTranscriptionComplete(
          telegramChatId || message.chatId,
          message.telegramMessageId,
          result.text,
          durationMs
        ).catch((error) => {
          logger.error('[Transcription] Failed to send completion feedback', {
            messageId: message.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      } else {
        logger.warn('[Transcription] Feedback service not available for completion', {
          messageId: message.id,
          hasFeedbackService: !!this.feedbackService,
          hasChatId: !!(telegramChatId || message.chatId),
        });
      }

      return {
        success: true,
        transcript: result.text,
        language: result.language,
        durationMs,
      };
    } catch (error) {
      this.failureCount++;
      this.isHealthy = false;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCategory = this.categorizeError(errorMessage);

      // Mark as failed in database
      await this.messageRepository.markTranscriptFailed(message.id, errorMessage);

      logger.error('[Transcription] Failed', {
        messageId: message.id,
        error: errorMessage,
        errorCategory,
        healthStatus: this.getHealthStatus(),
      });

      // Send feedback on transcription failure
      if (this.feedbackService && (telegramChatId || message.chatId)) {
        logger.debug('[Transcription] Sending transcription failure feedback', {
          messageId: message.id,
          chatId: telegramChatId || message.chatId,
          feedbackServiceAvailable: true,
        });
        this.feedbackService.onTranscriptionFailed(
          telegramChatId || message.chatId,
          message.telegramMessageId,
          errorMessage,
          errorCategory
        ).catch((feedbackError) => {
          logger.error('[Transcription] Failed to send failure feedback', {
            messageId: message.id,
            error: feedbackError instanceof Error ? feedbackError.message : 'Unknown error',
          });
        });
      } else {
        logger.warn('[Transcription] Feedback service not available for failure', {
          messageId: message.id,
          hasFeedbackService: !!this.feedbackService,
          hasChatId: !!(telegramChatId || message.chatId),
        });
      }

      return { success: false, error: errorMessage, errorCategory };
    }
  }

  /**
   * Process pending transcriptions (for recovery after restart).
   */
  async processPendingTranscriptions(limit: number = 50): Promise<number> {
    if (!appConfig.whisper.enabled) {
      return 0;
    }

    const pending = await this.messageRepository.findPendingTranscriptions(limit);

    if (pending.length === 0) {
      return 0;
    }

    logger.info('[Transcription] Processing pending transcriptions', {
      count: pending.length,
    });

    let processed = 0;
    for (const message of pending) {
      try {
        const result = await this.transcribe(message);
        if (result.success) {
          processed++;
        }
      } catch (error) {
        logger.error('[Transcription] Failed to process pending message', {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('[Transcription] Finished processing pending transcriptions', {
      processed,
      total: pending.length,
    });

    return processed;
  }
}
