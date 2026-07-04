/**
 * Retention Service
 *
 * Handles data retention policies and cleanup operations.
 * Manages automatic deletion of old data based on configurable retention periods.
 *
 * Features:
 * - Configurable retention policies per entity type
 * - Archive-before-delete option for compliance
 * - Media file cleanup with disk space tracking
 * - Audit logging for all cleanup operations
 * - Dry-run preview mode
 * - Storage statistics and reporting
 */

import { createLogger } from '../utils/logger.js';
import { appConfig } from '../config/index.js';
import { SecurityError, ErrorCode } from '../errors/index.js';
import type { RetentionPolicy } from '../types/security.types.js';
import { SecurityEventType } from '../types/security.types.js';
import type { SecurityAuditRepository } from '../repositories/securityAudit.repository.js';
import { db } from '../db/client.js';
import { eq, lt, and, sql } from 'drizzle-orm';
import {
  messages,
  memories,
  embeddings,
  semanticCache,
  metrics,
  securityAuditLogs,
  retentionPolicies,
} from '../db/schema.js';
import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';

const logger = createLogger('RetentionService');

/**
 * Cleanup result for a specific entity type
 */
interface EntityCleanupResult {
  archived: number;
  deleted: number;
}

/**
 * Media cleanup result
 */
interface MediaCleanupResult {
  deleted: number;
  bytesFreed: number;
}

/**
 * Complete cleanup result across all entity types
 */
interface CleanupResult {
  messages: EntityCleanupResult;
  memories: EntityCleanupResult;
  media: MediaCleanupResult;
  cache: EntityCleanupResult;
  metrics: EntityCleanupResult;
  embeddings: EntityCleanupResult;
  auditLogs: EntityCleanupResult;
}

/**
 * Storage statistics
 */
interface StorageStats {
  totalRecords: number;
  byEntityType: Record<string, number>;
  oldestRecordDate: Date | null;
  estimatedDiskUsage: number;
}

/**
 * Preview of what would be cleaned up
 */
interface CleanupPreview {
  messages: number;
  memories: number;
  media: number;
  cache: number;
  metrics: number;
  embeddings: number;
  auditLogs: number;
}

/**
 * Retention Service
 *
 * Manages data retention policies and automated cleanup operations.
 */
export class RetentionService {
  constructor(
    private readonly config: typeof appConfig.security.retention,
    private readonly auditRepo: SecurityAuditRepository
  ) {}

