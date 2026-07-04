/**
 * Consent Manager Service
 *
 * Handles opt-in consent for therapist mode activation.
 * Both participants must consent before therapist mode can be enabled.
 */

import { logger } from '../../utils/logger.js';
import { nanoid } from 'nanoid';
import type { ConsentStatus, TherapistConfig } from './types.js';
import type { TherapistModeType, ResponseFrequencyLevel } from '../../db/schema.js';

/** Required number of participants for consent (both must consent) */
const REQUIRED_CONSENT_COUNT = 2;

import type { IConsentManagerService } from '../../interfaces/therapist.js';
export type { IConsentManagerService };

/**
 * Resolves an identity reference to a stable, platform-anchored key.
 *
 * Consent is stored using unified `users.id` values, but the dyad detector
 * yields raw `senders.id` values (the `messages` table has no `userId` column).
 * Both map to the same Telegram ID, so normalizing each side through this
 * resolver lets stored consent match detected participants regardless of which
 * ID space they came from.
 */
export interface IIdentityResolver {
  /** Returns the Telegram ID for a senderId OR a unified userId, or null if unknown. */
  toTelegramId(id: string): Promise<string | null>;
}

export class ConsentManagerService implements IConsentManagerService {
  constructor(
    private therapistConfigRepo: {
      findByConversationId(conversationId: string): Promise<{
        id: string;
        conversationId: string;
        enabled: number;
        modeType: string;
        consentedByUserIds: string;
        responseFrequency: string;
        lastInterventionAt: number | null;
        interventionsCount: number;
      } | null>;
      upsert(config: {
        id: string;
        conversationId: string;
        enabled: number;
        modeType: string;
        consentedByUserIds: string;
        responseFrequency: string;
      }): Promise<void>;
      setEnabled(conversationId: string, enabled: boolean): Promise<void>;
    },
    private identityResolver?: IIdentityResolver
  ) {}

  /**
   * Normalize an identity reference (senderId or unified userId) to a canonical
   * key so the two ID spaces can be compared. Falls back to the raw id when no
   * resolver is wired or the id cannot be resolved (preserving legacy behavior).
   */
  private async canonicalIdentityKey(id: string): Promise<string> {
    if (!this.identityResolver) {
      return id;
    }
    try {
      const telegramId = await this.identityResolver.toTelegramId(id);
      return telegramId ? `tg:${telegramId}` : id;
    } catch {
      return id;
    }
  }

  /**
   * Check consent status for a conversation
   */
  async getConsentStatus(conversationId: string, participantIds: string[]): Promise<ConsentStatus> {
    const config = await this.therapistConfigRepo.findByConversationId(conversationId);
    const consentedByUserIds: string[] = config ? JSON.parse(config.consentedByUserIds) : [];

    // Normalize both sides to canonical identity keys so consent stored as
    // unified userIds matches participants detected as senderIds (and vice-versa).
    const [participantKeys, consentedKeys] = await Promise.all([
      Promise.all(participantIds.map(id => this.canonicalIdentityKey(id))),
      Promise.all(consentedByUserIds.map(id => this.canonicalIdentityKey(id))),
    ]);
    const consentedKeySet = new Set(consentedKeys);

    const consented = participantIds.filter((_, i) => consentedKeySet.has(participantKeys[i]));
    const pending = participantIds.filter((_, i) => !consentedKeySet.has(participantKeys[i]));

    return {
      hasAllConsent: consented.length >= REQUIRED_CONSENT_COUNT && pending.length === 0,
      consentedByUserIds: consented,
      pendingUserIds: pending,
      canEnable: consented.length >= REQUIRED_CONSENT_COUNT,
    };
  }

