/**
 * Progress Reporter Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressReporterService } from './progressReporter.service.js';
import type { ExecutionProgressReport } from '../types/plan.types.js';
import type { TelegramService } from './telegram.service.js';

// Mock TelegramService
const createMockTelegramService = () => ({
  sendMessage: vi.fn().mockResolvedValue({ id: 12345 }),
  isConnected: vi.fn().mockReturnValue(true),
});

describe('ProgressReporterService', () => {
  let service: ProgressReporterService;
  let mockTelegram: ReturnType<typeof createMockTelegramService>;

  const createProgress = (overrides: Partial<ExecutionProgressReport> = {}): ExecutionProgressReport => ({
    currentIteration: 5,
    tasksCompleted: 3,
    totalTasks: 10,
    tokensIn: 15000,
    tokensOut: 5000,
    cost: 0.85,
    filesModified: ['src/file1.ts', 'src/file2.ts'],
    lastActivity: new Date().toISOString(),
    ...overrides,
  });

  const createContext = () => ({
    chatId: 'chat-123',
    planId: 'plan-456',
    planTitle: 'Test Plan',
  });

  beforeEach(() => {
    mockTelegram = createMockTelegramService();
    service = new ProgressReporterService();
    service.setTelegramService(mockTelegram as unknown as TelegramService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('formatProgressReport', () => {
    it('should format progress report with all fields', () => {
      const progress = createProgress();
      const formatted = service.formatProgressReport(progress);

      expect(formatted).toContain('[');
      expect(formatted).toContain(']');
      expect(formatted).toContain('%');
      expect(formatted).toContain('Tasks: 3/10');
      expect(formatted).toContain('Iteration: 5');
      expect(formatted).toContain('Tokens:');
      expect(formatted).toContain('Cost: $0.85');
      expect(formatted).toContain('Files modified');
    });

    it('should format token counts with K suffix', () => {
      const progress = createProgress({ tokensIn: 15000, tokensOut: 5000 });
      const formatted = service.formatProgressReport(progress);

      expect(formatted).toContain('15.0K');
      expect(formatted).toContain('5.0K');
    });

    it('should truncate long file paths', () => {
      const progress = createProgress({
        filesModified: ['src/very/long/path/to/some/deeply/nested/file.ts'],
      });
      const formatted = service.formatProgressReport(progress);

      expect(formatted).toContain('...');
    });

    it('should limit files shown based on config', () => {
      const progress = createProgress({
        filesModified: [
          'src/file1.ts',
          'src/file2.ts',
          'src/file3.ts',
          'src/file4.ts',
          'src/file5.ts',
          'src/file6.ts',
          'src/file7.ts',
        ],
      });
      const formatted = service.formatProgressReport(progress);

      expect(formatted).toContain('... and 2 more');
    });

    it('should show errors if present', () => {
      const progress = createProgress({
        errors: ['Error 1', 'Error 2'],
      });
      const formatted = service.formatProgressReport(progress);

      expect(formatted).toContain('Errors: 2');
      expect(formatted).toContain('Error 1');
    });

    it('should handle zero values gracefully', () => {
      const progress = createProgress({
        currentIteration: 0,
        tasksCompleted: 0,
        totalTasks: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        filesModified: [],
      });
      const formatted = service.formatProgressReport(progress);

      // When totalTasks is 0, it shows '?' as placeholder
      expect(formatted).toContain('Tasks: 0/?');
      expect(formatted).toContain('Iteration: 0');
      expect(formatted).not.toContain('Files modified');
    });
  });

  describe('createProgressBar', () => {
    it('should create progress bar at 0%', () => {
      const bar = service.createProgressBar(0, 10);
      expect(bar).toBe('[░░░░░░░░░░] 0%');
    });

    it('should create progress bar at 50%', () => {
      const bar = service.createProgressBar(5, 10);
      expect(bar).toBe('[█████░░░░░] 50%');
    });

    it('should create progress bar at 100%', () => {
      const bar = service.createProgressBar(10, 10);
      expect(bar).toBe('[██████████] 100%');
    });

    it('should handle total of 0', () => {
      const bar = service.createProgressBar(0, 0);
      expect(bar).toBe('[░░░░░░░░░░] 0%');
    });
  });

  describe('sendProgressUpdate', () => {
    it('should send first progress update immediately', async () => {
      const context = createContext();
      const progress = createProgress();

      const result = await service.sendProgressUpdate(context, progress);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(12345);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.any(String)
      );
    });

    it('should throttle subsequent updates', async () => {
      const context = createContext();
      const progress = createProgress();

      // First call should send
      await service.sendProgressUpdate(context, progress);

      // Second call should be throttled
      const result = await service.sendProgressUpdate(context, progress);

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should allow update when task count increases (milestone)', async () => {
      const context = createContext();
      const progress1 = createProgress({ tasksCompleted: 3 });
      const progress2 = createProgress({ tasksCompleted: 4 });

      // First call
      await service.sendProgressUpdate(context, progress1);

      // Second call with increased tasks - should not be throttled
      await service.sendProgressUpdate(context, progress2);

      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle telegram service not configured', async () => {
      const serviceWithoutTelegram = new ProgressReporterService();
      const context = createContext();
      const progress = createProgress();

      const result = await serviceWithoutTelegram.sendProgressUpdate(context, progress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('TelegramService not configured');
    });

    it('should handle telegram send failure gracefully', async () => {
      mockTelegram.sendMessage.mockRejectedValue(new Error('Network error'));
      const context = createContext();
      const progress = createProgress();

      const result = await service.sendProgressUpdate(context, progress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('sendMilestoneNotification', () => {
    it('should send milestone notification with milestone text', async () => {
      const context = createContext();
      const progress = createProgress();
      const milestone = 'Task "Update API" completed';

      const result = await service.sendMilestoneNotification(context, progress, milestone);

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining(milestone)
      );
    });
  });

  describe('sendErrorNotification', () => {
    it('should send error notification with error message', async () => {
      const context = createContext();
      const progress = createProgress();
      const errorMessage = 'Build failed with exit code 1';

      const result = await service.sendErrorNotification(context, progress, errorMessage);

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining(errorMessage)
      );
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining('Error during execution')
      );
    });
  });

  describe('sendCompletionNotification', () => {
    it('should send completion notification for completed status', async () => {
      const context = createContext();
      const progress = createProgress();

      const result = await service.sendCompletionNotification(context, progress, 'completed');

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining('Execution completed successfully')
      );
    });

    it('should send completion notification for failed status', async () => {
      const context = createContext();
      const progress = createProgress();

      const result = await service.sendCompletionNotification(context, progress, 'failed');

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining('Execution failed')
      );
    });

    it('should send completion notification for cancelled status', async () => {
      const context = createContext();
      const progress = createProgress();

      const result = await service.sendCompletionNotification(context, progress, 'cancelled');

      expect(result.success).toBe(true);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        context.chatId,
        expect.stringContaining('Execution was cancelled')
      );
    });

    it('should clear plan state after completion', async () => {
      const context = createContext();
      const progress = createProgress();

      // Send first update to set state
      await service.sendProgressUpdate(context, progress);

      // Send completion
      await service.sendCompletionNotification(context, progress, 'completed');

      // Next progress update should send (state was cleared)
      mockTelegram.sendMessage.mockClear();
      await service.sendProgressUpdate(context, progress);

      expect(mockTelegram.sendMessage).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should respect milestoneOnly config', async () => {
      const configuredService = new ProgressReporterService({
        milestoneOnly: true,
      });
      configuredService.setTelegramService(mockTelegram as unknown as TelegramService);

      const context = createContext();
      const progress1 = createProgress({ tasksCompleted: 3 });
      const progress2 = createProgress({ tasksCompleted: 3, currentIteration: 10 });

      // First call should send
      await configuredService.sendProgressUpdate(context, progress1);
      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(1);

      // Second call should be skipped (no milestone, same task count)
      await configuredService.sendProgressUpdate(context, progress2);
      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(1);

      // Third call with milestone should send
      const progress3 = createProgress({ tasksCompleted: 4 });
      await configuredService.sendProgressUpdate(context, progress3);
      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('should respect includeTokenUsage config', () => {
      const configuredService = new ProgressReporterService({
        includeTokenUsage: false,
      });

      const progress = createProgress({ tokensIn: 15000, tokensOut: 5000 });
      const formatted = configuredService.formatProgressReport(progress);

      expect(formatted).not.toContain('Tokens:');
    });

    it('should respect includeCost config', () => {
      const configuredService = new ProgressReporterService({
        includeCost: false,
      });

      const progress = createProgress({ cost: 1.50 });
      const formatted = configuredService.formatProgressReport(progress);

      expect(formatted).not.toContain('Cost:');
    });

    it('should respect includeFilesModified config', () => {
      const configuredService = new ProgressReporterService({
        includeFilesModified: false,
      });

      const progress = createProgress({
        filesModified: ['src/file1.ts', 'src/file2.ts'],
      });
      const formatted = configuredService.formatProgressReport(progress);

      expect(formatted).not.toContain('Files modified');
    });
  });

  describe('message ID tracking', () => {
    it('should store and retrieve progress message ID', () => {
      const planId = 'plan-123';
      const messageId = 99999;

      service.setProgressMessageId(planId, messageId);
      const retrieved = service.getProgressMessageId(planId);

      expect(retrieved).toBe(messageId);
    });

    it('should return undefined for unknown plan', () => {
      const retrieved = service.getProgressMessageId('unknown-plan');
      expect(retrieved).toBeUndefined();
    });

    it('should clear message ID on plan state clear', () => {
      const planId = 'plan-123';
      service.setProgressMessageId(planId, 99999);
      service.clearPlanState(planId);

      const retrieved = service.getProgressMessageId(planId);
      expect(retrieved).toBeUndefined();
    });
  });
});
