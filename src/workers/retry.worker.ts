import { QueueRepository } from '../repositories/queue.repository';
import { MessageRepository } from '../repositories/message.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { SenderRepository } from '../repositories/sender.repository';
import { ProcessorService } from '../services/processor.service';
import { RetryStrategyService } from '../services/retryStrategy.service';
import { appConfig } from '../config';
import { logger } from '../utils/logger';

export class RetryWorker {
  private timer: NodeJS.Timeout | null = null;
  private retryStrategyService: RetryStrategyService | null = null;

  constructor(
    private queueRepo: QueueRepository,
    private messageRepo: MessageRepository,
    private chatRepo: ChatRepository,
    private senderRepo: SenderRepository,
    private processorService: ProcessorService
  ) {
    // Initialize retry strategy for calculating backoff delays
    this.retryStrategyService = new RetryStrategyService({
      maxAttempts: appConfig.retry.maxAttempts,
      baseDelayMs: appConfig.retry.baseDelayMs,
      maxDelayMs: appConfig.retry.maxDelayMs,
      backoffMultiplier: appConfig.retry.backoffMultiplier,
      jitterFactor: appConfig.retry.jitterFactor,
    });
  }

  startRetryWorker(intervalMs: number = appConfig.retry.retryIntervalMs): NodeJS.Timeout {
    logger.info('[RetryWorker] Starting retry worker with interval:', intervalMs, 'ms');

    this.timer = setInterval(async () => {
      try {
        // First, recover any stuck messages
        await this.recoverStuckMessages();
        // Then process pending retries
        await this.processRetries();
      } catch (error) {
        logger.error('[RetryWorker] Error in retry worker:', error);
      }
    }, intervalMs);

    return this.timer;
  }

  stopRetryWorker(timer: NodeJS.Timeout): void {
    logger.info('[RetryWorker] Stopping retry worker');
    clearInterval(timer);
    this.timer = null;
  }

  /**
   * Recover stuck messages that are eligible for retry
   * Stuck messages are those in 'processing' status for too long (crashed/timed out)
   */
  private async recoverStuckMessages(): Promise<void> {
    const stuckThresholdMs = appConfig.retry.stuckMessageThresholdMs;
    const stuckMaxRetries = appConfig.retry.stuckMessageMaxRetries;

    // Get stuck messages that haven't exceeded max retries
    const stuckMessages = await this.queueRepo.getStuckMessagesForRetry(
      stuckThresholdMs,
      stuckMaxRetries
    );

    if (stuckMessages.length === 0) {
      return;
    }

    logger.warn('[RetryWorker] Found stuck messages to recover:', {
      count: stuckMessages.length,
      thresholdMs: stuckThresholdMs,
      maxRetries: stuckMaxRetries,
    });

    for (const queueItem of stuckMessages) {
      try {
        const ageMs = Date.now() - new Date(queueItem.createdAt).getTime();
        const ageMinutes = Math.round(ageMs / 60000);

        // Calculate next retry time with exponential backoff
        const nextRetryAt = this.retryStrategyService
          ? this.retryStrategyService.calculateNextRetryTime(queueItem.attempts + 1)
          : new Date(Date.now() + appConfig.retry.baseDelayMs);

        const errorMessage = `Recovered from stuck processing state after ${ageMinutes} minutes`;

        // Reset the message for retry (changes processing → pending, increments attempts)
        const newAttempts = await this.queueRepo.resetStuckForRetry(
          queueItem.id,
          nextRetryAt,
          errorMessage
        );

        logger.info('[RetryWorker] Recovered stuck message for retry:', {
          queueId: queueItem.id,
          messageId: queueItem.messageId,
          ageMinutes,
          newAttempts,
          nextRetryAt: nextRetryAt.toISOString(),
          delayMs: nextRetryAt.getTime() - Date.now(),
        });
      } catch (error) {
        logger.error('[RetryWorker] Error recovering stuck message:', {
          queueId: queueItem.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Also check for stuck messages that have exceeded max retries - mark them as failed
    const stuckToFail = await this.queueRepo.getStuckProcessingMessages(stuckThresholdMs);
    const exceededMaxRetries = stuckToFail.filter(
      (item) => item.attempts >= stuckMaxRetries
    );

    if (exceededMaxRetries.length > 0) {
      const ids = exceededMaxRetries.map((item) => item.id);
      const failError = `Stuck message exceeded max retries (${stuckMaxRetries}) after recovery attempts`;
      await this.queueRepo.batchMarkFailed(ids, failError);

      logger.error('[RetryWorker] Marked stuck messages as failed (exceeded max retries):', {
        count: exceededMaxRetries.length,
        ids,
        maxRetries: stuckMaxRetries,
      });
    }
  }

  private async processRetries(): Promise<void> {
    // Use getReadyForRetry to respect nextRetryAt timing
    const pendingRetries = await this.queueRepo.getReadyForRetry();

    // Filter to items that need retrying:
    // 1. Items with attempts > 0 (actual retries after failed processing)
    // 2. Items with nextRetryAt set (messages reset from processing/shutdown, even if attempts=0)
    const retriesToProcess = pendingRetries.filter(
      item => item.attempts > 0 || item.nextRetryAt !== null
    );

    if (retriesToProcess.length === 0) {
      return;
    }

    logger.info('[RetryWorker] Processing', retriesToProcess.length, 'pending retries');

    for (const queueItem of retriesToProcess) {
      try {
        logger.info('[RetryWorker] Retrying message:', {
          messageId: queueItem.messageId,
          attempt: queueItem.attempts + 1,
          maxAttempts: appConfig.retry.maxAttempts,
        });

        const marked = await this.queueRepo.markProcessing(queueItem.id, queueItem.version);
        if (!marked) {
          // Already being processed by another handler
          logger.debug('[RetryWorker] Queue item already claimed', { queueId: queueItem.id });
          continue;
        }

        const message = await this.messageRepo.findById(queueItem.messageId);
        if (!message) {
          throw new Error(`Message not found: ${queueItem.messageId}`);
        }

        const chat = await this.chatRepo.findById(message.chatId);
        if (!chat) {
          throw new Error(`Chat not found: ${message.chatId}`);
        }

        let sender = null;
        if (message.senderId) {
          sender = await this.senderRepo.findById(message.senderId);
        }

        const result = await this.processorService.processMessage(message, chat, sender);

        await this.processorService.handleProcessingResult(queueItem, result);
      } catch (error) {
        logger.error('[RetryWorker] Error processing retry:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.processorService.handleProcessingResult(queueItem, {
          success: false,
          error: errorMessage,
        });
      }
    }
  }
}
