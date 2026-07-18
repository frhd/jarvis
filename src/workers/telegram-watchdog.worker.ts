/**
 * Telegram Watchdog Worker
 *
 * Heals the "zombie connection" failure mode: the Node process stays alive and
 * its internal timers keep running, but the Telegram client is disconnected and
 * never recovers. This happens because the in-service health check and keepalive
 * ping both early-return when `connected === false`, so once all reconnect
 * attempts have been exhausted (state left at connected=false, reconnecting=false)
 * nothing ever tries to reconnect again. The process then silently stops
 * receiving messages while outbound messages pile up in the send queue.
 *
 * This watchdog runs on its own interval, independent of the connection state,
 * and:
 *   1. forces a reconnect when the connection is down (or "connected" but the
 *      update stream has gone stale), and
 *   2. escalates to a full process restart if downtime persists past a
 *      threshold, relying on PM2's autorestart to bring up a fresh process
 *      (which reliably reconnects and catches up on missed messages).
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('TelegramWatchdog');

/** Subset of the Telegram connection status the watchdog needs. */
export interface TelegramConnectionStatus {
  connected: boolean;
  reconnecting: boolean;
  lastUpdate: Date | null;
  outboundQueueSize: number;
}

export interface TelegramWatchdogDeps {
  /** Snapshot of the current connection state. */
  getConnectionStatus: () => TelegramConnectionStatus;
  /** Force the Telegram client to disconnect and reconnect. */
  forceReconnect: () => Promise<void>;
  /** Last-resort escalation: terminate the process so PM2 restarts it. */
  restartProcess: () => void;
  /** Injectable clock for testability. Defaults to Date.now. */
  now?: () => number;
}

export interface TelegramWatchdogConfig {
  /** Treat a "connected" client with no updates past this as unhealthy. */
  staleUpdateThresholdMs: number;
  /** Escalate to a process restart after the connection is down this long. */
  restartAfterDownMs: number;
  /** Treat a reconnect still in progress past this as stuck (unhealthy). */
  stuckReconnectingThresholdMs: number;
  /** Whether the restart escalation is allowed at all. */
  enableRestartEscalation: boolean;
}

export class TelegramWatchdogWorker {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  /** Timestamp (ms) when the connection was first observed unhealthy, or null. */
  private downSince: number | null = null;
  /** Timestamp (ms) when a reconnect was first observed in progress, or null. */
  private reconnectingSince: number | null = null;

  constructor(
    private readonly deps: TelegramWatchdogDeps,
    private readonly config: TelegramWatchdogConfig
  ) {
    this.now = deps.now ?? Date.now;
  }

  start(intervalMs: number): NodeJS.Timeout {
    logger.info('[TelegramWatchdog] Starting watchdog', {
      intervalMs,
      restartAfterDownMs: this.config.restartAfterDownMs,
      enableRestartEscalation: this.config.enableRestartEscalation,
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    return this.timer;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for testing — runs a single watchdog cycle. */
  async tick(): Promise<void> {
    const status = this.deps.getConnectionStatus();

    // A reconnect is already underway; let it finish before intervening — but
    // only for so long. A reconnect stuck past the threshold (e.g. hung on a
    // network call that never resolves) permanently disables the in-service
    // health checks, so it must be treated as unhealthy, not waited on.
    if (status.reconnecting) {
      if (this.reconnectingSince === null) {
        this.reconnectingSince = this.now();
      }
      const reconnectingMs = this.now() - this.reconnectingSince;
      if (reconnectingMs <= this.config.stuckReconnectingThresholdMs) {
        return;
      }
      this.handleUnhealthy(status, { stuckReconnectingMs: reconnectingMs });
      return;
    }
    this.reconnectingSince = null;

    if (this.isHealthy(status)) {
      if (this.downSince !== null) {
        logger.info('[TelegramWatchdog] Connection recovered');
        this.downSince = null;
      }
      return;
    }

    const restarted = this.handleUnhealthy(status, {});
    if (restarted) {
      return;
    }

    try {
      logger.warn('[TelegramWatchdog] Forcing reconnect');
      await this.deps.forceReconnect();
    } catch (error) {
      logger.error('[TelegramWatchdog] Forced reconnect failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Tracks downtime and escalates to a process restart once it is sustained.
   * Returns true when the restart escalation fired. Callers decide whether a
   * forced reconnect is a sensible follow-up — it is not while a stuck
   * reconnect holds the reconnect mutex, since it would await that same
   * hung promise.
   */
  private handleUnhealthy(
    status: TelegramConnectionStatus,
    extra: Record<string, number>
  ): boolean {
    const now = this.now();
    if (this.downSince === null) {
      this.downSince = now;
    }
    const downMs = now - this.downSince;

    logger.warn('[TelegramWatchdog] Connection unhealthy', {
      connected: status.connected,
      reconnecting: status.reconnecting,
      lastUpdate: status.lastUpdate ? status.lastUpdate.toISOString() : null,
      outboundQueueSize: status.outboundQueueSize,
      downMs,
      ...extra,
    });

    // Escalate to a full restart once downtime is sustained — reconnects alone
    // have failed to recover the connection.
    if (this.config.enableRestartEscalation && downMs >= this.config.restartAfterDownMs) {
      logger.error('[TelegramWatchdog] Sustained downtime — escalating to process restart', {
        downMs,
        restartAfterDownMs: this.config.restartAfterDownMs,
        ...extra,
      });
      this.deps.restartProcess();
      return true;
    }
    return false;
  }

  private isHealthy(status: TelegramConnectionStatus): boolean {
    if (!status.connected) {
      return false;
    }
    if (status.lastUpdate !== null) {
      const sinceUpdate = this.now() - status.lastUpdate.getTime();
      if (sinceUpdate > this.config.staleUpdateThresholdMs) {
        return false;
      }
    }
    return true;
  }
}
