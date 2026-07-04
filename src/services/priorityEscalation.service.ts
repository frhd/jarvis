import { QueueRepository } from '../repositories/queue.repository';
import { MessageRepository } from '../repositories/message.repository';
import { PriorityConfig, EscalationRule, PriorityLevel } from '../types/queue.types';
import { QueueItem } from '../types';
import { logger } from '../utils/logger';

/**
 * Priority Escalation Service
 *
 * Handles automatic priority boosting for queue items based on age and VIP status.
 * Default escalation rules: 5min (+1 to HIGH), 15min (+2 to URGENT), 30min (+3 to VIP)
 */
export class PriorityEscalationService {
  constructor(
    private queueRepo: QueueRepository,
    private messageRepo: MessageRepository,
    private config: PriorityConfig
  ) {}

  /**
   * Calculate priority for a message based on VIP status
   */
  calculatePriority(
    chatId: string,
    senderId: string | null,
    basePriority?: number
  ): number {
    if (senderId && this.config.vipUserIds.includes(senderId)) {
      logger.debug('[PriorityEscalation] VIP sender detected', { senderId });
      return PriorityLevel.VIP;
    }

    if (this.config.vipChatIds.includes(chatId)) {
      logger.debug('[PriorityEscalation] VIP chat detected', { chatId });
      return PriorityLevel.VIP;
    }

    return basePriority !== undefined ? basePriority : this.config.baselinePriority;
  }

  async escalateStaleItems(): Promise<number> {
    try {
      let escalatedCount = 0;

      for (const rule of this.config.escalationRules) {
        const staleItems = await this.queueRepo.getStaleItems(rule.ageThresholdMs);

        for (const item of staleItems) {
          if (item.priority >= rule.maxPriority) {
            continue;
          }

          await this.applyEscalation(item.id, rule);
          escalatedCount++;

          logger.info('[PriorityEscalation] Item escalated', {
            queueItemId: item.id,
            messageId: item.messageId,
            oldPriority: item.priority,
            newPriority: Math.min(item.priority + rule.priorityBoost, rule.maxPriority),
            ageMs: Date.now() - item.createdAt.getTime(),
            ruleThreshold: rule.ageThresholdMs,
          });
        }
      }

      if (escalatedCount > 0) {
        logger.info('[PriorityEscalation] Escalation sweep completed', {
          itemsEscalated: escalatedCount,
        });
      }

      return escalatedCount;
    } catch (error) {
      logger.error('[PriorityEscalation] Error during escalation sweep', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async applyEscalation(queueItemId: string, rule: EscalationRule): Promise<void> {
    try {
      const staleItems = await this.queueRepo.getStaleItems(0);
      const item = staleItems.find((i) => i.id === queueItemId);

      if (!item) {
        logger.warn('[PriorityEscalation] Queue item not found for escalation', {
          queueItemId,
        });
        return;
      }

      const currentPriority = item.priority;
      const newPriority = Math.min(
        currentPriority + rule.priorityBoost,
        rule.maxPriority,
        PriorityLevel.VIP
      );

      const originalPriority = item.priorityBoostApplied
        ? undefined
        : currentPriority;

      await this.queueRepo.updatePriority(
        queueItemId,
        newPriority,
        rule.priorityBoost,
        originalPriority
      );

      logger.debug('[PriorityEscalation] Escalation applied', {
        queueItemId,
        messageId: item.messageId,
        originalPriority: originalPriority ?? item.originalPriority,
        oldPriority: currentPriority,
        newPriority,
        boost: rule.priorityBoost,
      });
    } catch (error) {
      logger.error('[PriorityEscalation] Error applying escalation', {
        queueItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Find the appropriate escalation rule for a given message age.
   * Returns the most specific rule (highest threshold) that applies.
   */
  getEscalationRule(ageMs: number): EscalationRule | null {
    const applicableRules = this.config.escalationRules.filter(
      (rule) => ageMs >= rule.ageThresholdMs
    );

    if (applicableRules.length === 0) {
      return null;
    }

    return applicableRules.reduce((highest, current) =>
      current.ageThresholdMs > highest.ageThresholdMs ? current : highest
    );
  }

  async manualPriorityOverride(
    queueItemId: string,
    newPriority: number
  ): Promise<void> {
    try {
      if (newPriority < PriorityLevel.LOW || newPriority > PriorityLevel.VIP) {
        throw new Error(
          `Invalid priority level: ${newPriority}. Must be between ${PriorityLevel.LOW} and ${PriorityLevel.VIP}`
        );
      }

      const staleItems = await this.queueRepo.getStaleItems(0);
      const item = staleItems.find((i) => i.id === queueItemId);

      if (!item) {
        throw new Error(`Queue item not found: ${queueItemId}`);
      }

      const originalPriority = item.priorityBoostApplied
        ? undefined
        : item.priority;

      const boost = newPriority - item.priority;

      await this.queueRepo.updatePriority(
        queueItemId,
        newPriority,
        boost,
        originalPriority
      );

      logger.info('[PriorityEscalation] Manual priority override applied', {
        queueItemId,
        messageId: item.messageId,
        oldPriority: item.priority,
        newPriority,
        originalPriority: originalPriority ?? item.originalPriority,
      });
    } catch (error) {
      logger.error('[PriorityEscalation] Error applying manual priority override', {
        queueItemId,
        newPriority,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
