import { TelegramClient } from 'telegram';
import { NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram';
import { SenderRepository } from '../repositories/sender.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { MessageRepository } from '../repositories/message.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { FilterService } from './filter.service';
import { MediaService } from './media.service';
import { ProcessorService } from './processor.service';
import { DeduplicationService } from './deduplication.service';
import { TelegramService } from './telegram.service';
import { QueueItem, ChatType, MediaType } from '../types';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { MESSAGE_PREVIEW_LENGTH } from '../config/constants.js';
import { getIdentityService } from './instances/core';
import { PLATFORM_TELEGRAM, mapTelegramChatType } from '../config/platforms';
import { deriveChatType } from '../utils/telegram-chat-type.js';

/** Extracted sender information from a Telegram message */
interface ResolvedSender {
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

/** Window for tracking recently ingested telegram message IDs to catch TDLib duplicate events */
const TELEGRAM_ID_DEDUP_WINDOW_MS = 120_000;
/** Maximum entries in the telegramMessageId dedup tracker */
const TELEGRAM_ID_DEDUP_MAX_SIZE = 2000;

export class IngestionService {
  /**
   * In-memory tracker for recently ingested telegramMessageIds.
   * Catches duplicate TDLib events (handler + catchup, reconnect replays)
   * before hitting the database. Key format: `chatId:telegramMessageId`.
   */
  private recentTelegramIds: Map<string, number> = new Map();
  private telegramIdCleanupInterval: NodeJS.Timeout;

  constructor(
    private senderRepo: SenderRepository,
    private chatRepo: ChatRepository,
    private messageRepo: MessageRepository,
    private queueRepo: QueueRepository,
    private filterService: FilterService,
    private mediaService: MediaService,
    private processorService: ProcessorService,
    private deduplicationService: DeduplicationService,
    private telegramService?: TelegramService
  ) {
    this.telegramIdCleanupInterval = setInterval(
      () => this.cleanupTelegramIdTracker(),
      60_000
    );
  }

  async ingestMessage(client: TelegramClient, event: NewMessageEvent): Promise<void> {
    try {
      const message = event.message;

      if (!message) {
        return;
      }

      const chatId = message.chatId?.toString();
      if (!chatId) {
        logger.warn('[Ingestion] Message has no chat ID, skipping');
        return;
      }

      const filterCheck = await this.filterService.checkMessage(chatId);
      if (!filterCheck.allowed) {
        logger.info('[Ingestion] Message blocked by filter:', chatId);
        return;
      }

      // Fast in-memory dedup by telegramMessageId to catch TDLib duplicate events
      // (reconnect replays, handler + catchup races) before any DB work
      const telegramDedupKey = `${chatId}:${message.id}`;
      if (this.recentTelegramIds.has(telegramDedupKey)) {
        logger.info('[Ingestion] Duplicate TDLib event detected, skipping', {
          chatId,
          telegramMessageId: message.id,
        });
        return;
      }
      this.recentTelegramIds.set(telegramDedupKey, Date.now());

      // Enforce max size to prevent memory leaks
      if (this.recentTelegramIds.size > TELEGRAM_ID_DEDUP_MAX_SIZE) {
        this.cleanupTelegramIdTracker();
      }

      let senderId: string | null = null;
      let resolvedSender: ResolvedSender | null = null;
      if (message.senderId) {
        resolvedSender = await this.resolveSenderFromEvent(event);

        if (resolvedSender) {
          const upsertedSender = await this.senderRepo.upsert({
            telegramId: resolvedSender.telegramId,
            firstName: resolvedSender.firstName,
            lastName: resolvedSender.lastName,
            username: resolvedSender.username,
            phone: resolvedSender.phone,
          });
          senderId = upsertedSender.id;
        }
      }

      const chat = await event.message.getChat();
      const chatType: ChatType = deriveChatType(chat);
      let chatTitle: string | undefined;
      let chatUsername: string | undefined;

      if (chat) {
        chatTitle = 'title' in chat ? (chat.title ?? undefined) : undefined;
        chatUsername = 'username' in chat ? (chat.username ?? undefined) : undefined;
      }

      const upsertedChat = await this.chatRepo.upsert({
        telegramId: chatId,
        type: chatType,
        title: chatTitle,
        username: chatUsername,
      });

      // Dual-write: resolve unified identities alongside legacy sender/chat upserts.
      // Identity resolution failure does NOT block message processing.
      let userId: string | undefined;
      let conversationId: string | undefined;
      try {
        const identityService = getIdentityService();

        if (resolvedSender) {
          const resolvedUser = await identityService.resolveUser(
            PLATFORM_TELEGRAM,
            resolvedSender.telegramId,
            {
              firstName: resolvedSender.firstName,
              lastName: resolvedSender.lastName,
              username: resolvedSender.username,
            }
          );
          userId = resolvedUser.id;
        }

        const resolvedConversation = await identityService.resolveConversation(
          PLATFORM_TELEGRAM,
          chatId,
          mapTelegramChatType(chatType),
          { title: chatTitle }
        );
        conversationId = resolvedConversation.id;
      } catch (error) {
        logger.warn('[Ingestion] Identity resolution failed, continuing with legacy IDs', {
          error: error instanceof Error ? error.message : String(error),
          chatId,
        });
      }

      let mediaType: MediaType | undefined;
      let mediaPath: string | undefined;
      let mediaFileId: string | undefined;

      if (message.media) {
        const mediaResult = await this.mediaService.downloadMedia(client, message);
        if (mediaResult) {
          mediaType = mediaResult.mediaType;
          mediaPath = mediaResult.mediaPath;
          mediaFileId = mediaResult.mediaFileId;
        }
      }

      // Check for duplicate content (same message sent in quick succession)
      const dedupCheck = this.deduplicationService.isDuplicate({
        text: message.text || null,
        senderId: senderId || 'unknown',
        chatId: upsertedChat.id,
        mediaType: mediaType || null,
      });

      if (dedupCheck.isDuplicate) {
        logger.info('[Ingestion] Duplicate message detected by content hash, skipping', {
          chatTitle: upsertedChat.title || upsertedChat.telegramId,
          textPreview: (message.text || '').substring(0, MESSAGE_PREVIEW_LENGTH),
        });

        // Send notification if configured
        if (dedupCheck.notify && this.telegramService?.isConnected()) {
          try {
            await this.telegramService.sendMessage(upsertedChat.telegramId, dedupCheck.notify);
          } catch (error) {
            logger.warn('[Ingestion] Failed to send duplicate notification', { error });
          }
        }

        return;
      }

      // Use createIfNotExists for atomic deduplication
      // This handles race conditions where multiple handlers try to ingest the same message
      const { message: storedMessage, created } = await this.messageRepo.createIfNotExists({
        id: nanoid(),
        telegramMessageId: message.id,
        chatId: upsertedChat.id,
        senderId: senderId,
        text: message.text || undefined,
        mediaType: mediaType,
        mediaPath: mediaPath,
        mediaFileId: mediaFileId,
        replyToMessageId: message.replyTo?.replyToMsgId || undefined,
        forwardFromChatId: undefined,
        forwardFromMessageId: undefined,
        rawJson: JSON.stringify({ id: message.id, text: message.text, media: !!message.media }),
        createdAt: new Date(),
      });

      // Skip processing if this is a duplicate message (already exists in DB)
      if (!created) {
        logger.debug('[Ingestion] Duplicate message detected, skipping', {
          telegramMessageId: message.id,
          chatId: upsertedChat.telegramId,
          existingMessageId: storedMessage.id,
        });
        return;
      }

      const queueItem = await this.queueRepo.enqueue(
        storedMessage.id,
        filterCheck.priority
      );

      logger.info('[Ingestion] Message ingested:', {
        messageId: storedMessage.id,
        chatTitle: upsertedChat.title || upsertedChat.telegramId,
        priority: filterCheck.priority,
      });

      await this.processImmediately(queueItem, userId, conversationId);
    } catch (error) {
      // Log detailed error information for debugging
      const errorDetails = {
        code: (error as { code?: string })?.code,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      };
      logger.error('[Ingestion] Error ingesting message:', errorDetails);
    }
  }

  async processImmediately(queueItem: QueueItem, userId?: string, conversationId?: string): Promise<void> {
    try {
      const marked = await this.queueRepo.markProcessing(queueItem.id, queueItem.version);
      if (!marked) {
        // Queue item already being processed by another handler (race condition)
        logger.debug('[Ingestion] Queue item already claimed', { queueId: queueItem.id });
        return;
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

      const result = await this.processorService.processMessage(message, chat, sender, { userId, conversationId });

      await this.processorService.handleProcessingResult(queueItem, result);
    } catch (error) {
      logger.error('[Ingestion] Error processing immediately:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.processorService.handleProcessingResult(queueItem, {
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Clean up expired entries from the telegramMessageId dedup tracker.
   */
  private cleanupTelegramIdTracker(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, timestamp] of this.recentTelegramIds.entries()) {
      if (now - timestamp > TELEGRAM_ID_DEDUP_WINDOW_MS) {
        this.recentTelegramIds.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('[Ingestion] Telegram ID dedup tracker cleanup', {
        removed,
        remaining: this.recentTelegramIds.size,
      });
    }
  }

  /**
   * Resolve sender information from a Telegram message event.
   * Extracts sender details to avoid code duplication between legacy and identity resolution.
   */
  private async resolveSenderFromEvent(event: NewMessageEvent): Promise<ResolvedSender | null> {
    if (!event.message.senderId) {
      return null;
    }

    const telegramId = event.message.senderId.toString();
    const sender = await event.message.getSender();

    if (!sender) {
      return null;
    }

    return {
      telegramId,
      firstName: 'firstName' in sender ? sender.firstName : undefined,
      lastName: 'lastName' in sender ? sender.lastName : undefined,
      username: 'username' in sender ? sender.username : undefined,
      phone: 'phone' in sender ? sender.phone : undefined,
    };
  }
}
