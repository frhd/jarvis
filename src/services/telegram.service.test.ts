import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mocks must be declared before importing the service under test.

const mocks = vi.hoisted(() => {
  const client = {
    addEventHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
    getMe: vi.fn().mockResolvedValue({}),
    invoke: vi.fn().mockResolvedValue({}),
    session: { save: () => 'session' },
  };
  return { client };
});

vi.mock('telegram', () => ({
  TelegramClient: class {
    constructor() {
      return mocks.client;
    }
  },
  Api: {
    UpdatesTooLong: class {},
    User: class {},
    updates: {
      GetState: class {},
    },
  },
}));

vi.mock('telegram/sessions/index.js', () => ({
  StringSession: class {},
}));

vi.mock('../config', () => ({
  appConfig: {
    telegram: {
      apiId: 12345,
      apiHash: 'test-hash',
      sessionString: 'test-session',
      healthCheckIntervalMs: 15_000,
      healthCheckTimeoutMs: 10_000,
      proactiveRefreshIntervalMs: 300_000,
      keepalivePingIntervalMs: 30_000,
      keepalivePingTimeoutMs: 5_000,
      keepaliveFailuresBeforeReconnect: 3,
      staleUpdateThresholdMs: 300_000,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      maxReconnectAttempts: 10,
      outboundQueueMaxSize: 100,
      outboundQueueFlushTimeoutMs: 30_000,
    },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { TelegramService } from './telegram.service.js';

/** Generous fake-timer budget covering reconnect delays plus all catchup/flush timeouts. */
const RECONNECT_TIMER_BUDGET_MS = 10 * 60_000;

type ReconnectInternals = {
  handlePotentialDisconnect(reason: string): Promise<void>;
};

describe('TelegramService reconnect resilience', () => {
  let service: TelegramService;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(mocks.client).forEach((fn) => {
      if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
    });
    mocks.client.connect.mockResolvedValue(undefined);
    mocks.client.disconnect.mockResolvedValue(undefined);
    mocks.client.getMessages.mockResolvedValue([]);
    mocks.client.sendMessage.mockResolvedValue({});
    mocks.client.invoke.mockResolvedValue({});
    service = new TelegramService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes reconnect and clears reconnecting even when catchup getMessages hangs forever', async () => {
    // Simulate the July 11 outage: getMessages never settles
    mocks.client.getMessages.mockImplementation(() => new Promise(() => {}));
    service.recordUpdateReceived('12345', 1); // registers a monitored chat so catchup runs

    const reconnect = (service as unknown as ReconnectInternals).handlePotentialDisconnect('test');
    await vi.advanceTimersByTimeAsync(RECONNECT_TIMER_BUDGET_MS);
    await reconnect;

    const status = service.getConnectionStatus();
    expect(status.reconnecting).toBe(false);
    expect(status.connected).toBe(true);
  });

  it('completes reconnect even when flushing a queued message hangs forever', async () => {
    // Message queued while disconnected (initial state is disconnected)
    await service.sendMessage('12345', 'hello');
    expect(service.getConnectionStatus().outboundQueueSize).toBe(1);

    // Simulate a send that never settles during the post-reconnect flush
    mocks.client.sendMessage.mockImplementation(() => new Promise(() => {}));

    const reconnect = (service as unknown as ReconnectInternals).handlePotentialDisconnect('test');
    await vi.advanceTimersByTimeAsync(RECONNECT_TIMER_BUDGET_MS);
    await reconnect;

    expect(service.getConnectionStatus().reconnecting).toBe(false);
  });

  describe('stale update stream detection during quiet periods', () => {
    type HealthCheckInternals = {
      performHealthCheck(): Promise<void>;
      connectionState: { connected: boolean };
      activityState: { lastUpdateReceived: Date | null; lastSuccessfulPing: Date | null };
    };

    const STALE_THRESHOLD_MS = 300_000; // matches mocked config

    function primeConnectedWithLastUpdate(ageMs: number): HealthCheckInternals {
      const internals = service as unknown as HealthCheckInternals;
      internals.connectionState.connected = true;
      internals.activityState.lastUpdateReceived = new Date(Date.now() - ageMs);
      return internals;
    }

    it('does not reconnect when updates are merely quiet but the connection validates', async () => {
      const internals = primeConnectedWithLastUpdate(STALE_THRESHOLD_MS + 1_000);

      await internals.performHealthCheck();

      expect(mocks.client.disconnect).not.toHaveBeenCalled();
      expect(mocks.client.connect).not.toHaveBeenCalled();
    });

    it('reconnects when the stale connection fails validation', async () => {
      const internals = primeConnectedWithLastUpdate(STALE_THRESHOLD_MS + 1_000);
      mocks.client.invoke.mockRejectedValue(new Error('CONNECTION_NOT_INITED'));

      const check = internals.performHealthCheck();
      await vi.advanceTimersByTimeAsync(RECONNECT_TIMER_BUDGET_MS);
      await check;

      expect(mocks.client.disconnect).toHaveBeenCalled();
      expect(mocks.client.connect).toHaveBeenCalled();
    });

    it('reconnects unconditionally once updates have been absent past the hard threshold', async () => {
      const HARD_THRESHOLD_MS = STALE_THRESHOLD_MS * 6;
      const internals = primeConnectedWithLastUpdate(HARD_THRESHOLD_MS + 1_000);
      mocks.client.invoke.mockResolvedValue({}); // validation would pass, but must not matter

      const check = internals.performHealthCheck();
      await vi.advanceTimersByTimeAsync(RECONNECT_TIMER_BUDGET_MS);
      await check;

      expect(mocks.client.disconnect).toHaveBeenCalled();
      expect(mocks.client.connect).toHaveBeenCalled();
    });
  });

  it('health checks resume after a reconnect whose catchup timed out', async () => {
    mocks.client.getMessages.mockImplementation(() => new Promise(() => {}));
    service.recordUpdateReceived('12345', 1);

    const reconnect = (service as unknown as ReconnectInternals).handlePotentialDisconnect('test');
    await vi.advanceTimersByTimeAsync(RECONNECT_TIMER_BUDGET_MS);
    await reconnect;

    // With reconnecting cleared, sends go straight through instead of queueing
    mocks.client.sendMessage.mockResolvedValue({});
    const sizeBefore = service.getConnectionStatus().outboundQueueSize;
    await service.sendMessage('12345', 'after recovery');
    expect(service.getConnectionStatus().outboundQueueSize).toBe(sizeBefore);
    expect(mocks.client.sendMessage).toHaveBeenCalled();
  });
});
