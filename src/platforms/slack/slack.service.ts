/**
 * Slack Platform Service
 * Implements IPlatform for Slack integration.
 * Provides platform-agnostic interface for modules.
 */

import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { createLogger } from '../../utils/logger.js';
import type {
  IPlatform,
  IPlatformHandler,
  PlatformEventType,
  SendMessageOptions,
} from '../../interfaces/platforms.js';
import type { SlackConfig } from './slack.config.js';

// SocketModeReceiver is on the CJS default export, not a named ESM export
const { SocketModeReceiver } = (await import('@slack/bolt')).default as any;

const logger = createLogger('SlackService');

/**
 * Slack Platform - Implements IPlatform for Slack.
 */
export class SlackService implements IPlatform {
  readonly name = 'slack';

  private app: App;
  private webClient: WebClient;
  private userNameCache = new Map<string, string>();
  private config: SlackConfig;

  // Handler registry
  private messageHandlers: Map<string, IPlatformHandler> = new Map();
  private mentionHandlers: Map<string, IPlatformHandler> = new Map();

  constructor(config: SlackConfig) {
    this.config = config;
    this.webClient = new WebClient(config.botToken);

    const receiver = new SocketModeReceiver({
      appToken: config.appToken,
    });

    this.app = new App({
      token: config.botToken,
      receiver,
    });

    // Setup internal event handlers that dispatch to registered handlers
    this.setupEventHandlers();
  }

  /**
   * Setup Slack event handlers that dispatch to registered platform handlers.
   */
  private setupEventHandlers(): void {
    // Handle @mentions in channels
    this.app.event('app_mention', async ({ event, say }: { event: any; say: any }) => {
      logger.info(`Mention from ${event.user}`, { text: event.text?.substring(0, 100) });

      const platformMessage = this.slackEventToPlatformMessage(event, true);

      // Dispatch to all registered mention handlers
      for (const handler of this.mentionHandlers.values()) {
        try {
          if (handler.handleMention) {
            await handler.handleMention(this, platformMessage);
          } else {
            await handler.handleMessage(this, platformMessage);
          }
        } catch (error) {
          logger.error(`Error in mention handler ${handler.id}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    });

    // Handle all messages (channels + DMs)
    this.app.event('message', async ({ event }: { event: any }) => {
      if (event.bot_id || event.subtype) return;

      const userMessage = event.text || '';
      const userId = event.user || 'unknown';
      const eventTs = event.ts || '';
      const channel = event.channel || '';
      const isDM = event.channel_type === 'im';

      logger.info(`Message from ${userId}`, { channel, isDM, text: userMessage.substring(0, 100) });

      const platformMessage = this.slackMessageToPlatformMessage(event);

      // Dispatch to all registered message handlers
      for (const handler of this.messageHandlers.values()) {
        try {
          await handler.handleMessage(this, platformMessage);
        } catch (error) {
          logger.error(`Error in message handler ${handler.id}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    });

    logger.info('Slack event handlers setup complete');
  }

  /**
   * Convert Slack app_mention event to PlatformMessage.
   */
  private slackEventToPlatformMessage(event: any, isMention: boolean): any {
    return {
      id: event.ts,
      userId: event.user,
      channelId: event.channel,
      text: event.text?.replace(/<@[A-Z0-9]+>/g, '').trim() || '',
      timestamp: event.ts,
      threadTs: event.thread_ts,
      isDM: false,
      isMention,
      files: event.files || [],
      raw: event,
    };
  }

  /**
   * Convert Slack message event to PlatformMessage.
   */
  private slackMessageToPlatformMessage(event: any): any {
    const isDM = event.channel_type === 'im';
    return {
      id: event.ts,
      userId: event.user || 'unknown',
      channelId: event.channel || '',
      text: event.text || '',
      timestamp: event.ts || '',
      threadTs: event.thread_ts,
      isDM,
      isMention: false,
      files: event.files || [],
      raw: event,
    };
  }

  // IPlatform implementation

  async start(): Promise<void> {
    await this.app.start();
    logger.info('Slack Socket Mode connected');
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('Slack disconnected');
  }

  async sendMessage(channelId: string, text: string, options?: SendMessageOptions): Promise<void> {
    const args: Record<string, unknown> = {
      channel: channelId,
      text,
    };

    if (options?.username) args.username = options.username;
    if (options?.iconEmoji) args.icon_emoji = options.iconEmoji;
    if (options?.iconUrl) args.icon_url = options.iconUrl;
    if (options?.threadTs) args.thread_ts = options.threadTs;

    await this.webClient.chat.postMessage(args as any);
  }

  async replyInThread(channelId: string, threadTs: string, text: string): Promise<void> {
    await this.webClient.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
    } as any);
  }

  async getConversationContext(channel: string, currentTs: string, threadTs?: string): Promise<string> {
    try {
      let messages;
      if (threadTs) {
        const result = await this.webClient.conversations.replies({
          channel,
          ts: threadTs,
          limit: 10,
        });
        messages = result.messages || [];
      } else {
        const result = await this.webClient.conversations.history({
          channel,
          limit: 10,
          latest: currentTs,
        });
        messages = (result.messages || []).reverse();
      }

      const contextMessages = messages
        .filter((m: any) => m.ts !== currentTs)
        .slice(-5);

      if (contextMessages.length === 0) return '';

      const formatted = await Promise.all(
        contextMessages.map(async (m: any) => {
          const userName = m.user ? await this.getUserName(m.user) : 'unknown';
          const text = (m.text || '').replace(/<@[A-Z0-9]+>/g, '@CEO').substring(0, 500);
          return `${userName}: ${text}`;
        }),
      );

      return `Recent conversation context:\n${formatted.join('\n')}\n\n---\nCurrent message:`;
    } catch (error) {
      logger.error('Failed to fetch conversation context', { error });
      return '';
    }
  }

  async getUserName(userId: string): Promise<string> {
    if (this.userNameCache.has(userId)) return this.userNameCache.get(userId)!;
    try {
      const result = await this.webClient.users.info({ user: userId });
      const name = result.user?.profile?.display_name || result.user?.real_name || userId;
      this.userNameCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  getDefaultChannelId(): string {
    return this.config.channelId;
  }

  registerHandler(eventType: PlatformEventType, handler: IPlatformHandler): void {
    switch (eventType) {
      case 'message':
        if (this.messageHandlers.has(handler.id)) {
          logger.warn(`Message handler ${handler.id} already registered`);
          return;
        }
        this.messageHandlers.set(handler.id, handler);
        logger.debug(`Registered message handler: ${handler.id}`);
        break;

      case 'mention':
        if (this.mentionHandlers.has(handler.id)) {
          logger.warn(`Mention handler ${handler.id} already registered`);
          return;
        }
        this.mentionHandlers.set(handler.id, handler);
        logger.debug(`Registered mention handler: ${handler.id}`);
        break;

      default:
        logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  unregisterHandler(eventType: PlatformEventType, handlerId: string): void {
    switch (eventType) {
      case 'message':
        if (this.messageHandlers.delete(handlerId)) {
          logger.debug(`Unregistered message handler: ${handlerId}`);
        }
        break;

      case 'mention':
        if (this.mentionHandlers.delete(handlerId)) {
          logger.debug(`Unregistered mention handler: ${handlerId}`);
        }
        break;

      default:
        logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  // Legacy methods for backward compatibility

  getBoltApp(): App {
    return this.app;
  }

  getWebClient(): WebClient {
    return this.webClient;
  }

  getTestUserId(): string {
    return this.config.testUserId;
  }
}
