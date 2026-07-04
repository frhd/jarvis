/**
 * Plan Management Service Tests
 *
 * Unit tests for plan creation, updates, state transitions, and feedback handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger first (this gets hoisted)
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the error classes
vi.mock('../errors/error-classes.js', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string, options?: object) {
      super(message);
      this.code = code;
    }
  },
}));

// Mock repositories with factory function
vi.mock('../repositories/index.js', () => {
  const mockPlanRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByChatId: vi.fn(),
    findByCreatedBy: vi.fn(),
    findByState: vi.fn(),
    findActivePlan: vi.fn(),
    transitionState: vi.fn(),
    incrementVersion: vi.fn(),
    markApproved: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };

  const mockPlanExecutionRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByPlanId: vi.fn(),
    findBySessionId: vi.fn(),
    findLatestByPlanId: vi.fn(),
    findRunning: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
  };

  const mockPlanFeedbackRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByPlanId: vi.fn(),
    findByPlanVersion: vi.fn(),
    getLatestFeedback: vi.fn(),
    countByPlanId: vi.fn(),
  };

  return {
    planRepository: mockPlanRepository,
    planExecutionRepository: mockPlanExecutionRepository,
    planFeedbackRepository: mockPlanFeedbackRepository,
  };
});

// Import after mocking
import { PlanManagementService } from './planManagement.service.js';
import {
  planRepository,
  planExecutionRepository,
  planFeedbackRepository,
} from '../repositories/index.js';
import type { Plan, PlanExecution, PlanFeedbackRecord } from '../types/index.js';
import type { PlanState } from '../db/schema.js';

// Get mocked repositories for type assertions
const mockPlanRepo = vi.mocked(planRepository);
const mockExecRepo = vi.mocked(planExecutionRepository);
const mockFeedbackRepo = vi.mocked(planFeedbackRepository);

// Test data factory
function createMockPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'test-plan-1',
    title: 'Test Plan',
    content: '# Test Plan\n\n## Objective\nTest objective',
    state: 'proposing' as PlanState,
    version: 1,
    createdBy: 'sender-1',
    chatId: 'chat-1',
    metadata: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function createMockExecution(overrides: Partial<PlanExecution> = {}): PlanExecution {
  return {
    id: 'test-exec-1',
    planId: 'test-plan-1',
    sessionId: 'session-1',
    status: 'running',
    promptFile: '/path/to/prompt.md',
    loopLogPath: '/path/to/loop.log',
    startedAt: new Date(),
    completedAt: null,
    totalIterations: 0,
    currentIteration: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCost: 0,
    progressReport: '{}',
    ...overrides,
  };
}

function createMockFeedback(overrides: Partial<PlanFeedbackRecord> = {}): PlanFeedbackRecord {
  return {
    id: 'test-fb-1',
    planId: 'test-plan-1',
    senderId: 'sender-1',
    feedback: 'Add more details to task 2',
    version: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PlanManagementService', () => {
  let service: PlanManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanManagementService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Plan Creation Tests
  // ===========================================================================

  describe('createPlan()', () => {
    it('should create a new plan successfully', async () => {
      const mockPlan = createMockPlan();
      const mockUpdatedPlan = createMockPlan({ state: 'feedback' });

      mockPlanRepo.findActivePlan.mockResolvedValue(null);
      mockPlanRepo.create.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(mockUpdatedPlan);

      const result = await service.createPlan({
        title: 'Test Plan',
        content: '# Test Plan\n\n## Objective\nTest objective',
        createdBy: 'sender-1',
        chatId: 'chat-1',
      });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.state).toBe('feedback');
      expect(mockPlanRepo.create).toHaveBeenCalledTimes(1);
      expect(mockPlanRepo.transitionState).toHaveBeenCalledWith(mockPlan.id, 'feedback');
    });

    it('should fail if an active plan already exists for the chat', async () => {
      const existingPlan = createMockPlan({ title: 'Existing Plan' });
      mockPlanRepo.findActivePlan.mockResolvedValue(existingPlan);

      const result = await service.createPlan({
        title: 'New Plan',
        content: 'Content',
        chatId: 'chat-1',
      });

      expect(result.success).toBe(false);
      expect(result.plan).toBeNull();
      expect(result.message).toContain('active plan already exists');
      expect(mockPlanRepo.create).not.toHaveBeenCalled();
    });

    it('should allow creating a plan without a chatId', async () => {
      const mockPlan = createMockPlan({ chatId: null });
      const mockUpdatedPlan = createMockPlan({ chatId: null, state: 'feedback' });

      mockPlanRepo.findActivePlan.mockResolvedValue(null);
      mockPlanRepo.create.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(mockUpdatedPlan);

      const result = await service.createPlan({
        title: 'Standalone Plan',
        content: 'Content',
      });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
    });
  });

  // ===========================================================================
  // Plan Retrieval Tests
  // ===========================================================================

  describe('getPlan()', () => {
    it('should return a plan by ID', async () => {
      const mockPlan = createMockPlan();
      mockPlanRepo.findById.mockResolvedValue(mockPlan);

      const result = await service.getPlan('test-plan-1');

      expect(result).toEqual(mockPlan);
      expect(mockPlanRepo.findById).toHaveBeenCalledWith('test-plan-1');
    });

    it('should return null for non-existent plan', async () => {
      mockPlanRepo.findById.mockResolvedValue(null);

      const result = await service.getPlan('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getPlanWithFeedback()', () => {
    it('should return plan with feedback history', async () => {
      const mockPlan = createMockPlan();
      const mockFeedback = [
        createMockFeedback({ version: 1 }),
        createMockFeedback({ id: 'fb-2', version: 2, feedback: 'More changes' }),
      ];

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockFeedbackRepo.findByPlanId.mockResolvedValue(mockFeedback);

      const result = await service.getPlanWithFeedback('test-plan-1');

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.feedbackHistory).toHaveLength(2);
    });

    it('should return failure for non-existent plan', async () => {
      mockPlanRepo.findById.mockResolvedValue(null);

      const result = await service.getPlanWithFeedback('non-existent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Plan not found');
    });
  });

  describe('getActivePlan()', () => {
    it('should return active plan for chat', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      mockPlanRepo.findActivePlan.mockResolvedValue(mockPlan);

      const result = await service.getActivePlan('chat-1');

      expect(result).toEqual(mockPlan);
      expect(mockPlanRepo.findActivePlan).toHaveBeenCalledWith('chat-1');
    });

    it('should return null when no active plan', async () => {
      mockPlanRepo.findActivePlan.mockResolvedValue(null);

      const result = await service.getActivePlan('chat-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Plan Update Tests
  // ===========================================================================

  describe('updatePlanContent()', () => {
    it('should update plan content in feedback state', async () => {
      const mockPlan = createMockPlan({ state: 'feedback' });
      const updatedPlan = createMockPlan({ state: 'feedback', title: 'Updated Title' });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.update.mockResolvedValue(updatedPlan);

      const result = await service.updatePlanContent('test-plan-1', {
        title: 'Updated Title',
      });

      expect(result.success).toBe(true);
      expect(mockPlanRepo.update).toHaveBeenCalled();
    });

    it('should fail to update plan in executing state', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      mockPlanRepo.findById.mockResolvedValue(mockPlan);

      const result = await service.updatePlanContent('test-plan-1', {
        title: 'New Title',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot update plan in executing state');
      expect(mockPlanRepo.update).not.toHaveBeenCalled();
    });

    it('should fail for non-existent plan', async () => {
      mockPlanRepo.findById.mockResolvedValue(null);

      const result = await service.updatePlanContent('non-existent', {
        title: 'New Title',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Plan not found');
    });
  });

  // ===========================================================================
  // Feedback Tests
  // ===========================================================================

  describe('addFeedback()', () => {
    it('should add feedback and increment version', async () => {
      const mockPlan = createMockPlan({ state: 'feedback', version: 1 });
      const updatedPlan = createMockPlan({ state: 'feedback', version: 2 });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockFeedbackRepo.create.mockResolvedValue(createMockFeedback());
      mockPlanRepo.incrementVersion.mockResolvedValue(updatedPlan);

      const result = await service.addFeedback(
        'test-plan-1',
        'sender-1',
        'Please add more details'
      );

      expect(result.success).toBe(true);
      expect(result.plan?.version).toBe(2);
      expect(mockFeedbackRepo.create).toHaveBeenCalledWith({
        planId: 'test-plan-1',
        senderId: 'sender-1',
        feedback: 'Please add more details',
        version: 1,
      });
    });

    it('should fail to add feedback when not in feedback state', async () => {
      const mockPlan = createMockPlan({ state: 'approved' });
      mockPlanRepo.findById.mockResolvedValue(mockPlan);

      const result = await service.addFeedback(
        'test-plan-1',
        'sender-1',
        'Feedback text'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot add feedback when plan is in approved state');
      expect(mockFeedbackRepo.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // State Transition Tests
  // ===========================================================================

  describe('transitionState()', () => {
    it('should allow valid transition from feedback to approved', async () => {
      const mockPlan = createMockPlan({ state: 'feedback' });
      const approvedPlan = createMockPlan({ state: 'approved', approvedAt: new Date() });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(approvedPlan);

      const result = await service.transitionState('test-plan-1', 'approved');

      expect(result.success).toBe(true);
      expect(result.previousState).toBe('feedback');
      expect(result.newState).toBe('approved');
    });

    it('should reject invalid transition from proposing to executing', async () => {
      const mockPlan = createMockPlan({ state: 'proposing' });
      mockPlanRepo.findById.mockResolvedValue(mockPlan);

      const result = await service.transitionState('test-plan-1', 'executing');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid transition');
      expect(mockPlanRepo.transitionState).not.toHaveBeenCalled();
    });

    it('should allow transition from approved to executing', async () => {
      const mockPlan = createMockPlan({ state: 'approved' });
      const executingPlan = createMockPlan({ state: 'executing' });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(executingPlan);

      const result = await service.transitionState('test-plan-1', 'executing');

      expect(result.success).toBe(true);
      expect(result.newState).toBe('executing');
    });

    it('should fail for non-existent plan', async () => {
      mockPlanRepo.findById.mockResolvedValue(null);

      const result = await service.transitionState('non-existent', 'approved');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Plan not found');
    });
  });

  describe('approvePlan()', () => {
    it('should approve a plan in feedback state', async () => {
      const mockPlan = createMockPlan({ state: 'feedback' });
      const approvedPlan = createMockPlan({ state: 'approved' });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(approvedPlan);

      const result = await service.approvePlan('test-plan-1');

      expect(result.success).toBe(true);
      expect(mockPlanRepo.transitionState).toHaveBeenCalledWith('test-plan-1', 'approved');
    });
  });

  describe('completePlan()', () => {
    it('should mark executing plan as completed', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      const completedPlan = createMockPlan({ state: 'completed', completedAt: new Date() });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(completedPlan);

      const result = await service.completePlan('test-plan-1');

      expect(result.success).toBe(true);
      expect(mockPlanRepo.transitionState).toHaveBeenCalledWith('test-plan-1', 'completed');
    });
  });

  describe('failPlan()', () => {
    it('should mark plan as failed with reason', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      const failedPlan = createMockPlan({ state: 'failed' });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.transitionState.mockResolvedValue(failedPlan);
      mockPlanRepo.update.mockResolvedValue(failedPlan);

      const result = await service.failPlan('test-plan-1', 'Execution timeout');

      expect(result.success).toBe(true);
      expect(mockPlanRepo.transitionState).toHaveBeenCalledWith('test-plan-1', 'failed');
      // Should update metadata with failure reason
      expect(mockPlanRepo.update).toHaveBeenCalled();
    });
  });

  describe('cancelPlan()', () => {
    it('should cancel an executing plan and mark executions as cancelled', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      const failedPlan = createMockPlan({ state: 'failed' });
      const runningExecution = createMockExecution({ status: 'running' });

      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockExecRepo.findByPlanId.mockResolvedValue([runningExecution]);
      mockExecRepo.markCancelled.mockResolvedValue(runningExecution);
      mockPlanRepo.transitionState.mockResolvedValue(failedPlan);

      const result = await service.cancelPlan('test-plan-1');

      expect(result.success).toBe(true);
      expect(mockExecRepo.markCancelled).toHaveBeenCalledWith('test-exec-1');
    });
  });

  // ===========================================================================
  // Query Tests
  // ===========================================================================

  describe('getPlansByChatId()', () => {
    it('should return plans for a chat', async () => {
      const mockPlans = [createMockPlan(), createMockPlan({ id: 'plan-2' })];
      mockPlanRepo.findByChatId.mockResolvedValue(mockPlans);

      const result = await service.getPlansByChatId('chat-1');

      expect(result).toHaveLength(2);
      expect(mockPlanRepo.findByChatId).toHaveBeenCalledWith('chat-1', undefined);
    });

    it('should respect limit parameter', async () => {
      mockPlanRepo.findByChatId.mockResolvedValue([createMockPlan()]);

      await service.getPlansByChatId('chat-1', 5);

      expect(mockPlanRepo.findByChatId).toHaveBeenCalledWith('chat-1', 5);
    });
  });

  describe('getPlansByState()', () => {
    it('should return plans by state', async () => {
      const executingPlans = [createMockPlan({ state: 'executing' })];
      mockPlanRepo.findByState.mockResolvedValue(executingPlans);

      const result = await service.getPlansByState('executing');

      expect(result).toHaveLength(1);
      expect(mockPlanRepo.findByState).toHaveBeenCalledWith('executing');
    });
  });

  // ===========================================================================
  // Deletion Tests
  // ===========================================================================

  describe('deletePlan()', () => {
    it('should delete a completed plan', async () => {
      const mockPlan = createMockPlan({ state: 'completed' });
      mockPlanRepo.findById.mockResolvedValue(mockPlan);
      mockPlanRepo.delete.mockResolvedValue(true);

      const result = await service.deletePlan('test-plan-1');

      expect(result).toBe(true);
      expect(mockPlanRepo.delete).toHaveBeenCalledWith('test-plan-1');
    });

    it('should not delete an executing plan', async () => {
      const mockPlan = createMockPlan({ state: 'executing' });
      mockPlanRepo.findById.mockResolvedValue(mockPlan);

      const result = await service.deletePlan('test-plan-1');

      expect(result).toBe(false);
      expect(mockPlanRepo.delete).not.toHaveBeenCalled();
    });

    it('should return false for non-existent plan', async () => {
      mockPlanRepo.findById.mockResolvedValue(null);

      const result = await service.deletePlan('non-existent');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Execution Tests
  // ===========================================================================

  describe('getCurrentExecution()', () => {
    it('should return the latest execution for a plan', async () => {
      const mockExecution = createMockExecution();
      mockExecRepo.findLatestByPlanId.mockResolvedValue(mockExecution);

      const result = await service.getCurrentExecution('test-plan-1');

      expect(result).toEqual(mockExecution);
    });

    it('should return null when no executions exist', async () => {
      mockExecRepo.findLatestByPlanId.mockResolvedValue(null);

      const result = await service.getCurrentExecution('test-plan-1');

      expect(result).toBeNull();
    });
  });

  describe('getPlanExecutions()', () => {
    it('should return all executions for a plan', async () => {
      const executions = [
        createMockExecution({ id: 'exec-1' }),
        createMockExecution({ id: 'exec-2', status: 'completed' }),
      ];
      mockExecRepo.findByPlanId.mockResolvedValue(executions);

      const result = await service.getPlanExecutions('test-plan-1');

      expect(result).toHaveLength(2);
    });
  });
});
