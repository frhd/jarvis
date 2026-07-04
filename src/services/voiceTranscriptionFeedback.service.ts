/**
 * Voice Transcription Feedback Service
 *
 * Provides user feedback for voice message processing.
 * Sends status updates when voice messages are received, processed,
 * and when transcription completes or fails.
 */

import { TelegramService } from './telegram.service';
import { logger } from '../utils/logger';

export interface FeedbackConfig {
  enabled: boolean;
  showProcessingStatus: boolean;
  showTranscriptPreview: boolean;
  showFailureDetails: boolean;
}

const DEFAULT_CONFIG: FeedbackConfig = {
  enabled: true,
  showProcessingStatus: true,
  showTranscriptPreview: true,
  showFailureDetails: true,
};

export class VoiceTranscriptionFeedbackService {
  private config: FeedbackConfig;

  constructor(
    private telegramService: TelegramService,
    config?: Partial<FeedbackConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Send immediate feedback when voice message is received
   */
  async onVoiceMessageReceived(
    chatId: string | number,
    messageId: number
  ): Promise<void> {
    if (!this.config.enabled || !this.config.showProcessingStatus) {
      return;
    }

    try {
      const message = '🎤 Voice message received. Transcribing...';
      await this.telegramService.sendMessage(chatId, message, messageId);

      logger.debug('[VoiceFeedback] Sent received feedback', { chatId, messageId });
    } catch (error) {
      logger.error('[VoiceFeedback] Failed to send received feedback', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send feedback when transcription completes successfully
   */
  async onTranscriptionComplete(
    chatId: string | number,
    originalMessageId: number,
    transcript: string,
    durationMs?: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Send full transcript in the format: 🎤 Transcript: [transcribed text]
      let message = `🎤 Transcript: ${transcript}`;

      // Add processing time if configured
      if (durationMs && durationMs > 0) {
        const seconds = (durationMs / 1000).toFixed(1);
        message += `\n\n⏱️ Processed in ${seconds}s`;
      }

      await this.telegramService.sendMessage(chatId, message, originalMessageId);

      logger.info('[VoiceFeedback] Sent completion feedback with full transcript', {
        chatId,
        transcriptLength: transcript.length,
        durationMs,
      });
    } catch (error) {
      logger.error('[VoiceFeedback] Failed to send completion feedback', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send feedback when transcription fails
   */
  async onTranscriptionFailed(
    chatId: string | number,
    originalMessageId: number,
    error: string,
    errorCategory?: string
  ): Promise<void> {
    if (!this.config.enabled || !this.config.showFailureDetails) {
      return;
    }

    try {
      let message = '❌ Transcription failed';

      if (this.config.showFailureDetails) {
        message += '\n\nError: ' + error;

        // Provide context based on error category
        const suggestions = this.getErrorSuggestion(errorCategory);
        if (suggestions) {
          message += '\n\n' + suggestions;
        }
      }

      await this.telegramService.sendMessage(chatId, message, originalMessageId);

      logger.warn('[VoiceFeedback] Sent failure feedback', {
        chatId,
        error,
        errorCategory,
      });
    } catch (error) {
      logger.error('[VoiceFeedback] Failed to send failure feedback', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get user-friendly suggestion based on error type
   */
  private getErrorSuggestion(errorCategory?: string): string | null {
    const suggestions: Record<string, string> = {
      file_access: 'The voice file could not be accessed. Please try sending the message again.',
      service_unavailable: 'The transcription service is currently unavailable. Please try again later.',
      timeout: 'The transcription took too long. Try a shorter voice message.',
      network: 'There was a network error. Please check your connection and try again.',
      transcript_empty: 'The audio was transcribed but no speech was detected.',
    };

    return suggestions[errorCategory || ''] || 'Please try sending the voice message again.';
  }

  /**
   * Update feedback configuration
   */
  updateConfig(updates: Partial<FeedbackConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[VoiceFeedback] Configuration updated', { config: this.config });
  }
}
