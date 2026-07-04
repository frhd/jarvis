/**
 * Dyad Detector Service
 *
 * Identifies 2-person groups (dyads) and manages participant tracking.
 */

import type { Conversation } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import type { DyadInfo, DyadParticipant } from './types.js';

/** Number of participants that defines a dyad */
const DYAD_PARTICIPANT_COUNT = 2;

/** Maximum recent messages to analyze for participant detection */
const MAX_RECENT_MESSAGES_FOR_PARTICIPANTS = 50;

import type { IDyadDetectorService } from '../../interfaces/therapist.js';
export type { IDyadDetectorService };

export class DyadDetectorService implements IDyadDetectorService {
  constructor(
    private messageRepo: {
      findRecentByConversationId(conversationId: string, limit: number): Promise<Array<{
        id: string;
        senderId: string | null;
        userId?: string | null;
        createdAt: Date;
      }>>;
    },
    private conversationRepo: {
      findById(id: string): Promise<Conversation | null>;
      updateParticipantCount(id: string, count: number): Promise<void>;
    },
    private identityService: {
      getIdentitiesForUser(userId: string): Promise<Array<{ platformUserId: string }>>;
    },
    private therapistConfigRepo: {
      findByConversationId(conversationId: string): Promise<{
        enabled: boolean;
        consentedByUserIds: string;
      } | null>;
    }
  ) {}

  /**
   * Check if a conversation is a dyad
   */
  async isDyad(conversationId: string): Promise<boolean> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      return false;
    }

    // Check stored participant count first
    if (conversation.participantCount !== undefined && conversation.participantCount !== null) {
      return conversation.participantCount === DYAD_PARTICIPANT_COUNT;
    }

    // Fall back to analyzing recent messages to determine participant count
    const participants = await this.getParticipants(conversationId);
    return participants.length === DYAD_PARTICIPANT_COUNT;
  }

  /**
   * Get detailed dyad information
   */
  async getDyadInfo(conversationId: string): Promise<DyadInfo | null> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      return null;
    }

    const participants = await this.getParticipants(conversationId);
    const isDyad = participants.length === DYAD_PARTICIPANT_COUNT;

    // Get therapist config
    const config = await this.therapistConfigRepo.findByConversationId(conversationId);
    const consentedByUserIds = config ? JSON.parse(config.consentedByUserIds) : [];

    return {
      isDyad,
      conversationId,
      participants,
      participantCount: participants.length,
      therapistEnabled: config?.enabled ?? false,
      hasConsent: isDyad && consentedByUserIds.length === DYAD_PARTICIPANT_COUNT,
      consentedByUserIds,
    };
  }

  /**
   * Get participants in a conversation
   */
  async getParticipants(conversationId: string): Promise<DyadParticipant[]> {
    const messages = await this.messageRepo.findRecentByConversationId(
      conversationId,
      MAX_RECENT_MESSAGES_FOR_PARTICIPANTS
    );

    if (messages.length === 0) {
      return [];
    }

    // Group by userId (preferred) or senderId (legacy).
    // NOTE: `messages` has no `userId` column today, so this always falls back
    // to `senderId` — a different ID space from the unified `users.id` used by
    // consent. ConsentManagerService normalizes across the two as an interim
    // fix; the proper resolution is docs/identity-unification-migration.md.
    const participantMap = new Map<string, DyadParticipant>();

    for (const msg of messages) {
      const participantKey = msg.userId || msg.senderId;
      if (!participantKey) continue;

      if (!participantMap.has(participantKey)) {
        participantMap.set(participantKey, {
          userId: participantKey,
          platformUserId: '', // Will be populated if available
          recentMessageCount: 1,
          lastMessageAt: msg.createdAt,
        });
      } else {
        const existing = participantMap.get(participantKey)!;
        existing.recentMessageCount++;
        if (msg.createdAt > (existing.lastMessageAt || new Date(0))) {
          existing.lastMessageAt = msg.createdAt;
        }
      }
    }

    return Array.from(participantMap.values());
  }

  /**
   * Update participant count for a conversation
   */
  async updateParticipantCount(conversationId: string, count: number): Promise<void> {
    await this.conversationRepo.updateParticipantCount(conversationId, count);
    logger.debug('[DyadDetector] Updated participant count', {
      conversationId,
      count,
    });
  }
}
