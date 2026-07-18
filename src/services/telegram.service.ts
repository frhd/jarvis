import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import qrcode from 'qrcode-terminal';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/timeout';

// ============================================================================
// Named Constants
// ============================================================================

/** Maximum latency measurements to retain for averaging */
const MAX_LATENCY_MEASUREMENTS = 100;

/** Stale update threshold for validation (1 minute in milliseconds) */
const STALE_UPDATE_VALIDATION_THRESHOLD_MS = 60_000;

/** Minimum idle time before proactive refresh (5 minutes in milliseconds) */
const PROACTIVE_REFRESH_MIN_IDLE_MS = 5 * 60_000;

/** Delay between queued messages to avoid rate limiting (milliseconds) */
const QUEUE_MESSAGE_DELAY_MS = 100;

/** Maximum retry attempts for queued messages */
const QUEUED_MESSAGE_MAX_RETRIES = 3;

/** Validation ping timeout in milliseconds */
const VALIDATION_PING_TIMEOUT_MS = 5_000;

/** Pre-disconnect delay base in milliseconds */
const PRE_DISCONNECT_DELAY_MS = 500;

/** Retry delay for the underlying TelegramClient's built-in connection retries, in milliseconds */
const TELEGRAM_CLIENT_RETRY_DELAY_MS = 1000;

/** Jitter factor applied to the exponential reconnect backoff delay (±10%) */
const RECONNECT_JITTER_FACTOR = 0.1;

/** Jitter factor applied to the pre-disconnect delay (±20%) */
const PRE_DISCONNECT_JITTER_FACTOR = 0.2;

/** Overall budget for post-reconnect message catchup (2 minutes) */
const RECONNECT_CATCHUP_TIMEOUT_MS = 120_000;

/** Timeout for a single getMessages call during catchup (30 seconds) */
const CATCHUP_GET_MESSAGES_TIMEOUT_MS = 30_000;

/** Timeout for processing a single missed message during catchup (60 seconds) */
const CATCHUP_HANDLER_TIMEOUT_MS = 60_000;

/** Timeout for a single queued message send during queue flush (30 seconds) */
const FLUSH_SEND_TIMEOUT_MS = 30_000;

/**
 * Multiplier on the stale-update threshold past which a reconnect happens even
 * if the connection validates. A request-layer probe (updates.GetState) cannot
 * prove the passive update stream is healthy, so validation only defers the
 * reconnect during quiet periods — it must not disable staleness recovery.
 */
export const STALE_HARD_RECONNECT_MULTIPLIER = 6;

// ============================================================================
// Types and Interfaces
// ============================================================================

// Type for handler setup function
type HandlerSetupFn = (client: TelegramClient) => void;
// Type for catchup handler (processes missed messages)
type CatchupHandler = (client: TelegramClient, message: Api.Message) => Promise<void>;

// Outbound message queue item
interface QueuedMessage {
  chatId: string | number;
  text: string;
  replyToMsgId?: number;
  timestamp: Date;
  retryCount: number;
}

/**
 * Connection state tracking for reconnection management
 */
interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  lastReconnectAttempt: Date | null;
  lastReconnectFinishTime: Date | null;
  consecutiveKeepaliveFailures: number;
}

/**
 * Activity tracking for stale connection detection
 */
interface ActivityState {
  lastSuccessfulPing: Date | null;
  lastUpdateReceived: Date | null;
  lastUpdatesTooLongTime: Date | null;
}

// Connection metrics for monitoring
interface ConnectionMetrics {
  reconnectCount: number;
  lastReconnectTime: Date | null;
  lastReconnectDuration: number | null;
  failedReconnectCount: number;
  healthCheckLatencyMs: number[];
  updateLagMs: number[];
  queuedMessageCount: number;
  flushedMessageCount: number;
  keepalivePingCount: number;
  keepalivePingFailures: number;
  keepalivePingLatencyMs: number[];
  reconnectReasons: Record<string, number>; // Track reasons for reconnects
  updatesTooLongCount: number; // Track UpdatesTooLong events
}

// ============================================================================
// IntervalTask Helper Class
// ============================================================================

/**
 * Manages a recurring interval task with start/stop semantics.
 * Reduces duplication of interval management boilerplate.
 */
class IntervalTask {
  private handle: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly task: () => Promise<void>;
  private readonly name: string;

  constructor(name: string, intervalMs: number, task: () => Promise<void>) {
    this.name = name;
    this.intervalMs = intervalMs;
    this.task = task;
  }

  start(): void {
    this.stop();
    this.handle = setInterval(async () => {
      await this.task();
    }, this.intervalMs);
    logger.info(`[Telegram] ${this.name} started (every ${this.intervalMs / 1000} seconds)`);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
      logger.debug(`[Telegram] ${this.name} stopped`);
    }
  }

  isRunning(): boolean {
    return this.handle !== null;
  }
}

