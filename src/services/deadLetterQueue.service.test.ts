import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks MUST be declared before importing the module under test.
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  DeadLetterQueueService,
  DLQ_MAX_ENTRIES,
  DLQ_TRIM_INSERT_SAMPLE_INTERVAL,
} from './deadLetterQueue.service.js';

type AnyMock = ReturnType<typeof vi.fn>;

describe('DeadLetterQueueService size cap', () => {
  let dlqRepository: {
    add: AnyMock;
    trimToMaxEntries: AnyMock;
    getById: AnyMock;
  };
  let queueRepository: {
    getById: AnyMock;
    markFailed: AnyMock;
  };
  let service: DeadLetterQueueService;

  beforeEach(() => {
    dlqRepository = {
      add: vi.fn().mockImplementation(async () => ({ id: 'dlq-1', messageId: 'msg-1' })),
      trimToMaxEntries: vi.fn().mockResolvedValue(0),
      getById: vi.fn(),
    };
    queueRepository = {
      getById: vi.fn().mockResolvedValue({
        id: 'queue-1',
        messageId: 'msg-1',
        attempts: 3,
        priority: 0,
        lastError: 'err',
        processedAt: null,
      }),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };

    service = new DeadLetterQueueService(
      dlqRepository as never,
      queueRepository as never
    );
  });

  describe('trimToMaxSize', () => {
    it('delegates to the repository with the default cap', async () => {
      dlqRepository.trimToMaxEntries.mockResolvedValue(7);

      const trimmed = await service.trimToMaxSize();

      expect(trimmed).toBe(7);
      expect(dlqRepository.trimToMaxEntries).toHaveBeenCalledWith(DLQ_MAX_ENTRIES);
    });

    it('honors an explicit cap', async () => {
      await service.trimToMaxSize(42);
      expect(dlqRepository.trimToMaxEntries).toHaveBeenCalledWith(42);
    });
  });

  describe('opportunistic trim on insert', () => {
    it('does not trim on every insert (sampled)', async () => {
      await service.moveToDeadLetter('queue-1', 'reason', []);
      expect(dlqRepository.trimToMaxEntries).not.toHaveBeenCalled();
    });

    it('trims once the sample interval is reached', async () => {
      for (let i = 0; i < DLQ_TRIM_INSERT_SAMPLE_INTERVAL; i++) {
        await service.moveToDeadLetter('queue-1', 'reason', []);
      }
      expect(dlqRepository.trimToMaxEntries).toHaveBeenCalledTimes(1);
      expect(dlqRepository.trimToMaxEntries).toHaveBeenCalledWith(DLQ_MAX_ENTRIES);
    });

    it('never lets a trim failure break moving an item to the DLQ', async () => {
      dlqRepository.trimToMaxEntries.mockRejectedValue(new Error('trim exploded'));

      // Reach the sample threshold; the final insert triggers the failing trim.
      let lastResult;
      for (let i = 0; i < DLQ_TRIM_INSERT_SAMPLE_INTERVAL; i++) {
        lastResult = await service.moveToDeadLetter('queue-1', 'reason', []);
      }

      // The move still succeeds despite the trim throwing.
      expect(lastResult).toEqual({ id: 'dlq-1', messageId: 'msg-1' });
      expect(dlqRepository.add).toHaveBeenCalledTimes(DLQ_TRIM_INSERT_SAMPLE_INTERVAL);
    });
  });
});
