/**
 * ProactiveExecutorService Tests
 *
 * Tests the executor's job execution lifecycle: target resolution, idle
 * detection for check-in jobs, context building, LLM message generation,
 * Telegram delivery, and run recording. All dependencies are mocked for
 * isolation. Verifies that executeJob NEVER throws — all errors are caught
 * and returned as result objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProactiveJob } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  ProactiveExecutorService,
  type IRunRepository,
  type IMessageRepository,
  type IMessageGenerator,
  type ITelegramService,
  type IUserPreferenceService,
  type ExecutorConfig,
} from './executor.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ProactiveJob> = {}): ProactiveJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: 'A test job',
    enabled: true,
    scheduleType: 'cron',
    scheduleValue: '0 8 * * *',
    timezone: 'Europe/Berlin',
    targetChatId: 'chat-123',
    targetSenderId: 'sender-1',
    messageType: 'greeting',
    messageTemplate: null,
    contextConfig: null,
    nextRunAt: new Date(),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    deleteAfterRun: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProactiveJob;
}

function createMockRunRepo(): IRunRepository {
  return {
    startRun: vi.fn().mockResolvedValue({ id: 'run-1', jobId: 'job-1', startedAt: new Date() }),
    completeRun: vi.fn().mockResolvedValue({}),
    findByJobId: vi.fn().mockResolvedValue([]),
  };
}

function createMockMessageRepo(): IMessageRepository {
  return {
    findRecentByChatId: vi.fn().mockResolvedValue([]),
  };
}

function createMockGenerator(): IMessageGenerator {
  return {
    generate: vi.fn().mockResolvedValue({
      message: 'Hello!',
      model: 'llama3.1:8b',
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'llama3.1:8b' },
    }),
  };
}

function createMockTelegram(): ITelegramService {
  return {
    sendMessage: vi.fn().mockResolvedValue({}),
  };
}

function createMockPreferenceService(): IUserPreferenceService {
  return {
    getPreferences: vi.fn().mockResolvedValue([]),
  };
}

const defaultConfig: ExecutorConfig = {
  targetChatId: 'default-chat',
  defaultTimezone: 'UTC',
  defaultContextMessages: 5,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProactiveExecutorService', () => {
  let executor: ProactiveExecutorService;
  let runRepo: IRunRepository;
  let messageRepo: IMessageRepository;
  let generator: IMessageGenerator;
  let telegram: ITelegramService;
  let preferenceService: IUserPreferenceService;

  beforeEach(() => {
    vi.clearAllMocks();

    runRepo = createMockRunRepo();
    messageRepo = createMockMessageRepo();
    generator = createMockGenerator();
    telegram = createMockTelegram();
    preferenceService = createMockPreferenceService();

    executor = new ProactiveExecutorService(
      runRepo,
      messageRepo,
      generator,
      telegram,
      defaultConfig,
      preferenceService,
    );
  });

  // =========================================================================
  // Successful execution
  // =========================================================================

  describe('Successful execution', () => {
    it('creates run, generates message, sends it, and completes with ok and delivery sent', async () => {
      const job = makeJob();

      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      expect(result.error).toBeUndefined();

      // Run started
      expect(runRepo.startRun).toHaveBeenCalledWith('job-1');

      // Message generated
      expect(generator.generate).toHaveBeenCalledOnce();

      // Sent via Telegram
      expect(telegram.sendMessage).toHaveBeenCalledWith('chat-123', 'Hello!');

      // Run completed with correct args
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'ok',
        generatedMessage: 'Hello!',
        deliveryStatus: 'sent',
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'llama3.1:8b' },
        durationMs: expect.any(Number),
      }));
    });
  });

  // =========================================================================
  // Idle check-in behaviour
  // =========================================================================

  describe('Idle check-in behaviour', () => {
    it('skips when user recently active (non-bot message within threshold)', async () => {
      const job = makeJob({ messageType: 'checkin' });

      // Recent non-bot message from 1 minute ago (well within 12h threshold)
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Hey there',
          createdAt: new Date(Date.now() - 60_000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('skipped');
      expect(generator.generate).not.toHaveBeenCalled();
      expect(telegram.sendMessage).not.toHaveBeenCalled();

      // Run completed as skipped
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'skipped',
        error: 'User is not idle — skipping check-in',
        durationMs: expect.any(Number),
      }));
    });

    it('proceeds when user idle (old message beyond threshold)', async () => {
      const job = makeJob({ messageType: 'checkin' });

      // Old non-bot message from 13 hours ago (beyond 12h threshold)
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Old message',
          createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();
      expect(telegram.sendMessage).toHaveBeenCalledOnce();
    });

    it('treats no messages as idle and proceeds', async () => {
      const job = makeJob({ messageType: 'checkin' });

      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();
      expect(telegram.sendMessage).toHaveBeenCalledOnce();
    });

    it('treats only bot messages as idle and proceeds', async () => {
      const job = makeJob({ messageType: 'checkin' });

      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Bot response',
          createdAt: new Date(Date.now() - 60_000),
          isBot: true,
          chatId: 'chat-123',
          senderId: 'bot-1',
        },
      ]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();
      expect(telegram.sendMessage).toHaveBeenCalledOnce();
    });

    it('uses scheduleValue as idle threshold for "every" schedule type', async () => {
      // 1-hour interval job
      const job = makeJob({
        messageType: 'checkin',
        scheduleType: 'every',
        scheduleValue: '3600000', // 1 hour
      });

      // Message from 30 minutes ago - within 1h threshold, so NOT idle
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Recent msg',
          createdAt: new Date(Date.now() - 30 * 60 * 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('skipped');
    });

    it('skips check-in when 3+ consecutive unanswered sends (backoff)', async () => {
      const job = makeJob({ messageType: 'checkin' });

      // User is idle (very old message — older than all runs)
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Old message',
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      // 3 consecutive successful runs with no user reply after them
      const pastRuns = [
        { status: 'ok', generatedMessage: 'Check-in 3', startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 2', startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 1', startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), completedAt: new Date() },
      ];
      vi.mocked(runRepo.findByJobId!).mockResolvedValue(pastRuns);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('skipped');
      expect(generator.generate).not.toHaveBeenCalled();

      // Check the skip reason mentions backoff
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'skipped',
        error: expect.stringContaining('backoff'),
      }));
    });

    it('proceeds with check-in when fewer than 3 unanswered sends', async () => {
      const job = makeJob({ messageType: 'checkin' });

      // User is idle (very old message)
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Old message',
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      // Only 2 unanswered runs
      const pastRuns = [
        { status: 'ok', generatedMessage: 'Check-in 2', startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 1', startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000), completedAt: new Date() },
      ];
      vi.mocked(runRepo.findByJobId!).mockResolvedValue(pastRuns);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();
    });

    it('resets backoff counter when user replies between runs', async () => {
      const job = makeJob({ messageType: 'checkin' });

      const runTime = Date.now() - 13 * 60 * 60 * 1000;
      // User replied after the second run
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'User reply',
          createdAt: new Date(runTime + 5000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      // 4 runs, but user replied after the 2nd one (breaking the streak)
      const pastRuns = [
        { status: 'ok', generatedMessage: 'Check-in 4', startedAt: new Date(runTime + 10000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 3', startedAt: new Date(runTime), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 2', startedAt: new Date(runTime - 10000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Check-in 1', startedAt: new Date(runTime - 20000), completedAt: new Date() },
      ];
      vi.mocked(runRepo.findByJobId!).mockResolvedValue(pastRuns);

      // isUserIdle is called first — user's last message is old enough
      // then countUnansweredSends uses the same messageRepo
      const result = await executor.executeJob(job);

      // Only 1 unanswered (the most recent), so should proceed
      expect(result.status).toBe('ok');
    });

    it('uses default 12h threshold for cron schedule type', async () => {
      const job = makeJob({
        messageType: 'checkin',
        scheduleType: 'cron',
        scheduleValue: '0 8 * * *',
      });

      // Message from 11 hours ago - within 12h threshold, so NOT idle
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Recent msg',
          createdAt: new Date(Date.now() - 11 * 60 * 60 * 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('skipped');
    });
  });

  // =========================================================================
  // Target chat resolution
  // =========================================================================

  describe('Target chat resolution', () => {
    it('uses job targetChatId when available', async () => {
      const job = makeJob({ targetChatId: 'job-chat-456' });

      await executor.executeJob(job);

      expect(telegram.sendMessage).toHaveBeenCalledWith('job-chat-456', 'Hello!');
    });

    it('falls back to config targetChatId when job has none', async () => {
      const job = makeJob({ targetChatId: null });

      await executor.executeJob(job);

      expect(telegram.sendMessage).toHaveBeenCalledWith('default-chat', 'Hello!');
    });

    it('returns error (does not throw) when neither job nor config has targetChatId', async () => {
      const noTargetConfig: ExecutorConfig = {
        defaultTimezone: 'UTC',
        defaultContextMessages: 5,
      };
      const noTargetExecutor = new ProactiveExecutorService(
        runRepo,
        messageRepo,
        generator,
        telegram,
        noTargetConfig,
      );

      const job = makeJob({ targetChatId: null });

      const result = await noTargetExecutor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toContain('No target chat ID available');
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('Error handling', () => {
    it('catches LLM failure and completes run with error', async () => {
      vi.mocked(generator.generate).mockRejectedValue(new Error('LLM timeout'));

      const job = makeJob();

      const result = await executor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toBe('LLM timeout');

      // Run completed with error status
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'error',
        error: 'LLM timeout',
        durationMs: expect.any(Number),
      }));

      // Telegram should NOT have been called
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('catches Telegram send failure and completes run with error', async () => {
      vi.mocked(telegram.sendMessage).mockRejectedValue(new Error('Telegram API error'));

      const job = makeJob();

      const result = await executor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Telegram API error');

      // Run completed with error status
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'error',
        error: 'Telegram API error',
        durationMs: expect.any(Number),
      }));
    });

    it('never throws, even when startRun fails', async () => {
      vi.mocked(runRepo.startRun).mockRejectedValue(new Error('DB write failed'));

      const job = makeJob();

      const result = await executor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toBe('DB write failed');

      // completeRun should NOT be called because run was never created
      expect(runRepo.completeRun).not.toHaveBeenCalled();
    });

    it('handles completeRun failure gracefully after primary error', async () => {
      vi.mocked(generator.generate).mockRejectedValue(new Error('LLM down'));
      vi.mocked(runRepo.completeRun).mockRejectedValue(new Error('DB unreachable'));

      const job = makeJob();

      // Should still not throw
      const result = await executor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toBe('LLM down');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(generator.generate).mockRejectedValue('string error');

      const job = makeJob();

      const result = await executor.executeJob(job);

      expect(result.status).toBe('error');
      expect(result.error).toBe('string error');
    });
  });

  // =========================================================================
  // Token usage and duration
  // =========================================================================

  describe('Token usage and duration', () => {
    it('records token usage from generator in run completion', async () => {
      const tokenUsage = { promptTokens: 200, completionTokens: 100, totalTokens: 300, model: 'claude-3' };
      vi.mocked(generator.generate).mockResolvedValue({
        message: 'Generated response',
        model: 'claude-3',
        tokenUsage,
      });

      const job = makeJob();

      await executor.executeJob(job);

      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        tokenUsage,
      }));
    });

    it('includes durationMs in successful run completion', async () => {
      const job = makeJob();

      await executor.executeJob(job);

      const completeRunCall = vi.mocked(runRepo.completeRun).mock.calls[0];
      const runResult = completeRunCall[1];

      expect(runResult.durationMs).toBeDefined();
      expect(typeof runResult.durationMs).toBe('number');
      expect(runResult.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes durationMs in error run completion', async () => {
      vi.mocked(generator.generate).mockRejectedValue(new Error('fail'));

      const job = makeJob();

      await executor.executeJob(job);

      const completeRunCall = vi.mocked(runRepo.completeRun).mock.calls[0];
      const runResult = completeRunCall[1];

      expect(runResult.durationMs).toBeDefined();
      expect(typeof runResult.durationMs).toBe('number');
    });

    it('includes durationMs in skipped run completion', async () => {
      const job = makeJob({ messageType: 'checkin' });

      // Recent non-bot message — user is active
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Hello',
          createdAt: new Date(Date.now() - 60_000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      await executor.executeJob(job);

      const completeRunCall = vi.mocked(runRepo.completeRun).mock.calls[0];
      const runResult = completeRunCall[1];

      expect(runResult.durationMs).toBeDefined();
      expect(typeof runResult.durationMs).toBe('number');
    });
  });

  // =========================================================================
  // Context building
  // =========================================================================

  describe('Context building', () => {
    it('includes user preferences when userPreferenceService is available and senderId is set', async () => {
      vi.mocked(preferenceService.getPreferences).mockResolvedValue([
        { category: 'context', key: 'name', value: 'Alex', senderId: 'sender-1' },
        { category: 'general', key: 'language', value: 'en', senderId: 'sender-1' },
      ]);

      const job = makeJob({ targetSenderId: 'sender-1' });

      await executor.executeJob(job);

      expect(preferenceService.getPreferences).toHaveBeenCalledWith('sender-1');

      // Check the context passed to the generator
      const generateCall = vi.mocked(generator.generate).mock.calls[0];
      const context = generateCall[0];

      expect(context.userPreferences).toEqual([
        { key: 'name', value: 'Alex', category: 'context' },
        { key: 'language', value: 'en', category: 'general' },
      ]);
      expect(context.userName).toBe('Alex');
    });

    it('extracts userName from nickname preference when name not present', async () => {
      vi.mocked(preferenceService.getPreferences).mockResolvedValue([
        { category: 'context', key: 'nickname', value: 'Fari', senderId: 'sender-1' },
      ]);

      const job = makeJob({ targetSenderId: 'sender-1' });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.userName).toBe('Fari');
    });

    it('includes recent messages based on contextConfig', async () => {
      const recentMessages = [
        { text: 'Hello', createdAt: new Date(), isBot: false, chatId: 'chat-123', senderId: 'sender-1' },
        { text: 'Hi there!', createdAt: new Date(), isBot: true, chatId: 'chat-123', senderId: 'bot-1' },
      ];

      // First call is for idle check (limit=1 for checkin), second is for context building
      // For non-checkin jobs, only context building call happens
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue(recentMessages);

      const job = makeJob({
        contextConfig: JSON.stringify({ recentMessages: 10 }),
      });

      await executor.executeJob(job);

      // Called with the configured message count
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 10);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.recentConversation).toEqual([
        { text: 'Hello', createdAt: expect.any(Date), isBot: false },
        { text: 'Hi there!', createdAt: expect.any(Date), isBot: true },
      ]);
    });

    it('uses defaultContextMessages when contextConfig has no recentMessages', async () => {
      const job = makeJob({ contextConfig: null });

      await executor.executeJob(job);

      // Called with config default (5)
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 5);
    });

    it('works when userPreferenceService is null', async () => {
      const executorNoPrefs = new ProactiveExecutorService(
        runRepo,
        messageRepo,
        generator,
        telegram,
        defaultConfig,
        null,
      );

      const job = makeJob({ targetSenderId: 'sender-1' });

      const result = await executorNoPrefs.executeJob(job);

      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.userPreferences).toBeUndefined();
      expect(context.userName).toBeUndefined();
    });

    it('does not fetch preferences when targetSenderId is null', async () => {
      const job = makeJob({ targetSenderId: null });

      await executor.executeJob(job);

      expect(preferenceService.getPreferences).not.toHaveBeenCalled();

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.userPreferences).toBeUndefined();
    });

    it('passes customTemplate from job.messageTemplate', async () => {
      const job = makeJob({ messageTemplate: 'Good morning {{name}}!' });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.customTemplate).toBe('Good morning {{name}}!');
    });

    it('sets customTemplate to undefined when messageTemplate is null', async () => {
      const job = makeJob({ messageTemplate: null });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.customTemplate).toBeUndefined();
    });

    it('includes customContext from contextConfig', async () => {
      const job = makeJob({
        contextConfig: JSON.stringify({
          recentMessages: 3,
          customContext: { mood: 'happy', topic: 'productivity' },
        }),
      });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.customContext).toEqual({ mood: 'happy', topic: 'productivity' });
    });

    it('sets correct timezone, messageType, localTime, and dayOfWeek', async () => {
      const job = makeJob({ timezone: 'America/New_York', messageType: 'summary' });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.messageType).toBe('summary');
      expect(context.timezone).toBe('America/New_York');
      expect(context.localTime).toBeInstanceOf(Date);
      expect(typeof context.dayOfWeek).toBe('string');
    });

    it('falls back to config defaultTimezone when job timezone is empty', async () => {
      const job = makeJob({ timezone: '' });

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.timezone).toBe('UTC');
    });

    it('handles preference service failure gracefully', async () => {
      vi.mocked(preferenceService.getPreferences).mockRejectedValue(new Error('DB error'));

      const job = makeJob({ targetSenderId: 'sender-1' });

      const result = await executor.executeJob(job);

      // Should still succeed — preference failure is non-fatal
      expect(result.status).toBe('ok');
      expect(generator.generate).toHaveBeenCalledOnce();

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.userPreferences).toBeUndefined();
    });

    it('includes recent proactive messages in context for repetition avoidance', async () => {
      const pastRuns = [
        { status: 'ok', generatedMessage: 'Good morning! How are you?', startedAt: new Date(Date.now() - 86400000), completedAt: new Date() },
        { status: 'ok', generatedMessage: 'Hey, checking in!', startedAt: new Date(Date.now() - 172800000), completedAt: new Date() },
      ];
      vi.mocked(runRepo.findByJobId!).mockResolvedValue(pastRuns);

      const job = makeJob();

      await executor.executeJob(job);

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.recentProactiveMessages).toHaveLength(2);
      expect(context.recentProactiveMessages![0].text).toBe('Good morning! How are you?');
      expect(context.recentProactiveMessages![1].text).toBe('Hey, checking in!');
    });

    it('handles message repo failure in context building gracefully', async () => {
      // First call succeeds (for idle check or is skipped for non-checkin),
      // but we make all calls fail to simulate context building failure
      vi.mocked(messageRepo.findRecentByChatId).mockRejectedValue(new Error('DB read error'));

      const job = makeJob({ messageType: 'greeting' }); // non-checkin, no idle check

      // The method catches errors during context building, so it should still call generate
      // but with no recentConversation. However, isUserIdle also uses findRecentByChatId
      // only for checkin jobs. For greeting, it goes straight to buildMessageContext.
      // buildMessageContext catches the error internally.
      const result = await executor.executeJob(job);

      expect(result.status).toBe('ok');
      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.recentConversation).toBeUndefined();
    });
  });

  // =========================================================================
  // contextConfig JSON parsing
  // =========================================================================

  describe('contextConfig JSON parsing', () => {
    it('correctly parses valid contextConfig JSON', async () => {
      const job = makeJob({
        contextConfig: JSON.stringify({ recentMessages: 15, customContext: { key: 'value' } }),
      });

      await executor.executeJob(job);

      // Used the parsed recentMessages value
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 15);
    });

    it('handles invalid contextConfig JSON gracefully (falls back to defaults)', async () => {
      const job = makeJob({
        contextConfig: '{ invalid json !!!',
      });

      const result = await executor.executeJob(job);

      // Should still succeed with defaults
      expect(result.status).toBe('ok');

      // Falls back to defaultContextMessages
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 5);
    });

    it('handles null contextConfig', async () => {
      const job = makeJob({ contextConfig: null });

      await executor.executeJob(job);

      // Uses default
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 5);
    });

    it('handles empty string contextConfig', async () => {
      const job = makeJob({ contextConfig: '' });

      await executor.executeJob(job);

      // Empty string is falsy, treated as null
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 5);
    });

    it('uses defaultContextMessages when recentMessages not in contextConfig', async () => {
      const job = makeJob({
        contextConfig: JSON.stringify({ includeMemories: true }),
      });

      await executor.executeJob(job);

      // recentMessages not set, so uses config.defaultContextMessages
      expect(messageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-123', 5);
    });

    it('skips recent message fetch when recentMessages is 0', async () => {
      const job = makeJob({
        contextConfig: JSON.stringify({ recentMessages: 0 }),
      });

      await executor.executeJob(job);

      // When recentMessageCount is 0, the code skips the fetch
      expect(messageRepo.findRecentByChatId).not.toHaveBeenCalled();

      const context = vi.mocked(generator.generate).mock.calls[0][0];
      expect(context.recentConversation).toBeUndefined();
    });
  });

  // =========================================================================
  // executeJob never throws
  // =========================================================================

  describe('executeJob never throws', () => {
    it('returns error result for any synchronous error', async () => {
      // Force resolveTargetChat to throw by having no targetChatId anywhere
      const noTargetConfig: ExecutorConfig = {
        defaultTimezone: 'UTC',
        defaultContextMessages: 5,
      };
      const noTargetExecutor = new ProactiveExecutorService(
        runRepo,
        messageRepo,
        generator,
        telegram,
        noTargetConfig,
      );

      const job = makeJob({ targetChatId: null });

      // Must not throw
      const result = await noTargetExecutor.executeJob(job);
      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });

    it('returns error result for async errors', async () => {
      vi.mocked(runRepo.startRun).mockRejectedValue(new Error('async failure'));

      const job = makeJob();

      const result = await executor.executeJob(job);
      expect(result.status).toBe('error');
      expect(result.error).toBe('async failure');
    });

    it('returns error result for generator errors', async () => {
      vi.mocked(generator.generate).mockRejectedValue(new Error('model not available'));

      const job = makeJob();

      const result = await executor.executeJob(job);
      expect(result.status).toBe('error');
      expect(result.error).toBe('model not available');
    });

    it('returns error result for telegram errors', async () => {
      vi.mocked(telegram.sendMessage).mockRejectedValue(new Error('network timeout'));

      const job = makeJob();

      const result = await executor.executeJob(job);
      expect(result.status).toBe('error');
      expect(result.error).toBe('network timeout');
    });
  });

  // =========================================================================
  // completeRun argument verification
  // =========================================================================

  describe('completeRun arguments', () => {
    it('success: status ok, generatedMessage, deliveryStatus sent, tokenUsage, durationMs', async () => {
      const job = makeJob();

      await executor.executeJob(job);

      expect(runRepo.completeRun).toHaveBeenCalledTimes(1);
      const [runId, result] = vi.mocked(runRepo.completeRun).mock.calls[0];
      expect(runId).toBe('run-1');
      expect(result.status).toBe('ok');
      expect(result.generatedMessage).toBe('Hello!');
      expect(result.deliveryStatus).toBe('sent');
      expect(result.tokenUsage).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // Error should not be present on success
      expect(result.error).toBeUndefined();
    });

    it('skipped: status skipped, error message, durationMs, no generatedMessage or deliveryStatus', async () => {
      const job = makeJob({ messageType: 'checkin' });
      vi.mocked(messageRepo.findRecentByChatId).mockResolvedValue([
        {
          text: 'Active!',
          createdAt: new Date(Date.now() - 1000),
          isBot: false,
          chatId: 'chat-123',
          senderId: 'sender-1',
        },
      ]);

      await executor.executeJob(job);

      expect(runRepo.completeRun).toHaveBeenCalledTimes(1);
      const [runId, result] = vi.mocked(runRepo.completeRun).mock.calls[0];
      expect(runId).toBe('run-1');
      expect(result.status).toBe('skipped');
      expect(result.error).toBe('User is not idle — skipping check-in');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.generatedMessage).toBeUndefined();
      expect(result.deliveryStatus).toBeUndefined();
    });

    it('error: status error, error message, durationMs, no generatedMessage or deliveryStatus', async () => {
      vi.mocked(generator.generate).mockRejectedValue(new Error('boom'));

      const job = makeJob();

      await executor.executeJob(job);

      expect(runRepo.completeRun).toHaveBeenCalledTimes(1);
      const [runId, result] = vi.mocked(runRepo.completeRun).mock.calls[0];
      expect(runId).toBe('run-1');
      expect(result.status).toBe('error');
      expect(result.error).toBe('boom');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.generatedMessage).toBeUndefined();
      expect(result.deliveryStatus).toBeUndefined();
    });

    it('no completeRun call when startRun fails (no run to complete)', async () => {
      vi.mocked(runRepo.startRun).mockRejectedValue(new Error('DB down'));

      const job = makeJob();

      await executor.executeJob(job);

      expect(runRepo.completeRun).not.toHaveBeenCalled();
    });
  });
});
