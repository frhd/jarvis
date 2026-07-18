import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { ConnectionManager } from './telegram/connection-manager';
import { IntervalTask } from './telegram/interval-task';
import { OutboundQueue, isConnectionError } from './telegram/outbound-queue';
import { connectWithQR } from './telegram/qr-auth';
import { markAsRead, setOnlineStatus, setTyping } from './telegram/presence';
import {
  ActivityState,
  CatchupHandler,
  ConnectionMetrics,
  ConnectionState,
  HandlerSetupFn,
  TELEGRAM_CLIENT_RETRY_DELAY_MS,
} from './telegram/types';

// Re-exported so existing importers (e.g. src/index.ts) keep resolving it here.
export { STALE_HARD_RECONNECT_MULTIPLIER } from './telegram/types';

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

  // Outbound message queue for graceful degradation during disconnection
  private outboundQueue: OutboundQueue;

  // Owns reconnection, keepalive, health checks, stale detection, and catchup
  private connectionManager: ConnectionManager;

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

    this.outboundQueue = new OutboundQueue({
      client: this.client,
      config: this.config,
      metrics: this.metrics,
    });

    this.connectionManager = new ConnectionManager({
      client: this.client,
      config: this.config,
      connectionState: this.connectionState,
      activityState: this.activityState,
      metrics: this.metrics,
      outboundQueue: this.outboundQueue,
    });

    // Initialize interval tasks with bound callbacks
    this.healthCheckTask = new IntervalTask(
      'Health check',
      this.config.healthCheckIntervalMs,
      () => this.connectionManager.performHealthCheck()
    );

    this.proactiveRefreshTask = new IntervalTask(
      'Proactive refresh',
      this.config.proactiveRefreshIntervalMs,
      () => this.connectionManager.performProactiveRefresh()
    );

    this.keepalivePingTask = new IntervalTask(
      'Keepalive ping',
      this.config.keepalivePingIntervalMs,
      () => this.connectionManager.performKeepalivePing()
    );

    this.connectionManager.registerUpdateHandlers();
  }

  /**
   * Delegate: verify connection health. Retained on the facade because tests
   * and interval scheduling drive it through the service surface.
   */
  private async performHealthCheck(): Promise<void> {
    return this.connectionManager.performHealthCheck();
  }

  /**
   * Delegate: trigger reconnection through the connection manager's mutex.
   */
  private async handlePotentialDisconnect(reason: string = 'unknown'): Promise<void> {
    return this.connectionManager.handlePotentialDisconnect(reason);
  }

  /**
   * Force a reconnection attempt. Called from global error handlers.
   */
  async forceReconnect(): Promise<void> {
    return this.connectionManager.forceReconnect();
  }

  /**
   * Record that an update was received. Call this from message handlers.
   * Used to detect stale connections where getMe() works but updates don't flow.
   */
  recordUpdateReceived(chatId?: string, messageId?: number): void {
    this.connectionManager.recordUpdateReceived(chatId, messageId);
  }

  /**
   * Register the handler setup function for re-registration after reconnection.
   */
  setHandlerSetupFn(fn: HandlerSetupFn): void {
    this.connectionManager.setHandlerSetupFn(fn);
  }

  /**
   * Mark that handlers have been registered. Called after initial setup.
   */
  markHandlersRegistered(): void {
    this.connectionManager.markHandlersRegistered();
  }

  /**
   * Register a handler for processing missed messages during catchup.
   */
  setCatchupHandler(fn: CatchupHandler): void {
    this.connectionManager.setCatchupHandler(fn);
  }

  /**
   * Mark the connection live and start the monitoring interval tasks.
   */
  private beginMonitoring(): void {
    this.connectionState.connected = true;
    this.activityState.lastSuccessfulPing = new Date();
    this.activityState.lastUpdateReceived = new Date();
    this.healthCheckTask.start();
    this.proactiveRefreshTask.start();
    this.keepalivePingTask.start();
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
        this.beginMonitoring();
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
    await connectWithQR({
      client: this.client,
      apiId: appConfig.telegram.apiId!,
      apiHash: appConfig.telegram.apiHash!,
      onAuthenticated: () => this.beginMonitoring(),
    });
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
        await this.outboundQueue.flush();
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
    return setTyping(this.client, chatId);
  }

  /**
   * Mark messages as read in a chat (shows ✓✓ to sender)
   * Use this to acknowledge receipt before processing
   */
  async markAsRead(chatId: string | number, maxId: number): Promise<void> {
    return markAsRead(this.client, chatId, maxId);
  }

  /**
   * Explicitly set online/offline status
   * Note: This is user-wide, not per-chat
   */
  async setOnlineStatus(online: boolean = true): Promise<void> {
    return setOnlineStatus(this.client, online);
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    replyToMsgId?: number
  ): Promise<Api.Message | null> {
    // If reconnecting, queue the message for later
    if (this.connectionState.reconnecting || !this.connectionState.connected) {
      this.outboundQueue.enqueue(chatId, text, replyToMsgId);
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
      if (isConnectionError(errorMessage)) {
        logger.warn('[Telegram] Send failed due to connection issue, queueing message', {
          chatId,
          error: errorMessage,
        });
        this.outboundQueue.enqueue(chatId, text, replyToMsgId);
        // Trigger reconnection
        this.connectionManager.handlePotentialDisconnect('send_failed');
        return null;
      }
      throw error;
    }
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
