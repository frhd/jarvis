/**
 * CEO Scheduled Worker
 * Posts scheduled motivational messages at configured times.
 * Uses IPlatform interface for platform-agnostic message posting.
 */

import { Cron } from 'croner';
import { createLogger } from '../../../utils/logger.js';
import type { IPlatform } from '../../../interfaces/platforms.js';
import type { CeoScheduledService } from '../ceo-scheduled.service.js';
import { CEO_POSTING_CONFIG } from '../ceo-config.js';

const logger = createLogger('CeoScheduledWorker');

export class CeoScheduledWorker {
  private jobs: Cron[] = [];
  private platform: IPlatform | null = null;

  constructor(private scheduledService: CeoScheduledService) {}

  /**
   * Set the platform to use for posting messages.
   */
  setPlatform(platform: IPlatform): void {
    this.platform = platform;
  }

  start(): void {
    const timezone = 'Europe/Berlin';

    // Weekday 8am - morning
    this.jobs.push(new Cron('0 8 * * 1-5', { timezone }, () => this.postMessage()));
    // Weekday 12pm - afternoon
    this.jobs.push(new Cron('0 12 * * 1-5', { timezone }, () => this.postMessage()));
    // Weekday 5pm - evening
    this.jobs.push(new Cron('0 17 * * 1-5', { timezone }, () => this.postMessage()));
    // Weekend 10am
    this.jobs.push(new Cron('0 10 * * 0,6', { timezone }, () => this.postMessage()));

    logger.info('CEO scheduled worker started', {
      jobs: this.jobs.length,
      timezone,
      nextRuns: this.jobs.map(j => j.nextRun()?.toISOString()),
    });
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    logger.info('CEO scheduled worker stopped');
  }

  private async postMessage(): Promise<void> {
    if (!this.platform) {
      logger.error('No platform set for CEO scheduled worker');
      return;
    }

    try {
      const message = this.scheduledService.pickMessage();
      const channelId = this.platform.getDefaultChannelId();
      await this.platform.sendMessage(channelId, message, {
        username: CEO_POSTING_CONFIG.username,
        iconEmoji: CEO_POSTING_CONFIG.iconEmoji,
      });
      logger.info('Posted scheduled CEO message', { length: message.length });
    } catch (error) {
      logger.error('Failed to post scheduled CEO message', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
