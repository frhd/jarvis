import { TelegramClient } from 'telegram';
import { logger } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import {
  ConnectionMetrics,
  QueuedMessage,
  TelegramConfig,
  FLUSH_SEND_TIMEOUT_MS,
  QUEUED_MESSAGE_MAX_RETRIES,
  QUEUE_MESSAGE_DELAY_MS,
} from './types';

/**
 * Check if an error message indicates a connection problem
 */
export function isConnectionError(errorMessage: string): boolean {
  const connectionErrors = [
    'TIMEOUT',
    'CONNECTION_NOT_INITED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'Not connected',
    'connection closed',
    'network error',
  ];
  const lowerMessage = errorMessage.toLowerCase();
  return connectionErrors.some(err => lowerMessage.includes(err.toLowerCase()));
}

/**
 * Outbound message queue for graceful degradation during disconnection.
 * Messages sent while disconnected/reconnecting are buffered here and flushed
 * once the connection is restored.
 */
export class OutboundQueue {
  private queue: QueuedMessage[] = [];
  private isFlushingQueue: boolean = false;

  private readonly client: TelegramClient;
  private readonly config: TelegramConfig;
  private readonly metrics: ConnectionMetrics;

  constructor(deps: { client: TelegramClient; config: TelegramConfig; metrics: ConnectionMetrics }) {
    this.client = deps.client;
    this.config = deps.config;
    this.metrics = deps.metrics;
  }

  /** Current number of queued messages. */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Queue an outbound message for later sending
   */
  enqueue(chatId: string | number, text: string, replyToMsgId?: number): void {
    if (this.queue.length >= this.config.outboundQueueMaxSize) {
      logger.warn('[Telegram] Outbound queue full, dropping oldest message', {
        queueSize: this.queue.length,
        maxSize: this.config.outboundQueueMaxSize,
      });
      this.queue.shift();
    }

    this.queue.push({
      chatId,
      text,
      replyToMsgId,
      timestamp: new Date(),
      retryCount: 0,
    });

    this.metrics.queuedMessageCount++;

    logger.info('[Telegram] Message queued for later sending', {
      chatId,
      queueSize: this.queue.length,
    });
  }

  /**
   * Flush the outbound message queue after reconnection
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isFlushingQueue) {
      return;
    }

    this.isFlushingQueue = true;
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    logger.info('[Telegram] Flushing outbound message queue', {
      queueSize: this.queue.length,
    });

    // Process queue with timeout
    const timeout = this.config.outboundQueueFlushTimeoutMs;
    const queueCopy = [...this.queue];
    this.queue = [];

    try {
      for (const msg of queueCopy) {
        if (Date.now() - startTime > timeout) {
          // Re-queue remaining messages
          logger.warn('[Telegram] Queue flush timeout, re-queueing remaining messages', {
            remaining: queueCopy.length - successCount - failCount,
          });
          const remaining = queueCopy.slice(successCount + failCount);
          this.queue.push(...remaining);
          break;
        }

        try {
          // Time-bounded: a hung send would otherwise stall the flush forever
          await withTimeout(
            this.client.sendMessage(msg.chatId, {
              message: msg.text,
              replyTo: msg.replyToMsgId,
            }),
            FLUSH_SEND_TIMEOUT_MS
          );
          successCount++;
          this.metrics.flushedMessageCount++;

          // Small delay between messages to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, QUEUE_MESSAGE_DELAY_MS));
        } catch (error) {
          failCount++;
          msg.retryCount++;

          if (msg.retryCount < QUEUED_MESSAGE_MAX_RETRIES) {
            // Re-queue for another attempt
            this.queue.push(msg);
          } else {
            logger.error('[Telegram] Failed to send queued message after retries', {
              chatId: msg.chatId,
              retryCount: msg.retryCount,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } finally {
      this.isFlushingQueue = false;
    }

    logger.info('[Telegram] Queue flush completed', {
      success: successCount,
      failed: failCount,
      remaining: this.queue.length,
      durationMs: Date.now() - startTime,
    });
  }
}
