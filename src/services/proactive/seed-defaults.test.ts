/**
 * Tests for seed-defaults.ts
 *
 * Validates the seedDefaultJobs function which creates default proactive jobs
 * idempotently from templates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedDefaultJobs } from './seed-defaults.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('croner', () => ({
  Cron: class MockCron {
    nextRun() {
      return new Date('2025-01-01T08:00:00Z');
    }
  },
}));

// ============================================================================
// Test Suite
// ============================================================================

describe('seedDefaultJobs', () => {
  let jobRepo: {
    existsByName: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  let config: {
    defaultTimezone: string;
    targetChatId?: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    jobRepo = {
      existsByName: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'test-id' }),
    };

    config = {
      defaultTimezone: 'Europe/Berlin',
      targetChatId: 'chat-123',
    };
  });

  it('seeds all 4 default jobs when DB is empty', async () => {
    // All jobs don't exist
    jobRepo.existsByName.mockResolvedValue(false);

    const result = await seedDefaultJobs(jobRepo, config);

    expect(result).toBe(4);
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    expect(jobRepo.existsByName).toHaveBeenCalledTimes(4);
  });

  it('skips existing jobs (idempotent)', async () => {
    // All jobs already exist
    jobRepo.existsByName.mockResolvedValue(true);

    const result = await seedDefaultJobs(jobRepo, config);

    expect(result).toBe(0);
    expect(jobRepo.create).not.toHaveBeenCalled();
    expect(jobRepo.existsByName).toHaveBeenCalledTimes(4);
  });

  it('skips some, creates others', async () => {
    // Mock different responses for different job names
    jobRepo.existsByName.mockImplementation(async (name: string) => {
      return name === 'Morning Greeting' || name === 'Daily Summary';
    });

    const result = await seedDefaultJobs(jobRepo, config);

    expect(result).toBe(2);
    expect(jobRepo.create).toHaveBeenCalledTimes(2);
    expect(jobRepo.existsByName).toHaveBeenCalledTimes(4);

    // Verify the created jobs are the ones that didn't exist
    const createdJobNames = jobRepo.create.mock.calls.map(call => call[0].name);
    expect(createdJobNames).toContain('Idle Check-in');
    expect(createdJobNames).toContain('Weekly Recap');
    expect(createdJobNames).not.toContain('Morning Greeting');
    expect(createdJobNames).not.toContain('Daily Summary');
  });

  it('uses config timezone', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have the configured timezone
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].timezone).toBe('Europe/Berlin');
    });
  });

  it('uses config targetChatId', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have the configured targetChatId
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].targetChatId).toBe('chat-123');
    });
  });

  it('sets targetChatId to null when not in config', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    // Config without targetChatId
    const configWithoutChat = {
      defaultTimezone: 'Europe/Berlin',
    };

    await seedDefaultJobs(jobRepo, configWithoutChat);

    // All created jobs should have null targetChatId
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].targetChatId).toBeNull();
    });
  });

  it('calculates nextRunAt for each job', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have a non-null nextRunAt that is a Date
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].nextRunAt).not.toBeNull();
      expect(call[0].nextRunAt).toBeInstanceOf(Date);
    });
  });

  it('stringifies contextConfig', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have contextConfig as a JSON string
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(typeof call[0].contextConfig).toBe('string');
      // Should be valid JSON
      expect(() => JSON.parse(call[0].contextConfig)).not.toThrow();
      // Should be an object when parsed
      const parsed = JSON.parse(call[0].contextConfig);
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
    });
  });

  it('sets correct defaults', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have correct default values
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].enabled).toBe(true);
      expect(call[0].deleteAfterRun).toBe(false);
      expect(call[0].lastRunAt).toBeNull();
      expect(call[0].lastStatus).toBeNull();
      expect(call[0].lastError).toBeNull();
    });
  });

  it('creates jobs with correct template properties', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    expect(jobRepo.create).toHaveBeenCalledTimes(4);

    // Verify specific template properties
    const calls = jobRepo.create.mock.calls;

    // Morning Greeting
    const morningGreeting = calls.find(call => call[0].name === 'Morning Greeting');
    expect(morningGreeting).toBeDefined();
    expect(morningGreeting![0].description).toBe('Daily morning greeting at 8am');
    expect(morningGreeting![0].scheduleType).toBe('cron');
    expect(morningGreeting![0].scheduleValue).toBe('0 8 * * *');
    expect(morningGreeting![0].messageType).toBe('greeting');

    // Daily Summary
    const dailySummary = calls.find(call => call[0].name === 'Daily Summary');
    expect(dailySummary).toBeDefined();
    expect(dailySummary![0].description).toBe('Daily conversation summary at 7pm');
    expect(dailySummary![0].scheduleType).toBe('cron');
    expect(dailySummary![0].scheduleValue).toBe('0 19 * * *');
    expect(dailySummary![0].messageType).toBe('summary');

    // Idle Check-in
    const idleCheckin = calls.find(call => call[0].name === 'Idle Check-in');
    expect(idleCheckin).toBeDefined();
    expect(idleCheckin![0].description).toBe('Check in after 12 hours of no messages');
    expect(idleCheckin![0].scheduleType).toBe('every');
    expect(idleCheckin![0].scheduleValue).toBe('43200000');
    expect(idleCheckin![0].messageType).toBe('checkin');

    // Weekly Recap
    const weeklyRecap = calls.find(call => call[0].name === 'Weekly Recap');
    expect(weeklyRecap).toBeDefined();
    expect(weeklyRecap![0].description).toBe('Weekly summary on Sunday at 6pm');
    expect(weeklyRecap![0].scheduleType).toBe('cron');
    expect(weeklyRecap![0].scheduleValue).toBe('0 18 * * 0');
    expect(weeklyRecap![0].messageType).toBe('summary');
  });

  it('sets targetSenderId to null for all jobs', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have null targetSenderId
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].targetSenderId).toBeNull();
    });
  });

  it('sets messageTemplate to null for all jobs', async () => {
    jobRepo.existsByName.mockResolvedValue(false);

    await seedDefaultJobs(jobRepo, config);

    // All created jobs should have null messageTemplate (uses default generation)
    expect(jobRepo.create).toHaveBeenCalledTimes(4);
    jobRepo.create.mock.calls.forEach(call => {
      expect(call[0].messageTemplate).toBeNull();
    });
  });
});
