/**
 * Platform abstraction interfaces for multi-platform support.
 * Allows modules to interact with messaging platforms (Slack, Discord, etc.)
 * without depending on platform-specific implementations.
 */

/**
 * Represents a message received from a platform.
 */
export interface PlatformMessage {
  /** Platform-specific message ID */
  id: string;
  /** User ID who sent the message */
  userId: string;
  /** Channel/room ID where message was sent */
  channelId: string;
  /** Message text content */
  text: string;
  /** Timestamp of the message (platform-specific format) */
  timestamp: string;
  /** Thread timestamp for threaded replies (optional) */
  threadTs?: string;
  /** Whether this is a direct message */
  isDM: boolean;
  /** Whether the bot was mentioned in the message */
  isMention: boolean;
  /** Attached files (if any) */
  files?: PlatformAttachment[];
  /** Raw event data from the platform (for platform-specific needs) */
  raw?: unknown;
}

/**
 * Represents a file attachment in a message.
 */
export interface PlatformAttachment {
  /** File MIME type */
  mimetype: string;
  /** File name */
  name: string;
  /** File URL (if accessible) */
  url?: string;
}

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
  /** Thread timestamp to reply in a thread */
  threadTs?: string;
  /** Display username override */
  username?: string;
  /** Icon emoji or URL */
  iconEmoji?: string;
  /** Icon URL */
  iconUrl?: string;
  /** Additional platform-specific options */
  [key: string]: unknown;
}

/**
 * Handler for platform message events.
 */
export interface IPlatformHandler {
  /** Unique identifier for this handler */
  readonly id: string;

  /**
   * Handle an incoming message.
   * @param platform The platform that received the message
   * @param message The message to handle
   */
  handleMessage(platform: IPlatform, message: PlatformMessage): Promise<void>;

  /**
   * Handle an @mention (optional - called when bot is mentioned).
   * If not implemented, handleMessage is used for mentions too.
   */
  handleMention?(platform: IPlatform, message: PlatformMessage): Promise<void>;
}

/**
 * Event types that handlers can subscribe to.
 */
export type PlatformEventType = 'message' | 'mention';

/**
 * Platform interface that modules can use to send messages.
 * Abstracts away platform-specific implementation details.
 */
export interface IPlatform {
  /** Platform name (e.g., 'slack', 'discord') */
  readonly name: string;

  /**
   * Send a message to a channel.
   * @param channelId Target channel ID
   * @param text Message text
   * @param options Optional send options
   */
  sendMessage(channelId: string, text: string, options?: SendMessageOptions): Promise<void>;

  /**
   * Reply to a message in a thread.
   * @param channelId Channel ID
   * @param threadTs Thread timestamp to reply to
   * @param text Message text
   */
  replyInThread(channelId: string, threadTs: string, text: string): Promise<void>;

  /**
   * Get recent conversation context for a channel/thread.
   * @param channelId Channel ID
   * @param currentTs Current message timestamp
   * @param threadTs Thread timestamp (if in thread)
   * @returns Formatted conversation context string
   */
  getConversationContext(channelId: string, currentTs: string, threadTs?: string): Promise<string>;

  /**
   * Get a user's display name.
   * @param userId User ID
   * @returns User's display name
   */
  getUserName(userId: string): Promise<string>;

  /**
   * Get the default channel ID for this platform.
   * @returns Default channel ID
   */
  getDefaultChannelId(): string;

  /**
   * Register a handler for a specific event type.
   * @param eventType Type of event to handle
   * @param handler Handler to register
   */
  registerHandler(eventType: PlatformEventType, handler: IPlatformHandler): void;

  /**
   * Unregister a handler.
   * @param eventType Type of event
   * @param handlerId Handler ID to unregister
   */
  unregisterHandler(eventType: PlatformEventType, handlerId: string): void;

  /**
   * Start the platform connection.
   */
  start(): Promise<void>;

  /**
   * Stop the platform connection.
   */
  stop(): Promise<void>;
}
