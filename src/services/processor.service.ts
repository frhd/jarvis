/**
 * Processor Service - Thin Orchestrator
 *
 * Coordinates message processing by delegating to focused services:
 * - ExtractionCoordinatorService: Memory and preference extraction
 * - RetryCoordinatorService: Retry logic and dead letter queue
 * - TranscriptionCoordinatorService: Voice message transcription
 * - ResponseRouterService: Response generation
 *
 * Refactored from 601 lines to ~200 lines following Phase 5 decomposition plan.
 */

import type { Message, Chat, Sender, QueueItem, ProcessingResult } from '../types/index.js';
import { QueueRepository } from '../repositories/queue.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { LLMService } from './llm.service.js';
import { ResponseRouterService } from './responseRouter.service.js';
import { TelegramService } from './telegram.service.js';
import { MessageLengthService, MessageLengthResult } from './messageLength.service.js';
import { MetricsService } from './metrics.service.js';
import { ResponseDeduplicationService } from './response-deduplication.service.js';
import { MESSAGE_PREVIEW_LENGTH } from '../config/constants.js';
import {
  ExtractionCoordinatorService,
  RetryCoordinatorService,
  TranscriptionCoordinatorService,
} from './processing/index.js';
import { appConfig } from '../config/index.js';
import { featureFlags, FeatureFlagNames } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';
import { languagePreferenceService } from './languagePreference.service.js';
import { chatRepository } from '../repositories/chat.repository.js';
import type { ITherapistService } from '../interfaces/therapist.js';

/** Maximum message length supported by Telegram API (in characters) */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Fallback truncation length with buffer for ellipsis (in characters) */
const FALLBACK_TRUNCATION_LENGTH = 4000;

/**
 * ProcessorService - Thin Orchestrator
 *
 * Coordinates message processing using focused coordinator services.
 */
export class ProcessorService {
  private messageLengthService: MessageLengthService | null = null;
  private metricsService: MetricsService | null = null;
  private therapistService: ITherapistService | null = null;
  private responseDeduplicationService: ResponseDeduplicationService | null = null;

  constructor(
    private queueRepository: QueueRepository,
    private llmService: LLMService,
    private responseRouter: ResponseRouterService,
    private messageRepository: MessageRepository,
    private telegramService: TelegramService,
    private extractionCoordinator: ExtractionCoordinatorService,
    private retryCoordinator: RetryCoordinatorService,
    private transcriptionCoordinator: TranscriptionCoordinatorService,
    responseDeduplicationService?: ResponseDeduplicationService
  ) {
    this.responseDeduplicationService = responseDeduplicationService || null;
  }

  setMessageLengthService(service: MessageLengthService): void {
    this.messageLengthService = service;
  }

  setMetricsService(service: MetricsService): void {
    this.metricsService = service;
  }

  setTherapistService(service: ITherapistService): void {
    this.therapistService = service;
  }

  getErrorHistorySize(): number {
    return this.retryCoordinator.getErrorHistorySize();
  }

  stop(): void {
    this.retryCoordinator.stop();
  }

