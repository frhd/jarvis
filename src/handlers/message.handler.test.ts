import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks MUST be declared before importing the handler.
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// The GramJS packages are heavy and only used for types / the event-builder
// instance here; stub them so the handler can be exercised in isolation.
vi.mock('telegram', () => ({
  TelegramClient: class {},
  Api: {},
}));
vi.mock('telegram/events/index.js', () => ({
  NewMessage: class {
    constructor(_opts?: unknown) {}
  },
}));

import {
  setupMessageHandler,
  MAX_CONCURRENT_MESSAGE_PIPELINES,
} from './message.handler.js';

/** Utility: a promise plus its resolve handle. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('setupMessageHandler concurrency gating', () => {
  let capturedHandler: (event: unknown) => Promise<void>;
  let client: { addEventHandler: ReturnType<typeof vi.fn>; removeEventHandler: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    capturedHandler = undefined as never;
    client = {
      addEventHandler: vi.fn((handler: (event: unknown) => Promise<void>) => {
        capturedHandler = handler;
      }),
      removeEventHandler: vi.fn(),
    };
  });

  it('ingests immediately, bounds concurrent processing, and never drops a message', async () => {
    let ingested = 0;
    let processing = 0;
    let maxObserved = 0;
    const gates: Array<ReturnType<typeof deferred>> = [];

    // Mirrors the real IngestionService contract: ingest/enqueue runs
    // unconditionally, then the expensive stage runs inside the provided gate.
    const ingestionService = {
      ingestMessage: vi.fn(
        async (
          _client: unknown,
          _event: unknown,
          options?: { processingGate?: (fn: () => Promise<void>) => Promise<void> }
        ) => {
          ingested++;
          const runProcessing = async () => {
            processing++;
            maxObserved = Math.max(maxObserved, processing);
            const gate = deferred();
            gates.push(gate);
            await gate.promise;
            processing--;
          };
          await (options?.processingGate
            ? options.processingGate(runProcessing)
            : runProcessing());
        }
      ),
    };

    setupMessageHandler(client as never, ingestionService as never);
    expect(capturedHandler).toBeDefined();

    // Fire a burst far larger than the concurrency limit.
    const burstSize = MAX_CONCURRENT_MESSAGE_PIPELINES * 3;
    const inflight = Array.from({ length: burstSize }, (_v, i) =>
      capturedHandler({ chatId: { toString: () => `chat-${i}` }, message: { id: i } })
    );

    // Let the scheduler admit as many as permitted.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Every message was ingested immediately — persistence is never delayed
    // behind other messages' processing.
    expect(ingested).toBe(burstSize);
    // Processing concurrency is capped; the remainder are queued (not dropped).
    expect(processing).toBe(MAX_CONCURRENT_MESSAGE_PIPELINES);

    // Drain: resolve gates as they appear until every task completes.
    while (gates.length > 0) {
      const gate = gates.shift()!;
      gate.resolve();
      for (let i = 0; i < 3; i++) await Promise.resolve();
    }

    await Promise.all(inflight);

    // Every message in the burst was eventually fully processed — none dropped.
    expect(ingestionService.ingestMessage).toHaveBeenCalledTimes(burstSize);
    expect(gates.length).toBe(0);
    expect(maxObserved).toBe(MAX_CONCURRENT_MESSAGE_PIPELINES);
  });

  it('swallows pipeline errors so one failure cannot break the handler', async () => {
    const ingestionService = {
      ingestMessage: vi.fn(async () => {
        throw new Error('pipeline boom');
      }),
    };

    setupMessageHandler(client as never, ingestionService as never);

    await expect(
      capturedHandler({ chatId: { toString: () => 'chat' }, message: { id: 1 } })
    ).resolves.toBeUndefined();
    expect(ingestionService.ingestMessage).toHaveBeenCalledTimes(1);
  });
});
