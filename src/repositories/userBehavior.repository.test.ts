import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock db client with a queue-based chainable builder.
// getUserEngagementMetrics issues selects in this order:
//   1. basic message stats
//   2. intent (diversity) stats
//   3. all messages (session calc)
//   4. response stats (llmResponses linkage)  <-- the metric under test
// Real schema is used so drizzle helpers get real column objects.
// ============================================================================

let mockSelectQueue: unknown[][] = [];

vi.mock('../db/client', () => {
  const makeThenable = (getResult: () => unknown) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(getResult()).then(resolve);
        }
        if (prop === Symbol.toStringTag) return 'Promise';
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: () => {
        const r = mockSelectQueue.shift() ?? [];
        return makeThenable(() => r);
      },
    },
  };
});

// Import AFTER vi.mock()
import { UserBehaviorRepository } from './userBehavior.repository';
import type { BehaviorTimeRange } from '../types/analytics.types';

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_RANGE: BehaviorTimeRange = { from: NOW - 7 * DAY_MS, to: NOW };

function queueEngagementSelects(opts: {
  messageCount: number;
  respondedCount: number;
}): void {
  mockSelectQueue = [
    // 1. basic stats
    [
      {
        messageCount: opts.messageCount,
        avgMessageLength: 20,
        firstMessage: new Date(NOW - 5 * DAY_MS),
        lastMessage: new Date(NOW - DAY_MS),
        uniqueDays: 3,
      },
    ],
    // 2. intent stats
    [{ uniqueIntents: 2, totalClassifications: 5 }],
    // 3. all messages (session calc) - empty keeps session math simple
    [],
    // 4. response stats
    [{ respondedCount: opts.respondedCount }],
  ];
}

describe('UserBehaviorRepository - responseRate', () => {
  let repo: UserBehaviorRepository;

  beforeEach(() => {
    mockSelectQueue = [];
    repo = new UserBehaviorRepository();
  });

  it('computes real response rate from bot-response linkage', async () => {
    queueEngagementSelects({ messageCount: 10, respondedCount: 7 });

    const metrics = await repo.getUserEngagementMetrics('sender-1', TIME_RANGE);

    expect(metrics.messageCount).toBe(10);
    expect(metrics.responseRate).toBeCloseTo(0.7);
  });

  it('returns 0 response rate when the user sent no messages', async () => {
    queueEngagementSelects({ messageCount: 0, respondedCount: 0 });

    const metrics = await repo.getUserEngagementMetrics('sender-1', TIME_RANGE);

    expect(metrics.responseRate).toBe(0);
  });

  it('caps response rate at 1.0', async () => {
    // respondedCount somehow exceeding messageCount must not exceed 100%
    queueEngagementSelects({ messageCount: 5, respondedCount: 8 });

    const metrics = await repo.getUserEngagementMetrics('sender-1', TIME_RANGE);

    expect(metrics.responseRate).toBe(1);
  });
});