  async processMessage(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<ProcessingResult> {
    try {
      logger.info('[Processor] Processing message', {
        messageId: message.id,
        chatTitle: chat.title || chat.telegramId,
        senderName: sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'Unknown' : 'Unknown',
        textPreview: message.text?.substring(0, MESSAGE_PREVIEW_LENGTH),
      });

      // 1. Detect and save language preference (async, non-blocking)
      if (sender && message.text) {
        this.detectAndSaveLanguagePreference(message, chat).catch(err => {
          logger.warn('[Processor] Language detection failed (non-critical)', {
            messageId: message.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
      }

      // 2. Extract memories and preferences (async, non-blocking)
      if (sender && appConfig.memory.enabled) {
        try {
          this.extractionCoordinator.extractAll(message, sender, identityOptions);
        } catch (err) {
          logger.warn('[Processor] Extraction coordinator failed (non-critical)', {
            messageId: message.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      // 2. Transcribe voice messages
      await this.transcriptionCoordinator.processVoiceMessage(
        message,
        chat,
        appConfig.response.enabled
      );

      // 3. Try therapist mode for non-private chats
      if (chat.type !== 'private' && this.therapistService && identityOptions?.conversationId) {
        const therapistResponse = await this.therapistService.processAndGenerateResponse(
          identityOptions.conversationId,
          message,
          null,
          identityOptions
        );

        if (therapistResponse) {
          return {
            success: true,
            response: 'Response generated via therapist mode',
          };
        }
      }

      // 4. Generate and send response (private chats only)
      if (this.shouldGenerateResponse(chat, message)) {
        await this.generateAndSendResponse(message, chat, sender, identityOptions);
        return {
          success: true,
          response: 'Response generated via router',
        };
      }

      // 5. Perform LLM analysis for non-response scenarios
      const analysis = await this.llmService.analyzeMessage(message, chat, sender, 'analysis');

      if (!analysis.success) {
        if (appConfig.llm.skipOnUnhealthy) {
          logger.warn('[Processor] LLM failed, marking complete anyway', {
            messageId: message.id,
            error: analysis.error,
          });
          return {
            success: true,
            response: 'Processed without LLM (service unavailable)',
          };
        }
        return {
          success: false,
          error: analysis.error,
        };
      }

      return {
        success: true,
        response: analysis.content,
        llmResponseId: analysis.responseId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Processor] Error processing message', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async handleProcessingResult(
    queueItem: QueueItem,
    result: ProcessingResult
  ): Promise<void> {
    await this.retryCoordinator.handleResult(queueItem, result);
  }

  private shouldGenerateResponse(chat: Chat, message: Message): boolean {
    if (chat.type !== 'private') return false;
    if (message.isBot) return false;
    if (!appConfig.response.enabled) return false;
    if (!message.text || message.text.trim().length === 0) return false;
    return true;
  }

  /**
   * Detect and save language preference from message
   */
  private async detectAndSaveLanguagePreference(message: Message, chat: Chat): Promise<void> {
    try {
      const messageText = message.text || '';

      // Check for explicit language switch request first
      const switchRequest = languagePreferenceService.detectLanguageSwitch(messageText);
      if (switchRequest && switchRequest.detected) {
        await chatRepository.updatePreferredLanguage(chat.id, switchRequest.language);
        logger.info('[Processor] Language preference updated', {
          chatId: chat.id,
          language: switchRequest.language,
          originalText: messageText.substring(0, MESSAGE_PREVIEW_LENGTH),
        });
        return;
      }

      // Auto-detect language from message content
      const detectedLanguage = languagePreferenceService.autoDetectLanguage(messageText);
      if (detectedLanguage !== 'unknown' && detectedLanguage !== chat.preferredLanguage) {
        await chatRepository.updatePreferredLanguage(chat.id, detectedLanguage);
        logger.debug('[Processor] Language auto-detected and saved', {
          chatId: chat.id,
          language: detectedLanguage,
          previousPreference: chat.preferredLanguage,
        });
      }
    } catch (error) {
      logger.error('[Processor] Failed to detect/save language preference', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: message.id,
        chatId: chat.id,
      });
    }
  }

  private async generateAndSendResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<void> {
    try {
      // Check if we've already sent a bot response for this message (prevents duplicates on retry)
      if (message.telegramMessageId) {
        const alreadyResponded = await this.messageRepository.hasBotResponseForMessage(
          chat.id,
          message.telegramMessageId
        );
        if (alreadyResponded) {
          logger.info('[Processor] Response already sent for this message, skipping', {
            messageId: message.id,
            telegramMessageId: message.telegramMessageId,
            chatId: chat.telegramId,
          });
          return;
        }
      }

      if (appConfig.response.readReceipts && message.telegramMessageId) {
        await this.telegramService.markAsRead(chat.telegramId, message.telegramMessageId);
      }

      const history = await this.messageRepository.findRecentByChatId(
        chat.id,
        appConfig.response.contextWindowSize
      );

      if (appConfig.response.typingIndicator) {
        await this.telegramService.setTyping(chat.telegramId);
      }

      const result = await this.responseRouter.generateResponse(message, chat, sender, history, identityOptions);

      if (!result.success || result.skipped || !result.content) {
        logger.warn('[Processor] Response skipped or failed', {
          messageId: message.id,
          skipped: result.skipped,
          error: result.error,
        });
        return;
      }

      const finalContent = await this.ensureMessageLength(message.id, result.content);

      // Check for duplicate responses before sending
      if (this.responseDeduplicationService) {
        const isDuplicate = this.responseDeduplicationService.isDuplicate({
          text: finalContent,
          chatId: chat.telegramId,
        });
        if (isDuplicate) {
          logger.warn('[Processor] Duplicate response skipped', {
            messageId: message.id,
            chatId: chat.telegramId,
            responseLength: finalContent.length,
          });
          return;
        }
      }

      const sentMessage = await this.telegramService.sendMessage(
        chat.telegramId,
        finalContent,
        message.telegramMessageId
      );

      if (sentMessage) {
        await this.messageRepository.create({
          telegramMessageId: sentMessage.id,
          chatId: chat.id,
          senderId: null,
          text: finalContent,
          isBot: true,
          replyToMessageId: message.telegramMessageId ?? undefined,
          rawJson: JSON.stringify({ id: sentMessage.id, text: finalContent, isBot: true }),
        });
      }

      logger.info('[Processor] Response sent', {
        messageId: message.id,
        responseLength: finalContent.length,
      });
    } catch (error) {
      logger.error('[Processor] Failed to send response', {
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async ensureMessageLength(messageId: string, content: string): Promise<string> {
    if (!this.messageLengthService) {
      // Fallback truncation
      if (content.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        return content.slice(0, FALLBACK_TRUNCATION_LENGTH) + '...';
      }
      return content;
    }

    try {
      const result = await this.messageLengthService.ensureFitsLimit(content);
      this.recordLengthMetrics(result);

      if (result.wasSummarized || result.wasTruncated) {
        logger.info('[Processor] Response adjusted for length limit', {
          messageId,
          originalLength: result.originalLength,
          finalLength: result.finalLength,
          wasSummarized: result.wasSummarized,
          wasTruncated: result.wasTruncated,
        });
      }

      return result.text;
    } catch (error) {
      logger.error('[Processor] Message length service failed', {
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Fallback truncation
      if (content.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        return content.slice(0, FALLBACK_TRUNCATION_LENGTH) + '...';
      }
      return content;
    }
  }

  private recordLengthMetrics(result: MessageLengthResult): void {
    if (!this.metricsService) return;

    this.metricsService.histogram('message_length_original', result.originalLength);
    this.metricsService.histogram('message_length_final', result.finalLength);

    if (result.wasSummarized) {
      this.metricsService.increment('message_summarization_count');
      this.metricsService.histogram('message_summarization_duration_ms', result.processingTimeMs);
    }
    if (result.wasTruncated) {
      this.metricsService.increment('message_truncation_count');
    }
  }
}
