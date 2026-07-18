import type { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { appConfig } from '../../config';

// ============================================================================
// Named Constants
// ============================================================================

/** Maximum latency measurements to retain for averaging */
export const MAX_LATENCY_MEASUREMENTS = 100;

/** Stale update threshold for validation (1 minute in milliseconds) */
export const STALE_UPDATE_VALIDATION_THRESHOLD_MS = 60_000;

/** Minimum idle time before proactive refresh (5 minutes in milliseconds) */
export const PROACTIVE_REFRESH_MIN_IDLE_MS = 5 * 60_000;

/** Delay between queued messages to avoid rate limiting (milliseconds) */
export const QUEUE_MESSAGE_DELAY_MS = 100;

/** Maximum retry attempts for queued messages */
export const QUEUED_MESSAGE_MAX_RETRIES = 3;

/** Validation ping timeout in milliseconds */
export const VALIDATION_PING_TIMEOUT_MS = 5_000;

/** Pre-disconnect delay base in milliseconds */
export const PRE_DISCONNECT_DELAY_MS = 500;

/** Retry delay for the underlying TelegramClient's built-in connection retries, in milliseconds */
export const TELEGRAM_CLIENT_RETRY_DELAY_MS = 1000;

/** Jitter factor applied to the exponential reconnect backoff delay (±10%) */
export const RECONNECT_JITTER_FACTOR = 0.1;

/** Jitter factor applied to the pre-disconnect delay (±20%) */
export const PRE_DISCONNECT_JITTER_FACTOR = 0.2;

/** Overall budget for post-reconnect message catchup (2 minutes) */
export const RECONNECT_CATCHUP_TIMEOUT_MS = 120_000;

/** Timeout for a single getMessages call during catchup (30 seconds) */
export const CATCHUP_GET_MESSAGES_TIMEOUT_MS = 30_000;

/** Timeout for processing a single missed message during catchup (60 seconds) */
export const CATCHUP_HANDLER_TIMEOUT_MS = 60_000;

/** Timeout for a single queued message send during queue flush (30 seconds) */
export const FLUSH_SEND_TIMEOUT_MS = 30_000;

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

/** Resolved Telegram configuration slice from appConfig. */
export type TelegramConfig = (typeof appConfig)['telegram'];

// Type for handler setup function
export type HandlerSetupFn = (client: TelegramClient) => void;
// Type for catchup handler (processes missed messages)
export type CatchupHandler = (client: TelegramClient, message: Api.Message) => Promise<void>;

// Outbound message queue item
export interface QueuedMessage {
  chatId: string | number;
  text: string;
  replyToMsgId?: number;
  timestamp: Date;
  retryCount: number;
}

/**
 * Connection state tracking for reconnection management
 */
export interface ConnectionState {
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
export interface ActivityState {
  lastSuccessfulPing: Date | null;
  lastUpdateReceived: Date | null;
  lastUpdatesTooLongTime: Date | null;
}

// Connection metrics for monitoring
export interface ConnectionMetrics {
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
