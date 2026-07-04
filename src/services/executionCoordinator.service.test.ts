/**
 * Integration tests for ExecutionCoordinatorService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionCoordinatorService } from './executionCoordinator.service';
import path from 'path';
import fs from 'fs';

// Mock dependencies
vi.mock('../repositories/index.js', () => ({
  planRepository: {
    findById: vi.fn(),
    transitionState: vi.fn(),
    update: vi.fn(),
  },
  planExecutionRepository: {
    create: vi.fn(),
    findLatestByPlanId: vi.fn(),
    findRunning: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
  },
}));

vi.mock('./planManagement.service.js', () => ({
  planManagementService: {
    startExecution: vi.fn(),
    completePlan: vi.fn(),
    failPlan: vi.fn(),
  },
}));

vi.mock('../utils/loopLogParser.js', () => ({
  parseLoopLog: vi.fn(() => ({
    totalIterations: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalCost: 0,
    entries: [],
  })),
  parseLoopLogIncremental: vi.fn(() => Promise.resolve({
    metrics: {
      totalIterations: 1,
      totalTokensIn: 1000,
      totalTokensOut: 500,
      totalCacheRead: 500,
      totalCacheWrite: 0,
      totalCost: 0.05,
      entries: [],
    },
    lastLine: 100,
  })),
}));

vi.mock('../utils/implMdParser.js', () => ({
  parseImplMd: vi.fn(() => ({
    title: 'Test Plan',
    status: 'executing',
    createdDate: '2024-01-01',
    lastUpdated: '2024-01-01',
    objective: 'Test objective',
    context: 'Test context',
    tasks: [
      { description: 'Task 1', completed: true, subtasks: [] },
      { description: 'Task 2', completed: false, subtasks: [] },
    ],
    progress: [],
    filesModified: ['src/test.ts'],
    notes: '',
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { planRepository, planExecutionRepository } from '../repositories/index.js';
import { planManagementService } from './planManagement.service.js';

describe('ExecutionCoordinatorService', () => {
  let service: ExecutionCoordinatorService;
  const mockLoopDir = path.join(process.cwd(), 'loop');

  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(mockLoopDir, { recursive: true });
    service = new ExecutionCoordinatorService({
      loopDir: mockLoopDir,
      progressIntervalMs: 1000,
    });
  });

  afterEach(() => {
    // Clean up any BREAK files
    const breakPath = path.join(mockLoopDir, 'BREAK');
    if (fs.existsSync(breakPath)) {
      fs.unlinkSync(breakPath);
    }
  });

  describe('BREAK signal mechanism', () => {
    it('should create BREAK file when signalBreak is called', () => {
      const breakPath = path.join(mockLoopDir, 'BREAK');

      // Ensure BREAK file doesn't exist
      if (fs.existsSync(breakPath)) {
        fs.unlinkSync(breakPath);
      }

      service.signalBreak();

      expect(fs.existsSync(breakPath)).toBe(true);
    });

    it('should detect BREAK file correctly', () => {
      const breakPath = path.join(mockLoopDir, 'BREAK');

      // Ensure BREAK file doesn't exist first
      if (fs.existsSync(breakPath)) {
        fs.unlinkSync(breakPath);
      }
      expect(service.isBreakSignaled()).toBe(false);

      // Create BREAK file
      fs.writeFileSync(breakPath, '');
      expect(service.isBreakSignaled()).toBe(true);
    });

    it('should remove BREAK file when removeBreakFile is called', () => {
      const breakPath = path.join(mockLoopDir, 'BREAK');

      // Create BREAK file
      fs.writeFileSync(breakPath, '');
      expect(fs.existsSync(breakPath)).toBe(true);

      service.removeBreakFile();
      expect(fs.existsSync(breakPath)).toBe(false);
    });
  });

  describe('startExecution', () => {
    it('should reject if plan is not found', async () => {
      vi.mocked(planRepository.findById).mockResolvedValue(null);

      const result = await service.startExecution({ planId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Plan not found');
    });

    it('should reject if plan is not in approved state', async () => {
      vi.mocked(planRepository.findById).mockResolvedValue({
        id: 'plan-1',
        title: 'Test Plan',
        content: 'Test content',
        state: 'feedback',
        version: 1,
        createdBy: null,
        chatId: null,
        metadata: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        completedAt: null,
      });

      const result = await service.startExecution({ planId: 'plan-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('approved');
    });

    it('should reject if plan is already being executed', async () => {
      vi.mocked(planRepository.findById).mockResolvedValue({
        id: 'plan-1',
        title: 'Test Plan',
        content: 'Test content',
        state: 'approved',
        version: 1,
        createdBy: null,
        chatId: null,
        metadata: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: new Date(),
        completedAt: null,
      });

      vi.mocked(planManagementService.startExecution).mockResolvedValue({
        plan: null,
        success: true,
      });

      vi.mocked(planExecutionRepository.create).mockResolvedValue({
        id: 'exec-1',
        planId: 'plan-1',
        sessionId: 'session-1',
        status: 'running',
        promptFile: null,
        loopLogPath: null,
        startedAt: new Date(),
        completedAt: null,
        totalIterations: 0,
        currentIteration: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        progressReport: '{}',
      });

      // Manually add to active executions (simulating already running)
      // @ts-expect-error - accessing private map for testing
      service.activeExecutions.set('plan-1', {
        planId: 'plan-1',
        executionId: 'exec-1',
        sessionId: 'session-1',
        loopLogPath: '',
        workingDirectory: '',
        lastLogLine: 0,
        process: null as any,
      });

      const result = await service.startExecution({ planId: 'plan-1' });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Plan is already being executed');
    });
  });

  describe('getProgress', () => {
    it('should return null if no execution exists', async () => {
      vi.mocked(planExecutionRepository.findLatestByPlanId).mockResolvedValue(null);

      const progress = await service.getProgress('nonexistent');

      expect(progress).toBeNull();
    });

    it('should return parsed progress from database for completed execution', async () => {
      const mockProgress = {
        currentIteration: 5,
        tasksCompleted: 3,
        totalTasks: 5,
        tokensIn: 10000,
        tokensOut: 5000,
        cost: 1.25,
        filesModified: ['src/test.ts'],
      };

      vi.mocked(planExecutionRepository.findLatestByPlanId).mockResolvedValue({
        id: 'exec-1',
        planId: 'plan-1',
        sessionId: 'session-1',
        status: 'completed',
        promptFile: null,
        loopLogPath: null,
        startedAt: new Date(),
        completedAt: new Date(),
        totalIterations: 5,
        currentIteration: 5,
        totalTokensIn: 10000,
        totalTokensOut: 5000,
        totalCost: 1.25,
        progressReport: JSON.stringify(mockProgress),
      });

      const progress = await service.getProgress('plan-1');

      expect(progress).toEqual(mockProgress);
    });
  });

  describe('isExecutionActive', () => {
    it('should return false if no active execution', () => {
      expect(service.isExecutionActive('plan-1')).toBe(false);
    });
  });

  describe('getActiveExecutions', () => {
    it('should return empty array if no active executions', () => {
      expect(service.getActiveExecutions()).toEqual([]);
    });
  });

  describe('recoverCrashedExecutions', () => {
    it('should recover orphaned running executions', async () => {
      vi.mocked(planExecutionRepository.findRunning).mockResolvedValue([
        {
          id: 'exec-1',
          planId: 'plan-1',
          sessionId: 'session-1',
          status: 'running',
          promptFile: null,
          loopLogPath: null,
          startedAt: new Date(Date.now() - 3600000), // 1 hour ago
          completedAt: null,
          totalIterations: 0,
          currentIteration: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalCost: 0,
          progressReport: '{}',
        },
      ]);

      vi.mocked(planExecutionRepository.markFailed).mockResolvedValue({
        id: 'exec-1',
        planId: 'plan-1',
        sessionId: 'session-1',
        status: 'failed',
        promptFile: null,
        loopLogPath: null,
        startedAt: new Date(Date.now() - 3600000),
        completedAt: new Date(),
        totalIterations: 0,
        currentIteration: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        progressReport: '{}',
      });

      vi.mocked(planManagementService.failPlan).mockResolvedValue({
        plan: null,
        success: true,
      });

      const recoveredCount = await service.recoverCrashedExecutions();

      expect(recoveredCount).toBe(1);
      expect(planExecutionRepository.markFailed).toHaveBeenCalledWith(
        'exec-1',
        expect.stringContaining('service restarted')
      );
      expect(planManagementService.failPlan).toHaveBeenCalledWith(
        'plan-1',
        'Execution interrupted by service restart'
      );
    });

    it('should return 0 if no orphaned executions', async () => {
      vi.mocked(planExecutionRepository.findRunning).mockResolvedValue([]);

      const recoveredCount = await service.recoverCrashedExecutions();

      expect(recoveredCount).toBe(0);
    });
  });

  describe('stopExecution', () => {
    it('should return error if no active execution found', async () => {
      const result = await service.stopExecution('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('No active execution found for this plan');
    });
  });

  describe('killExecution', () => {
    it('should return error if no active execution found', async () => {
      const result = await service.killExecution('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('No active execution found for this plan');
    });
  });
});
