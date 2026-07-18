import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock db client with a queue-based chainable builder.
// Each db.select()/db.selectDistinct() call consumes the next queued result.
// Real schema is used (not mocked) so drizzle helpers get real column objects.
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

  const nextResult = () => {
    const r = mockSelectQueue.shift() ?? [];
    return makeThenable(() => r);
  };

  return {
    db: {
      select: () => nextResult(),
      selectDistinct: () => nextResult(),
    },
  };
});

// Import AFTER vi.mock()
import { AnalyticsRepository } from './analytics.repository';
import type { AnalyticsTimeRange } from '../types/analytics.types';

const TIME_RANGE: AnalyticsTimeRange = { from: 0, to: 1_000_000 };

describe('AnalyticsRepository - confidence & escalation', () => {
  let repo: AnalyticsRepository;

  beforeEach(() => {
    mockSelectQueue = [];
    repo = new AnalyticsRepository();
  });

  describe('getConfidenceStats', () => {
    it('computes real average confidence and low-confidence rate', async () => {
      mockSelectQueue = [
        [
          {
            total: 10,
            confidenceCount: 8,
            confidenceSum: 6.4, // avg = 0.8
            levelCount: 10,
            lowLevelCount: 3, // low rate = 0.3
          },
        ],
      ];

      const result = await repo.getConfidenceStats(TIME_RANGE);

      expect(result.avgConfidence).toBeCloseTo(0.8);
      expect(result.lowConfidenceRate).toBeCloseTo(0.3);
      expect(result.sampleSize).toBe(10);
    });

    it('returns null (not fabricated) when no confidence data is captured', async () => {
      mockSelectQueue = [
        [
          {
            total: 5,
            confidenceCount: 0,
            confidenceSum: null,
            levelCount: 0,
            lowLevelCount: null,
          },
        ],
      ];

      const result = await repo.getConfidenceStats(TIME_RANGE);

      expect(result.avgConfidence).toBeNull();
      expect(result.lowConfidenceRate).toBeNull();
      expect(result.sampleSize).toBe(5);
    });
  });

  describe('getConfidenceAndEscalationByHour', () => {
    it('maps per-hour rows, nulling confidence when uncaptured', async () => {
      mockSelectQueue = [
        [
          {
            hour: 9,
            total: 20,
            confidenceCount: 20,
            confidenceSum: 17, // avg = 0.85
            escalatedCount: 4, // rate = 0.2
          },
          {
            hour: 14,
            total: 10,
            confidenceCount: 0, // no confidence captured this hour
            confidenceSum: null,
            escalatedCount: 0,
          },
        ],
      ];

      const result = await repo.getConfidenceAndEscalationByHour(TIME_RANGE);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ hour: 9, count: 20 });
      expect(result[0].avgConfidence).toBeCloseTo(0.85);
      expect(result[0].escalationRate).toBeCloseTo(0.2);

      expect(result[1]).toMatchObject({ hour: 14, escalationRate: 0, count: 10 });
      expect(result[1].avgConfidence).toBeNull();
    });
  });

  describe('getConversationLengthDistribution', () => {
    it('buckets real per-session turn counts', async () => {
      // chatIds supplied -> selectDistinct enumeration path is skipped.
      const sessions = [
        { sessionId: 's1', messageIds: ['a', 'b'] },
        { sessionId: 's2', messageIds: ['c', 'd'] },
        { sessionId: 's3', messageIds: ['e'] },
      ];
      vi.spyOn(repo, 'getConversationSessions').mockResolvedValue(
        sessions as never
      );

      // s1 -> 1 turn, s2 -> 3 turns, s3 -> 6 turns
      const turnsById: Record<string, unknown[]> = {
        s1: [{ responseTime: 100 }],
        s2: [{ responseTime: 200 }, { responseTime: 400 }, {}],
        s3: [{}, {}, {}, {}, {}, {}],
      };
      vi.spyOn(repo, 'getConversationTurns').mockImplementation(
        async (sessionId: string) => turnsById[sessionId] as never
      );

      const result = await repo.getConversationLengthDistribution(TIME_RANGE, [
        'chat-1',
      ]);

      expect(result.stats.totalSessions).toBe(3);
      expect(result.stats.minTurns).toBe(1);
      expect(result.stats.maxTurns).toBe(6);

      const oneTurn = result.buckets.find((b) => b.label === '1 turn');
      const twoThree = result.buckets.find((b) => b.label === '2-3 turns');
      const sixTen = result.buckets.find((b) => b.label === '6-10 turns');

      expect(oneTurn?.count).toBe(1);
      expect(twoThree?.count).toBe(1);
      expect(sixTen?.count).toBe(1);

      // percentages sum to 100 across non-empty buckets
      const totalPct = result.buckets.reduce((s, b) => s + b.percentage, 0);
      expect(totalPct).toBeCloseTo(100);

      // avgResponseTime for the 2-3 bucket = mean of s2 defined response times (300)
      expect(twoThree?.avgResponseTime).toBeCloseTo(300);
    });

    it('returns zeroed stats when there is no session data', async () => {
      vi.spyOn(repo, 'getConversationSessions').mockResolvedValue([] as never);

      const result = await repo.getConversationLengthDistribution(TIME_RANGE, [
        'chat-1',
      ]);

      expect(result.stats.totalSessions).toBe(0);
      expect(result.buckets.every((b) => b.count === 0)).toBe(true);
    });
  });
});
