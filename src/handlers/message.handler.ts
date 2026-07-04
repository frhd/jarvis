import { TelegramClient, Api } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { IngestionService } from '../services/ingestion.service';
import { TelegramService } from '../services/telegram.service';
import { logger } from '../utils/logger';

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

      await ingestionService.ingestMessage(client, event);
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

        await ingestionService.ingestMessage(tgClient, fakeEvent);
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
