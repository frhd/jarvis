import { AnalyticsRepository } from '../repositories/analytics.repository';
import { logger } from '../utils/logger';
import type {
  ConversationFlowMetrics,
  ConversationFlowOptions,
  ConversationSession,
  ConversationTurn,
  FlowPattern,
  ConversationTransition,
  IntentTransitionMatrix,
  ConversationLengthDistribution,
  ResponseTimeStats,
  ResponseTimeGroupBy,
  ConversationQualityMetrics,
  SessionIdentificationOptions,
  AnalyticsTimeRange,
} from '../types/analytics.types';
import type { ChildIntent } from '../types/intent.types';

/**
 * Default session identification options
 */
const DEFAULT_SESSION_OPTIONS: SessionIdentificationOptions = {
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  minMessages: 1,
  maxSessionDuration: 24 * 60 * 60 * 1000, // 24 hours
  breakOnTopicChange: false,
};

/**
 * AnalyticsService - Business logic for conversation flow analysis
 *
 * Provides comprehensive analytics on conversation patterns, flow,
 * and quality metrics.
 */
export class AnalyticsService {
  constructor(private analyticsRepo: AnalyticsRepository) {
    logger.info('[Analytics] Service initialized');
  }

  /**
   * Get comprehensive conversation flow analysis
   *
   * @param options - Analysis options
   * @returns Complete conversation flow metrics
   */
  async getConversationFlowAnalysis(
    options: ConversationFlowOptions
  ): Promise<ConversationFlowMetrics> {
    logger.info('[Analytics] Getting conversation flow analysis', { options });

    try {
      const {
        timeRange,
        chatIds,
        sessionTimeoutMs = DEFAULT_SESSION_OPTIONS.timeoutMs,
        minTurns = 1,
        maxPatterns = 20,
        minPatternFrequency = 2,
      } = options;

      // Step 1: Analyze sessions
      const sessionAnalysis = await this.analyzeSessions(
        timeRange,
        chatIds,
        sessionTimeoutMs,
        minTurns
      );

      // Step 2: Calculate metrics
      const metricsAnalysis = this.calculateMetrics(sessionAnalysis.filteredSessions);

      // Step 3: Detect patterns
      const patternAnalysis = await this.detectPatterns(
        sessionAnalysis.filteredSessions,
        timeRange,
        chatIds,
        maxPatterns,
        minPatternFrequency
      );

      // Step 4: Aggregate results
      const metrics = await this.aggregateResults(
        timeRange,
        chatIds,
        metricsAnalysis,
        patternAnalysis
      );

      logger.info('[Analytics] Conversation flow analysis completed', {
        totalSessions: metrics.totalSessions,
        totalTurns: metrics.totalTurns,
        patternsFound: patternAnalysis.flowPatterns.length,
      });

      return metrics;
    } catch (error) {
      logger.error('[Analytics] Failed to get conversation flow analysis', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Identify conversation sessions from messages
   *
   * @param timeRange - Time range to analyze
   * @param chatIds - Optional filter by chat IDs
   * @param sessionTimeoutMs - Session timeout threshold
   * @returns Array of identified sessions with turns
   */
  async identifySessions(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[],
    sessionTimeoutMs: number = DEFAULT_SESSION_OPTIONS.timeoutMs
  ): Promise<ConversationSession[]> {
    logger.info('[Analytics] Identifying sessions', {
      timeRange,
      chatIds,
      sessionTimeoutMs,
    });

    try {
      // If chatIds provided, get sessions for each chat
      // Otherwise, we'd need to query all chats first
      if (!chatIds || chatIds.length === 0) {
        logger.warn(
          '[Analytics] No chatIds provided for session identification'
        );
        return [];
      }

      const allSessions: ConversationSession[] = [];

      for (const chatId of chatIds) {
        const chatSessions = await this.analyticsRepo.getConversationSessions(
          chatId,
          timeRange,
          sessionTimeoutMs
        );

        // Populate turns for each session
        for (const session of chatSessions) {
          const turns = await this.analyticsRepo.getConversationTurns(
            session.sessionId,
            session.messageIds
          );

          session.turns = turns;
          session.turnCount = turns.length;

          // Calculate average response time
          const responseTimes = turns
            .filter((t) => t.responseTime !== undefined)
            .map((t) => t.responseTime!);

          session.avgResponseTime =
            responseTimes.length > 0
              ? responseTimes.reduce((sum, rt) => sum + rt, 0) /
                responseTimes.length
              : 0;
        }

        allSessions.push(...chatSessions);
      }

      logger.info('[Analytics] Sessions identified', {
        sessionCount: allSessions.length,
      });

      return allSessions;
    } catch (error) {
      logger.error('[Analytics] Failed to identify sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Analyze flow patterns in sessions
   * Identifies common sequences of intents
   *
   * @param sessions - Sessions to analyze
   * @param maxPatterns - Maximum patterns to return
   * @param minFrequency - Minimum frequency for a pattern
   * @returns Array of detected flow patterns
   */
  async analyzeFlowPatterns(
    sessions: ConversationSession[],
    maxPatterns: number = 20,
    minFrequency: number = 2
  ): Promise<FlowPattern[]> {
    logger.info('[Analytics] Analyzing flow patterns', {
      sessionCount: sessions.length,
      maxPatterns,
      minFrequency,
    });

    try {
      // Extract intent sequences from sessions
      const patternMap = new Map<
        string,
        {
          sequence: ChildIntent[];
          frequency: number;
          durations: number[];
          turnCounts: number[];
          sessionIds: string[];
        }
      >();

      for (const session of sessions) {
        // Extract intent sequence from turns
        const intentSequence = session.turns
          .filter((t) => t.childIntent)
          .map((t) => t.childIntent!);

        if (intentSequence.length === 0) continue;

        // Create pattern key from sequence
        const patternKey = intentSequence.join('->');

        const existing = patternMap.get(patternKey);
        if (existing) {
          existing.frequency++;
          existing.durations.push(session.durationMs);
          existing.turnCounts.push(session.turnCount);
          if (existing.sessionIds.length < 5) {
            // Keep max 5 examples
            existing.sessionIds.push(session.sessionId);
          }
        } else {
          patternMap.set(patternKey, {
            sequence: intentSequence,
            frequency: 1,
            durations: [session.durationMs],
            turnCounts: [session.turnCount],
            sessionIds: [session.sessionId],
          });
        }
      }

      // Convert to FlowPattern array
      const patterns: FlowPattern[] = Array.from(patternMap.entries())
        .filter(([_, data]) => data.frequency >= minFrequency)
        .map(([key, data]) => {
          const avgDuration =
            data.durations.reduce((sum, d) => sum + d, 0) / data.durations.length;
          const avgTurns =
            data.turnCounts.reduce((sum, t) => sum + t, 0) /
            data.turnCounts.length;

          return {
            patternId: key,
            patternName: this.generatePatternName(data.sequence),
            intentSequence: data.sequence,
            frequency: data.frequency,
            avgDuration,
            minDuration: Math.min(...data.durations),
            maxDuration: Math.max(...data.durations),
            avgTurns,
            exampleSessionIds: data.sessionIds,
          };
        })
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, maxPatterns);

      logger.info('[Analytics] Flow patterns analyzed', {
        patternsFound: patterns.length,
      });

      return patterns;
    } catch (error) {
      logger.error('[Analytics] Failed to analyze flow patterns', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get transition probability matrix
   *
   * @param timeRange - Time range for analysis
   * @param chatIds - Optional filter by chat IDs
   * @returns Intent transition matrix with probabilities
   */
  async getTransitionMatrix(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[]
  ): Promise<IntentTransitionMatrix> {
    logger.info('[Analytics] Getting transition matrix', { timeRange, chatIds });

    try {
      const transitions = await this.analyticsRepo.getIntentTransitions(
        timeRange,
        chatIds
      );

      // Build transition matrix
      const matrix: Record<ChildIntent, Record<ChildIntent, number>> = {} as any;

      for (const transition of transitions) {
        if (!matrix[transition.fromIntent]) {
          matrix[transition.fromIntent] = {} as any;
        }
        matrix[transition.fromIntent][transition.toIntent] =
          transition.probability;
      }

      // Calculate starting intents (intents that appear as "from" but rarely as "to")
      const fromCounts = new Map<ChildIntent, number>();
      const toCounts = new Map<ChildIntent, number>();

      for (const t of transitions) {
        fromCounts.set(t.fromIntent, (fromCounts.get(t.fromIntent) || 0) + t.count);
        toCounts.set(t.toIntent, (toCounts.get(t.toIntent) || 0) + t.count);
      }

      const totalTransitions = transitions.reduce((sum, t) => sum + t.count, 0);

      const startingIntents = Array.from(fromCounts.entries())
        .map(([intent, count]) => ({
          intent,
          count,
          percentage: totalTransitions > 0 ? (count / totalTransitions) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const endingIntents = Array.from(toCounts.entries())
        .map(([intent, count]) => ({
          intent,
          count,
          percentage: totalTransitions > 0 ? (count / totalTransitions) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const result: IntentTransitionMatrix = {
        timeRange,
        transitions,
        matrix,
        startingIntents,
        endingIntents,
        totalTransitions,
      };

      logger.info('[Analytics] Transition matrix generated', {
        totalTransitions,
        uniqueFromIntents: fromCounts.size,
        uniqueToIntents: toCounts.size,
      });

      return result;
    } catch (error) {
      logger.error('[Analytics] Failed to get transition matrix', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get conversation quality metrics
   *
   * @param timeRange - Time range for analysis
   * @param chatIds - Optional filter by chat IDs
   * @returns Quality metrics
   */
  async getConversationQualityMetrics(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[]
  ): Promise<ConversationQualityMetrics> {
    logger.info('[Analytics] Getting conversation quality metrics', {
      timeRange,
      chatIds,
    });

    try {
      // Get escalation rates
      const escalationRateByIntent =
        await this.analyticsRepo.getEscalationRateByIntent(timeRange);

      const overallEscalationRate =
        escalationRateByIntent.length > 0
          ? escalationRateByIntent.reduce(
              (sum, e) => sum + e.rate * e.totalCount,
              0
            ) /
            escalationRateByIntent.reduce((sum, e) => sum + e.totalCount, 0)
          : 0;

      // Get cache stats
      const cacheStats = await this.analyticsRepo.getCacheStats(timeRange);

      // Get response time by hour and real confidence/escalation stats
      const [responseTimeByHour, confidenceStats, confidenceByHour] =
        await Promise.all([
          this.analyticsRepo.getAverageResponseTimes('hour', timeRange, chatIds),
          this.analyticsRepo.getConfidenceStats(timeRange),
          this.analyticsRepo.getConfidenceAndEscalationByHour(timeRange),
        ]);

      // Index per-hour confidence/escalation for merging with response times.
      const byHour = new Map(confidenceByHour.map((h) => [h.hour, h]));

      const qualityByTimeOfDay = responseTimeByHour.map((g) => {
        const hour = parseInt(g.key);
        const hourStats = byHour.get(hour);
        // Null (not zero) when no classification data exists for this hour, so
        // callers can distinguish "unknown" from a real 0% escalation rate.
        return {
          hour,
          avgResponseTime: g.avgMs,
          escalationRate: hourStats ? hourStats.escalationRate : null,
          avgConfidence: hourStats ? hourStats.avgConfidence : null,
        };
      });

      const qualityMetrics: ConversationQualityMetrics = {
        escalationRate: overallEscalationRate,
        escalationRateByIntent,
        cacheHitRate: cacheStats.hitRate,
        avgConfidenceScore: confidenceStats.avgConfidence,
        lowConfidenceRate: confidenceStats.lowConfidenceRate,
        qualityByTimeOfDay,
      };

      logger.info('[Analytics] Quality metrics calculated', {
        escalationRate: overallEscalationRate,
        cacheHitRate: cacheStats.hitRate,
      });

      return qualityMetrics;
    } catch (error) {
      logger.error('[Analytics] Failed to get conversation quality metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Analyze sessions - identify and filter sessions based on options
   */
  private async analyzeSessions(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[],
    sessionTimeoutMs?: number,
    minTurns?: number
  ): Promise<{ filteredSessions: ConversationSession[] }> {
    const allSessions = await this.identifySessions(
      timeRange,
      chatIds,
      sessionTimeoutMs ?? DEFAULT_SESSION_OPTIONS.timeoutMs
    );

    const filteredSessions = allSessions.filter(
      (s) => s.turnCount >= (minTurns ?? 1)
    );

    return { filteredSessions };
  }

  /**
   * Calculate metrics - basic session metrics, response times, and durations
   */
  private calculateMetrics(sessions: ConversationSession[]): {
    totalSessions: number;
    totalTurns: number;
    avgTurnsPerSession: number;
    medianTurnsPerSession: number;
    responseTimeStats: { avg: number; min: number; max: number; p50: number; p95: number; p99: number };
    avgSessionDuration: number;
  } {
    const totalSessions = sessions.length;
    const totalTurns = sessions.reduce((sum, s) => sum + s.turnCount, 0);
    const avgTurnsPerSession = totalSessions > 0 ? totalTurns / totalSessions : 0;

    // Calculate median turns
    const turnCounts = sessions.map((s) => s.turnCount).sort((a, b) => a - b);
    const medianTurnsPerSession =
      turnCounts.length > 0 ? turnCounts[Math.floor(turnCounts.length / 2)] : 0;

    // Calculate response time statistics
    const allTurns = sessions.flatMap((s) => s.turns);
    const responseTimes = allTurns
      .filter((t) => t.responseTime !== undefined)
      .map((t) => t.responseTime!);

    const responseTimeStats = this.calculateResponseTimeStats(responseTimes);

    // Calculate session duration
    const sessionDurations = sessions.map((s) => s.durationMs);
    const avgSessionDuration =
      sessionDurations.length > 0
        ? sessionDurations.reduce((sum, d) => sum + d, 0) / sessionDurations.length
        : 0;

    return {
      totalSessions,
      totalTurns,
      avgTurnsPerSession,
      medianTurnsPerSession,
      responseTimeStats,
      avgSessionDuration,
    };
  }

  /**
   * Detect patterns - flow patterns, transitions, and session length distribution
   */
  private async detectPatterns(
    sessions: ConversationSession[],
    timeRange: AnalyticsTimeRange,
    chatIds?: string[],
    maxPatterns?: number,
    minPatternFrequency?: number
  ): Promise<{
    flowPatterns: FlowPattern[];
    transitions: ConversationTransition[];
    sessionLengthDistribution: ConversationFlowMetrics['sessionLengthDistribution'];
  }> {
    const flowPatterns = await this.analyzeFlowPatterns(
      sessions,
      maxPatterns ?? 20,
      minPatternFrequency ?? 2
    );

    const transitions = await this.analyticsRepo.getIntentTransitions(timeRange, chatIds);

    const sessionLengthDistribution = this.buildSessionLengthDistribution(sessions);

    return {
      flowPatterns,
      transitions,
      sessionLengthDistribution,
    };
  }

  /**
   * Aggregate results - combine all analysis data into final metrics object
   */
  private async aggregateResults(
    timeRange: AnalyticsTimeRange,
    chatIds: string[] | undefined,
    metricsAnalysis: ReturnType<typeof this.calculateMetrics>,
    patternAnalysis: ReturnType<typeof this.detectPatterns> extends Promise<infer T> ? T : never
  ): Promise<ConversationFlowMetrics> {
    // Get response time groupings
    const [responseTimeByIntent, responseTimeByModel, responseTimeByHour] = await Promise.all([
      this.analyticsRepo.getAverageResponseTimes('intent', timeRange, chatIds),
      this.analyticsRepo.getAverageResponseTimes('model', timeRange, chatIds),
      this.analyticsRepo.getAverageResponseTimes('hour', timeRange, chatIds),
    ]);

    // Get quality metrics
    const qualityMetrics = await this.getConversationQualityMetrics(timeRange, chatIds);

    return {
      timeRange,
      totalSessions: metricsAnalysis.totalSessions,
      totalTurns: metricsAnalysis.totalTurns,
      avgTurnsPerSession: metricsAnalysis.avgTurnsPerSession,
      medianTurnsPerSession: metricsAnalysis.medianTurnsPerSession,
      avgResponseTime: metricsAnalysis.responseTimeStats.avg,
      p50ResponseTime: metricsAnalysis.responseTimeStats.p50,
      p95ResponseTime: metricsAnalysis.responseTimeStats.p95,
      p99ResponseTime: metricsAnalysis.responseTimeStats.p99,
      avgSessionDuration: metricsAnalysis.avgSessionDuration,
      flowPatterns: patternAnalysis.flowPatterns,
      transitions: patternAnalysis.transitions,
      sessionLengthDistribution: patternAnalysis.sessionLengthDistribution,
      responseTimeByIntent: responseTimeByIntent.map((g) => ({
        intent: g.key as ChildIntent,
        avgResponseTime: g.avgMs,
        count: g.count,
      })),
      responseTimeByModel: responseTimeByModel.map((g) => ({
        model: g.key,
        avgResponseTime: g.avgMs,
        count: g.count,
      })),
      responseTimeByHour: responseTimeByHour.map((g) => ({
        hour: parseInt(g.key),
        avgResponseTime: g.avgMs,
        count: g.count,
      })),
      qualityMetrics,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate response time statistics
   */
  private calculateResponseTimeStats(responseTimes: number[]) {
    if (responseTimes.length === 0) {
      return {
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = responseTimes.sort((a, b) => a - b);
    const avg =
      responseTimes.reduce((sum, rt) => sum + rt, 0) / responseTimes.length;

    return {
      avg,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  /**
   * Build session length distribution
   */
  private buildSessionLengthDistribution(
    sessions: ConversationSession[]
  ): ConversationFlowMetrics['sessionLengthDistribution'] {
    const buckets = [
      { label: '1 turn', min: 1, max: 1 },
      { label: '2-3 turns', min: 2, max: 3 },
      { label: '4-5 turns', min: 4, max: 5 },
      { label: '6-10 turns', min: 6, max: 10 },
      { label: '11+ turns', min: 11, max: Infinity },
    ];

    const bucketCounts = buckets.map((bucket) => {
      const sessionsInBucket = sessions.filter(
        (s) => s.turnCount >= bucket.min && s.turnCount <= bucket.max
      );

      return {
        bucket: bucket.label,
        count: sessionsInBucket.length,
        percentage:
          sessions.length > 0
            ? (sessionsInBucket.length / sessions.length) * 100
            : 0,
      };
    });

    return bucketCounts;
  }

  /**
   * Generate human-readable pattern name
   */
  private generatePatternName(sequence: ChildIntent[]): string {
    if (sequence.length === 0) return 'Empty';
    if (sequence.length === 1) return `Single ${sequence[0]}`;

    // Create abbreviated name
    const abbreviated = sequence
      .slice(0, 3)
      .map((intent) =>
        intent
          .split('_')
          .map((word) => word[0].toUpperCase())
          .join('')
      )
      .join('-');

    if (sequence.length > 3) {
      return `${abbreviated}... (${sequence.length} steps)`;
    }

    return abbreviated;
  }
}
