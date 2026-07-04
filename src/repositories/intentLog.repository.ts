import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { intentClassificationLogs } from '../db/schema';
import { IntentClassificationLog, NewIntentClassificationLog } from '../types';
import { BaseRepository } from './base.repository';

export interface AccuracyStatsOptions {
  startDate?: Date;
  endDate?: Date;
}

export interface AccuracyStats {
  totalClassifications: number;
  totalWithFeedback: number;
  correctClassifications: number;
  incorrectClassifications: number;
  accuracyRate: number; // percentage
  averageConfidence: number;
  byMethod: {
    pattern: MethodStats;
    llm: MethodStats;
    escalated: MethodStats;
  };
  byConfidenceLevel: {
    high: ConfidenceLevelStats;
    medium: ConfidenceLevelStats;
    low: ConfidenceLevelStats;
    uncertain: ConfidenceLevelStats;
  };
}

export interface MethodStats {
  count: number;
  withFeedback: number;
  correct: number;
  incorrect: number;
  accuracyRate: number;
  averageConfidence: number;
  averageDuration: number;
}

export interface ConfidenceLevelStats {
  count: number;
  withFeedback: number;
  correct: number;
  incorrect: number;
  accuracyRate: number;
  averageConfidence: number;
}

export interface ConfidenceDistribution {
  high: number;
  medium: number;
  low: number;
  uncertain: number;
  total: number;
}

export interface EscalationRate {
  totalClassifications: number;
  escalatedCount: number;
  escalationRate: number; // percentage
  byParentIntent: Record<string, { total: number; escalated: number; rate: number }>;
}

export class IntentLogRepository extends BaseRepository<
  IntentClassificationLog,
  NewIntentClassificationLog,
  typeof intentClassificationLogs
