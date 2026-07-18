import { TelegramClient, Api } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { IngestionService } from '../services/ingestion.service';
import { TelegramService } from '../services/telegram.service';
import { logger } from '../utils/logger';
import { Semaphore } from '../utils/semaphore.js';

/**
 * Maximum number of expensive processing stages (processImmediately →
 * LLM/whisper) allowed to run concurrently. Ingest + enqueue are NOT gated —
 * every message is persisted immediately.
 *
 * Without a limit a burst of messages would launch unbounded parallel LLM
 * work and exhaust resources. Excess processing waits (FIFO) on the semaphore
 * instead of being dropped, so nothing is lost — the work simply queues up.
 */
export const MAX_CONCURRENT_MESSAGE_PIPELINES = 4;

/**
 * Shared across every handler registration (including reconnects) and the
 * catchup path so the concurrency bound applies to ALL inbound work, not per
 * registration. Module-scoped so it survives handler re-registration.
 */
const pipelineSemaphore = new Semaphore(MAX_CONCURRENT_MESSAGE_PIPELINES);

let currentHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;
let currentEventBuilder: NewMessage | null = null;

export function setupMessageHandler(
  client: TelegramClient,
  ingestionService: IngestionService,
  telegramService?: TelegramService
): void {
  if (currentHandler && currentEventBuilder) {
    logger.info('[MessageHandler] Removing previous event handler to prevent duplicates');
    client.removeEventHandler(currentHandler, currentEventBuilder);
  }

  currentHandler = async (event: NewMessageEvent) => {
    try {
      const chatId = event.chatId?.toString();
      const messageId = event.message?.id;
      telegramService?.recordUpdateReceived(chatId, messageId);

      // The semaphore gates only the expensive processing stage (LLM/whisper);
      // ingest + enqueue always run immediately so a burst is persisted right
      // away while excess processing queues FIFO — never dropped.
      await ingestionService.ingestMessage(client, event, {
        processingGate: (fn) => pipelineSemaphore.runExclusive(fn),
      });
    } catch (error) {
      logger.error('[MessageHandler] Error handling message:', error);
    }
  };

  currentEventBuilder = new NewMessage({ incoming: true });

  client.addEventHandler(currentHandler, currentEventBuilder);

  if (telegramService) {
    telegramService.setCatchupHandler(async (tgClient: TelegramClient, message: Api.Message) => {
      try {
        const fakeEvent = {
          message,
          chatId: message.chatId,
        } as NewMessageEvent;

        const chatId = message.chatId?.toString();
        telegramService.recordUpdateReceived(chatId, message.id);

        // Catchup can replay a large batch on reconnect; share the same
        // processing-stage bound so it cannot flood the pipeline either.
        await ingestionService.ingestMessage(tgClient, fakeEvent, {
          processingGate: (fn) => pipelineSemaphore.runExclusive(fn),
        });
        logger.info('[MessageHandler] Processed catchup message', {
          chatId,
          messageId: message.id,
        });
      } catch (error) {
        logger.error('[MessageHandler] Error processing catchup message:', error);
        throw error;
      }
    });
  }

  logger.info('[MessageHandler] Message handler registered');
}