export class TelegramService {
  private client: TelegramClient;

  // Grouped connection state
  private connectionState: ConnectionState = {
    connected: false,
    reconnecting: false,
    reconnectAttempts: 0,
    lastReconnectAttempt: null,
    lastReconnectFinishTime: null,
    consecutiveKeepaliveFailures: 0,
  };

  // Grouped activity tracking
  private activityState: ActivityState = {
    lastSuccessfulPing: null,
    lastUpdateReceived: null,
    lastUpdatesTooLongTime: null,
  };

  // Interval tasks (using helper class)
  private healthCheckTask: IntervalTask;
  private proactiveRefreshTask: IntervalTask;
  private keepalivePingTask: IntervalTask;

  // Store handler setup function for re-registration after reconnect
  private handlerSetupFn: HandlerSetupFn | null = null;
  // Track if handlers have been registered to prevent duplicates
  private handlersRegistered: boolean = false;
  // Track monitored chat IDs for message catchup
  private monitoredChatIds: Set<string> = new Set();
  // Track last processed message ID per chat for catchup
  private lastProcessedMessageId: Map<string, number> = new Map();
  // Handler for processing missed messages during catchup
  private catchupHandler: CatchupHandler | null = null;
  // Promise-based mutex for reconnection to prevent concurrent reconnects
  private reconnectPromise: Promise<void> | null = null;

  // Outbound message queue for graceful degradation during disconnection
  private outboundQueue: QueuedMessage[] = [];
  private isFlushingQueue: boolean = false;

  // Rate limiting for UpdatesTooLong events to prevent reconnect storms
  private readonly updatesTooLongCooldownMs: number = 60000; // 1 minute cooldown between handling these events

  // Minimum time between reconnections to prevent rapid reconnect loops
  private readonly minReconnectIntervalMs: number = 30000; // Minimum 30s between reconnects

  // Connection metrics for monitoring
  private metrics: ConnectionMetrics = {
    reconnectCount: 0,
    lastReconnectTime: null,
    lastReconnectDuration: null,
    failedReconnectCount: 0,
    healthCheckLatencyMs: [],
    updateLagMs: [],
    queuedMessageCount: 0,
    flushedMessageCount: 0,
    keepalivePingCount: 0,
    keepalivePingFailures: 0,
    keepalivePingLatencyMs: [],
    reconnectReasons: {},
    updatesTooLongCount: 0,
  };

  // Configuration from appConfig
  private readonly config = appConfig.telegram;

  /**
   * Add jitter to a delay value to prevent thundering herd
   * @param baseMs - Base delay in milliseconds
   * @param jitterFactor - Fraction of base to add as random jitter (default 0.1 = 10%)
   */
  private addJitter(baseMs: number, jitterFactor: number = 0.1): number {
    const jitter = baseMs * jitterFactor * (Math.random() * 2 - 1); // +/- jitterFactor
    return Math.round(baseMs + jitter);
  }

