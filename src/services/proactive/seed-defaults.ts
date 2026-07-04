/**
 * Proactive Job Default Seeder
 *
 * Idempotent seeder that creates default proactive jobs on startup
 * if they don't already exist in the database.
 */

import { DEFAULT_JOB_TEMPLATES, type ProactiveScheduleType, type ProactiveMessageType } from '../../types/proactive.types.js';
import { calculateNextRunTime } from './schedule-utils.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('proactive-seed');

// ============================================================================
// Duck-typed Interfaces
// ============================================================================

/**
 * Duck-typed interface for the job repository.
 * Allows testing without importing the full repository implementation.
 */
interface IJobRepository {
  existsByName(name: string): Promise<boolean>;
  create(job: {
    name: string;
    description: string | null;
    enabled: boolean;
    scheduleType: ProactiveScheduleType;
    scheduleValue: string;
    timezone: string;
    targetChatId: string | null;
    targetSenderId: string | null;
    messageType: ProactiveMessageType;
    messageTemplate: string | null;
    contextConfig: string | null;
    deleteAfterRun: boolean;
    nextRunAt: Date | null;
    lastRunAt: null;
    lastStatus: null;
    lastError: null;
  }): Promise<unknown>;
}

/**
 * Configuration for seeding default jobs.
 */
interface SeedConfig {
  /** Default timezone for scheduling (e.g., 'America/Los_Angeles') */
  defaultTimezone: string;
  /** Optional target chat ID for all jobs */
  targetChatId?: string;
}

// ============================================================================
// Main Seeder Function
// ============================================================================

/**
 * Seed default proactive jobs into the database if they don't already exist.
 *
 * This function is idempotent - it can be safely called multiple times.
 * Jobs are only created if they don't already exist (checked by name).
 *
 * @param jobRepo - Repository for proactive jobs (duck-typed interface)
 * @param config - Configuration with timezone and optional target chat ID
 * @returns Number of jobs created
 */
export async function seedDefaultJobs(
  jobRepo: IJobRepository,
  config: SeedConfig,
): Promise<number> {
  let createdCount = 0;

  for (const template of DEFAULT_JOB_TEMPLATES) {
    // Skip if job already exists
    const exists = await jobRepo.existsByName(template.name);
    if (exists) {
      logger.debug('Skipping existing job', { name: template.name });
      continue;
    }

    // Calculate initial next run time
    const nextRunAt = calculateNextRunTime(
      template.scheduleType,
      template.scheduleValue,
      config.defaultTimezone,
    );

    if (!nextRunAt) {
      logger.warn('Failed to calculate next run time for job, skipping', {
        name: template.name,
        scheduleType: template.scheduleType,
        scheduleValue: template.scheduleValue,
      });
      continue;
    }

    // Create the job
    await jobRepo.create({
      name: template.name,
      description: template.description,
      enabled: true,
      scheduleType: template.scheduleType,
      scheduleValue: template.scheduleValue,
      timezone: config.defaultTimezone,
      targetChatId: config.targetChatId ?? null,
      targetSenderId: null,
      messageType: template.messageType,
      messageTemplate: null,
      contextConfig: JSON.stringify(template.contextConfig),
      deleteAfterRun: false,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    });

    logger.info('Created default proactive job', {
      name: template.name,
      messageType: template.messageType,
      scheduleType: template.scheduleType,
      scheduleValue: template.scheduleValue,
      nextRunAt: nextRunAt.toISOString(),
    });

    createdCount++;
  }

  if (createdCount > 0) {
    logger.info('Default job seeding complete', { createdCount });
  } else {
    logger.debug('No new default jobs created (all already exist)');
  }

  return createdCount;
}
