import { TelegramClient, Api } from 'telegram';
import { logger } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import { OutboundQueue } from './outbound-queue';
import {
  ActivityState,
  CatchupHandler,
  ConnectionMetrics,
  ConnectionState,
  HandlerSetupFn,
  TelegramConfig,
  MAX_LATENCY_MEASUREMENTS,
  STALE_UPDATE_VALIDATION_THRESHOLD_MS,
  PROACTIVE_REFRESH_MIN_IDLE_MS,
  VALIDATION_PING_TIMEOUT_MS,
  PRE_DISCONNECT_DELAY_MS,
  RECONNECT_JITTER_FACTOR,
  PRE_DISCONNECT_JITTER_FACTOR,
  RECONNECT_CATCHUP_TIMEOUT_MS,
  CATCHUP_GET_MESSAGES_TIMEOUT_MS,
  CATCHUP_HANDLER_TIMEOUT_MS,
  FLUSH_SEND_TIMEOUT_MS,
  STALE_HARD_RECONNECT_MULTIPLIER,
} from './types';

/**
 * Owns the connection lifecycle: reconnection (with mutex + backoff),
 * keepalive pings, health checks, stale-update detection, and post-reconnect
 * catchup. Connection/activity/metrics state objects are shared by reference
 * with the owning TelegramService so both observe the same mutations.
 */
export class ConnectionManager {
  private readonly client: TelegramClient;
  private readonly config: TelegramConfig;
  private readonly connectionState: ConnectionState;
  private readonly activityState: ActivityState;
  private readonly metrics: ConnectionMetrics;
  private readonly outboundQueue: OutboundQueue;

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

  // Rate limiting for UpdatesTooLong events to prevent reconnect storms
  private readonly updatesTooLongCooldownMs: number = 60000; // 1 minute cooldown between handling these events

  // Minimum time between reconnections to prevent rapid reconnect loops
  private readonly minReconnectIntervalMs: number = 30000; // Minimum 30s between reconnects

  constructor(deps: {
    client: TelegramClient;
    config: TelegramConfig;
    connectionState: ConnectionState;
    activityState: ActivityState;
    metrics: ConnectionMetrics;
    outboundQueue: OutboundQueue;
  }) {
    this.client = deps.client;
    this.config = deps.config;
    this.connectionState = deps.connectionState;
    this.activityState = deps.activityState;
    this.metrics = deps.metrics;
    this.outboundQueue = deps.outboundQueue;
  }

  /**
   * Add jitter to a delay value to prevent thundering herd
   * @param baseMs - Base delay in milliseconds
   * @param jitterFactor - Fraction of base to add as random jitter (default 0.1 = 10%)
   */
  private addJitter(baseMs: number, jitterFactor: number = 0.1): number {
    const jitter = baseMs * jitterFactor * (Math.random() * 2 - 1); // +/- jitterFactor
    return Math.round(baseMs + jitter);
  }

  registerUpdateHandlers(): void {
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

  async handlePotentialDisconnect(reason: string = 'unknown'): Promise<void> {
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
          this.outboundQueue.flush(),
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
  async performProactiveRefresh(): Promise<void> {
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
  async performKeepalivePing(): Promise<void> {
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
  async performHealthCheck(): Promise<void> {
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
}
