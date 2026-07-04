import { PriorityEscalationService } from '../services/priorityEscalation.service';
import { logger } from '../utils/logger';
import { PRIORITY_ESCALATION_INTERVAL_MS } from '../config/constants';

/**
 * Worker that periodically escalates priority for stale queue items.
 *
 * Stale items are those that have been waiting longer than expected,
 * and priority escalation ensures they don't get stuck forever.
 */
export class PriorityEscalationWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private priorityEscalationService: PriorityEscalationService
  ) {}

  /**
   * Start the priority escalation worker
   * @param intervalMs How often to check for stale items (default: 60 seconds)
   */
  start(intervalMs: number = PRIORITY_ESCALATION_INTERVAL_MS): NodeJS.Timeout {
    logger.info('[PriorityEscalationWorker] Starting with interval:', intervalMs, 'ms');

    // Run immediately on start
    this.runEscalation().catch(err => {
      logger.error('[PriorityEscalationWorker] Initial run failed:', err);
    });

    this.timer = setInterval(async () => {
      await this.runEscalation();
    }, intervalMs);

    return this.timer;
  }

  /**
   * Stop the priority escalation worker
   */
  stop(): void {
    if (this.timer) {
      logger.info('[PriorityEscalationWorker] Stopping');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single escalation pass
   */
  private async runEscalation(): Promise<void> {
    try {
      const escalatedCount = await this.priorityEscalationService.escalateStaleItems();

      if (escalatedCount > 0) {
        logger.info('[PriorityEscalationWorker] Escalated items:', escalatedCount);
      }
    } catch (error) {
      logger.error('[PriorityEscalationWorker] Error during escalation:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
