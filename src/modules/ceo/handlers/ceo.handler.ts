/**
 * CEO Handler
 * Handles incoming messages for the CEO module.
 * Implements IPlatformHandler for platform-agnostic message handling.
 */

import { createLogger } from '../../../utils/logger.js';
import type { IPlatform, PlatformMessage, IPlatformHandler } from '../../../interfaces/platforms.js';
import type { CeoResponseService } from '../ceo-response.service.js';
import type { Message } from '../../../types/index.js';
import { getIdentityService } from '../../../services/instances/core.js';
import { getMemoryService } from '../../../services/instances/ai.js';
import { PLATFORM_SLACK } from '../../../config/platforms.js';
import { formatMemoryContext } from '../utils/format-memory-context.js';

const logger = createLogger('CeoHandler');

/** How long to keep processed message IDs in memory (5 minutes) */
const PROCESSED_MESSAGES_TTL_MS = 5 * 60 * 1000;

/** Maximum number of processed message IDs to keep */
const MAX_PROCESSED_MESSAGES = 1000;

/** Prefix for Slack-sourced message IDs to avoid collisions with Telegram IDs */
const SLACK_ID_PREFIX = 'slack-';

/**
 * CEO Handler - Responds to messages and mentions as the CEO persona.
 */
export class CeoHandler implements IPlatformHandler {
  readonly id = 'ceo-handler';
  private platform: IPlatform | null = null;

  /** Track processed message IDs to prevent duplicate responses */
  private processedMessages = new Map<string, number>();

  constructor(private ceoResponseService: CeoResponseService) {}

  /**
   * Check if a message has already been processed (deduplication).
   * Also cleans up old entries to prevent memory leaks.
   */
  private isAlreadyProcessed(messageId: string): boolean {
    const now = Date.now();

    // Clean up old entries periodically
    if (this.processedMessages.size > MAX_PROCESSED_MESSAGES) {
      for (const [id, timestamp] of this.processedMessages) {
        if (now - timestamp > PROCESSED_MESSAGES_TTL_MS) {
          this.processedMessages.delete(id);
        }
      }
    }

    if (this.processedMessages.has(messageId)) {
      return true;
    }

    this.processedMessages.set(messageId, now);
    return false;
  }

  /**
   * Set the platform instance (called by CeoModule during registration).
   */
  setPlatform(platform: IPlatform): void {
    this.platform = platform;
  }

  /**
   * Handle an @mention.
   */
  async handleMention(platform: IPlatform, message: PlatformMessage): Promise<void> {
    await this.handleMessage(platform, message);
  }

  /**
   * Handle an incoming message.
   */
  async handleMessage(platform: IPlatform, message: PlatformMessage): Promise<void> {
    // Deduplicate: Slack sends both 'message' and 'app_mention' events for mentions
    if (this.isAlreadyProcessed(message.id)) {
      logger.debug('Skipping duplicate message', { messageId: message.id });
      return;
    }

    const userMessage = message.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    const files = message.files || [];
    const hasImages = files.some((f) => f.mimetype?.startsWith('image/'));

    if (!userMessage && !hasImages) {
      await this.sendResponse(platform, message, 'Hey! What can I help you with?');
      return;
    }

    // Resolve unified identity (never blocks response delivery)
    let userId: string | undefined;
    let conversationId: string | undefined;
    try {
      const identityService = getIdentityService();
      const conversationType = message.isDM ? 'dm' : 'channel';

      const [user, conversation] = await Promise.all([
        identityService.resolveUser(PLATFORM_SLACK, message.userId, {
          slackDisplayName: await platform.getUserName(message.userId).catch(() => undefined),
        }),
        identityService.resolveConversation(PLATFORM_SLACK, message.channelId, conversationType, {
          channelId: message.channelId,
        }),
      ]);

      userId = user.id;
      conversationId = conversation.id;
    } catch (err) {
      logger.warn('Identity resolution failed, continuing without memory', {
        error: (err as Error).message,
      });
    }

    // Retrieve relevant memories (never blocks response delivery)
    let memoryContext = '';
    if (userId) {
      try {
        const memoryService = getMemoryService();
        const result = await memoryService.retrieveRelevant(userMessage, { userId });
        memoryContext = formatMemoryContext(result.memories);
      } catch (err) {
        logger.warn('Memory retrieval failed, continuing without memories', {
          error: (err as Error).message,
        });
      }
    }

    const context = await platform.getConversationContext(
      message.channelId,
      message.timestamp,
      message.threadTs
    );

    const messageWithImageNote = hasImages
      ? `${userMessage || ''}\n\n[User attached an image, but I cannot view images yet. Please describe what you're seeing or paste the relevant text.]`
      : userMessage;

    const response = await this.ceoResponseService.generateResponse(
      messageWithImageNote,
      context,
      memoryContext
    );
    logger.info('Responding to message', {
      channel: message.channelId,
      isDM: message.isDM,
      responseLength: response.length,
      hasMemoryContext: memoryContext.length > 0,
    });

    await this.sendResponse(platform, message, response);

    // Fire-and-forget: extract and store memories from this interaction
    if (userId && conversationId) {
      // Create a minimal Message object for memory extraction
      // Only id, text, and createdAt are actually used by extractAndStore
      const memMessage = {
        id: `${SLACK_ID_PREFIX}${message.id}`,
        text: message.text,
        telegramMessageId: 0,
        chatId: 'slack-placeholder', // Required field, not used for memory
        senderId: null,
        rawJson: JSON.stringify({ source: 'slack', channelId: message.channelId, userId: message.userId }),
        isBot: false,
        createdAt: new Date(parseFloat(message.timestamp) * 1000),
        mediaType: null,
        mediaPath: null,
        mediaFileId: null,
        transcript: null,
        transcriptStatus: null,
        transcriptError: null,
        transcriptLanguage: null,
        transcriptDurationMs: null,
        transcriptedAt: null,
        replyToMessageId: null,
        forwardFromChatId: null,
        forwardFromMessageId: null,
      } as Message;
      getMemoryService()
        .extractAndStore(memMessage, [], { userId, conversationId })
        .catch((err: Error) => {
          logger.warn('Memory extraction failed', { error: err.message });
        });
    }
  }

  /**
   * Send a response to a message.
   */
  private async sendResponse(
    platform: IPlatform,
    message: PlatformMessage,
    text: string
  ): Promise<void> {
    if (message.isDM) {
      await platform.sendMessage(message.channelId, text);
    } else if (message.threadTs) {
      await platform.replyInThread(message.channelId, message.threadTs, text);
    } else {
      await platform.replyInThread(message.channelId, message.timestamp, text);
    }
  }
}
