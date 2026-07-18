import { describe, it, expect, vi, beforeEach } from 'vitest';

// db client is only pulled in transitively via AnalyticsRepository import;
// mock it so no real SQLite connection is opened during the test.
vi.mock('../db/client', () => ({ db: {} }));

// Import AFTER vi.mock()
import { AnalyticsService } from './analytics.service';
import type { AnalyticsRepository } from '../repositories/analytics.repository';
import type { AnalyticsTimeRange } from '../types/analytics.types';

const TIME_RANGE: AnalyticsTimeRange = { from: 0, to: 1_000_000 };

function makeRepo(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  const base = {
    getEscalationRateByIntent: vi.fn().mockResolvedValue([]),
    getCacheStats: vi.fn().mockResolvedValue({
      totalEntries: 10,
      totalHits: 5,
      hitRate: 0.5,
      avgHitCount: 1,
    }),
    getAverageResponseTimes: vi.fn().mockResolvedValue([
      { key: '9', count: 5, avgMs: 100, minMs: 50, maxMs: 200, p50Ms: 100, p95Ms: 150, p99Ms: 200 },
      { key: '10', count: 3, avgMs: 120, minMs: 60, maxMs: 240, p50Ms: 120, p95Ms: 180, p99Ms: 240 },
    ]),
    getConfidenceStats: vi.fn().mockResolvedValue({
      avgConfidence: 0.8,
      lowConfidenceRate: 0.2,
      sampleSize: 100,
    }),
    getConfidenceAndEscalationByHour: vi.fn().mockResolvedValue([
      { hour: 9, avgConfidence: 0.85, escalationRate: 0.1, count: 50 },
    ]),
  };
  return { ...base, ...overrides } as unknown as AnalyticsRepository;
}

describe('AnalyticsService.getConversationQualityMetrics', () => {
  let repo: AnalyticsRepository;
  let service: AnalyticsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new AnalyticsService(repo);
  });

  it('surfaces real confidence stats from the repository', async () => {
    const result = await service.getConversationQualityMetrics(TIME_RANGE);

    expect(result.avgConfidenceScore).toBe(0.8);
    expect(result.lowConfidenceRate).toBe(0.2);
    expect(result.cacheHitRate).toBe(0.5);
  });

  it('merges per-hour confidence/escalation, nulling hours without data', async () => {
    const result = await service.getConversationQualityMetrics(TIME_RANGE);

    const hour9 = result.qualityByTimeOfDay.find((q) => q.hour === 9);
    const hour10 = result.qualityByTimeOfDay.find((q) => q.hour === 10);

    // Hour 9 has classification data
    expect(hour9?.escalationRate).toBe(0.1);
    expect(hour9?.avgConfidence).toBe(0.85);
    expect(hour9?.avgResponseTime).toBe(100);

    // Hour 10 has response times but NO classification data -> null, not 0
    expect(hour10?.avgResponseTime).toBe(120);
    expect(hour10?.escalationRate).toBeNull();
    expect(hour10?.avgConfidence).toBeNull();
  });

  it('propagates null confidence (honest unknown) when nothing was captured', async () => {
    service = new AnalyticsService(
      makeRepo({
        getConfidenceStats: vi.fn().mockResolvedValue({
          avgConfidence: null,
          lowConfidenceRate: null,
          sampleSize: 0,
        }) as never,
        getConfidenceAndEscalationByHour: vi.fn().mockResolvedValue([]) as never,
      })
    );

    const result = await service.getConversationQualityMetrics(TIME_RANGE);

    expect(result.avgConfidenceScore).toBeNull();
    expect(result.lowConfidenceRate).toBeNull();
    expect(
      result.qualityByTimeOfDay.every(
        (q) => q.escalationRate === null && q.avgConfidence === null
      )
    ).toBe(true);
  });
});
