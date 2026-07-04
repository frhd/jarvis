/**
 * Transcription Coordinator Service
 *
 * Coordinates voice message transcription.
 * Extracted from ProcessorService to follow single responsibility principle.
 *
 * Key responsibilities:
 * - Determine when to transcribe voice messages
 * - Handle sync vs async transcription based on chat type
 * - Update message text with transcript for response generation
 */

import type { Message, Chat } from '../../types/index.js';
import { TranscriptionService } from '../transcription.service.js';
import { logger } from '../../utils/logger.js';

export interface TranscriptionResult {
  success: boolean;
  transcribed: boolean;
  transcript?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface TranscriptionCoordinatorConfig {
  enabled: boolean;
  syncForPrivateChats: boolean;
  asyncForGroupChats: boolean;
}

const DEFAULT_CONFIG: TranscriptionCoordinatorConfig = {
  enabled: true,
  syncForPrivateChats: true,
  asyncForGroupChats: true,
};

/**
 * TranscriptionCoordinatorService
 *
 * Coordinates voice message transcription with different strategies
 * for private and group chats.
 *
 * - Private chats: Synchronous transcription (wait for result to enable response)
 * - Group chats: Asynchronous transcription (non-blocking, store for later)
 */
export class TranscriptionCoordinatorService {
  private config: TranscriptionCoordinatorConfig;
  private feedbackService: import('../voiceTranscriptionFeedback.service').VoiceTranscriptionFeedbackService | null = null;

  constructor(
    private transcriptionService: TranscriptionService | null,
    config?: Partial<TranscriptionCoordinatorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the feedback service for user notifications
   */
  setFeedbackService(service: import('../voiceTranscriptionFeedback.service').VoiceTranscriptionFeedbackService | null): void {
    this.feedbackService = service;
    logger.info('[TranscriptionCoordinator] Feedback service set', { hasService: !!service });
  }

  /**
   * Process voice message transcription
   *
   * @param message - The message to process (may be modified with transcript)
   * @param chat - The chat context
   * @param responseEnabled - Whether response generation is enabled
   * @returns Transcription result indicating what happened
   */
  async processVoiceMessage(
    message: Message,
    chat: Chat,
    responseEnabled: boolean
  ): Promise<TranscriptionResult> {
    // Check if transcription is applicable
    if (!this.shouldTranscribe(message)) {
      return {
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Not a voice message or transcription service unavailable',
      };
    }

    // Send immediate feedback that voice message was received
    // Use chat.telegramId (actual Telegram chat ID) instead of message.chatId (internal database ID)
    if (this.feedbackService && chat.telegramId && message.telegramMessageId) {
      try {
        await this.feedbackService.onVoiceMessageReceived(
          chat.telegramId,
          message.telegramMessageId
        );
        logger.debug('[TranscriptionCoordinator] Sent voice received feedback', {
          messageId: message.id,
          chatId: message.chatId,
          telegramId: chat.telegramId,
        });
      } catch (error) {
        logger.error('[TranscriptionCoordinator] Failed to send voice received feedback', {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // For private chats with response enabled, wait for transcription
    if (chat.type === 'private' && responseEnabled && this.config.syncForPrivateChats) {
      return this.transcribeSync(message, chat);
    }

    // For group chats, transcribe asynchronously
    if (this.config.asyncForGroupChats) {
      this.transcribeAsync(message, chat);
      return {
        success: true,
        transcribed: false,
        skipped: false,
      };
    }

    return {
      success: true,
      transcribed: false,
      skipped: true,
      skipReason: 'Async transcription disabled for group chats',
    };
  }

  /**
   * Synchronous transcription - waits for result
   *
   * Used for private chats where we need the transcript
   * to generate a response.
   */
  private async transcribeSync(message: Message, chat: Chat): Promise<TranscriptionResult> {
    if (!this.transcriptionService) {
      return {
        success: false,
        transcribed: false,
        skipped: true,
        skipReason: 'Transcription service not available',
      };
    }

    try {
      const result = await this.transcriptionService.transcribe(message, chat.telegramId);

      if (result.success && result.transcript) {
        // Update message text with transcript for response generation
        message.text = result.transcript;

        logger.info('[TranscriptionCoordinator] Voice message transcribed', {
          messageId: message.id,
          textLength: message.text.length,
        });

        return {
          success: true,
          transcribed: true,
          transcript: result.transcript,
        };
      }

      return {
        success: false,
        transcribed: false,
        skipReason: result.error || 'Transcription failed',
      };
    } catch (error) {
      logger.error('[TranscriptionCoordinator] Sync transcription failed', {
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        transcribed: false,
        skipReason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Asynchronous transcription - non-blocking
   *
   * Used for group chats where we don't need the transcript
   * for immediate response generation.
   */
  private transcribeAsync(message: Message, chat: Chat): void {
    if (!this.transcriptionService) {
      return;
    }

    this.transcriptionService.transcribeAsync(message, chat.telegramId);

    logger.debug('[TranscriptionCoordinator] Started async transcription', {
      messageId: message.id,
    });
  }

  /**
   * Check if a message should be transcribed
   */
  private shouldTranscribe(message: Message): boolean {
    if (!this.config.enabled) {
      logger.debug('[TranscriptionCoordinator] Transcription disabled', {
        messageId: message.id,
        mediaType: message.mediaType,
      });
      return false;
    }

    if (!this.transcriptionService) {
      logger.warn('[TranscriptionCoordinator] Transcription service not available', {
        messageId: message.id,
      });
      return false;
    }

    if (message.mediaType !== 'voice') {
      logger.debug('[TranscriptionCoordinator] Not a voice message', {
        messageId: message.id,
        mediaType: message.mediaType,
      });
      return false;
    }

    if (!message.mediaPath) {
      logger.warn('[TranscriptionCoordinator] No media path for voice message', {
        messageId: message.id,
        mediaType: message.mediaType,
        hasMediaPath: !!message.mediaPath,
      });
      return false;
    }

    // Verify media file exists
    // Note: We can't do async file check here, so we verify during transcription
    logger.debug('[TranscriptionCoordinator] Media path verification deferred to transcription phase', {
      messageId: message.id,
      mediaPath: message.mediaPath,
    });

    return true;
  }

  /**
   * Check if transcription is enabled and service is available
   */
  isEnabled(): boolean {
    return this.config.enabled && this.transcriptionService !== null;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<TranscriptionCoordinatorConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[TranscriptionCoordinator] Configuration updated', { config: this.config });
  }

  /**
   * Set transcription service (for late binding)
   */
  setTranscriptionService(service: TranscriptionService): void {
    this.transcriptionService = service;
    logger.info('[TranscriptionCoordinator] Transcription service set');
  }
}
