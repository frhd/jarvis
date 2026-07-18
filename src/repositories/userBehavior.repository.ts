import { eq, desc, and, gte, lte, sql, count, asc, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { messages, senders, intentClassificationLogs, llmResponses } from '../db/schema';
import { logger } from '../utils/logger';
import type {
  BehaviorTimeRange,
  UserActivityPattern,
  UserIntentPreferences,
  UserIntentPreference,
  UserEngagementMetrics,
  UserSegmentType,
  CohortRetention,
  CohortRetentionPoint,
  TopUser,
} from '../types/analytics.types';
import type { ChildIntent, ParentIntent } from '../types/intent.types';
import { CHILD_TO_PARENT } from '../types/intent.types';

/**
 * Day name constants
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * UserBehaviorRepository - Database queries for user behavior analytics
 *
 * Provides methods to analyze user activity patterns, engagement metrics,
 * intent preferences, and segmentation data.
 */
export class UserBehaviorRepository {
  /**
   * Get user activity pattern (when user is active)
   *
   * @param senderId - User/sender ID
   * @param timeRange - Time range for analysis
   * @returns Activity pattern with hourly and daily distributions
   */
  async getUserActivityPattern(
    senderId: string,
    timeRange: BehaviorTimeRange
  ): Promise<UserActivityPattern> {
    logger.info('[UserBehaviorRepo] Getting activity pattern', { senderId, timeRange });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Get hourly activity distribution
      const hourlyActivity = await db
        .select({
          hour: sql<number>`CAST(strftime('%H', ${messages.createdAt}) AS INTEGER)`,
          messageCount: sql<number>`count(*)`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .groupBy(sql`strftime('%H', ${messages.createdAt})`)
        .orderBy(sql`strftime('%H', ${messages.createdAt})`);

      // Get daily activity distribution (day of week)
      const dailyActivity = await db
        .select({
          dayOfWeek: sql<number>`CAST(strftime('%w', ${messages.createdAt}) AS INTEGER)`,
          messageCount: sql<number>`count(*)`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .groupBy(sql`strftime('%w', ${messages.createdAt})`)
        .orderBy(sql`strftime('%w', ${messages.createdAt})`);

      // Get total message count and date range
      const [stats] = await db
        .select({
          totalMessages: sql<number>`count(*)`,
          firstMessage: sql<Date>`min(${messages.createdAt})`,
          lastMessage: sql<Date>`max(${messages.createdAt})`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        );

      const totalMessages = Number(stats?.totalMessages || 0);
      const lastActiveAt = stats?.lastMessage || toDate;

      // Calculate percentages
      const activeHours = hourlyActivity.map((row) => ({
        hour: Number(row.hour),
        messageCount: Number(row.messageCount),
        percentage: totalMessages > 0 ? (Number(row.messageCount) / totalMessages) * 100 : 0,
      }));

      const activeDays = dailyActivity.map((row) => {
        const dayOfWeek = Number(row.dayOfWeek);
        return {
          dayOfWeek,
          dayName: DAY_NAMES[dayOfWeek],
          messageCount: Number(row.messageCount),
          percentage: totalMessages > 0 ? (Number(row.messageCount) / totalMessages) * 100 : 0,
        };
      });

      // Calculate average messages per day
      const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      const averageMessagesPerDay = daysDiff > 0 ? totalMessages / daysDiff : 0;

      return {
        senderId,
        activeHours,
        activeDays,
        averageMessagesPerDay,
        lastActiveAt,
        timeRange,
      };
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get activity pattern', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Get user intent preferences (most common intents)
   *
   * @param senderId - User/sender ID
   * @param timeRange - Time range for analysis
   * @param limit - Maximum number of intents to return
   * @returns Intent preferences summary
   */
  async getUserIntentPreferences(
    senderId: string,
    timeRange: BehaviorTimeRange,
    limit: number = 10
  ): Promise<UserIntentPreferences> {
    logger.info('[UserBehaviorRepo] Getting intent preferences', { senderId, timeRange, limit });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Calculate midpoint for trend analysis
      const midPoint = new Date((fromDate.getTime() + toDate.getTime()) / 2);

      // Get intent distribution for the full period and both halves in a single query
      const intentStats = await db
        .select({
          childIntent: intentClassificationLogs.childIntent,
          count: sql<number>`count(*)`,
          avgConfidence: sql<number>`avg(COALESCE(${intentClassificationLogs.confidence}, 0))`,
          firstHalfCount: sql<number>`sum(CASE WHEN ${intentClassificationLogs.createdAt} < ${midPoint} THEN 1 ELSE 0 END)`,
          secondHalfCount: sql<number>`sum(CASE WHEN ${intentClassificationLogs.createdAt} >= ${midPoint} THEN 1 ELSE 0 END)`,
        })
        .from(intentClassificationLogs)
        .innerJoin(messages, eq(messages.id, intentClassificationLogs.messageId))
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(intentClassificationLogs.createdAt, fromDate),
            lte(intentClassificationLogs.createdAt, toDate)
          )
        )
        .groupBy(intentClassificationLogs.childIntent)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(limit);

      // Calculate total classifications
      const totalClassifications = intentStats.reduce((sum, stat) => sum + Number(stat.count), 0);

      // Helper function to calculate trend
      const calculateTrend = (firstHalf: number, secondHalf: number): 'increasing' | 'stable' | 'decreasing' => {
        if (firstHalf === 0) {
          return secondHalf > 0 ? 'increasing' : 'stable';
        }
        const changePercent = ((secondHalf - firstHalf) / firstHalf) * 100;
        if (changePercent > 20) return 'increasing';
        if (changePercent < -20) return 'decreasing';
        return 'stable';
      };

      // Build top intents list with calculated trends
      const topIntents: UserIntentPreference[] = intentStats.map((stat) => ({
        intent: stat.childIntent as ChildIntent,
        count: Number(stat.count),
        percentage: totalClassifications > 0 ? (Number(stat.count) / totalClassifications) * 100 : 0,
        averageConfidence: Number(stat.avgConfidence),
        trend: calculateTrend(Number(stat.firstHalfCount), Number(stat.secondHalfCount)),
      }));

      // Calculate diversity score (unique intents / total intents)
      const uniqueIntents = intentStats.length;
      const diversityScore = totalClassifications > 0 ? uniqueIntents / totalClassifications : 0;

      // Get dominant category (most common parent intent)
      const parentIntentCounts: Record<string, number> = {};
      topIntents.forEach((intent) => {
        const parentIntent = CHILD_TO_PARENT[intent.intent];
        if (parentIntent) {
          parentIntentCounts[parentIntent] = (parentIntentCounts[parentIntent] || 0) + intent.count;
        }
      });

      const dominantCategory = Object.entries(parentIntentCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';

      return {
        senderId,
        topIntents,
        diversityScore,
        dominantCategory,
        timeRange,
      };
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get intent preferences', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Get detailed user engagement metrics
   *
   * @param senderId - User/sender ID
   * @param timeRange - Time range for analysis
   * @returns Detailed engagement metrics
   */
  async getUserEngagementMetrics(
    senderId: string,
    timeRange: BehaviorTimeRange
  ): Promise<UserEngagementMetrics> {
    logger.info('[UserBehaviorRepo] Getting engagement metrics', { senderId, timeRange });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);
      const now = new Date();

      // Get basic message statistics
      const [basicStats] = await db
        .select({
          messageCount: sql<number>`count(*)`,
          avgMessageLength: sql<number>`avg(length(COALESCE(${messages.text}, '')))`,
          firstMessage: sql<Date>`min(${messages.createdAt})`,
          lastMessage: sql<Date>`max(${messages.createdAt})`,
          uniqueDays: sql<number>`count(DISTINCT date(${messages.createdAt}))`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        );

      const messageCount = Number(basicStats?.messageCount || 0);
      const activeDays = Number(basicStats?.uniqueDays || 0);
      const firstMessageDate = basicStats?.firstMessage || fromDate;
      const lastMessageDate = basicStats?.lastMessage || toDate;
      const averageMessageLength = Number(basicStats?.avgMessageLength || 0);

      // Calculate retention days (days since first message)
      const retentionDays = Math.max(
        1,
        Math.floor((now.getTime() - new Date(firstMessageDate).getTime()) / (1000 * 60 * 60 * 24))
      );

      // Calculate days since last active
      const daysSinceLastActive = Math.floor(
        (now.getTime() - new Date(lastMessageDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate message frequency (messages per day)
      const timeRangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      const messageFrequency = timeRangeDays > 0 ? messageCount / timeRangeDays : 0;

      // Get unique intents for diversity calculation
      const [intentStats] = await db
        .select({
          uniqueIntents: sql<number>`count(DISTINCT ${intentClassificationLogs.childIntent})`,
          totalClassifications: sql<number>`count(*)`,
        })
        .from(intentClassificationLogs)
        .innerJoin(messages, eq(messages.id, intentClassificationLogs.messageId))
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(intentClassificationLogs.createdAt, fromDate),
            lte(intentClassificationLogs.createdAt, toDate)
          )
        );

      const uniqueIntents = Number(intentStats?.uniqueIntents || 0);
      const totalClassifications = Number(intentStats?.totalClassifications || 0);
      const intentDiversity = totalClassifications > 0 ? uniqueIntents / totalClassifications : 0;

      // Calculate session-based metrics (sessions are groups of messages within 30 minutes)
      // This is a simplified calculation - for more accurate results, use session tracking
      const sessionTimeoutMs = 30 * 60 * 1000; // 30 minutes
      const allMessages = await db
        .select({
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .orderBy(asc(messages.createdAt));

      let sessionCount = 0;
      let totalSessionDuration = 0;
      let sessionStart: Date | null = null;
      let lastMessageTime: Date | null = null;

      allMessages.forEach((msg) => {
        const msgTime = new Date(msg.createdAt);

        if (!sessionStart) {
          sessionStart = msgTime;
          sessionCount++;
        } else if (lastMessageTime !== null && msgTime.getTime() - lastMessageTime.getTime() > sessionTimeoutMs) {
          // Session ended, start new session
          if (sessionStart !== null && lastMessageTime !== null) {
            totalSessionDuration += lastMessageTime.getTime() - sessionStart.getTime();
          }
          sessionStart = msgTime;
          sessionCount++;
        }

        lastMessageTime = msgTime;
      });

      // Add final session duration
      if (sessionStart !== null && lastMessageTime !== null) {
        const startTime = sessionStart as Date;
        const endTime = lastMessageTime as Date;
        totalSessionDuration += endTime.getTime() - startTime.getTime();
      }

      const averageSessionLength = sessionCount > 0 ? totalSessionDuration / sessionCount / (1000 * 60) : 0; // in minutes

      // Response rate: fraction of the user's messages that received a bot
      // response. A message is "responded to" when it has a linked llmResponses
      // row with no error (llmResponses.messageId references the user message
      // that was processed). Computed from real data rather than assumed 100%.
      const [responseStats] = await db
        .select({
          respondedCount: sql<number>`count(DISTINCT ${llmResponses.messageId})`,
        })
        .from(llmResponses)
        .innerJoin(messages, eq(messages.id, llmResponses.messageId))
        .where(
          and(
            eq(messages.senderId, senderId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate),
            isNull(llmResponses.error)
          )
        );

      const respondedCount = Number(responseStats?.respondedCount || 0);
      const responseRate =
        messageCount > 0 ? Math.min(1, respondedCount / messageCount) : 0;

      return {
        messageCount,
        activeDays,
        responseRate,
        averageSessionLength,
        retentionDays,
        daysSinceLastActive,
        messageFrequency,
        intentDiversity,
        averageMessageLength,
      };
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get engagement metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Get cohort retention data
   *
   * @param cohortDate - Start date for the cohort (users who joined on this date)
   * @param periodType - Period type for retention analysis
   * @returns Cohort retention analysis
   */
  async getUserRetention(
    cohortDate: Date,
    periodType: 'day' | 'week' | 'month' = 'week'
  ): Promise<CohortRetention> {
    logger.info('[UserBehaviorRepo] Getting user retention', { cohortDate, periodType });

    try {
      const cohortStart = new Date(cohortDate);
      cohortStart.setHours(0, 0, 0, 0);

      const cohortEnd = new Date(cohortStart);
      cohortEnd.setHours(23, 59, 59, 999);

      // Get users who joined in this cohort
      const cohortUsers = await db
        .select({
          senderId: senders.id,
        })
        .from(senders)
        .where(
          and(
            gte(senders.createdAt, cohortStart),
            lte(senders.createdAt, cohortEnd)
          )
        );

      const cohortSize = cohortUsers.length;
      const userIds = cohortUsers.map((u) => u.senderId);

      if (cohortSize === 0) {
        return {
          cohortDate: cohortStart,
          cohortSize: 0,
          retentionCurve: [],
          averageRetention: 0,
          periodType,
        };
      }

      // Calculate retention for each period
      const retentionCurve: CohortRetentionPoint[] = [];
      const maxPeriods = periodType === 'day' ? 30 : periodType === 'week' ? 12 : 6;

      for (let period = 0; period <= maxPeriods; period++) {
        const periodStart = new Date(cohortStart);
        const periodEnd = new Date(cohortStart);

        if (periodType === 'day') {
          periodStart.setDate(periodStart.getDate() + period);
          periodEnd.setDate(periodEnd.getDate() + period + 1);
        } else if (periodType === 'week') {
          periodStart.setDate(periodStart.getDate() + period * 7);
          periodEnd.setDate(periodEnd.getDate() + (period + 1) * 7);
        } else {
          periodStart.setMonth(periodStart.getMonth() + period);
          periodEnd.setMonth(periodEnd.getMonth() + period + 1);
        }

        // Count active users in this period
        const [activeUsersResult] = await db
          .select({
            activeUsers: sql<number>`count(DISTINCT ${messages.senderId})`,
          })
          .from(messages)
          .where(
            and(
              sql`${messages.senderId} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`,
              gte(messages.createdAt, periodStart),
              lte(messages.createdAt, periodEnd)
            )
          );

        const activeUsers = Number(activeUsersResult?.activeUsers || 0);
        const retentionRate = activeUsers / cohortSize;

        retentionCurve.push({
          cohortDate: cohortStart,
          period,
          periodLabel: `${periodType === 'day' ? 'Day' : periodType === 'week' ? 'Week' : 'Month'} ${period}`,
          activeUsers,
          retentionRate,
          retentionPercentage: retentionRate * 100,
        });
      }

      // Calculate average retention across all periods
      const averageRetention = retentionCurve.reduce((sum, point) => sum + point.retentionRate, 0) / retentionCurve.length;

      return {
        cohortDate: cohortStart,
        cohortSize,
        retentionCurve,
        averageRetention,
        periodType,
      };
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get user retention', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cohortDate,
      });
      throw error;
    }
  }

  /**
   * Get top users by message count
   *
   * @param timeRange - Time range for analysis
   * @param limit - Maximum number of users to return
   * @returns Top users list
   */
  async getTopUsers(
    timeRange: BehaviorTimeRange,
    limit: number = 10
  ): Promise<Array<{ senderId: string; username: string | null; firstName: string | null; messageCount: number }>> {
    logger.info('[UserBehaviorRepo] Getting top users', { timeRange, limit });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const topUsers = await db
        .select({
          senderId: messages.senderId,
          username: senders.username,
          firstName: senders.firstName,
          messageCount: sql<number>`count(*)`,
        })
        .from(messages)
        .leftJoin(senders, eq(messages.senderId, senders.id))
        .where(
          and(
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .groupBy(messages.senderId, senders.username, senders.firstName)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(limit);

      return topUsers.map((user) => ({
        senderId: user.senderId || 'unknown',
        username: user.username,
        firstName: user.firstName,
        messageCount: Number(user.messageCount),
      }));
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get top users', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get user segments (categorize users by engagement)
   *
   * @param timeRange - Time range for analysis
   * @returns User segmentation summary
   */
  async getUserSegments(
    timeRange: BehaviorTimeRange
  ): Promise<Array<{ senderId: string; messageCount: number; activeDays: number; lastActiveAt: Date }>> {
    logger.info('[UserBehaviorRepo] Getting user segments', { timeRange });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Get basic user statistics for segmentation
      const userStats = await db
        .select({
          senderId: messages.senderId,
          messageCount: sql<number>`count(*)`,
          activeDays: sql<number>`count(DISTINCT date(${messages.createdAt}))`,
          lastActiveAt: sql<Date>`max(${messages.createdAt})`,
        })
        .from(messages)
        .where(
          and(
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .groupBy(messages.senderId);

      return userStats.map((stat) => ({
        senderId: stat.senderId || 'unknown',
        messageCount: Number(stat.messageCount),
        activeDays: Number(stat.activeDays),
        lastActiveAt: new Date(stat.lastActiveAt),
      }));
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get user segments', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get all senders with their basic info
   *
   * @returns List of all senders
   */
  async getAllSenders(): Promise<Array<{
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
  }>> {
    logger.info('[UserBehaviorRepo] Getting all senders');

    try {
      const allSenders = await db
        .select({
          id: senders.id,
          telegramId: senders.telegramId,
          username: senders.username,
          firstName: senders.firstName,
          lastName: senders.lastName,
          createdAt: senders.createdAt,
        })
        .from(senders)
        .orderBy(desc(senders.createdAt));

      return allSenders.map((sender) => ({
        id: sender.id,
        telegramId: sender.telegramId,
        username: sender.username,
        firstName: sender.firstName,
        lastName: sender.lastName,
        createdAt: new Date(sender.createdAt),
      }));
    } catch (error) {
      logger.error('[UserBehaviorRepo] Failed to get all senders', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
