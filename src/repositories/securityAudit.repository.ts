import { eq, desc, and, gte, lte, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { securityAuditLogs } from '../db/schema.js';
import type { SecurityAuditLog, SecurityEventType, SecuritySeverity } from '../types/security.types.js';

export type SecurityAuditLogDB = typeof securityAuditLogs.$inferSelect;
export type NewSecurityAuditLog = typeof securityAuditLogs.$inferInsert;

export class SecurityAuditRepository {
  /**
   * Create a new security audit log entry
   */
  async create(entry: {
    eventType: SecurityEventType;
    userId?: string;
    telegramId?: bigint;
    action: string;
    details: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    severity: SecuritySeverity;
    correlationId?: string;
  }): Promise<SecurityAuditLog> {
    const id = nanoid();
    const now = new Date();

    const inserted = await db
      .insert(securityAuditLogs)
      .values({
        id,
        eventType: entry.eventType,
        userId: entry.userId ?? null,
        telegramId: entry.telegramId ? Number(entry.telegramId) : null,
        action: entry.action,
        details: JSON.stringify(entry.details),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        createdAt: now,
        severity: entry.severity,
        correlationId: entry.correlationId ?? null,
      })
      .returning();

    return this.mapToSecurityAuditLog(inserted[0]);
  }

  /**
   * Find audit log by ID
   */
  async findById(id: string): Promise<SecurityAuditLog | null> {
    const result = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.id, id))
      .limit(1);

    return result[0] ? this.mapToSecurityAuditLog(result[0]) : null;
  }

  /**
   * Find audit logs by user ID
   */
  async findByUserId(userId: string, limit = 100): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.userId, userId))
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Find audit logs by telegram ID
   */
  async findByTelegramId(telegramId: bigint, limit = 100): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.telegramId, Number(telegramId)))
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Find audit logs by event type
   */
  async findByEventType(
    eventType: SecurityEventType,
    limit = 100
  ): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.eventType, eventType))
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Find audit logs by severity
   */
  async findBySeverity(severity: SecuritySeverity, limit = 100): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.severity, severity))
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Find audit logs by correlation ID
   */
  async findByCorrelationId(correlationId: string): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(eq(securityAuditLogs.correlationId, correlationId))
      .orderBy(desc(securityAuditLogs.createdAt));

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Find audit logs within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    limit = 1000
  ): Promise<SecurityAuditLog[]> {
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(
        and(
          gte(securityAuditLogs.createdAt, startDate),
          lte(securityAuditLogs.createdAt, endDate)
        )
      )
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit);

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Delete audit logs older than specified date
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await db
      .delete(securityAuditLogs)
      .where(sql`${securityAuditLogs.createdAt} < ${date.getTime() / 1000}`)
      .returning();

    return result.length;
  }

  /**
   * Get count of audit logs by event type
   */
  async getCountByEventType(): Promise<Record<string, number>> {
    const results = await db
      .select({
        eventType: securityAuditLogs.eventType,
        count: sql<number>`count(*)`,
      })
      .from(securityAuditLogs)
      .groupBy(securityAuditLogs.eventType);

    return Object.fromEntries(results.map((r) => [r.eventType, r.count]));
  }

  /**
   * Get recent critical/error events
   *
   * @param hours - Number of hours to look back (default: 24)
   * @returns Array of audit logs with severity ERROR or CRITICAL
   */
  async getRecentAlerts(hours: number = 24): Promise<SecurityAuditLog[]> {
    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(
        and(
          gte(securityAuditLogs.createdAt, cutoffDate),
          inArray(securityAuditLogs.severity, ['ERROR', 'CRITICAL'])
        )
      )
      .orderBy(desc(securityAuditLogs.createdAt));

    return results.map((r) => this.mapToSecurityAuditLog(r));
  }

  /**
   * Search audit logs with flexible criteria
   *
   * @param criteria - Search criteria (all fields are optional)
   * @param limit - Maximum number of logs to return (default: 100)
   * @param offset - Number of logs to skip (default: 0)
   * @returns Object containing logs and total count
   *
   * @example
   * ```typescript
   * const { logs, total } = await repo.search({
   *   userId: 'user-123',
   *   eventTypes: [SecurityEventType.DATA_EXPORT, SecurityEventType.DATA_DELETION],
   *   severities: ['WARNING', 'ERROR'],
   *   startDate: new Date('2023-01-01'),
   *   endDate: new Date('2023-12-31')
   * }, 50, 0);
   * ```
   */
  async search(
    criteria: {
      userId?: string;
      telegramId?: bigint;
      eventTypes?: SecurityEventType[];
      severities?: SecuritySeverity[];
      startDate?: Date;
      endDate?: Date;
      action?: string;
    },
    limit: number = 100,
    offset: number = 0
  ): Promise<{ logs: SecurityAuditLog[]; total: number }> {
    // Build where conditions
    const conditions = [];

    if (criteria.userId) {
      conditions.push(eq(securityAuditLogs.userId, criteria.userId));
    }

    if (criteria.telegramId) {
      conditions.push(eq(securityAuditLogs.telegramId, Number(criteria.telegramId)));
    }

    if (criteria.eventTypes && criteria.eventTypes.length > 0) {
      conditions.push(inArray(securityAuditLogs.eventType, criteria.eventTypes));
    }

    if (criteria.severities && criteria.severities.length > 0) {
      conditions.push(inArray(securityAuditLogs.severity, criteria.severities));
    }

    if (criteria.startDate) {
      conditions.push(gte(securityAuditLogs.createdAt, criteria.startDate));
    }

    if (criteria.endDate) {
      conditions.push(lte(securityAuditLogs.createdAt, criteria.endDate));
    }

    if (criteria.action) {
      conditions.push(sql`${securityAuditLogs.action} LIKE ${`%${criteria.action}%`}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityAuditLogs)
      .where(whereClause);

    const total = countResult[0]?.count || 0;

    // Get logs with pagination
    const results = await db
      .select()
      .from(securityAuditLogs)
      .where(whereClause)
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const logs = results.map((r) => this.mapToSecurityAuditLog(r));

    return { logs, total };
  }

  /**
   * Get statistics about audit logs
   *
   * @param days - Number of days to include in statistics (default: 30)
   * @returns Statistics object with counts and breakdowns
   *
   * @example
   * ```typescript
   * const stats = await repo.getStats(7);
   * console.log(`Total events in last 7 days: ${stats.totalEvents}`);
   * console.log(`By event type:`, stats.byEventType);
   * console.log(`By severity:`, stats.bySeverity);
   * ```
   */
  async getStats(days: number = 30): Promise<{
    totalEvents: number;
    byEventType: Record<string, number>;
    bySeverity: Record<string, number>;
    uniqueUsers: number;
  }> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await db
      .select()
      .from(securityAuditLogs)
      .where(gte(securityAuditLogs.createdAt, cutoffDate));

    // Calculate total events
    const totalEvents = logs.length;

    // Count by event type
    const byEventType: Record<string, number> = {};
    logs.forEach((log) => {
      byEventType[log.eventType] = (byEventType[log.eventType] || 0) + 1;
    });

    // Count by severity
    const bySeverity: Record<string, number> = {};
    logs.forEach((log) => {
      bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
    });

    // Count unique users
    const uniqueUserIds = new Set<string>();
    logs.forEach((log) => {
      if (log.userId) {
        uniqueUserIds.add(log.userId);
      }
    });
    const uniqueUsers = uniqueUserIds.size;

    return {
      totalEvents,
      byEventType,
      bySeverity,
      uniqueUsers,
    };
  }

  /**
   * Alias methods for consistency with requirements
   */
  async getByUserId(userId: string, limit?: number): Promise<SecurityAuditLog[]> {
    return this.findByUserId(userId, limit);
  }

  async getByTelegramId(telegramId: bigint, limit?: number): Promise<SecurityAuditLog[]> {
    return this.findByTelegramId(telegramId, limit);
  }

  async getByEventType(eventType: SecurityEventType, limit?: number): Promise<SecurityAuditLog[]> {
    return this.findByEventType(eventType, limit);
  }

  async getByTimeRange(startDate: Date, endDate: Date, limit?: number): Promise<SecurityAuditLog[]> {
    return this.findByDateRange(startDate, endDate, limit);
  }

  async getBySeverity(severity: SecuritySeverity, limit?: number): Promise<SecurityAuditLog[]> {
    return this.findBySeverity(severity, limit);
  }

  /**
   * Map database row to SecurityAuditLog type
   */
  private mapToSecurityAuditLog(row: SecurityAuditLogDB): SecurityAuditLog {
    return {
      id: row.id,
      eventType: row.eventType as SecurityEventType,
      userId: row.userId ?? undefined,
      telegramId: row.telegramId ? BigInt(row.telegramId) : undefined,
      action: row.action,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      timestamp: row.createdAt,
      severity: row.severity as SecuritySeverity,
      correlationId: row.correlationId ?? undefined,
    };
  }
}

export const securityAuditRepository = new SecurityAuditRepository();
