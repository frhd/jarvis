import { sql, and, gte, lte, eq, desc, inArray, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from '../db/client';
import {
  messages,
  intentClassificationLogs,
  llmResponses,
  semanticCache,
} from '../db/schema';
import { logger } from '../utils/logger';
import type {
  AnalyticsTimeRange,
  ConversationSession,
  ConversationTurn,
  ConversationTransition,
  ResponseTimeGroup,
  ResponseTimeGroupBy,
} from '../types/analytics.types';
import type { ChildIntent, ParentIntent } from '../types/intent.types';

/**
 * Message with intent data for session analysis
 */
interface MessageWithIntent {
  id: string;
  telegramMessageId: number;
  chatId: string;
  senderId: string | null;
  text: string | null;
  isBot: boolean;
  createdAt: Date;
  parentIntent: string | null;
  childIntent: string | null;
  confidence: number | null;
  wasEscalated: boolean;
  llmModel: string | null;
  llmDurationMs: number | null;
  responseTime: number | null;
}

/**
 * Turn data from database
 */
interface TurnData {
  userMessageId: string;
  userMessageTimestamp: Date;
  userMessageText: string | null;
  botResponseId: string | null;
  botResponseTimestamp: Date | null;
  responseTimeMs: number | null;
  parentIntent: string | null;
  childIntent: string | null;
  intentConfidence: number | null;
  wasEscalated: boolean;
  modelUsed: string | null;
  llmDurationMs: number | null;
}

/**
 * Confidence levels considered "low" for the low-confidence rate metric.
 * Mirrors the `confidenceLevel` enum on `intentClassificationLogs`.
 */
const LOW_CONFIDENCE_LEVELS = ['low', 'uncertain'] as const;

/** Default time gap that separates two conversation sessions (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Sentinel for an unbounded upper turn bound in a distribution bucket. */
const UNBOUNDED_MAX_TURNS = -1;

/**
 * Turn-count buckets for the conversation length distribution.
 * `maxTurns === UNBOUNDED_MAX_TURNS` means "no upper bound".
 */
const CONVERSATION_LENGTH_BUCKETS = [
  { label: '1 turn', minTurns: 1, maxTurns: 1 },
  { label: '2-3 turns', minTurns: 2, maxTurns: 3 },
  { label: '4-5 turns', minTurns: 4, maxTurns: 5 },
  { label: '6-10 turns', minTurns: 6, maxTurns: 10 },
  { label: '11+ turns', minTurns: 11, maxTurns: UNBOUNDED_MAX_TURNS },
] as const;

/** Percentage scale factor (fraction -> percent). */
const PERCENT_SCALE = 100;

/**
 * AnalyticsRepository - Data access layer for conversation flow analytics
 *
 * Provides queries for conversation session analysis, flow patterns,
 * and intent transitions.
 */
export class AnalyticsRepository {
  /**
   * Get conversation sessions for a chat within a time range
   * Sessions are identified by time gaps (default 30 minutes)
   *
   * @param chatId - Chat ID to analyze
   * @param timeRange - Time range for analysis
   * @param sessionTimeoutMs - Time gap to consider as session boundary (default: 30 minutes)
   * @returns Array of conversation sessions
   */
  async getConversationSessions(
    chatId: string,
    timeRange: AnalyticsTimeRange,
    sessionTimeoutMs: number = 30 * 60 * 1000
  ): Promise<ConversationSession[]> {
    logger.info('[AnalyticsRepo] Fetching conversation sessions', {
      chatId,
      timeRange,
      sessionTimeoutMs,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Get all messages in the time range for this chat
      const messagesData = await db
        .select({
          id: messages.id,
          telegramMessageId: messages.telegramMessageId,
          chatId: messages.chatId,
          senderId: messages.senderId,
          text: messages.text,
          isBot: messages.isBot,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            gte(messages.createdAt, fromDate),
            lte(messages.createdAt, toDate)
          )
        )
        .orderBy(messages.createdAt);

      if (messagesData.length === 0) {
        return [];
      }

      // Group messages into sessions based on time gaps
      const sessions: ConversationSession[] = [];
      let currentSession: {
        messageIds: string[];
        senderId: string | null;
        startTime: number;
        lastTime: number;
      } | null = null;

      for (const msg of messagesData) {
        const msgTime = msg.createdAt.getTime();

        // Start new session if:
        // 1. No current session
        // 2. Time gap exceeds threshold
        // 3. Sender changed (different user)
        if (
          !currentSession ||
          msgTime - currentSession.lastTime > sessionTimeoutMs ||
          (msg.senderId && msg.senderId !== currentSession.senderId)
        ) {
          // Save previous session
          if (currentSession && currentSession.messageIds.length > 0) {
            sessions.push({
              sessionId: `session_${currentSession.startTime}`,
              chatId,
              senderId: currentSession.senderId || 'unknown',
              startTime: currentSession.startTime,
              endTime: currentSession.lastTime,
              durationMs: currentSession.lastTime - currentSession.startTime,
              messageIds: currentSession.messageIds,
              turns: [], // Will be populated later
              turnCount: 0,
              avgResponseTime: 0,
              wasTimedOut: msgTime - currentSession.lastTime > sessionTimeoutMs,
            });
          }

          // Start new session
          currentSession = {
            messageIds: [msg.id],
            senderId: msg.senderId,
            startTime: msgTime,
            lastTime: msgTime,
          };
        } else {
          // Continue current session
          currentSession.messageIds.push(msg.id);
          currentSession.lastTime = msgTime;
        }
      }

      // Add final session
      if (currentSession && currentSession.messageIds.length > 0) {
        sessions.push({
          sessionId: `session_${currentSession.startTime}`,
          chatId,
          senderId: currentSession.senderId || 'unknown',
          startTime: currentSession.startTime,
          endTime: currentSession.lastTime,
          durationMs: currentSession.lastTime - currentSession.startTime,
          messageIds: currentSession.messageIds,
          turns: [],
          turnCount: 0,
          avgResponseTime: 0,
          wasTimedOut: false,
        });
      }

      logger.info('[AnalyticsRepo] Sessions identified', {
        sessionCount: sessions.length,
      });

      return sessions;
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch conversation sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get conversation turns for a session
   * A turn is a user message followed by a bot response
   *
   * @param sessionId - Session ID
   * @param messageIds - Message IDs in the session
   * @returns Array of conversation turns
   */
  async getConversationTurns(
    sessionId: string,
    messageIds: string[]
  ): Promise<ConversationTurn[]> {
    logger.info('[AnalyticsRepo] Fetching conversation turns', {
      sessionId,
      messageCount: messageIds.length,
    });

    try {
      if (messageIds.length === 0) {
        return [];
      }

      // Get messages with intent data and LLM responses
      const messagesWithData = await db
        .select({
          messageId: messages.id,
          telegramMessageId: messages.telegramMessageId,
          chatId: messages.chatId,
          senderId: messages.senderId,
          text: messages.text,
          isBot: messages.isBot,
          createdAt: messages.createdAt,
          parentIntent: intentClassificationLogs.parentIntent,
          childIntent: intentClassificationLogs.childIntent,
          confidence: intentClassificationLogs.confidence,
          wasEscalated: intentClassificationLogs.wasEscalated,
          llmModel: llmResponses.model,
          llmDurationMs: llmResponses.durationMs,
        })
        .from(messages)
        .leftJoin(
          intentClassificationLogs,
          eq(messages.id, intentClassificationLogs.messageId)
        )
        .leftJoin(llmResponses, eq(messages.id, llmResponses.messageId))
        .where(inArray(messages.id, messageIds))
        .orderBy(messages.createdAt);

      // Batch lookup cached messages for efficiency
      const cacheEntries = await db
        .select({
          sourceMessageIds: semanticCache.sourceMessageIds,
        })
        .from(semanticCache);

      // Build a Set of message IDs that have cached responses
      const cachedMessageIds = new Set<string>();
      for (const entry of cacheEntries) {
        if (entry.sourceMessageIds) {
          try {
            const messageIds = JSON.parse(entry.sourceMessageIds) as string[];
            for (const msgId of messageIds) {
              cachedMessageIds.add(msgId);
            }
          } catch (error) {
            // Skip malformed JSON
            logger.warn('[AnalyticsRepo] Failed to parse sourceMessageIds', {
              sourceMessageIds: entry.sourceMessageIds,
            });
          }
        }
      }

      // Build turns by pairing user messages with bot responses
      const turns: ConversationTurn[] = [];
      let turnNumber = 1;

      for (let i = 0; i < messagesWithData.length; i++) {
        const msg = messagesWithData[i];

        // Skip bot messages (they're responses, not turn starters)
        if (msg.isBot) {
          continue;
        }

        // Find the next bot message as the response
        let botResponse = null;
        for (let j = i + 1; j < messagesWithData.length; j++) {
          if (messagesWithData[j].isBot) {
            botResponse = messagesWithData[j];
            break;
          }
        }

        const userTimestamp = msg.createdAt.getTime();
        const botTimestamp = botResponse?.createdAt.getTime();
        const responseTime =
          botTimestamp && userTimestamp ? botTimestamp - userTimestamp : undefined;

        turns.push({
          turnNumber,
          userMessageId: msg.messageId,
          userMessageTimestamp: userTimestamp,
          userMessageText: msg.text || undefined,
          botResponseId: botResponse?.messageId || undefined,
          botResponseTimestamp: botTimestamp || undefined,
          responseTime,
          parentIntent: (msg.parentIntent as ParentIntent) || undefined,
          childIntent: (msg.childIntent as ChildIntent) || undefined,
          intentConfidence: msg.confidence || undefined,
          wasEscalated: msg.wasEscalated || false,
          modelUsed: msg.llmModel || undefined,
          llmDurationMs: msg.llmDurationMs || undefined,
          wasCached: cachedMessageIds.has(msg.messageId),
        });

        turnNumber++;
      }

      logger.info('[AnalyticsRepo] Turns fetched', { turnCount: turns.length });

      return turns;
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch conversation turns', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get intent transitions (from intent -> to intent) in a time range
   * Used to build transition probability matrix
   *
   * @param timeRange - Time range for analysis
   * @param chatIds - Optional filter by chat IDs
   * @returns Array of intent transitions
   */
  async getIntentTransitions(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[]
  ): Promise<ConversationTransition[]> {
    logger.info('[AnalyticsRepo] Fetching intent transitions', {
      timeRange,
      chatIds,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Build WHERE conditions
      const conditions = [
        gte(messages.createdAt, fromDate),
        lte(messages.createdAt, toDate),
      ];

      if (chatIds && chatIds.length > 0) {
        conditions.push(inArray(messages.chatId, chatIds));
      }

      // Get messages with intents ordered by chat and time
      const messagesWithIntents = await db
        .select({
          messageId: messages.id,
          chatId: messages.chatId,
          senderId: messages.senderId,
          createdAt: messages.createdAt,
          childIntent: intentClassificationLogs.childIntent,
        })
        .from(messages)
        .innerJoin(
          intentClassificationLogs,
          eq(messages.id, intentClassificationLogs.messageId)
        )
        .where(and(...conditions))
        .orderBy(messages.chatId, messages.senderId, messages.createdAt);

      // Build transitions map
      const transitionsMap = new Map<
        string,
        {
          fromIntent: ChildIntent;
          toIntent: ChildIntent;
          count: number;
          totalTimeBetween: number;
        }
      >();

      // Track previous message per chat/sender
      const previousMessage = new Map<string, typeof messagesWithIntents[0]>();

      for (const msg of messagesWithIntents) {
        if (!msg.childIntent) continue;

        const key = `${msg.chatId}:${msg.senderId}`;
        const prev = previousMessage.get(key);

        if (prev && prev.childIntent) {
          // Record transition
          const transitionKey = `${prev.childIntent}->${msg.childIntent}`;
          const existing = transitionsMap.get(transitionKey);

          const timeBetween =
            msg.createdAt.getTime() - prev.createdAt.getTime();

          if (existing) {
            existing.count++;
            existing.totalTimeBetween += timeBetween;
          } else {
            transitionsMap.set(transitionKey, {
              fromIntent: prev.childIntent as ChildIntent,
              toIntent: msg.childIntent as ChildIntent,
              count: 1,
              totalTimeBetween: timeBetween,
            });
          }
        }

        previousMessage.set(key, msg);
      }

      // Calculate probabilities
      const totalTransitions = Array.from(transitionsMap.values()).reduce(
        (sum, t) => sum + t.count,
        0
      );

      const transitions: ConversationTransition[] = Array.from(
        transitionsMap.values()
      ).map((t) => ({
        fromIntent: t.fromIntent,
        toIntent: t.toIntent,
        count: t.count,
        avgTimeBetween: t.totalTimeBetween / t.count,
        probability: totalTransitions > 0 ? t.count / totalTransitions : 0,
      }));

      logger.info('[AnalyticsRepo] Intent transitions fetched', {
        transitionCount: transitions.length,
      });

      return transitions;
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch intent transitions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get average response times grouped by various dimensions
   *
   * @param groupBy - Dimension to group by (intent, model, hour)
   * @param timeRange - Time range for analysis
   * @param chatIds - Optional filter by chat IDs
   * @returns Array of response time groups
   */
  async getAverageResponseTimes(
    groupBy: ResponseTimeGroupBy,
    timeRange: AnalyticsTimeRange,
    chatIds?: string[]
  ): Promise<ResponseTimeGroup[]> {
    logger.info('[AnalyticsRepo] Fetching average response times', {
      groupBy,
      timeRange,
      chatIds,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const conditions = [
        gte(llmResponses.createdAt, fromDate),
        lte(llmResponses.createdAt, toDate),
      ];

      if (chatIds && chatIds.length > 0) {
        conditions.push(
          inArray(
            messages.chatId,
            chatIds
          )
        );
      }

      // Type for groupBy column - can be a column or SQL expression
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type GroupByColumn = SQLiteColumn<any, any, any> | SQL<unknown>;

      let groupByColumn: GroupByColumn;
      switch (groupBy) {
        case 'intent':
          groupByColumn = intentClassificationLogs.childIntent;
          break;
        case 'model':
          groupByColumn = llmResponses.model;
          break;
        case 'hour':
          groupByColumn = sql<number>`CAST(strftime('%H', ${llmResponses.createdAt}) AS INTEGER)`;
          break;
        case 'day_of_week':
          groupByColumn = sql<number>`CAST(strftime('%w', ${llmResponses.createdAt}) AS INTEGER)`;
          break;
        default:
          groupByColumn = llmResponses.model;
      }

      const results = await db
        .select({
          groupKey: groupByColumn,
          count: sql<number>`count(*)`,
          avgMs: sql<number>`avg(${llmResponses.durationMs})`,
          minMs: sql<number>`min(${llmResponses.durationMs})`,
          maxMs: sql<number>`max(${llmResponses.durationMs})`,
        })
        .from(llmResponses)
        .leftJoin(messages, eq(llmResponses.messageId, messages.id))
        .leftJoin(
          intentClassificationLogs,
          eq(messages.id, intentClassificationLogs.messageId)
        )
        .where(and(...conditions))
        .groupBy(groupByColumn)
        .orderBy(desc(sql<number>`count(*)`));

      // Calculate percentiles (simplified - would need more complex query for true percentiles)
      const groups: ResponseTimeGroup[] = results.map((r) => {
        const key = r.groupKey?.toString() || 'unknown';
        const avgMs = Number(r.avgMs) || 0;

        return {
          key,
          count: Number(r.count),
          avgMs,
          minMs: Number(r.minMs) || 0,
          maxMs: Number(r.maxMs) || 0,
          p50Ms: avgMs, // Simplified - using avg as p50
          p95Ms: avgMs * 1.5, // Rough estimate
          p99Ms: avgMs * 2, // Rough estimate
        };
      });

      logger.info('[AnalyticsRepo] Response times fetched', {
        groupCount: groups.length,
      });

      return groups;
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch average response times', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get conversation length distribution
   * Groups sessions by turn count into buckets
   *
   * @param timeRange - Time range for analysis
   * @param chatIds - Optional filter by chat IDs
   * @returns Distribution data with buckets
   */
  async getConversationLengthDistribution(
    timeRange: AnalyticsTimeRange,
    chatIds?: string[]
  ) {
    logger.info('[AnalyticsRepo] Fetching conversation length distribution', {
      timeRange,
      chatIds,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      // Determine which chats to analyze. When no explicit chatIds are given,
      // enumerate every chat that had activity in the time range so the
      // distribution reflects real traffic rather than a fabricated structure.
      let chatIdList = chatIds;
      if (!chatIdList || chatIdList.length === 0) {
        const chatRows = await db
          .selectDistinct({ chatId: messages.chatId })
          .from(messages)
          .where(
            and(
              gte(messages.createdAt, fromDate),
              lte(messages.createdAt, toDate)
            )
          );
        chatIdList = chatRows.map((r) => r.chatId);
      }

      // Identify sessions per chat and count real turns per session.
      const sessionData: Array<{ turnCount: number; avgResponseTime: number }> =
        [];
      for (const chatId of chatIdList) {
        const sessions = await this.getConversationSessions(
          chatId,
          timeRange,
          DEFAULT_SESSION_TIMEOUT_MS
        );
        for (const session of sessions) {
          const turns = await this.getConversationTurns(
            session.sessionId,
            session.messageIds
          );
          const responseTimes = turns
            .map((t) => t.responseTime)
            .filter((rt): rt is number => typeof rt === 'number');
          const avgResponseTime =
            responseTimes.length > 0
              ? responseTimes.reduce((sum, rt) => sum + rt, 0) /
                responseTimes.length
              : 0;
          sessionData.push({ turnCount: turns.length, avgResponseTime });
        }
      }

      const totalSessions = sessionData.length;

      const buckets = CONVERSATION_LENGTH_BUCKETS.map((bucket) => {
        const inBucket = sessionData.filter(
          (s) =>
            s.turnCount >= bucket.minTurns &&
            (bucket.maxTurns === UNBOUNDED_MAX_TURNS ||
              s.turnCount <= bucket.maxTurns)
        );
        const count = inBucket.length;
        const avgResponseTime =
          count > 0
            ? inBucket.reduce((sum, s) => sum + s.avgResponseTime, 0) / count
            : 0;
        return {
          label: bucket.label,
          minTurns: bucket.minTurns,
          maxTurns: bucket.maxTurns,
          count,
          percentage: totalSessions > 0 ? (count / totalSessions) * PERCENT_SCALE : 0,
          avgResponseTime,
        };
      });

      const turnCounts = sessionData
        .map((s) => s.turnCount)
        .sort((a, b) => a - b);
      const avgTurns =
        totalSessions > 0
          ? turnCounts.reduce((sum, t) => sum + t, 0) / totalSessions
          : 0;
      const medianTurns =
        totalSessions > 0 ? turnCounts[Math.floor(totalSessions / 2)] : 0;
      const minTurns = totalSessions > 0 ? turnCounts[0] : 0;
      const maxTurns = totalSessions > 0 ? turnCounts[turnCounts.length - 1] : 0;

      logger.info('[AnalyticsRepo] Conversation length distribution computed', {
        totalSessions,
        chatCount: chatIdList.length,
      });

      return {
        buckets,
        stats: {
          totalSessions,
          avgTurns,
          medianTurns,
          minTurns,
          maxTurns,
        },
      };
    } catch (error) {
      logger.error(
        '[AnalyticsRepo] Failed to fetch conversation length distribution',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw error;
    }
  }

  /**
   * Get escalation statistics by intent
   *
   * @param timeRange - Time range for analysis
   * @returns Escalation rate by intent
   */
  async getEscalationRateByIntent(
    timeRange: AnalyticsTimeRange
  ): Promise<
    Array<{
      intent: ChildIntent;
      rate: number;
      count: number;
      totalCount: number;
    }>
  > {
    logger.info('[AnalyticsRepo] Fetching escalation rate by intent', {
      timeRange,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const results = await db
        .select({
          childIntent: intentClassificationLogs.childIntent,
          totalCount: sql<number>`count(*)`,
          escalatedCount: sql<number>`sum(CASE WHEN ${intentClassificationLogs.wasEscalated} = 1 THEN 1 ELSE 0 END)`,
        })
        .from(intentClassificationLogs)
        .where(
          and(
            gte(intentClassificationLogs.createdAt, fromDate),
            lte(intentClassificationLogs.createdAt, toDate)
          )
        )
        .groupBy(intentClassificationLogs.childIntent)
        .orderBy(desc(sql<number>`count(*)`));

      const escalationRates = results.map((r) => ({
        intent: (r.childIntent as ChildIntent) || ('unknown' as ChildIntent),
        rate:
          Number(r.totalCount) > 0
            ? Number(r.escalatedCount) / Number(r.totalCount)
            : 0,
        count: Number(r.escalatedCount),
        totalCount: Number(r.totalCount),
      }));

      logger.info('[AnalyticsRepo] Escalation rates fetched', {
        intentCount: escalationRates.length,
      });

      return escalationRates;
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch escalation rates', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get cache statistics
   *
   * @param timeRange - Time range for analysis
   * @returns Cache hit rate and stats
   */
  async getCacheStats(timeRange: AnalyticsTimeRange) {
    logger.info('[AnalyticsRepo] Fetching cache stats', { timeRange });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const results = await db
        .select({
          totalEntries: sql<number>`count(*)`,
          totalHits: sql<number>`sum(${semanticCache.hitCount})`,
          avgHitCount: sql<number>`avg(${semanticCache.hitCount})`,
        })
        .from(semanticCache)
        .where(
          and(
            gte(semanticCache.createdAt, fromDate),
            lte(semanticCache.createdAt, toDate)
          )
        );

      const stats = results[0];
      const totalEntries = Number(stats?.totalEntries) || 0;
      const totalHits = Number(stats?.totalHits) || 0;

      return {
        totalEntries,
        totalHits,
        hitRate: totalEntries > 0 ? totalHits / totalEntries : 0,
        avgHitCount: Number(stats?.avgHitCount) || 0,
      };
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch cache stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get intent-classification confidence statistics for a time range.
   *
   * Confidence data lives on `intentClassificationLogs`. Both fields are
   * nullable, so this returns `null` (not a fabricated default) when the
   * relevant column has no data in range, letting callers distinguish
   * "unknown" from a genuine value.
   *
   * @param timeRange - Time range for analysis
   * @returns Average confidence and low-confidence rate (or null when uncaptured)
   */
  async getConfidenceStats(timeRange: AnalyticsTimeRange): Promise<{
    avgConfidence: number | null;
    lowConfidenceRate: number | null;
    sampleSize: number;
  }> {
    logger.info('[AnalyticsRepo] Fetching confidence stats', { timeRange });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const [row] = await db
        .select({
          total: sql<number>`count(*)`,
          // count(col) ignores NULLs, so this is the number of rows with a value
          confidenceCount: sql<number>`count(${intentClassificationLogs.confidence})`,
          confidenceSum: sql<number>`sum(${intentClassificationLogs.confidence})`,
          levelCount: sql<number>`count(${intentClassificationLogs.confidenceLevel})`,
          lowLevelCount: sql<number>`sum(CASE WHEN ${inArray(
            intentClassificationLogs.confidenceLevel,
            [...LOW_CONFIDENCE_LEVELS]
          )} THEN 1 ELSE 0 END)`,
        })
        .from(intentClassificationLogs)
        .where(
          and(
            gte(intentClassificationLogs.createdAt, fromDate),
            lte(intentClassificationLogs.createdAt, toDate)
          )
        );

      const confidenceCount = Number(row?.confidenceCount) || 0;
      const levelCount = Number(row?.levelCount) || 0;

      return {
        avgConfidence:
          confidenceCount > 0
            ? Number(row?.confidenceSum) / confidenceCount
            : null,
        lowConfidenceRate:
          levelCount > 0 ? Number(row?.lowLevelCount) / levelCount : null,
        sampleSize: Number(row?.total) || 0,
      };
    } catch (error) {
      logger.error('[AnalyticsRepo] Failed to fetch confidence stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get confidence and escalation rates grouped by hour of day (0-23).
   *
   * Used to build per-hour quality metrics. Per-hour values are `null` when no
   * confidence/classification data exists for that hour, rather than defaulting
   * to a fabricated number.
   *
   * @param timeRange - Time range for analysis
   * @returns Per-hour confidence and escalation stats
   */
  async getConfidenceAndEscalationByHour(
    timeRange: AnalyticsTimeRange
  ): Promise<
    Array<{
      hour: number;
      avgConfidence: number | null;
      escalationRate: number | null;
      count: number;
    }>
  > {
    logger.info('[AnalyticsRepo] Fetching confidence/escalation by hour', {
      timeRange,
    });

    try {
      const fromDate = new Date(timeRange.from);
      const toDate = new Date(timeRange.to);

      const hourExpr = sql<number>`CAST(strftime('%H', ${intentClassificationLogs.createdAt}) AS INTEGER)`;

      const results = await db
        .select({
          hour: hourExpr,
          total: sql<number>`count(*)`,
          confidenceCount: sql<number>`count(${intentClassificationLogs.confidence})`,
          confidenceSum: sql<number>`sum(${intentClassificationLogs.confidence})`,
          escalatedCount: sql<number>`sum(CASE WHEN ${intentClassificationLogs.wasEscalated} = 1 THEN 1 ELSE 0 END)`,
        })
        .from(intentClassificationLogs)
        .where(
          and(
            gte(intentClassificationLogs.createdAt, fromDate),
            lte(intentClassificationLogs.createdAt, toDate)
          )
        )
        .groupBy(hourExpr);

      return results.map((r) => {
        const total = Number(r.total) || 0;
        const confidenceCount = Number(r.confidenceCount) || 0;
        return {
          hour: Number(r.hour),
          avgConfidence:
            confidenceCount > 0 ? Number(r.confidenceSum) / confidenceCount : null,
          escalationRate: total > 0 ? Number(r.escalatedCount) / total : null,
          count: total,
        };
      });
    } catch (error) {
      logger.error(
        '[AnalyticsRepo] Failed to fetch confidence/escalation by hour',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw error;
    }
  }
}