  /**
   * Grant consent for a user
   */
  async grantConsent(userId: string, conversationId: string): Promise<boolean> {
    try {
      const existing = await this.therapistConfigRepo.findByConversationId(conversationId);
      const currentConsented = existing ? JSON.parse(existing.consentedByUserIds) : [];

      if (currentConsented.includes(userId)) {
        logger.debug('[ConsentManager] User already consented', {
          userId,
          conversationId,
        });
        return true;
      }

      const updatedConsented = [...currentConsented, userId];

      await this.therapistConfigRepo.upsert({
        id: existing?.id || nanoid(),
        conversationId,
        enabled: existing?.enabled ?? 0,
        modeType: existing?.modeType || 'active_listener',
        consentedByUserIds: JSON.stringify(updatedConsented),
        responseFrequency: existing?.responseFrequency || 'minimal',
      });

      logger.info('[ConsentManager] Consent granted', {
        userId,
        conversationId,
        totalConsented: updatedConsented.length,
      });

      return true;
    } catch (error) {
      logger.error('[ConsentManager] Failed to grant consent', {
        userId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Revoke consent for a user
   */
  async revokeConsent(userId: string, conversationId: string): Promise<boolean> {
    try {
      const existing = await this.therapistConfigRepo.findByConversationId(conversationId);
      if (!existing) {
        return true;
      }

      const currentConsented = JSON.parse(existing.consentedByUserIds);
      const updatedConsented = currentConsented.filter((id: string) => id !== userId);

      // If consent is revoked, disable therapist mode
      const shouldDisable = updatedConsented.length < REQUIRED_CONSENT_COUNT;

      await this.therapistConfigRepo.upsert({
        id: existing.id,
        conversationId,
        enabled: shouldDisable ? 0 : existing.enabled,
        modeType: existing.modeType,
        consentedByUserIds: JSON.stringify(updatedConsented),
        responseFrequency: existing.responseFrequency,
      });

      logger.info('[ConsentManager] Consent revoked', {
        userId,
        conversationId,
        totalConsented: updatedConsented.length,
        therapistDisabled: shouldDisable,
      });

      return true;
    } catch (error) {
      logger.error('[ConsentManager] Failed to revoke consent', {
        userId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Enable therapist mode (requires full consent)
   */
  async enableTherapistMode(
    conversationId: string,
    modeType: TherapistModeType,
    responseFrequency: ResponseFrequencyLevel
  ): Promise<boolean> {
    try {
      const existing = await this.therapistConfigRepo.findByConversationId(conversationId);
      const consentedUserIds = existing ? JSON.parse(existing.consentedByUserIds) : [];

      if (consentedUserIds.length < REQUIRED_CONSENT_COUNT) {
        logger.warn('[ConsentManager] Cannot enable therapist mode - insufficient consent', {
          conversationId,
          consentedCount: consentedUserIds.length,
          requiredCount: REQUIRED_CONSENT_COUNT,
        });
        return false;
      }

      await this.therapistConfigRepo.upsert({
        id: existing?.id || nanoid(),
        conversationId,
        enabled: 1,
        modeType,
        consentedByUserIds: existing?.consentedByUserIds || '[]',
        responseFrequency,
      });

      logger.info('[ConsentManager] Therapist mode enabled', {
        conversationId,
        modeType,
        responseFrequency,
      });

      return true;
    } catch (error) {
      logger.error('[ConsentManager] Failed to enable therapist mode', {
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Disable therapist mode
   */
  async disableTherapistMode(conversationId: string): Promise<boolean> {
    try {
      await this.therapistConfigRepo.setEnabled(conversationId, false);

      logger.info('[ConsentManager] Therapist mode disabled', {
        conversationId,
      });

      return true;
    } catch (error) {
      logger.error('[ConsentManager] Failed to disable therapist mode', {
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get therapist config for a conversation
   */
  async getConfig(conversationId: string): Promise<TherapistConfig | null> {
    const config = await this.therapistConfigRepo.findByConversationId(conversationId);

    if (!config) {
      return null;
    }

    return {
      conversationId: config.conversationId,
      enabled: config.enabled === 1,
      modeType: config.modeType as TherapistModeType,
      consentedByUserIds: JSON.parse(config.consentedByUserIds),
      responseFrequency: config.responseFrequency as ResponseFrequencyLevel,
      lastInterventionAt: config.lastInterventionAt ? new Date(config.lastInterventionAt * 1000) : undefined,
      interventionsCount: config.interventionsCount,
    };
  }
}
