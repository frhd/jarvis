/**
 * Identity Resolution Service
 *
 * Resolves platform-specific user/conversation IDs into unified internal IDs.
 * Provides find-or-create semantics for users and conversations, and supports
 * cross-platform identity linking.
 */

import type { IIdentityService } from '../interfaces/services.js';
import type { IUserRepository, IPlatformIdentityRepository, IConversationRepository } from '../interfaces/repositories.js';
import type { User, PlatformIdentity, Conversation } from '../types/index.js';
import type { ConversationType } from '../config/platforms.js';
import { IdentityError } from '../errors/error-classes.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('IdentityService');

export class IdentityService implements IIdentityService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly platformIdentityRepo: IPlatformIdentityRepository,
    private readonly conversationRepo: IConversationRepository
  ) {}

  async resolveUser(
    platform: string,
    platformUserId: string,
    metadata?: Record<string, unknown>
  ): Promise<User> {
    const existing = await this.platformIdentityRepo.findByPlatformUser(platform, platformUserId);

    if (existing) {
      if (metadata) {
        await this.platformIdentityRepo.update(existing.id, {
          metadata: JSON.stringify(metadata),
        });
      }

      const user = await this.userRepo.findById(existing.userId);
      if (!user) {
        // Data recovery: Create missing user and update platform identity
        // This can happen if user was deleted or backfill was incomplete
        logger.warn(`User ${existing.userId} referenced by platform identity not found, creating recovery user`, {
          platform,
          platformUserId,
          existingIdentityId: existing.id,
        });

        const recoveredUser = await this.userRepo.create({ displayName: null });
        await this.platformIdentityRepo.update(existing.id, { userId: recoveredUser.id });

        logger.info(`Created recovery user ${recoveredUser.id} for platform identity ${existing.id}`);
        return recoveredUser;
      }

      // Update display name from metadata if provided
      if (metadata?.displayName && metadata.displayName !== user.displayName) {
        const updated = await this.userRepo.update(user.id, {
          displayName: metadata.displayName as string,
        });
        return updated ?? user;
      }

      return user;
    }

    // Create new user + platform identity
    try {
      const displayName = (metadata?.displayName as string) ??
        (metadata?.firstName as string) ??
        null;

      const user = await this.userRepo.create({ displayName });

      await this.platformIdentityRepo.create({
        userId: user.id,
        platform,
        platformUserId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      logger.info(`Created user ${user.id} for ${platform}:${platformUserId}`);
      return user;
    } catch (error: unknown) {
      // Handle race condition: another request may have created the identity
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const retryExisting = await this.platformIdentityRepo.findByPlatformUser(platform, platformUserId);
        if (retryExisting) {
          const user = await this.userRepo.findById(retryExisting.userId);
          if (user) return user;
        }
      }
      throw error;
    }
  }

  async resolveConversation(
    platform: string,
    platformConversationId: string,
    type: ConversationType,
    metadata?: Record<string, unknown>
  ): Promise<Conversation> {
    const existing = await this.conversationRepo.findByPlatformConversation(
      platform,
      platformConversationId
    );

    if (existing) {
      const title = metadata?.title as string | undefined;
      if (title && title !== existing.title) {
        const updated = await this.conversationRepo.update(existing.id, {
          title,
          metadata: metadata ? JSON.stringify(metadata) : existing.metadata,
        });
        return updated ?? existing;
      }
      if (metadata) {
        const updated = await this.conversationRepo.update(existing.id, {
          metadata: JSON.stringify(metadata),
        });
        return updated ?? existing;
      }
      return existing;
    }

    // Create new conversation
    try {
      const conversation = await this.conversationRepo.create({
        platform,
        platformConversationId,
        type,
        title: (metadata?.title as string) ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      logger.info(`Created conversation ${conversation.id} for ${platform}:${platformConversationId}`);
      return conversation;
    } catch (error: unknown) {
      // Handle race condition
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const retryExisting = await this.conversationRepo.findByPlatformConversation(
          platform,
          platformConversationId
        );
        if (retryExisting) return retryExisting;
      }
      throw error;
    }
  }

  async linkIdentities(
    userId: string,
    platform: string,
    platformUserId: string
  ): Promise<PlatformIdentity> {
    // Check if the platform identity already exists
    const existing = await this.platformIdentityRepo.findByPlatformUser(platform, platformUserId);

    if (existing) {
      if (existing.userId === userId) {
        // Already linked to the same user — no-op
        return existing;
      }
      throw IdentityError.duplicatePlatformUser(platform, platformUserId);
    }

    // Verify the target user exists
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw IdentityError.userNotFound(platform, platformUserId);
    }

    return this.platformIdentityRepo.create({
      userId,
      platform,
      platformUserId,
      metadata: null,
    });
  }

  async findUser(platform: string, platformUserId: string): Promise<User | null> {
    const identity = await this.platformIdentityRepo.findByPlatformUser(platform, platformUserId);
    if (!identity) return null;
    return this.userRepo.findById(identity.userId);
  }

  async findConversation(
    platform: string,
    platformConversationId: string
  ): Promise<Conversation | null> {
    return this.conversationRepo.findByPlatformConversation(platform, platformConversationId);
  }

  async getIdentitiesForUser(userId: string): Promise<PlatformIdentity[]> {
    return this.platformIdentityRepo.findByUserId(userId);
  }
}
