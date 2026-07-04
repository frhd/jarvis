/**
 * CEO Monitor Worker
 * Runs daily YouTrack checks and posts status reports.
 * Uses IPlatform interface for platform-agnostic message posting.
 */

import { Cron } from 'croner';
import { createLogger } from '../../../utils/logger.js';
import type { IPlatform } from '../../../interfaces/platforms.js';
import type { CeoMonitorService } from '../ceo-monitor.service.js';
import { CEO_POSTING_CONFIG } from '../ceo-config.js';

const logger = createLogger('CeoMonitorWorker');

export class CeoMonitorWorker {
  private job: Cron | null = null;
  private platform: IPlatform | null = null;

  constructor(private monitorService: CeoMonitorService) {}

  /**
   * Set the platform to use for posting reports.
   */
  setPlatform(platform: IPlatform): void {
    this.platform = platform;
  }

  start(): void {
    const timezone = 'Europe/Berlin';

    // Weekday 9am
    this.job = new Cron('0 9 * * 1-5', { timezone }, () => this.runCheck());

    logger.info('CEO monitor worker started', {
      timezone,
      nextRun: this.job.nextRun()?.toISOString(),
    });
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
    logger.info('CEO monitor worker stopped');
  }

  private async runCheck(): Promise<void> {
    if (!this.platform) {
      logger.error('No platform set for CEO monitor worker');
      return;
    }

    try {
      logger.info('Starting CEO monitor check');
      const report = await this.monitorService.runMonitorCheck();
      const channelId = this.platform.getDefaultChannelId();
      await this.platform.sendMessage(channelId, report, {
        username: CEO_POSTING_CONFIG.username,
        iconEmoji: CEO_POSTING_CONFIG.iconEmoji,
      });
      logger.info('Posted CEO monitor report', { length: report.length });
    } catch (error) {
      logger.error('Failed to run CEO monitor check', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