> {
  protected table = intentClassificationLogs;

  /**
   * Find intent classification log by message ID
   */
  async findByMessageId(messageId: string): Promise<IntentClassificationLog | null> {
    return this.findOneWhere(eq(this.table.messageId, messageId));
  }

  /**
   * Find all logs for a message (in case of multiple classifications)
   */
  async findAllByMessageId(messageId: string): Promise<IntentClassificationLog[]> {
    return this.findManyWhere(eq(this.table.messageId, messageId));
  }

  /**
   * Record feedback for a classification
   */
  async recordFeedback(
    id: string,
    correctIntent: string,
    score: number
  ): Promise<IntentClassificationLog | null> {
    return this.update(id, {
      feedbackCorrectIntent: correctIntent,
      feedbackScore: score,
    });
  }

  /**
   * Get accuracy statistics with optional date range filtering
   */
  async getAccuracyStats(options: AccuracyStatsOptions = {}): Promise<AccuracyStats> {
    const { startDate, endDate } = options;

    // Build where conditions
    const conditions = [];
    if (startDate) {
      conditions.push(gte(intentClassificationLogs.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(intentClassificationLogs.createdAt, endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get all logs in the date range
    const logs = await db
      .select()
      .from(intentClassificationLogs)
      .where(whereClause);

    // Calculate overall stats
    const totalClassifications = logs.length;
    const logsWithFeedback = logs.filter(log => log.feedbackScore !== null);
    const totalWithFeedback = logsWithFeedback.length;
    const correctClassifications = logsWithFeedback.filter(log => log.feedbackScore === 1).length;
    const incorrectClassifications = logsWithFeedback.filter(log => log.feedbackScore === -1).length;
    const accuracyRate = totalWithFeedback > 0
      ? (correctClassifications / totalWithFeedback) * 100
      : 0;

    const confidenceValues = logs.filter(log => log.confidence !== null).map(log => log.confidence!);
    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length
      : 0;

    // Calculate stats by method
    const byMethod = {
      pattern: this.calculateMethodStats(logs, 'pattern'),
      llm: this.calculateMethodStats(logs, 'llm'),
      escalated: this.calculateMethodStats(logs, 'escalated'),
    };

    // Calculate stats by confidence level
    const byConfidenceLevel = {
      high: this.calculateConfidenceLevelStats(logs, 'high'),
      medium: this.calculateConfidenceLevelStats(logs, 'medium'),
      low: this.calculateConfidenceLevelStats(logs, 'low'),
      uncertain: this.calculateConfidenceLevelStats(logs, 'uncertain'),
    };

    return {
      totalClassifications,
      totalWithFeedback,
      correctClassifications,
      incorrectClassifications,
      accuracyRate,
      averageConfidence,
      byMethod,
      byConfidenceLevel,
    };
  }

  /**
   * Helper method to calculate stats for a specific classification method
   */
  private calculateMethodStats(
    logs: IntentClassificationLog[],
    method: 'pattern' | 'llm' | 'escalated'
  ): MethodStats {
    const methodLogs = logs.filter(log => log.classificationMethod === method);
    const withFeedback = methodLogs.filter(log => log.feedbackScore !== null);
    const correct = withFeedback.filter(log => log.feedbackScore === 1).length;
    const incorrect = withFeedback.filter(log => log.feedbackScore === -1).length;
    const accuracyRate = withFeedback.length > 0
      ? (correct / withFeedback.length) * 100
      : 0;

    const confidenceValues = methodLogs
      .filter(log => log.confidence !== null)
      .map(log => log.confidence!);
    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length
      : 0;

    const durationValues = methodLogs
      .filter(log => log.durationMs !== null)
      .map(log => log.durationMs!);
    const averageDuration = durationValues.length > 0
      ? durationValues.reduce((sum, val) => sum + val, 0) / durationValues.length
      : 0;

    return {
      count: methodLogs.length,
      withFeedback: withFeedback.length,
      correct,
      incorrect,
      accuracyRate,
      averageConfidence,
      averageDuration,
    };
  }

  /**
   * Helper method to calculate stats for a specific confidence level
   */
  private calculateConfidenceLevelStats(
    logs: IntentClassificationLog[],
    level: 'high' | 'medium' | 'low' | 'uncertain'
  ): ConfidenceLevelStats {
    const levelLogs = logs.filter(log => log.confidenceLevel === level);
    const withFeedback = levelLogs.filter(log => log.feedbackScore !== null);
    const correct = withFeedback.filter(log => log.feedbackScore === 1).length;
    const incorrect = withFeedback.filter(log => log.feedbackScore === -1).length;
    const accuracyRate = withFeedback.length > 0
      ? (correct / withFeedback.length) * 100
      : 0;

    const confidenceValues = levelLogs
      .filter(log => log.confidence !== null)
      .map(log => log.confidence!);
    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length
      : 0;

    return {
      count: levelLogs.length,
      withFeedback: withFeedback.length,
      correct,
      incorrect,
      accuracyRate,
      averageConfidence,
    };
  }

  /**
   * Get distribution of confidence levels
   */
  async getConfidenceDistribution(): Promise<ConfidenceDistribution> {
    const logs = await db
      .select()
      .from(intentClassificationLogs);

    const distribution = {
      high: logs.filter(log => log.confidenceLevel === 'high').length,
      medium: logs.filter(log => log.confidenceLevel === 'medium').length,
      low: logs.filter(log => log.confidenceLevel === 'low').length,
      uncertain: logs.filter(log => log.confidenceLevel === 'uncertain').length,
      total: logs.length,
    };

    return distribution;
  }

  /**
   * Get escalation rate overall and by parent intent
   */
  async getEscalationRate(): Promise<EscalationRate> {
    const logs = await db
      .select()
      .from(intentClassificationLogs);

    const totalClassifications = logs.length;
    const escalatedCount = logs.filter(log => log.wasEscalated === true).length;
    const escalationRate = totalClassifications > 0
      ? (escalatedCount / totalClassifications) * 100
      : 0;

    // Calculate escalation by parent intent
    const byParentIntent: Record<string, { total: number; escalated: number; rate: number }> = {};

    logs.forEach(log => {
      if (log.parentIntent) {
        if (!byParentIntent[log.parentIntent]) {
          byParentIntent[log.parentIntent] = { total: 0, escalated: 0, rate: 0 };
        }
        byParentIntent[log.parentIntent].total++;
        if (log.wasEscalated) {
          byParentIntent[log.parentIntent].escalated++;
        }
      }
    });

    // Calculate rates
    Object.keys(byParentIntent).forEach(intent => {
      const stats = byParentIntent[intent];
      stats.rate = stats.total > 0 ? (stats.escalated / stats.total) * 100 : 0;
    });

    return {
      totalClassifications,
      escalatedCount,
      escalationRate,
      byParentIntent,
    };
  }

  /**
   * Find recent logs with limit
   */
  async findRecent(limit: number = 100): Promise<IntentClassificationLog[]> {
    return await db
      .select()
      .from(intentClassificationLogs)
      .orderBy(desc(intentClassificationLogs.createdAt))
      .limit(limit);
  }

  /**
   * Find logs by classification method
   */
  async findByMethod(
    method: 'pattern' | 'llm' | 'escalated',
    limit: number = 100
  ): Promise<IntentClassificationLog[]> {
    return await db
      .select()
      .from(intentClassificationLogs)
      .where(eq(intentClassificationLogs.classificationMethod, method))
      .orderBy(desc(intentClassificationLogs.createdAt))
      .limit(limit);
  }

  /**
   * Find logs that were escalated
   */
  async findEscalated(limit: number = 100): Promise<IntentClassificationLog[]> {
    return await db
      .select()
      .from(intentClassificationLogs)
      .where(eq(intentClassificationLogs.wasEscalated, true))
      .orderBy(desc(intentClassificationLogs.createdAt))
      .limit(limit);
  }

  /**
   * Find logs with feedback
   */
  async findWithFeedback(limit: number = 100): Promise<IntentClassificationLog[]> {
    return await db
      .select()
      .from(intentClassificationLogs)
      .where(sql`${intentClassificationLogs.feedbackScore} IS NOT NULL`)
      .orderBy(desc(intentClassificationLogs.createdAt))
      .limit(limit);
  }
}