  /**
   * Get all retention policies
   */
  async getPolicies(): Promise<RetentionPolicy[]> {
    try {
      const policies = await db.select().from(retentionPolicies).where(eq(retentionPolicies.isActive, true));

      return policies.map((p) => ({
        entityType: p.entityType as any,
        retentionDays: p.retentionDays,
        archiveBeforeDelete: Boolean(p.archiveBeforeDelete),
        requiresUserConsent: Boolean(p.requiresUserConsent),
      }));
    } catch (error) {
      logger.error('Failed to get retention policies', error);
      throw new SecurityError('Failed to retrieve retention policies', ErrorCode.SECURITY_POLICY_VIOLATION, {
        reason: 'database_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Get policy for specific entity type
   */
  async getPolicy(entityType: string): Promise<RetentionPolicy | null> {
    try {
      const result = await db
        .select()
        .from(retentionPolicies)
        .where(
          and(
            eq(retentionPolicies.entityType, entityType as 'message' | 'memory' | 'media' | 'cache' | 'metrics' | 'embeddings' | 'audit_logs'),
            eq(retentionPolicies.isActive, true)
          )
        )
        .limit(1);

      if (!result[0]) {
        return null;
      }

      const p = result[0];
      return {
        entityType: p.entityType as any,
        retentionDays: p.retentionDays,
        archiveBeforeDelete: Boolean(p.archiveBeforeDelete),
        requiresUserConsent: Boolean(p.requiresUserConsent),
      };
    } catch (error) {
      logger.error(`Failed to get retention policy for ${entityType}`, error);
      throw new SecurityError('Failed to retrieve retention policy', ErrorCode.SECURITY_POLICY_VIOLATION, {
        reason: 'database_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Update a retention policy
   */
  async updatePolicy(
    entityType: string,
    retentionDays: number,
    archiveBeforeDelete?: boolean
  ): Promise<void> {
    try {
      // Validate inputs
      if (retentionDays < 0) {
        throw new SecurityError('Retention days must be non-negative', ErrorCode.VALIDATION_OUT_OF_RANGE, {
          context: { entityType, retentionDays },
        });
      }

      // Update or insert policy
      const existing = await db
        .select()
        .from(retentionPolicies)
        .where(eq(retentionPolicies.entityType, entityType as 'message' | 'memory' | 'media' | 'cache' | 'metrics' | 'embeddings' | 'audit_logs'))
        .limit(1);

      if (existing[0]) {
        await db
          .update(retentionPolicies)
          .set({
            retentionDays,
            archiveBeforeDelete: archiveBeforeDelete !== undefined ? archiveBeforeDelete : undefined,
            updatedAt: new Date(),
          })
          .where(eq(retentionPolicies.entityType, entityType as 'message' | 'memory' | 'media' | 'cache' | 'metrics' | 'embeddings' | 'audit_logs'));
      } else {
        await db.insert(retentionPolicies).values({
          id: nanoid(),
          entityType: entityType as 'message' | 'memory' | 'media' | 'cache' | 'metrics' | 'embeddings' | 'audit_logs',
          retentionDays,
          archiveBeforeDelete: archiveBeforeDelete ?? false,
          requiresUserConsent: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Log audit event
      await this.auditRepo.create({
        eventType: SecurityEventType.CONFIG_CHANGE,
        action: 'update_retention_policy',
        details: {
          entityType,
          retentionDays,
          archiveBeforeDelete,
        },
        severity: 'INFO',
      });

      logger.info(`Updated retention policy for ${entityType}: ${retentionDays} days`);
    } catch (error) {
      logger.error(`Failed to update retention policy for ${entityType}`, error);
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError('Failed to update retention policy', ErrorCode.SECURITY_POLICY_VIOLATION, {
        reason: 'database_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Run cleanup for all entities based on policies
   */
  async runCleanup(): Promise<CleanupResult> {
    logger.info('Starting retention cleanup');

    const result: CleanupResult = {
      messages: { archived: 0, deleted: 0 },
      memories: { archived: 0, deleted: 0 },
      media: { deleted: 0, bytesFreed: 0 },
      cache: { archived: 0, deleted: 0 },
      metrics: { archived: 0, deleted: 0 },
      embeddings: { archived: 0, deleted: 0 },
      auditLogs: { archived: 0, deleted: 0 },
    };

    try {
      // Cleanup each entity type
      result.messages = await this.runCleanupForEntity('message');
      result.memories = await this.runCleanupForEntity('memory');
      result.cache = await this.runCleanupForEntity('cache');
      result.metrics = await this.runCleanupForEntity('metrics');
      result.embeddings = await this.runCleanupForEntity('embeddings');
      result.auditLogs = await this.runCleanupForEntity('audit_logs');

      // Cleanup media files (special case - file system cleanup)
      result.media = await this.cleanupMediaFiles(this.config.mediaRetentionDays);

      // Log audit event
      await this.auditRepo.create({
        eventType: SecurityEventType.DATA_DELETION,
        action: 'retention_cleanup',
        details: {
          result,
          timestamp: new Date().toISOString(),
        },
        severity: 'INFO',
      });

      logger.info('Retention cleanup completed', result);
      return result;
    } catch (error) {
      logger.error('Retention cleanup failed', error);
      throw new SecurityError('Retention cleanup failed', ErrorCode.SECURITY_DATA_DELETION_FAILED, {
        reason: 'cleanup_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Run cleanup for specific entity type
   */
  async runCleanupForEntity(entityType: string): Promise<EntityCleanupResult> {
    logger.info(`Cleaning up entity: ${entityType}`);

    const result: EntityCleanupResult = {
      archived: 0,
      deleted: 0,
    };

    try {
      // Get policy for this entity type
      const policy = await this.getPolicy(entityType);
      if (!policy) {
        logger.warn(`No retention policy found for ${entityType}, skipping`);
        return result;
      }

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

      // Find records to delete
      let recordIds: string[] = [];
      let table;

      switch (entityType) {
        case 'message':
          table = messages;
          const oldMessages = await db
            .select({ id: messages.id })
            .from(messages)
            .where(lt(messages.createdAt, cutoffDate));
          recordIds = oldMessages.map((m) => m.id);
          break;

        case 'memory':
          table = memories;
          const oldMemories = await db
            .select({ id: memories.id })
            .from(memories)
            .where(
              and(
                lt(memories.createdAt, cutoffDate),
                eq(memories.isArchived, false)
              )
            );
          recordIds = oldMemories.map((m) => m.id);
          break;

        case 'cache':
          table = semanticCache;
          const oldCache = await db
            .select({ id: semanticCache.id })
            .from(semanticCache)
            .where(lt(semanticCache.createdAt, cutoffDate));
          recordIds = oldCache.map((c) => c.id);
          break;

        case 'metrics':
          table = metrics;
          const oldMetrics = await db
            .select({ id: metrics.id })
            .from(metrics)
            .where(lt(metrics.timestamp, cutoffDate));
          recordIds = oldMetrics.map((m) => m.id);
          break;

        case 'embeddings':
          table = embeddings;
          const oldEmbeddings = await db
            .select({ id: embeddings.id })
            .from(embeddings)
            .where(lt(embeddings.createdAt, cutoffDate));
          recordIds = oldEmbeddings.map((e) => e.id);
          break;

        case 'audit_logs':
          table = securityAuditLogs;
          const oldAudits = await db
            .select({ id: securityAuditLogs.id })
            .from(securityAuditLogs)
            .where(lt(securityAuditLogs.createdAt, cutoffDate));
          recordIds = oldAudits.map((a) => a.id);
          break;

        default:
          logger.warn(`Unknown entity type: ${entityType}`);
          return result;
      }

      if (recordIds.length === 0) {
        logger.info(`No old records found for ${entityType}`);
        return result;
      }

      logger.info(`Found ${recordIds.length} old ${entityType} records to delete`);

      // Archive if configured
      if (policy.archiveBeforeDelete && table) {
        await this.archiveRecords(entityType, recordIds);
        result.archived = recordIds.length;
      }

      // Delete records
      if (table) {
        // Use SQL IN clause for efficient batch deletion
        await db.delete(table).where(sql`${table.id} IN ${recordIds}`);
        result.deleted = recordIds.length;
      }

      logger.info(`Deleted ${result.deleted} ${entityType} records`);
      return result;
    } catch (error) {
      logger.error(`Failed to cleanup ${entityType}`, error);
      throw new SecurityError(`Failed to cleanup ${entityType}`, ErrorCode.SECURITY_DATA_DELETION_FAILED, {
        reason: 'cleanup_error',
        context: { entityType },
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    try {
      const stats: StorageStats = {
        totalRecords: 0,
        byEntityType: {},
        oldestRecordDate: null,
        estimatedDiskUsage: 0,
      };

      // Count messages
      const messageCount = await db.select({ count: sql<number>`count(*)` }).from(messages);
      stats.byEntityType.messages = Number(messageCount[0]?.count || 0);

      // Count memories
      const memoryCount = await db.select({ count: sql<number>`count(*)` }).from(memories);
      stats.byEntityType.memories = Number(memoryCount[0]?.count || 0);

      // Count cache entries
      const cacheCount = await db.select({ count: sql<number>`count(*)` }).from(semanticCache);
      stats.byEntityType.cache = Number(cacheCount[0]?.count || 0);

      // Count metrics
      const metricsCount = await db.select({ count: sql<number>`count(*)` }).from(metrics);
      stats.byEntityType.metrics = Number(metricsCount[0]?.count || 0);

      // Count embeddings
      const embeddingsCount = await db.select({ count: sql<number>`count(*)` }).from(embeddings);
      stats.byEntityType.embeddings = Number(embeddingsCount[0]?.count || 0);

      // Count audit logs
      const auditCount = await db.select({ count: sql<number>`count(*)` }).from(securityAuditLogs);
      stats.byEntityType.auditLogs = Number(auditCount[0]?.count || 0);

      // Calculate total
      stats.totalRecords = Object.values(stats.byEntityType).reduce((sum, count) => sum + count, 0);

      // Get oldest record date
      const oldestMessage = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .orderBy(messages.createdAt)
        .limit(1);

      if (oldestMessage[0]) {
        stats.oldestRecordDate = oldestMessage[0].createdAt;
      }

      // Estimate disk usage (rough approximation)
      // Database file size would be more accurate, but this gives an estimate
      stats.estimatedDiskUsage = stats.totalRecords * 1024; // Assume ~1KB per record on average

      // Add media file sizes
      try {
        const mediaStats = await this.getMediaDiskUsage();
        stats.estimatedDiskUsage += mediaStats;
      } catch (error) {
        logger.warn('Failed to calculate media disk usage', error);
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get storage stats', error);
      throw new SecurityError('Failed to get storage statistics', ErrorCode.SECURITY_POLICY_VIOLATION, {
        reason: 'stats_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Preview what would be cleaned up (dry run)
   */
  async previewCleanup(): Promise<CleanupPreview> {
    logger.info('Previewing retention cleanup');

    const preview: CleanupPreview = {
      messages: 0,
      memories: 0,
      media: 0,
      cache: 0,
      metrics: 0,
      embeddings: 0,
      auditLogs: 0,
    };

    try {
      // Preview each entity type
      const policies = await this.getPolicies();

      for (const policy of policies) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

        switch (policy.entityType) {
          case 'message':
            const messageCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(messages)
              .where(lt(messages.createdAt, cutoffDate));
            preview.messages = Number(messageCount[0]?.count || 0);
            break;

          case 'memory':
            const memoryCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(memories)
              .where(
                and(
                  lt(memories.createdAt, cutoffDate),
                  eq(memories.isArchived, false)
                )
              );
            preview.memories = Number(memoryCount[0]?.count || 0);
            break;

          case 'cache':
            const cacheCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(semanticCache)
              .where(lt(semanticCache.createdAt, cutoffDate));
            preview.cache = Number(cacheCount[0]?.count || 0);
            break;

          case 'metrics':
            const metricsCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(metrics)
              .where(lt(metrics.timestamp, cutoffDate));
            preview.metrics = Number(metricsCount[0]?.count || 0);
            break;

          case 'embeddings':
            const embeddingsCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(embeddings)
              .where(lt(embeddings.createdAt, cutoffDate));
            preview.embeddings = Number(embeddingsCount[0]?.count || 0);
            break;
        }
      }

      // Preview media cleanup
      preview.media = await this.previewMediaCleanup(this.config.mediaRetentionDays);

      logger.info('Cleanup preview completed', preview);
      return preview;
    } catch (error) {
      logger.error('Failed to preview cleanup', error);
      throw new SecurityError('Failed to preview cleanup', ErrorCode.SECURITY_POLICY_VIOLATION, {
        reason: 'preview_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Archive records before deletion (for compliance)
   * @private
   */
  private async archiveRecords(entityType: string, recordIds: string[]): Promise<void> {
    logger.info(`Archiving ${recordIds.length} ${entityType} records`);

    try {
      // Create archive directory if it doesn't exist
      const archiveDir = path.join(process.cwd(), 'data', 'archives', entityType);
      await fs.mkdir(archiveDir, { recursive: true });

      // Create archive file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveFile = path.join(archiveDir, `archive-${timestamp}.json`);

      // Fetch records to archive
      let records: Record<string, unknown>[] = [];
      switch (entityType) {
        case 'message':
          records = await db.select().from(messages).where(sql`${messages.id} IN ${recordIds}`);
          break;
        case 'memory':
          records = await db.select().from(memories).where(sql`${memories.id} IN ${recordIds}`);
          break;
        case 'cache':
          records = await db.select().from(semanticCache).where(sql`${semanticCache.id} IN ${recordIds}`);
          break;
        case 'metrics':
          records = await db.select().from(metrics).where(sql`${metrics.id} IN ${recordIds}`);
          break;
        case 'embeddings':
          records = await db.select().from(embeddings).where(sql`${embeddings.id} IN ${recordIds}`);
          break;
        case 'audit_logs':
          records = await db.select().from(securityAuditLogs).where(sql`${securityAuditLogs.id} IN ${recordIds}`);
          break;
      }

      // Write archive file
      await fs.writeFile(
        archiveFile,
        JSON.stringify(
          {
            entityType,
            archivedAt: new Date().toISOString(),
            recordCount: records.length,
            records,
          },
          null,
          2
        )
      );

      logger.info(`Archived ${records.length} ${entityType} records to ${archiveFile}`);
    } catch (error) {
      logger.error(`Failed to archive ${entityType} records`, error);
      throw new SecurityError('Failed to archive records', ErrorCode.SECURITY_DATA_DELETION_FAILED, {
        reason: 'archive_error',
        context: { entityType, recordCount: recordIds.length },
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Delete media files from filesystem
   * @private
   */
  private async cleanupMediaFiles(olderThanDays: number): Promise<MediaCleanupResult> {
    logger.info(`Cleaning up media files older than ${olderThanDays} days`);

    const result: MediaCleanupResult = {
      deleted: 0,
      bytesFreed: 0,
    };

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // Get messages with media older than cutoff
      const oldMedia = await db
        .select({
          id: messages.id,
          mediaPath: messages.mediaPath,
          mediaType: messages.mediaType,
        })
        .from(messages)
        .where(
          and(
            lt(messages.createdAt, cutoffDate),
            sql`${messages.mediaPath} IS NOT NULL`
          )
        );

      for (const media of oldMedia) {
        if (!media.mediaPath) continue;

        try {
          const fullPath = path.join(process.cwd(), media.mediaPath);
          const stats = await fs.stat(fullPath);
          await fs.unlink(fullPath);

          result.deleted++;
          result.bytesFreed += stats.size;

          logger.debug(`Deleted media file: ${media.mediaPath}`);
        } catch (error) {
          // File might already be deleted or not exist
          logger.warn(`Failed to delete media file ${media.mediaPath}`, error);
        }
      }

      logger.info(`Deleted ${result.deleted} media files, freed ${result.bytesFreed} bytes`);
      return result;
    } catch (error) {
      logger.error('Failed to cleanup media files', error);
      throw new SecurityError('Failed to cleanup media files', ErrorCode.SECURITY_DATA_DELETION_FAILED, {
        reason: 'media_cleanup_error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Preview media cleanup
   * @private
   */
  private async previewMediaCleanup(olderThanDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            lt(messages.createdAt, cutoffDate),
            sql`${messages.mediaPath} IS NOT NULL`
          )
        );

      return Number(result[0]?.count || 0);
    } catch (error) {
      logger.warn('Failed to preview media cleanup', error);
      return 0;
    }
  }

  /**
   * Get total media disk usage
   * @private
   */
  private async getMediaDiskUsage(): Promise<number> {
    try {
      const mediaBasePath = path.join(process.cwd(), 'data', 'media');
      let totalSize = 0;

      const calculateDirSize = async (dirPath: string): Promise<number> => {
        let size = 0;
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              size += await calculateDirSize(fullPath);
            } else {
              const stats = await fs.stat(fullPath);
              size += stats.size;
            }
          }
        } catch (error) {
          // Directory might not exist
          logger.debug(`Failed to calculate size for ${dirPath}`, error);
        }
        return size;
      };

      totalSize = await calculateDirSize(mediaBasePath);
      return totalSize;
    } catch (error) {
      logger.warn('Failed to calculate media disk usage', error);
      return 0;
    }
  }
}

/**
 * Singleton instance - will be initialized in services/index.ts
 */
export let retentionService: RetentionService;

/**
 * Initialize the retention service (called from services/index.ts)
 */
export function initializeRetentionService(
  config: typeof appConfig.security.retention,
  auditRepo: SecurityAuditRepository
): void {
  retentionService = new RetentionService(config, auditRepo);
}
