import { UserBehaviorRepository } from '../repositories/userBehavior.repository';
import { logger } from '../utils/logger';
import { processSettledResults } from '../utils/promise-helpers';
import type {
  BehaviorTimeRange,
  UserBehaviorProfile,
  UserEngagementScore,
  UserEngagementMetrics,
  UserSegment,
  UserSegmentType,
  UserSegmentCriteria,
  UserSegmentationSummary,
  RetentionAnalysis,
  CohortRetention,
  UserBehaviorTrends,
  BehaviorTrend,
  BehaviorTrendPoint,
  TopUsersSummary,
  TopUser,
} from '../types/analytics.types';
import {
  DEFAULT_SEGMENT_CRITERIA,
  SEGMENT_DEFINITIONS,
} from '../types/analytics.types';

/**
 * UserBehaviorService - Business logic for user behavior analytics
 *
 * Provides high-level methods for analyzing user behavior, calculating
 * engagement scores, segmenting users, and tracking retention.
 */
export class UserBehaviorService {
  constructor(private userBehaviorRepo: UserBehaviorRepository) {
    logger.info('[UserBehaviorService] Service initialized');
  }

  /**
   * Get complete user behavior profile
   *
   * @param senderId - User/sender ID
   * @param timeRange - Time range for analysis
   * @returns Complete behavior profile
   */
  async getUserBehaviorProfile(
    senderId: string,
    timeRange: BehaviorTimeRange
  ): Promise<UserBehaviorProfile> {
    logger.info('[UserBehaviorService] Getting user behavior profile', { senderId, timeRange });

    try {
      // Fetch all components in parallel
      const [activityPattern, intentPreferences, engagementMetrics, senders] = await Promise.all([
        this.userBehaviorRepo.getUserActivityPattern(senderId, timeRange),
        this.userBehaviorRepo.getUserIntentPreferences(senderId, timeRange),
        this.userBehaviorRepo.getUserEngagementMetrics(senderId, timeRange),
        this.userBehaviorRepo.getAllSenders(),
      ]);

      // Find sender info
      const sender = senders.find((s) => s.id === senderId);

      // Calculate engagement score
      const engagementScore = this.calculateEngagementScore(senderId, engagementMetrics);

      // Determine user segment
      const segment = this.classifyUserSegment(senderId, engagementScore, engagementMetrics);

      // Calculate behavior trends (simplified - would need historical data for real trends)
      const trends = await this.getBehaviorTrends(senderId, timeRange);

      return {
        senderId,
        user: {
          telegramId: sender?.telegramId || 'unknown',
          username: sender?.username || null,
          firstName: sender?.firstName || null,
          lastName: sender?.lastName || null,
        },
        activityPattern,
        intentPreferences,
        engagementScore,
        segment,
        trends,
        generatedAt: new Date(),
        timeRange,
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to get user behavior profile', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Calculate user engagement score
   *
   * @param senderId - User/sender ID
   * @param metrics - Engagement metrics (optional, will fetch if not provided)
   * @param timeRange - Time range for metrics (required if metrics not provided)
   * @returns Engagement score with component breakdown
   */
  calculateEngagementScore(
    senderId: string,
    metrics: UserEngagementMetrics
  ): UserEngagementScore {
    logger.info('[UserBehaviorService] Calculating engagement score', { senderId });

    try {
      // Calculate component scores (0-100)

      // Frequency score: Based on message frequency and active days
      const frequencyScore = Math.min(
        100,
        (metrics.messageFrequency * 10 + metrics.activeDays * 2) / 2
      );

      // Recency score: Based on days since last active (inverse)
      const recencyScore = Math.max(
        0,
        100 - metrics.daysSinceLastActive * 3
      );

      // Depth score: Based on session length, message length, and intent diversity
      const depthScore = Math.min(
        100,
        (metrics.averageSessionLength / 30) * 30 +
        (metrics.averageMessageLength / 100) * 30 +
        metrics.intentDiversity * 40
      );

      // Retention score: Based on retention days and consistency
      const retentionScore = Math.min(
        100,
        (metrics.retentionDays / 365) * 50 +
        (metrics.activeDays / (metrics.retentionDays || 1)) * 50
      );

      // Overall engagement score (weighted average)
      const score = Math.round(
        frequencyScore * 0.3 +
        recencyScore * 0.25 +
        depthScore * 0.25 +
        retentionScore * 0.2
      );

      return {
        senderId,
        score,
        components: {
          frequency: Math.round(frequencyScore),
          recency: Math.round(recencyScore),
          depth: Math.round(depthScore),
          retention: Math.round(retentionScore),
        },
        metrics,
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to calculate engagement score', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Classify user into a segment based on engagement
   *
   * @param senderId - User/sender ID
   * @param engagementScore - Pre-calculated engagement score
   * @param metrics - Engagement metrics
   * @param customCriteria - Optional custom segmentation criteria
   * @returns User segment classification
   */
  classifyUserSegment(
    senderId: string,
    engagementScore: UserEngagementScore,
    metrics: UserEngagementMetrics,
    customCriteria?: Record<UserSegmentType, UserSegmentCriteria>
  ): UserSegment {
    logger.info('[UserBehaviorService] Classifying user segment', { senderId });

    try {
      const criteria = customCriteria || (DEFAULT_SEGMENT_CRITERIA as Record<UserSegmentType, UserSegmentCriteria>);
      const timeRangeDays = metrics.retentionDays;
      const messagesPerDay = metrics.messageFrequency;
      const daysSinceActive = metrics.daysSinceLastActive;

      // Determine segment type based on criteria
      let segmentType: UserSegmentType = 'casual';

      // Check new users first
      if (
        timeRangeDays <= (criteria.new.maxRetentionDays || 7)
      ) {
        segmentType = 'new';
      }
      // Check power users
      else if (
        engagementScore.score >= criteria.power_user.minEngagementScore &&
        messagesPerDay >= (criteria.power_user.minMessagesPerDay || 0) &&
        daysSinceActive <= (criteria.power_user.maxDaysSinceActive || Infinity) &&
        timeRangeDays >= (criteria.power_user.minRetentionDays || 0)
      ) {
        segmentType = 'power_user';
      }
      // Check at-risk users
      else if (
        engagementScore.score >= criteria.at_risk.minEngagementScore &&
        daysSinceActive >= 7 &&
        daysSinceActive <= (criteria.at_risk.maxDaysSinceActive || Infinity) &&
        timeRangeDays >= (criteria.at_risk.minRetentionDays || 0)
      ) {
        segmentType = 'at_risk';
      }
      // Check inactive users
      else if (
        engagementScore.score <= criteria.inactive.maxEngagementScore ||
        daysSinceActive >= (criteria.inactive.maxDaysSinceActive || 30)
      ) {
        segmentType = 'inactive';
      }
      // Default to casual
      else {
        segmentType = 'casual';
      }

      const segmentDef = SEGMENT_DEFINITIONS[segmentType];

      return {
        senderId,
        type: segmentType,
        name: segmentDef.name,
        description: segmentDef.description,
        criteria: criteria[segmentType],
        engagementScore: engagementScore.score,
        metrics: {
          messageCount: metrics.messageCount,
          messagesPerDay: metrics.messageFrequency,
          daysSinceLastActive: metrics.daysSinceLastActive,
          retentionDays: metrics.retentionDays,
        },
        classifiedAt: new Date(),
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to classify user segment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Segment all users into categories
   *
   * @param timeRange - Time range for analysis
   * @param customCriteria - Optional custom segmentation criteria
   * @returns User segmentation summary
   */
  async segmentUsers(
    timeRange: BehaviorTimeRange,
    customCriteria?: Record<UserSegmentType, UserSegmentCriteria>
  ): Promise<UserSegmentationSummary> {
    logger.info('[UserBehaviorService] Segmenting users', { timeRange });

    try {
      // Get all user stats
      const userStats = await this.userBehaviorRepo.getUserSegments(timeRange);

      // Classify each user
      const segmentCounts: Record<UserSegmentType, number> = {
        power_user: 0,
        casual: 0,
        inactive: 0,
        new: 0,
        at_risk: 0,
      };

      for (const userStat of userStats) {
        // Get detailed metrics for this user
        const metrics = await this.userBehaviorRepo.getUserEngagementMetrics(
          userStat.senderId,
          timeRange
        );

        const engagementScore = this.calculateEngagementScore(userStat.senderId, metrics);
        const segment = this.classifyUserSegment(
          userStat.senderId,
          engagementScore,
          metrics,
          customCriteria
        );

        segmentCounts[segment.type]++;
      }

      const totalUsers = userStats.length;

      const segments = (Object.entries(segmentCounts) as [UserSegmentType, number][]).map(
        ([type, count]) => {
          const def = SEGMENT_DEFINITIONS[type];
          return {
            type,
            name: def.name,
            count,
            percentage: totalUsers > 0 ? (count / totalUsers) * 100 : 0,
          };
        }
      );

      return {
        totalUsers,
        segments,
        timeRange,
        analyzedAt: new Date(),
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to segment users', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get retention analysis across multiple cohorts
   *
   * @param timeRange - Time range for analysis
   * @param periodType - Period type for retention calculation
   * @param cohortInterval - Interval for creating cohorts (in days)
   * @returns Retention analysis with cohorts
   */
  async getRetentionAnalysis(
    timeRange: BehaviorTimeRange,
    periodType: 'day' | 'week' | 'month' = 'week',
    cohortInterval: number = 7 // days
  ): Promise<RetentionAnalysis> {
    logger.info('[UserBehaviorService] Getting retention analysis', {
      timeRange,
      periodType,
      cohortInterval,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Generate cohort dates
      const cohortDates: Date[] = [];
      const currentDate = new Date(fromDate);

      while (currentDate <= toDate) {
        cohortDates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + cohortInterval);
      }

      // Get retention data for each cohort
      const cohorts: CohortRetention[] = [];

      for (const cohortDate of cohortDates) {
        const cohort = await this.userBehaviorRepo.getUserRetention(cohortDate, periodType);

        if (cohort.cohortSize > 0) {
          cohorts.push(cohort);
        }
      }

      // Calculate overall retention metrics
      const day1Retention =
        cohorts.reduce((sum, c) => sum + (c.retentionCurve[1]?.retentionRate || 0), 0) /
        (cohorts.length || 1);

      const day7Retention =
        cohorts.reduce((sum, c) => sum + (c.retentionCurve[7]?.retentionRate || 0), 0) /
        (cohorts.length || 1);

      const day30Retention =
        cohorts.reduce((sum, c) => sum + (c.retentionCurve[30]?.retentionRate || 0), 0) /
        (cohorts.length || 1);

      return {
        cohorts,
        overall: {
          day1Retention,
          day7Retention,
          day30Retention,
        },
        timeRange,
        analyzedAt: new Date(),
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to get retention analysis', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get behavior trends for a user over time
   *
   * @param senderId - User/sender ID
   * @param timeRange - Time range for analysis
   * @returns Behavior trends
   */
  async getBehaviorTrends(
    senderId: string,
    timeRange: BehaviorTimeRange
  ): Promise<UserBehaviorTrends> {
    logger.info('[UserBehaviorService] Getting behavior trends', { senderId, timeRange });

    try {
      // This is a simplified implementation
      // In a real implementation, you would:
      // 1. Split the time range into intervals (e.g., weekly)
      // 2. Calculate metrics for each interval
      // 3. Build time-series data points
      // 4. Calculate trend direction and percentage change

      const now = new Date();
      const midpoint = new Date((timeRange.from + timeRange.to) / 2);

      // Get metrics for current and previous periods
      const currentMetrics = await this.userBehaviorRepo.getUserEngagementMetrics(senderId, {
        from: midpoint.getTime(),
        to: timeRange.to,
      });

      const previousMetrics = await this.userBehaviorRepo.getUserEngagementMetrics(senderId, {
        from: timeRange.from,
        to: midpoint.getTime(),
      });

      // Calculate engagement scores for both periods
      const currentScore = this.calculateEngagementScore(senderId, currentMetrics);
      const previousScore = this.calculateEngagementScore(senderId, previousMetrics);

      // Helper to determine trend direction
      const getTrend = (current: number, previous: number): 'increasing' | 'decreasing' | 'stable' => {
        const change = ((current - previous) / (previous || 1)) * 100;
        if (Math.abs(change) < 5) return 'stable';
        return change > 0 ? 'increasing' : 'decreasing';
      };

      // Helper to calculate percentage change
      const getPercentageChange = (current: number, previous: number): number => {
        return previous > 0 ? ((current - previous) / previous) * 100 : 0;
      };

      // Build trend data points (simplified - just two points)
      const buildDataPoints = (previous: number, current: number, label: string): BehaviorTrendPoint[] => [
        {
          timestamp: midpoint,
          value: previous,
          label: `${label} (Previous Period)`,
        },
        {
          timestamp: now,
          value: current,
          label: `${label} (Current Period)`,
        },
      ];

      return {
        senderId,
        messageFrequency: {
          metric: 'messageFrequency',
          label: 'Message Frequency (per day)',
          dataPoints: buildDataPoints(
            previousMetrics.messageFrequency,
            currentMetrics.messageFrequency,
            'Messages/Day'
          ),
          trend: getTrend(currentMetrics.messageFrequency, previousMetrics.messageFrequency),
          percentageChange: getPercentageChange(
            currentMetrics.messageFrequency,
            previousMetrics.messageFrequency
          ),
          currentValue: currentMetrics.messageFrequency,
          previousValue: previousMetrics.messageFrequency,
        },
        engagementScore: {
          metric: 'engagementScore',
          label: 'Engagement Score',
          dataPoints: buildDataPoints(previousScore.score, currentScore.score, 'Score'),
          trend: getTrend(currentScore.score, previousScore.score),
          percentageChange: getPercentageChange(currentScore.score, previousScore.score),
          currentValue: currentScore.score,
          previousValue: previousScore.score,
        },
        sessionLength: {
          metric: 'sessionLength',
          label: 'Average Session Length (minutes)',
          dataPoints: buildDataPoints(
            previousMetrics.averageSessionLength,
            currentMetrics.averageSessionLength,
            'Session Length'
          ),
          trend: getTrend(currentMetrics.averageSessionLength, previousMetrics.averageSessionLength),
          percentageChange: getPercentageChange(
            currentMetrics.averageSessionLength,
            previousMetrics.averageSessionLength
          ),
          currentValue: currentMetrics.averageSessionLength,
          previousValue: previousMetrics.averageSessionLength,
        },
        intentDiversity: {
          metric: 'intentDiversity',
          label: 'Intent Diversity',
          dataPoints: buildDataPoints(
            previousMetrics.intentDiversity,
            currentMetrics.intentDiversity,
            'Diversity'
          ),
          trend: getTrend(currentMetrics.intentDiversity, previousMetrics.intentDiversity),
          percentageChange: getPercentageChange(
            currentMetrics.intentDiversity,
            previousMetrics.intentDiversity
          ),
          currentValue: currentMetrics.intentDiversity,
          previousValue: previousMetrics.intentDiversity,
        },
        timeRange,
        analyzedAt: now,
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to get behavior trends', {
        error: error instanceof Error ? error.message : 'Unknown error',
        senderId,
      });
      throw error;
    }
  }

  /**
   * Get top users across various metrics
   *
   * @param timeRange - Time range for analysis
   * @param limit - Number of top users to return per category
   * @returns Top users summary
   */
  async getTopUsers(timeRange: BehaviorTimeRange, limit: number = 10): Promise<TopUsersSummary> {
    logger.info('[UserBehaviorService] Getting top users', { timeRange, limit });

    try {
      // Get top users by message count
      const topByMessages = await this.userBehaviorRepo.getTopUsers(timeRange, limit);

      // For each user, calculate engagement score and segment
      // Use Promise.allSettled to handle partial failures gracefully
      const enrichmentResults = await Promise.allSettled(
        topByMessages.map(async (user) => {
          const metrics = await this.userBehaviorRepo.getUserEngagementMetrics(user.senderId, timeRange);
          const engagementScore = this.calculateEngagementScore(user.senderId, metrics);
          const segment = this.classifyUserSegment(user.senderId, engagementScore, metrics);

          return {
            user,
            metrics,
            engagementScore,
            segment,
          };
        })
      );

      const { fulfilled: enrichedUsers, rejected } = processSettledResults(enrichmentResults);

      // Log any failures but continue with successful results
      if (rejected.length > 0) {
        logger.warn('[UserBehaviorService] Some user enrichments failed', {
          failureCount: rejected.length,
          totalCount: topByMessages.length,
          successCount: enrichedUsers.length,
        });
      }

      // Build top users lists
      const byMessageCount: TopUser[] = enrichedUsers.map((item, index) => ({
        senderId: item.user.senderId,
        username: item.user.username,
        firstName: item.user.firstName,
        value: item.user.messageCount,
        metricLabel: 'Messages',
        rank: index + 1,
        engagementScore: item.engagementScore.score,
        segment: item.segment.type,
      }));

      const byEngagementScore: TopUser[] = [...enrichedUsers]
        .sort((a, b) => b.engagementScore.score - a.engagementScore.score)
        .map((item, index) => ({
          senderId: item.user.senderId,
          username: item.user.username,
          firstName: item.user.firstName,
          value: item.engagementScore.score,
          metricLabel: 'Engagement Score',
          rank: index + 1,
          engagementScore: item.engagementScore.score,
          segment: item.segment.type,
        }));

      const bySessionLength: TopUser[] = [...enrichedUsers]
        .sort((a, b) => b.metrics.averageSessionLength - a.metrics.averageSessionLength)
        .map((item, index) => ({
          senderId: item.user.senderId,
          username: item.user.username,
          firstName: item.user.firstName,
          value: item.metrics.averageSessionLength,
          metricLabel: 'Session Length (min)',
          rank: index + 1,
          engagementScore: item.engagementScore.score,
          segment: item.segment.type,
        }));

      const byRetention: TopUser[] = [...enrichedUsers]
        .sort((a, b) => b.metrics.retentionDays - a.metrics.retentionDays)
        .map((item, index) => ({
          senderId: item.user.senderId,
          username: item.user.username,
          firstName: item.user.firstName,
          value: item.metrics.retentionDays,
          metricLabel: 'Retention Days',
          rank: index + 1,
          engagementScore: item.engagementScore.score,
          segment: item.segment.type,
        }));

      return {
        byMessageCount,
        byEngagementScore,
        bySessionLength,
        byRetention,
        timeRange,
        analyzedAt: new Date(),
      };
    } catch (error) {
      logger.error('[UserBehaviorService] Failed to get top users', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
