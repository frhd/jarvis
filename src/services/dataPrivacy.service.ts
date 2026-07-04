import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { eq, sql, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { messages, embeddings, semanticCache } from '../db/schema.js';
import {
  senderRepository,
  messageRepository,
  memoryRepository,
  userPreferenceRepository,
  embeddingRepository,
  semanticCacheRepository,
  securityAuditRepository,
} from '../repositories/index.js';
import type {
  DataExportRequest,
  DataExportResult,
  DataDeletionRequest,
  DataDeletionResult,
  SecurityEventType,
} from '../types/security.types.js';
import { SecurityError, ErrorCode } from '../errors/index.js';

export interface UserDataSummary {
  messageCount: number;
  memoryCount: number;
  preferenceCount: number;
  mediaFileCount: number;
  embeddingCount: number;
  cacheEntryCount: number;
  oldestDataDate: Date | null;
  newestDataDate: Date | null;
}

export interface DataExportRequestWithStatus extends DataExportRequest {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface DataDeletionRequestWithStatus extends DataDeletionRequest {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * GDPR-compliant Data Privacy Service
 *
 * Handles user data export, deletion, anonymization, and right to be forgotten.
 * Implements GDPR Article 17 (Right to Erasure) and Article 20 (Right to Data Portability).
 */
export class DataPrivacyService {
  private readonly exportDir: string;
  private readonly pendingExports: Map<string, DataExportRequestWithStatus> = new Map();
  private readonly pendingDeletions: Map<string, DataDeletionRequestWithStatus> = new Map();

  constructor(
    private readonly config: typeof appConfig.security.gdpr,
    private readonly auditRepo: typeof securityAuditRepository
  ) {
    this.exportDir = path.join(process.cwd(), 'data', 'exports');
    this.ensureExportDir();
  }

  /**
   * Ensure export directory exists
   */
  private ensureExportDir(): void {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
      logger.info(`Created export directory: ${this.exportDir}`);
    }
  }

  /**
   * Export all user data to JSON format (GDPR Article 20: Right to Data Portability)
   */
  async exportUserData(request: DataExportRequest): Promise<DataExportResult> {
    const requestId = nanoid();
    const correlationId = nanoid();

    logger.info(`Starting data export for user ${request.userId}`, {
      requestId,
      telegramId: request.telegramId.toString(),
      format: request.format,
    });

    try {
      // Check if export is allowed
      if (!this.config.allowDataExport) {
        throw new SecurityError(
          'Data export is not allowed by system configuration',
          ErrorCode.SECURITY_FORBIDDEN,
          { userId: request.userId, action: 'data_export' }
        );
      }

      // Get sender info
      const sender = await senderRepository.findByTelegramId(request.telegramId.toString());
      if (!sender) {
        throw new SecurityError(
          `User not found: ${request.telegramId}`,
          ErrorCode.SECURITY_VALIDATION_FAILED,
          { userId: request.userId, context: { telegramId: request.telegramId.toString() } }
        );
      }

      // Collect all user data
      const exportData: Record<string, unknown> = {
        exportMetadata: {
          requestId,
          userId: request.userId,
          telegramId: request.telegramId.toString(),
          exportedAt: new Date().toISOString(),
          format: request.format,
        },
        profile: {
          telegramId: sender.telegramId,
          firstName: sender.firstName,
          lastName: sender.lastName,
          username: sender.username,
          phone: sender.phone,
          createdAt: sender.createdAt.toISOString(),
          updatedAt: sender.updatedAt.toISOString(),
        },
      };

      const recordCounts = {
        messages: 0,
        memories: 0,
        preferences: 0,
        mediaFiles: 0,
      };

      // Export messages
      if (request.includeMessages) {
        const userMessages = await db
          .select({
            telegramMessageId: messages.telegramMessageId,
            text: messages.text,
            mediaType: messages.mediaType,
            mediaPath: messages.mediaPath,
            replyToMessageId: messages.replyToMessageId,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(eq(messages.senderId, sender.id));

        exportData.messages = userMessages.map((msg) => ({
          telegramMessageId: msg.telegramMessageId,
          text: msg.text,
          mediaType: msg.mediaType,
          hasMedia: !!msg.mediaPath,
          replyToMessageId: msg.replyToMessageId,
          createdAt: msg.createdAt?.toISOString(),
        }));
        recordCounts.messages = userMessages.length;

        // Count media files
        if (request.includeMedia) {
          recordCounts.mediaFiles = userMessages.filter((m) => m.mediaPath).length;
        }
      }

      // Export memories
      if (request.includeMemories) {
        const memories = await memoryRepository.findBySenderId(sender.id, 10000);
        exportData.memories = memories.map((mem) => ({
          type: mem.memoryType,
          content: mem.content,
          confidence: mem.confidence,
          accessCount: mem.accessCount,
          lastAccessedAt: mem.lastAccessedAt?.toISOString(),
          createdAt: mem.createdAt?.toISOString(),
          updatedAt: mem.updatedAt?.toISOString(),
        }));
        recordCounts.memories = memories.length;
      }

      // Export preferences
      if (request.includePreferences) {
        const preferences = await userPreferenceRepository.findBySenderId(sender.id);
        exportData.preferences = preferences.map((pref) => ({
          category: pref.category,
          key: pref.key,
          value: pref.value,
          confidence: pref.confidence,
          createdAt: pref.createdAt?.toISOString(),
          updatedAt: pref.updatedAt?.toISOString(),
        }));
        recordCounts.preferences = preferences.length;
      }

      // Generate filename and write file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `user-${request.telegramId}-export-${timestamp}.json`;
      const filePath = path.join(this.exportDir, filename);

      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

      const stats = fs.statSync(filePath);

      // Log audit event
      await this.auditRepo.create({
        eventType: 'DATA_EXPORT' as SecurityEventType,
        userId: request.userId,
        telegramId: request.telegramId,
        action: 'User data exported to file',
        details: {
          requestId,
          format: request.format,
          filePath,
          sizeBytes: stats.size,
          recordCounts,
        },
        severity: 'INFO',
        correlationId,
      });

      logger.info(`Data export completed successfully`, {
        requestId,
        filePath,
        sizeBytes: stats.size,
      });

      return {
        requestId,
        userId: request.userId,
        exportedAt: new Date(),
        filePath,
        sizeBytes: stats.size,
        recordCounts,
      };
    } catch (error) {
      logger.error(`Data export failed: ${error}`, {
        requestId,
        userId: request.userId,
        error,
      });

      // Log audit event for failure
      await this.auditRepo.create({
        eventType: 'DATA_EXPORT' as SecurityEventType,
        userId: request.userId,
        telegramId: request.telegramId,
        action: 'Data export failed',
        details: {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        },
        severity: 'ERROR',
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Delete all user data (GDPR Article 17: Right to Erasure)
   */
  async deleteUserData(request: DataDeletionRequest): Promise<DataDeletionResult> {
    const requestId = nanoid();
    const correlationId = nanoid();

    logger.info(`Starting data deletion for user ${request.userId}`, {
      requestId,
      telegramId: request.telegramId.toString(),
      reason: request.reason,
    });

    try {
      // Check if deletion is allowed
      if (!this.config.allowDataDeletion) {
        throw new SecurityError(
          'Data deletion is not allowed by system configuration',
          ErrorCode.SECURITY_FORBIDDEN,
          { userId: request.userId, action: 'data_deletion' }
        );
      }

      // Check if user can be deleted
      const canDelete = await this.canDeleteUserData(request.telegramId);
      if (!canDelete.allowed) {
        throw new SecurityError(
          `Data deletion not allowed: ${canDelete.reason}`,
          ErrorCode.SECURITY_FORBIDDEN,
          { userId: request.userId, reason: canDelete.reason }
        );
      }

      // Get sender info
      const sender = await senderRepository.findByTelegramId(request.telegramId.toString());
      if (!sender) {
        logger.warn(`User not found for deletion: ${request.telegramId}`);
        throw new SecurityError(
          `User not found: ${request.telegramId}`,
          ErrorCode.SECURITY_VALIDATION_FAILED,
          { userId: request.userId, context: { telegramId: request.telegramId.toString() } }
        );
      }

      const deletedCounts = {
        messages: 0,
        memories: 0,
        preferences: 0,
        mediaFiles: 0,
        embeddings: 0,
        cacheEntries: 0,
      };

      // Delete in correct order to respect foreign key constraints

      // 1. Delete embeddings (no foreign key dependencies)
      if (request.deleteMessages || request.deleteMemories || request.deletePreferences) {
        // Get all embeddings for this user's content
        const userMemories = await memoryRepository.findBySenderId(sender.id, 100000);
        const userMessages = await db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.senderId, sender.id));

        for (const memory of userMemories) {
          const deleted = await embeddingRepository.deleteBySource('memory', memory.id);
          if (deleted) deletedCounts.embeddings++;
        }

        for (const message of userMessages) {
          const deleted = await embeddingRepository.deleteBySource('message', message.id);
          if (deleted) deletedCounts.embeddings++;
        }
      }

      // 2. Delete cache entries (references embeddings)
      const cacheEntriesWithUser = await db
        .select({ id: semanticCache.id, sourceMessageIds: semanticCache.sourceMessageIds })
        .from(semanticCache);

      for (const entry of cacheEntriesWithUser) {
        if (entry.sourceMessageIds) {
          const sourceIds = JSON.parse(entry.sourceMessageIds) as string[];
          const userMessages = await db
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.senderId, sender.id));
          const userMessageIds = new Set(userMessages.map((m) => m.id));

          if (sourceIds.some((id) => userMessageIds.has(id))) {
            await semanticCacheRepository.delete(entry.id);
            deletedCounts.cacheEntries++;
          }
        }
      }

      // 3. Delete memories
      if (request.deleteMemories) {
        const memories = await memoryRepository.findBySenderId(sender.id, 100000);
        for (const memory of memories) {
          await memoryRepository.delete(memory.id);
          deletedCounts.memories++;
        }
      }

      // 4. Delete preferences
      if (request.deletePreferences) {
        const count = await userPreferenceRepository.deleteBySenderId(sender.id);
        deletedCounts.preferences = count;
      }

      // 5. Delete media files from filesystem
      if (request.deleteMedia) {
        const userMessages = await db
          .select({ mediaPath: messages.mediaPath })
          .from(messages)
          .where(
            and(eq(messages.senderId, sender.id), sql`${messages.mediaPath} IS NOT NULL`)
          );

        for (const msg of userMessages) {
          if (msg.mediaPath && fs.existsSync(msg.mediaPath)) {
            try {
              fs.unlinkSync(msg.mediaPath);
              deletedCounts.mediaFiles++;
              logger.debug(`Deleted media file: ${msg.mediaPath}`);
            } catch (error) {
              logger.error(`Failed to delete media file: ${msg.mediaPath}`, { error });
            }
          }
        }
      }

      // 6. Delete messages (must be last due to foreign key references)
      if (request.deleteMessages) {
        const result = await db
          .delete(messages)
          .where(eq(messages.senderId, sender.id))
          .returning();
        deletedCounts.messages = result.length;
      }

      // Log audit event
      const auditLog = await this.auditRepo.create({
        eventType: 'DATA_DELETION' as SecurityEventType,
        userId: request.userId,
        telegramId: request.telegramId,
        action: 'User data deleted (right to be forgotten)',
        details: {
          requestId,
          reason: request.reason,
          deletedCounts,
        },
        severity: 'WARNING',
        correlationId,
      });

      logger.info(`Data deletion completed successfully`, {
        requestId,
        deletedCounts,
      });

      return {
        requestId,
        userId: request.userId,
        deletedAt: new Date(),
        deletedCounts,
        auditLogId: auditLog.id,
      };
    } catch (error) {
      logger.error(`Data deletion failed: ${error}`, {
        requestId,
        userId: request.userId,
        error,
      });

      // Log audit event for failure
      await this.auditRepo.create({
        eventType: 'DATA_DELETION' as SecurityEventType,
        userId: request.userId,
        telegramId: request.telegramId,
        action: 'Data deletion failed',
        details: {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        },
        severity: 'ERROR',
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Get summary of user's stored data
   */
  async getUserDataSummary(telegramId: bigint): Promise<UserDataSummary> {
    const sender = await senderRepository.findByTelegramId(telegramId.toString());
    if (!sender) {
      return {
        messageCount: 0,
        memoryCount: 0,
        preferenceCount: 0,
        mediaFileCount: 0,
        embeddingCount: 0,
        cacheEntryCount: 0,
        oldestDataDate: null,
        newestDataDate: null,
      };
    }

    // Count messages
    const messageCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.senderId, sender.id));
    const messageCount = messageCountResult[0]?.count || 0;

    // Count media files
    const mediaCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.senderId, sender.id), sql`${messages.mediaPath} IS NOT NULL`));
    const mediaFileCount = mediaCountResult[0]?.count || 0;

    // Count memories
    const memories = await memoryRepository.findBySenderId(sender.id, 100000);
    const memoryCount = memories.length;

    // Count preferences
    const preferences = await userPreferenceRepository.findBySenderId(sender.id);
    const preferenceCount = preferences.length;

    // Count embeddings
    let embeddingCount = 0;
    for (const memory of memories) {
      const embedding = await embeddingRepository.findBySource('memory', memory.id);
      if (embedding) embeddingCount++;
    }

    const userMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.senderId, sender.id));
    for (const msg of userMessages) {
      const embedding = await embeddingRepository.findBySource('message', msg.id);
      if (embedding) embeddingCount++;
    }

    // Count cache entries (approximate - entries that reference user's messages)
    let cacheEntryCount = 0;
    const cacheEntries = await db.select({ sourceMessageIds: semanticCache.sourceMessageIds }).from(semanticCache);
    const userMessageIds = new Set(userMessages.map((m) => m.id));
    for (const entry of cacheEntries) {
      if (entry.sourceMessageIds) {
        const sourceIds = JSON.parse(entry.sourceMessageIds) as string[];
        if (sourceIds.some((id) => userMessageIds.has(id))) {
          cacheEntryCount++;
        }
      }
    }

    // Get date range
    const dateRangeResult = await db
      .select({
        oldest: sql<number>`MIN(${messages.createdAt})`,
        newest: sql<number>`MAX(${messages.createdAt})`,
      })
      .from(messages)
      .where(eq(messages.senderId, sender.id));

    const oldest = dateRangeResult[0]?.oldest;
    const newest = dateRangeResult[0]?.newest;

    return {
      messageCount,
      memoryCount,
      preferenceCount,
      mediaFileCount,
      embeddingCount,
      cacheEntryCount,
      oldestDataDate: oldest ? new Date(oldest * 1000) : null,
      newestDataDate: newest ? new Date(newest * 1000) : null,
    };
  }

  /**
   * Anonymize user data (alternative to deletion)
   * Replaces PII with anonymized values while preserving data structure
   */
  async anonymizeUserData(telegramId: bigint): Promise<{ recordsAnonymized: number }> {
    const sender = await senderRepository.findByTelegramId(telegramId.toString());
    if (!sender) {
      return { recordsAnonymized: 0 };
    }

    let recordsAnonymized = 0;
    const anonymizedId = `anon_${nanoid(8)}`;

    // Anonymize sender profile
    const { senders } = await import('../db/schema.js');
    await db
      .update(senders)
      .set({
        firstName: 'Anonymous',
        lastName: 'User',
        username: null,
        phone: null,
        updatedAt: new Date(),
      })
      .where(eq(senders.id, sender.id));
    recordsAnonymized++;

    // Anonymize message text (replace with "[REDACTED]")
    const userMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.senderId, sender.id));

    for (const msg of userMessages) {
      await db
        .update(messages)
        .set({ text: '[REDACTED]' })
        .where(eq(messages.id, msg.id));
      recordsAnonymized++;
    }

    logger.info(`Anonymized ${recordsAnonymized} records for user`, {
      telegramId: telegramId.toString(),
      anonymizedId,
    });

    // Log audit event
    await this.auditRepo.create({
      eventType: 'DATA_DELETION' as SecurityEventType,
      userId: anonymizedId,
      telegramId,
      action: 'User data anonymized',
      details: {
        recordsAnonymized,
        anonymizedId,
      },
      severity: 'INFO',
    });

    return { recordsAnonymized };
  }

  /**
   * Check if user data can be deleted
   */
  async canDeleteUserData(
    telegramId: bigint
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.config.allowDataDeletion) {
      return {
        allowed: false,
        reason: 'Data deletion is disabled in system configuration',
      };
    }

    // Check if user exists
    const sender = await senderRepository.findByTelegramId(telegramId.toString());
    if (!sender) {
      return {
        allowed: false,
        reason: 'User not found',
      };
    }

    // Additional business logic checks can go here
    // For example: check if user has pending transactions, active sessions, etc.

    return { allowed: true };
  }

  /**
   * Get pending export requests
   */
  async getPendingExportRequests(): Promise<DataExportRequestWithStatus[]> {
    return Array.from(this.pendingExports.values()).filter((req) => req.status === 'pending');
  }

  /**
   * Get pending deletion requests
   */
  async getPendingDeletionRequests(): Promise<DataDeletionRequestWithStatus[]> {
    return Array.from(this.pendingDeletions.values()).filter(
      (req) => req.status === 'pending'
    );
  }

  /**
   * Process pending requests (called by worker)
   * This can be expanded to handle async processing of requests
   */
  async processPendingRequests(): Promise<void> {
    const pendingExports = await this.getPendingExportRequests();
    const pendingDeletions = await this.getPendingDeletionRequests();

    logger.info(`Processing pending privacy requests`, {
      exports: pendingExports.length,
      deletions: pendingDeletions.length,
    });

    // Process exports
    for (const request of pendingExports) {
      try {
        await this.exportUserData(request);
        request.status = 'completed';
        request.completedAt = new Date();
      } catch (error) {
        logger.error(`Failed to process export request`, { request, error });
        request.status = 'failed';
        request.error = error instanceof Error ? error.message : String(error);
      }
    }

    // Process deletions
    for (const request of pendingDeletions) {
      try {
        await this.deleteUserData(request);
        request.status = 'completed';
        request.completedAt = new Date();
      } catch (error) {
        logger.error(`Failed to process deletion request`, { request, error });
        request.status = 'failed';
        request.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
}

// Export singleton instance
export const dataPrivacyService = new DataPrivacyService(
  appConfig.security.gdpr,
  securityAuditRepository
);