  constructor() {
    const { apiId, apiHash, sessionString } = appConfig.telegram;

    if (!apiId || !apiHash) {
      throw new Error('API_ID and API_HASH must be set in environment variables');
    }

    const stringSession = new StringSession(sessionString || '');

    this.client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 10,
      retryDelay: TELEGRAM_CLIENT_RETRY_DELAY_MS,
      autoReconnect: true,
      requestRetries: 5,
      floodSleepThreshold: 60,
    });

    // Initialize interval tasks with bound callbacks
    this.healthCheckTask = new IntervalTask(
      'Health check',
      this.config.healthCheckIntervalMs,
      () => this.performHealthCheck()
    );

    this.proactiveRefreshTask = new IntervalTask(
      'Proactive refresh',
      this.config.proactiveRefreshIntervalMs,
      () => this.performProactiveRefresh()
    );

    this.keepalivePingTask = new IntervalTask(
      'Keepalive ping',
      this.config.keepalivePingIntervalMs,
      () => this.performKeepalivePing()
    );

    this.setupConnectionHandlers();
  }

  private setupConnectionHandlers(): void {
    // Handle UpdatesTooLong events with rate limiting to prevent reconnect storms
    this.client.addEventHandler((update: Api.TypeUpdate) => {
      if (update instanceof Api.UpdatesTooLong) {
        this.metrics.updatesTooLongCount++;

        // Rate limit: Only handle if we haven't seen one recently
        const now = new Date();
        const timeSinceLastEvent = this.activityState.lastUpdatesTooLongTime
          ? now.getTime() - this.activityState.lastUpdatesTooLongTime.getTime()
          : Infinity;

        if (timeSinceLastEvent < this.updatesTooLongCooldownMs) {
          logger.debug('[Telegram] UpdatesTooLong received but within cooldown period, skipping reconnect', {
            timeSinceLastEventMs: timeSinceLastEvent,
            cooldownMs: this.updatesTooLongCooldownMs,
            totalEvents: this.metrics.updatesTooLongCount,
          });
          return;
        }

        this.activityState.lastUpdatesTooLongTime = now;

        // Validate connection is actually stale before reconnecting
        this.validateAndHandleStaleConnection();
      }
    });
  }

  /**
   * Validate that the connection is actually stale before triggering a reconnect.
   * This prevents unnecessary reconnects when UpdatesTooLong is received but connection is healthy.
   */
  private async validateAndHandleStaleConnection(): Promise<void> {
    // If we've received an update recently, the connection is not stale
    const timeSinceLastUpdate = this.activityState.lastUpdateReceived
      ? Date.now() - this.activityState.lastUpdateReceived.getTime()
      : null;

    if (timeSinceLastUpdate !== null && timeSinceLastUpdate < STALE_UPDATE_VALIDATION_THRESHOLD_MS) {
      // Received update within last minute, connection is likely fine
      logger.info('[Telegram] UpdatesTooLong received but recent activity detected, validating connection', {
        timeSinceLastUpdateMs: timeSinceLastUpdate,
      });

      // Try a lightweight ping to verify connection health
      try {
        const pingStart = Date.now();
        await Promise.race([
          this.client.getMe(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Validation ping timeout')), VALIDATION_PING_TIMEOUT_MS)
          ),
        ]);
        const latency = Date.now() - pingStart;

        logger.info('[Telegram] Connection validation successful, skipping reconnect', {
          validationLatencyMs: latency,
        });
        return;
      } catch (error) {
        logger.warn('[Telegram] Connection validation failed, proceeding with reconnect', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.warn('[Telegram] UpdatesTooLong received, connection appears stale', {
      timeSinceLastUpdateMs: timeSinceLastUpdate,
    });
    await this.handlePotentialDisconnect('stale_updates');
  }

  private async handlePotentialDisconnect(reason: string = 'unknown'): Promise<void> {
    // Promise-based mutex: if a reconnect is already in progress, wait for it instead of racing
    if (this.reconnectPromise) {
      logger.debug('[Telegram] Already reconnecting, waiting for in-progress reconnect');
      await this.reconnectPromise;
      return;
    }

    // Enforce minimum time between reconnections to prevent rapid loops
    const timeSinceLastReconnect = this.connectionState.lastReconnectFinishTime
      ? Date.now() - this.connectionState.lastReconnectFinishTime.getTime()
      : Infinity;

    if (timeSinceLastReconnect < this.minReconnectIntervalMs && reason !== 'force_reconnect') {
      logger.debug('[Telegram] Reconnect requested too soon after last reconnect, skipping', {
        timeSinceLastReconnectMs: timeSinceLastReconnect,
        minIntervalMs: this.minReconnectIntervalMs,
        reason,
      });
      return;
    }

    // Acquire the mutex by setting the promise before any await
    this.reconnectPromise = this.performReconnect(reason);
    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = null;
    }
  }

  /**
   * Internal reconnection logic, called exclusively via the promise mutex in handlePotentialDisconnect.
   */
  private async performReconnect(reason: string): Promise<void> {
    this.connectionState.reconnecting = true;
    this.connectionState.reconnectAttempts++;
    this.connectionState.lastReconnectAttempt = new Date();
    const reconnectStartTime = Date.now();

    try {
      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        this.config.reconnectBaseDelayMs * Math.pow(2, this.connectionState.reconnectAttempts - 1),
        this.config.reconnectMaxDelayMs
      );
      // Add jitter to prevent thundering herd
      const delay = this.addJitter(baseDelay, RECONNECT_JITTER_FACTOR);

      if (this.connectionState.reconnectAttempts > 1) {
        logger.info(`[Telegram] Waiting ${delay}ms before reconnection attempt ${this.connectionState.reconnectAttempts}/${this.config.maxReconnectAttempts}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      logger.info(`[Telegram] Reconnection attempt ${this.connectionState.reconnectAttempts}/${this.config.maxReconnectAttempts} (reason: ${reason})`);

      // Track reconnect reason
      this.metrics.reconnectReasons[reason] = (this.metrics.reconnectReasons[reason] || 0) + 1;

      // Disconnect first (ignore errors - we may already be disconnected)
      try {
        await this.client.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      // Small delay before reconnecting (with jitter)
      await new Promise((resolve) => setTimeout(resolve, this.addJitter(PRE_DISCONNECT_DELAY_MS, PRE_DISCONNECT_JITTER_FACTOR)));

      await this.client.connect();
      this.activityState.lastSuccessfulPing = new Date();
      this.activityState.lastUpdateReceived = new Date(); // Reset update tracker
      this.connectionState.connected = true;
      this.connectionState.reconnectAttempts = 0; // Reset on success
      this.connectionState.consecutiveKeepaliveFailures = 0; // Reset keepalive failures
      this.connectionState.lastReconnectFinishTime = new Date(); // Track when we finished reconnecting

      // Track metrics
      this.metrics.reconnectCount++;
      this.metrics.lastReconnectTime = new Date();
      this.metrics.lastReconnectDuration = Date.now() - reconnectStartTime;

      logger.info('[Telegram] Reconnection successful', {
        durationMs: this.metrics.lastReconnectDuration,
        totalReconnects: this.metrics.reconnectCount,
      });

      // Re-register event handlers after reconnection (only if already registered before)
      if (this.handlerSetupFn && this.handlersRegistered) {
        logger.info('[Telegram] Re-registering event handlers after reconnection');
        this.handlerSetupFn(this.client);
      }

      // Catchup and flush must be time-bounded: a hang here holds the
      // reconnect mutex open indefinitely, which silently disables health
      // checks, keepalive pings, the watchdog, and outbound sends.
      try {
        await withTimeout(this.catchUpMissedMessages(), RECONNECT_CATCHUP_TIMEOUT_MS);
      } catch (error) {
        logger.warn('[Telegram] Post-reconnect catchup did not complete', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        await withTimeout(
          this.flushOutboundQueue(),
          this.config.outboundQueueFlushTimeoutMs + FLUSH_SEND_TIMEOUT_MS
        );
      } catch (error) {
        logger.warn('[Telegram] Post-reconnect queue flush did not complete', {
          error: error instanceof Error ? error.message : String(error),
          remainingQueueSize: this.outboundQueue.length,
        });
      }

    } catch (error) {
      this.metrics.failedReconnectCount++;

      logger.error('[Telegram] Reconnection failed', {
        attempt: this.connectionState.reconnectAttempts,
        maxAttempts: this.config.maxReconnectAttempts,
        totalFailures: this.metrics.failedReconnectCount,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.connectionState.reconnectAttempts >= this.config.maxReconnectAttempts) {
        logger.error('[Telegram] Max reconnection attempts reached, connection may be unstable');
        // Reset counter to allow future attempts
        this.connectionState.reconnectAttempts = 0;
      }
    } finally {
      this.connectionState.reconnecting = false;
      this.connectionState.lastReconnectFinishTime = new Date();
    }
  }

  /**
   * Catch up on messages that may have been missed during disconnection
   */
  private async catchUpMissedMessages(): Promise<void> {
    if (this.monitoredChatIds.size === 0) {
      return;
    }

    logger.info('[Telegram] Catching up on missed messages', {
      chatCount: this.monitoredChatIds.size,
    });

    for (const chatId of this.monitoredChatIds) {
      try {
        const lastMsgId = this.lastProcessedMessageId.get(chatId) || 0;

        // Fetch recent messages from this chat (time-bounded: this call can
        // hang indefinitely on a degraded connection)
        const messages = await withTimeout(
          this.client.getMessages(chatId, {
            limit: 10,
            minId: lastMsgId,
          }),
          CATCHUP_GET_MESSAGES_TIMEOUT_MS
        );

        if (messages.length > 0) {
          logger.info('[Telegram] Found missed messages during catchup', {
            chatId,
            count: messages.length,
            lastKnownId: lastMsgId,
          });

          // Process each missed message through the catchup handler
          for (const msg of messages) {
            // Skip outgoing messages (messages we sent ourselves)
            if (msg.out) continue;

            if (msg.id > lastMsgId && this.catchupHandler) {
              try {
                await withTimeout(this.catchupHandler(this.client, msg), CATCHUP_HANDLER_TIMEOUT_MS);
                logger.info('[Telegram] Processed missed message', {
                  chatId,
                  messageId: msg.id,
                });
              } catch (processError) {
                logger.warn('[Telegram] Failed to process missed message', {
                  chatId,
                  messageId: msg.id,
                  error: processError instanceof Error ? processError.message : String(processError),
                });
              }
            }
          }

          // Always advance lastProcessedMessageId to the max ID in the batch,
          // including outgoing (bot) messages. Without this, the bot's own replies
          // keep the ID stale, causing the same messages to be re-fetched on every reconnect.
          const maxId = Math.max(...messages.map(m => m.id));
          const currentMax = this.lastProcessedMessageId.get(chatId) || 0;
          if (maxId > currentMax) {
            this.lastProcessedMessageId.set(chatId, maxId);
          }
        }
      } catch (error) {
        logger.warn('[Telegram] Failed to catch up messages for chat', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Force a reconnection attempt. Called from global error handlers.
   */
  async forceReconnect(): Promise<void> {
    logger.warn('[Telegram] Force reconnect requested');
    this.connectionState.connected = false;
    await this.handlePotentialDisconnect('force_reconnect');
  }

  /**
   * Record that an update was received. Call this from message handlers.
   * Used to detect stale connections where getMe() works but updates don't flow.
   */
  recordUpdateReceived(chatId?: string, messageId?: number): void {
    this.activityState.lastUpdateReceived = new Date();

    // Track chat for catchup
    if (chatId) {
      this.monitoredChatIds.add(chatId);
      if (messageId) {
        this.lastProcessedMessageId.set(chatId, messageId);
      }
    }
  }

  /**
   * Register the handler setup function for re-registration after reconnection.
   */
  setHandlerSetupFn(fn: HandlerSetupFn): void {
    this.handlerSetupFn = fn;
  }

  /**
   * Mark that handlers have been registered. Called after initial setup.
   */
  markHandlersRegistered(): void {
    this.handlersRegistered = true;
  }

  /**
   * Register a handler for processing missed messages during catchup.
   */
  setCatchupHandler(fn: CatchupHandler): void {
    this.catchupHandler = fn;
  }

  /**
   * Perform proactive connection refresh if connection has been idle.
   * Reconnects periodically to prevent connection staleness, but only if idle.
   */
  private async performProactiveRefresh(): Promise<void> {
    if (!this.connectionState.connected || this.connectionState.reconnecting) {
      return;
    }

    // Only do proactive refresh if connection has been idle for a while
    // This prevents unnecessary reconnects during active use
    const timeSinceLastUpdate = this.activityState.lastUpdateReceived
      ? Date.now() - this.activityState.lastUpdateReceived.getTime()
      : null;

    if (timeSinceLastUpdate !== null && timeSinceLastUpdate < PROACTIVE_REFRESH_MIN_IDLE_MS) {
      logger.debug('[Telegram] Skipping proactive refresh - connection is active', {
        timeSinceLastUpdateMs: timeSinceLastUpdate,
        minIdleTimeMs: PROACTIVE_REFRESH_MIN_IDLE_MS,
      });
      return;
    }

    logger.info('[Telegram] Proactive connection refresh triggered (idle connection)', {
      idleTimeMs: timeSinceLastUpdate,
    });
    await this.handlePotentialDisconnect('proactive_refresh');
  }

  /**
   * Perform a lightweight keepalive ping to verify connection is alive.
   * Uses a short timeout for fast failure detection.
   */
  private async performKeepalivePing(): Promise<void> {
    if (!this.connectionState.connected || this.connectionState.reconnecting) {
      return;
    }

    const pingStart = Date.now();
    this.metrics.keepalivePingCount++;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Keepalive ping timeout')), this.config.keepalivePingTimeoutMs);
      });

      // Use getMe() as a lightweight ping
      await Promise.race([this.client.getMe(), timeoutPromise]);

      // Track latency
      const latency = Date.now() - pingStart;
      this.metrics.keepalivePingLatencyMs.push(latency);
      if (this.metrics.keepalivePingLatencyMs.length > MAX_LATENCY_MEASUREMENTS) {
        this.metrics.keepalivePingLatencyMs.shift();
      }

      // Reset failure counter on success
      this.connectionState.consecutiveKeepaliveFailures = 0;
      this.activityState.lastSuccessfulPing = new Date();

      logger.debug('[Telegram] Keepalive ping successful', { latencyMs: latency });
    } catch (error) {
      this.connectionState.consecutiveKeepaliveFailures++;
      this.metrics.keepalivePingFailures++;

      logger.warn('[Telegram] Keepalive ping failed', {
        consecutiveFailures: this.connectionState.consecutiveKeepaliveFailures,
        threshold: this.config.keepaliveFailuresBeforeReconnect,
        error: error instanceof Error ? error.message : String(error),
      });

      // Trigger reconnect after consecutive failures
      if (this.connectionState.consecutiveKeepaliveFailures >= this.config.keepaliveFailuresBeforeReconnect) {
        logger.warn('[Telegram] Keepalive failure threshold reached, triggering reconnect', {
          consecutiveFailures: this.connectionState.consecutiveKeepaliveFailures,
        });
        this.connectionState.consecutiveKeepaliveFailures = 0;
        await this.handlePotentialDisconnect('keepalive_failures');
      }
    }
  }

  /**
   * Perform periodic health check to verify connection is alive.
   * Also detects stale update streams where getMe() works but updates don't flow.
   */
  private async performHealthCheck(): Promise<void> {
    if (!this.connectionState.connected || this.connectionState.reconnecting) {
      return;
    }

    const healthCheckStart = Date.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeoutMs);
      });

      // Use getMe() as a ping - lightweight and confirms auth is still valid
      await Promise.race([this.client.getMe(), timeoutPromise]);

      // Track health check latency
      const latency = Date.now() - healthCheckStart;
      this.metrics.healthCheckLatencyMs.push(latency);
      // Keep only last N measurements
      if (this.metrics.healthCheckLatencyMs.length > MAX_LATENCY_MEASUREMENTS) {
        this.metrics.healthCheckLatencyMs.shift();
      }

      this.activityState.lastSuccessfulPing = new Date();

      // Check for stale update stream
      // getMe() works (active request) but we haven't received updates (passive stream)
      const timeSinceLastUpdate = this.activityState.lastUpdateReceived
        ? Date.now() - this.activityState.lastUpdateReceived.getTime()
        : null;

      // Track update lag
      if (timeSinceLastUpdate !== null) {
        this.metrics.updateLagMs.push(timeSinceLastUpdate);
        if (this.metrics.updateLagMs.length > MAX_LATENCY_MEASUREMENTS) {
          this.metrics.updateLagMs.shift();
        }
      }

      if (timeSinceLastUpdate && timeSinceLastUpdate > this.config.staleUpdateThresholdMs) {
        // A quiet account looks identical to a broken update stream. Validate
        // before tearing the connection down — unvalidated staleness used to
        // cause a full reconnect every ~5 idle minutes (~220/day).
        const hardThresholdMs = this.config.staleUpdateThresholdMs * STALE_HARD_RECONNECT_MULTIPLIER;
        if (timeSinceLastUpdate <= hardThresholdMs && (await this.validateUpdateStream())) {
          logger.debug('[Telegram] No updates in stale window but connection validates, deferring reconnect', {
            timeSinceLastUpdateMs: timeSinceLastUpdate,
            hardThresholdMs,
          });
          return;
        }

        logger.debug('[Telegram] Update stream appears stale, triggering reconnect', {
          timeSinceLastUpdateMs: timeSinceLastUpdate,
          thresholdMs: this.config.staleUpdateThresholdMs,
        });
        await this.handlePotentialDisconnect('stale_updates');
        return;
      }

      logger.debug('[Telegram] Health check passed', {
        latencyMs: latency,
        timeSinceLastUpdateMs: timeSinceLastUpdate,
      });
    } catch (error) {
      const timeSinceLastPing = this.activityState.lastSuccessfulPing
        ? Date.now() - this.activityState.lastSuccessfulPing.getTime()
        : null;

      logger.warn('[Telegram] Health check failed, triggering reconnect', {
        error: error instanceof Error ? error.message : String(error),
        timeSinceLastPingMs: timeSinceLastPing,
      });

      await this.handlePotentialDisconnect('health_check_failed');
    }
  }

  /**
   * Probe the connection at the updates layer to distinguish a quiet account
   * from a broken connection.
   */
  private async validateUpdateStream(): Promise<boolean> {
    try {
      await withTimeout(this.client.invoke(new Api.updates.GetState()), VALIDATION_PING_TIMEOUT_MS);
      return true;
    } catch (error) {
      logger.debug('[Telegram] Update stream validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async connect(): Promise<void> {
    if (this.connectionState.connected) {
      logger.debug('Telegram client already connected');
      return;
    }

    const { sessionString } = appConfig.telegram;

    // If we have a session string, try to use it directly
    if (sessionString) {
      try {
        await this.client.connect();
        this.connectionState.connected = true;
        this.activityState.lastSuccessfulPing = new Date();
        this.activityState.lastUpdateReceived = new Date();
        this.healthCheckTask.start();
        this.proactiveRefreshTask.start();
        this.keepalivePingTask.start();
        logger.info('Successfully connected to Telegram using saved session');
        return;
      } catch (error) {
        logger.warn('Saved session invalid, will re-authenticate...');
      }
    }

    // Use QR code authentication
    await this.connectWithQR();
  }

  private async connectWithQR(): Promise<void> {
    logger.info('Starting QR code authentication...');
    logger.info('Open Telegram on your phone -> Settings -> Devices -> Link Desktop Device');
    logger.info('Then scan the QR code below:\n');

    try {
      await this.client.connect();

      const user = await this.client.signInUserWithQrCode(
        { apiId: appConfig.telegram.apiId!, apiHash: appConfig.telegram.apiHash! },
        {
          qrCode: async (code) => {
            const url = `tg://login?token=${code.token.toString('base64url')}`;
            qrcode.generate(url, { small: true }, (qr: string) => {
              console.log('\n' + qr);
            });
            logger.info('Scan this QR code with your Telegram app...');
          },
          password: async () => {
            logger.info('2FA password required');
            return input.text('Enter your 2FA password: ');
          },
          onError: async (err) => {
            logger.error('QR auth error:', err.message);
            throw err;
          },
        }
      );

      this.connectionState.connected = true;
      this.activityState.lastSuccessfulPing = new Date();
      this.activityState.lastUpdateReceived = new Date();
      this.healthCheckTask.start();
      this.proactiveRefreshTask.start();
      this.keepalivePingTask.start();
      logger.info(`Successfully authenticated as ${(user as Api.User).firstName || 'User'}`);

      const session = this.client.session.save() as unknown as string;
      logger.info('\nIMPORTANT: Save this session string to SESSION_STRING in your .env:');
      logger.info(`SESSION_STRING="${session}"`);
      logger.info('');
    } catch (error) {
      logger.error('Failed to connect to Telegram:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.healthCheckTask.stop();
    this.proactiveRefreshTask.stop();
    this.keepalivePingTask.stop();

    // Flush outbound queue before disconnecting
    if (this.outboundQueue.length > 0 && this.connectionState.connected) {
      logger.info('[Telegram] Flushing outbound queue before disconnect', {
        queueSize: this.outboundQueue.length,
      });
      try {
        await this.flushOutboundQueue();
      } catch (error) {
        logger.warn('[Telegram] Failed to flush outbound queue during disconnect', {
          error: error instanceof Error ? error.message : 'Unknown error',
          remainingMessages: this.outboundQueue.length,
        });
      }
    }

    if (this.connectionState.connected) {
      await this.client.disconnect();
      this.connectionState.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connectionState.connected && !this.connectionState.reconnecting;
  }

  getConnectionStatus(): {
    connected: boolean;
    lastPing: Date | null;
    lastUpdate: Date | null;
    reconnecting: boolean;
    reconnectAttempts: number;
    lastReconnectAttempt: Date | null;
    outboundQueueSize: number;
  } {
    return {
      connected: this.connectionState.connected,
      lastPing: this.activityState.lastSuccessfulPing,
      lastUpdate: this.activityState.lastUpdateReceived,
      reconnecting: this.connectionState.reconnecting,
      reconnectAttempts: this.connectionState.reconnectAttempts,
      lastReconnectAttempt: this.connectionState.lastReconnectAttempt,
      outboundQueueSize: this.outboundQueue.length,
    };
  }

  getClient(): TelegramClient {
    // Return the client even if we're temporarily disconnected
    // Operations will fail gracefully and trigger reconnection
    return this.client;
  }

  async setTyping(chatId: string | number): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.SetTyping({
          peer: chatId,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch (error) {
      logger.warn('[Telegram] Failed to set typing indicator', { chatId });
      // Non-fatal, continue without typing indicator
    }
  }

  /**
   * Mark messages as read in a chat (shows ✓✓ to sender)
   * Use this to acknowledge receipt before processing
   */
  async markAsRead(chatId: string | number, maxId: number): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.ReadHistory({
          peer: chatId,
          maxId: maxId,
        })
      );
      logger.debug('[Telegram] Marked messages as read', { chatId, maxId });
    } catch (error) {
      logger.warn('[Telegram] Failed to mark as read', { chatId });
      // Non-fatal, continue without read receipt
    }
  }

  /**
   * Explicitly set online/offline status
   * Note: This is user-wide, not per-chat
   */
  async setOnlineStatus(online: boolean = true): Promise<void> {
    try {
      await this.client.invoke(
        new Api.account.UpdateStatus({
          offline: !online,
        })
      );
      logger.debug('[Telegram] Updated online status', { online });
    } catch (error) {
      logger.warn('[Telegram] Failed to update online status');
      // Non-fatal, continue without status update
    }
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    replyToMsgId?: number
  ): Promise<Api.Message | null> {
    // If reconnecting, queue the message for later
    if (this.connectionState.reconnecting || !this.connectionState.connected) {
      this.queueOutboundMessage(chatId, text, replyToMsgId);
      return null;
    }

    try {
      const result = await this.client.sendMessage(chatId, {
        message: text,
        replyTo: replyToMsgId,
      });
      return result as Api.Message;
    } catch (error) {
      // If send fails due to connection issues, queue the message
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.isConnectionError(errorMessage)) {
        logger.warn('[Telegram] Send failed due to connection issue, queueing message', {
          chatId,
          error: errorMessage,
        });
        this.queueOutboundMessage(chatId, text, replyToMsgId);
        // Trigger reconnection
        this.handlePotentialDisconnect('send_failed');
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if an error message indicates a connection problem
   */
  private isConnectionError(errorMessage: string): boolean {
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
   * Queue an outbound message for later sending
   */
  private queueOutboundMessage(chatId: string | number, text: string, replyToMsgId?: number): void {
    if (this.outboundQueue.length >= this.config.outboundQueueMaxSize) {
      logger.warn('[Telegram] Outbound queue full, dropping oldest message', {
        queueSize: this.outboundQueue.length,
        maxSize: this.config.outboundQueueMaxSize,
      });
      this.outboundQueue.shift();
    }

    this.outboundQueue.push({
      chatId,
      text,
      replyToMsgId,
      timestamp: new Date(),
      retryCount: 0,
    });

    this.metrics.queuedMessageCount++;

    logger.info('[Telegram] Message queued for later sending', {
      chatId,
      queueSize: this.outboundQueue.length,
    });
  }

  /**
   * Flush the outbound message queue after reconnection
   */
  private async flushOutboundQueue(): Promise<void> {
    if (this.outboundQueue.length === 0 || this.isFlushingQueue) {
      return;
    }

    this.isFlushingQueue = true;
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    logger.info('[Telegram] Flushing outbound message queue', {
      queueSize: this.outboundQueue.length,
    });

    // Process queue with timeout
    const timeout = this.config.outboundQueueFlushTimeoutMs;
    const queueCopy = [...this.outboundQueue];
    this.outboundQueue = [];

    try {
      for (const msg of queueCopy) {
        if (Date.now() - startTime > timeout) {
          // Re-queue remaining messages
          logger.warn('[Telegram] Queue flush timeout, re-queueing remaining messages', {
            remaining: queueCopy.length - successCount - failCount,
          });
          const remaining = queueCopy.slice(successCount + failCount);
          this.outboundQueue.push(...remaining);
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
            this.outboundQueue.push(msg);
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
      remaining: this.outboundQueue.length,
      durationMs: Date.now() - startTime,
    });
  }

  /**
   * Get connection metrics for monitoring
   */
  getConnectionMetrics(): ConnectionMetrics & {
    avgHealthCheckLatencyMs: number | null;
    avgUpdateLagMs: number | null;
    avgKeepalivePingLatencyMs: number | null;
    queueSize: number;
    consecutiveKeepaliveFailures: number;
    avgTimeBetweenReconnectsMs: number | null;
    primaryReconnectReason: string | null;
  } {
    const avgLatency = this.metrics.healthCheckLatencyMs.length > 0
      ? this.metrics.healthCheckLatencyMs.reduce((a, b) => a + b, 0) / this.metrics.healthCheckLatencyMs.length
      : null;

    const avgLag = this.metrics.updateLagMs.length > 0
      ? this.metrics.updateLagMs.reduce((a, b) => a + b, 0) / this.metrics.updateLagMs.length
      : null;

    const avgKeepaliveLatency = this.metrics.keepalivePingLatencyMs.length > 0
      ? this.metrics.keepalivePingLatencyMs.reduce((a, b) => a + b, 0) / this.metrics.keepalivePingLatencyMs.length
      : null;

    // Calculate average time between reconnects
    let avgTimeBetweenReconnectsMs: number | null = null;
    if (this.metrics.reconnectCount > 1 && this.metrics.lastReconnectTime) {
      const startTime = this.metrics.lastReconnectTime.getTime() - (this.metrics.reconnectCount - 1) * this.metrics.lastReconnectDuration!;
      if (this.metrics.lastReconnectDuration) {
        avgTimeBetweenReconnectsMs = startTime / (this.metrics.reconnectCount - 1);
      }
    }

    // Find primary reconnect reason
    let primaryReconnectReason: string | null = null;
    let maxReasonCount = 0;
    for (const [reason, count] of Object.entries(this.metrics.reconnectReasons)) {
      if (count > maxReasonCount) {
        maxReasonCount = count;
        primaryReconnectReason = reason;
      }
    }

    return {
      ...this.metrics,
      avgHealthCheckLatencyMs: avgLatency,
      avgUpdateLagMs: avgLag,
      avgKeepalivePingLatencyMs: avgKeepaliveLatency,
      queueSize: this.outboundQueue.length,
      consecutiveKeepaliveFailures: this.connectionState.consecutiveKeepaliveFailures,
      avgTimeBetweenReconnectsMs,
      primaryReconnectReason,
    };
  }

  async getMe(): Promise<Api.User> {
    const me = await this.client.getMe();
    return me as Api.User;
  }
}
