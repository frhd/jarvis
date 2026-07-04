import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger module before importing the worker
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { TelegramWatchdogWorker } from './telegram-watchdog.worker.js';
import type {
  TelegramWatchdogDeps,
  TelegramWatchdogConfig,
  TelegramConnectionStatus,
} from './telegram-watchdog.worker.js';

describe('TelegramWatchdogWorker', () => {
  let status: TelegramConnectionStatus;
  let forceReconnect: ReturnType<typeof vi.fn>;
  let restartProcess: ReturnType<typeof vi.fn>;
  let nowMs: number;
  let config: TelegramWatchdogConfig;
  let worker: TelegramWatchdogWorker;

  const HEALTHY: TelegramConnectionStatus = {
    connected: true,
    reconnecting: false,
    lastUpdate: null,
    outboundQueueSize: 0,
  };

  function makeWorker() {
    const deps: TelegramWatchdogDeps = {
      getConnectionStatus: () => status,
      forceReconnect,
      restartProcess,
      now: () => nowMs,
    };
    return new TelegramWatchdogWorker(deps, config);
  }

  beforeEach(() => {
    status = { ...HEALTHY };
    forceReconnect = vi.fn().mockResolvedValue(undefined);
    restartProcess = vi.fn();
    nowMs = 1_000_000;
    config = {
      staleUpdateThresholdMs: 5 * 60 * 1000, // 5 min
      restartAfterDownMs: 10 * 60 * 1000, // 10 min
      enableRestartEscalation: true,
    };
    worker = makeWorker();
  });

  afterEach(() => {
    worker.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('start/stop lifecycle', () => {
    it('should start and return a timer', () => {
      vi.useFakeTimers();
      const timer = worker.start(60000);
      expect(timer).toBeDefined();
    });

    it('should stop and clear the timer', () => {
      vi.useFakeTimers();
      worker.start(60000);
      worker.stop();
      // ticking the clock should not invoke any action after stop
      vi.advanceTimersByTime(120000);
      expect(forceReconnect).not.toHaveBeenCalled();
    });
  });

  describe('healthy connection', () => {
    it('takes no action when connected and updates are fresh', async () => {
      await worker.tick();
      expect(forceReconnect).not.toHaveBeenCalled();
      expect(restartProcess).not.toHaveBeenCalled();
    });
  });

  describe('zombie state (the 3-week outage)', () => {
    it('forces a reconnect when disconnected and not already reconnecting', async () => {
      status = { ...HEALTHY, connected: false, reconnecting: false };
      await worker.tick();
      expect(forceReconnect).toHaveBeenCalledTimes(1);
      expect(restartProcess).not.toHaveBeenCalled();
    });

    it('does nothing while a reconnect is already in progress', async () => {
      status = { ...HEALTHY, connected: false, reconnecting: true };
      await worker.tick();
      expect(forceReconnect).not.toHaveBeenCalled();
      expect(restartProcess).not.toHaveBeenCalled();
    });
  });

  describe('stale update stream while still "connected"', () => {
    it('forces a reconnect when no updates received past the stale threshold', async () => {
      status = {
        ...HEALTHY,
        connected: true,
        lastUpdate: new Date(nowMs - (config.staleUpdateThresholdMs + 1)),
      };
      await worker.tick();
      expect(forceReconnect).toHaveBeenCalledTimes(1);
    });

    it('does not reconnect when updates are within the stale threshold', async () => {
      status = {
        ...HEALTHY,
        connected: true,
        lastUpdate: new Date(nowMs - (config.staleUpdateThresholdMs - 1)),
      };
      await worker.tick();
      expect(forceReconnect).not.toHaveBeenCalled();
    });
  });

  describe('escalation to self-restart on sustained downtime', () => {
    it('restarts the process after downtime exceeds the restart threshold', async () => {
      status = { ...HEALTHY, connected: false };

      // First tick: marks downtime start, attempts reconnect
      await worker.tick();
      expect(forceReconnect).toHaveBeenCalledTimes(1);
      expect(restartProcess).not.toHaveBeenCalled();

      // Time passes beyond the restart threshold, still down
      nowMs += config.restartAfterDownMs + 1;
      await worker.tick();

      expect(restartProcess).toHaveBeenCalledTimes(1);
      // should escalate instead of issuing another reconnect
      expect(forceReconnect).toHaveBeenCalledTimes(1);
    });

    it('does not restart when escalation is disabled', async () => {
      config = { ...config, enableRestartEscalation: false };
      worker = makeWorker();
      status = { ...HEALTHY, connected: false };

      await worker.tick();
      nowMs += config.restartAfterDownMs + 1;
      await worker.tick();

      expect(restartProcess).not.toHaveBeenCalled();
      expect(forceReconnect).toHaveBeenCalledTimes(2);
    });

    it('resets the downtime timer once the connection recovers', async () => {
      status = { ...HEALTHY, connected: false };
      await worker.tick(); // down at t0

      // recovers
      status = { ...HEALTHY, connected: true };
      nowMs += config.restartAfterDownMs + 1;
      await worker.tick(); // healthy -> reset

      // goes down again; should NOT immediately restart (timer was reset)
      status = { ...HEALTHY, connected: false };
      await worker.tick();

      expect(restartProcess).not.toHaveBeenCalled();
    });
  });
});
