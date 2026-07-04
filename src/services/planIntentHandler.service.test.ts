/**
 * Plan Intent Handler Service Tests
 *
 * Unit tests for intent-driven plan workflow operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock plan prompts
vi.mock('../config/prompts/plan-prompts.js', () => ({
  PLAN_PROPOSAL_SYSTEM_PROMPT: 'Mock system prompt for proposals',
  PLAN_FEEDBACK_SYSTEM_PROMPT: 'Mock system prompt for feedback',
  PLAN_PROMPTS: {
    propose: (request: string) => `Create plan for: ${request}`,
    feedback: (current: string, feedback: string) => `Update plan: ${current}\n\nFeedback: ${feedback}`,
    formatPlanDisplay: (title: string, content: string, state: string, version: number) =>
      `📋 **${title}** (v${version})\n**Status**: ${state}\n\n${content}`,
    formatProgressDisplay: (progress: any) =>
      `Progress: ${progress.tasksCompleted}/${progress.totalTasks}`,
    formatCompletionReport: (plan: any, progress: any) =>
      `Completed: ${plan.title}`,
  },
  PLAN_RESPONSES: {
    noActivePlan: "You don't have an active plan.",
    activePlanExists: (title: string) => `Active plan exists: ${title}`,
    planCreated: (title: string) => `Plan created: ${title}`,
    feedbackApplied: (version: number) => `Feedback applied (v${version})`,
    planApproved: (title: string) => `Plan approved: ${title}`,
    executionStarted: (title: string) => `Execution started: ${title}`,
    executionAlreadyRunning: (title: string) => `Already running: ${title}`,
    cannotExecute: (state: string) => `Cannot execute in ${state} state`,
    planCancelled: (title: string) => `Plan cancelled: ${title}`,
    executionStopped: (title: string) => `Execution stopped: ${title}`,
    noPlansFound: 'No plans found.',
    error: (msg: string) => `Error: ${msg}`,
  },
  formatPlanState: (state: string) => state.toUpperCase(),
}));

// Mock plan management service - must be defined inside factory
vi.mock('./planManagement.service.js', () => ({
  planManagementService: {
    createPlan: vi.fn(),
    getPlan: vi.fn(),
    getActivePlan: vi.fn(),
    updatePlanContent: vi.fn(),
    addFeedback: vi.fn(),
    approvePlan: vi.fn(),
    startExecution: vi.fn(),
    cancelPlan: vi.fn(),
    getPlansByChatId: vi.fn(),
    getPlanWithFeedback: vi.fn(),
  },
}));

// Mock execution coordinator service
vi.mock('./executionCoordinator.service.js', () => ({
  executionCoordinatorService: {
    startExecution: vi.fn(),
    stopExecution: vi.fn(),
    getProgress: vi.fn(),
    isExecutionActive: vi.fn(),
    setCompletionCallback: vi.fn(),
  },
}));

// Import after mocking
import { PlanIntentHandlerService } from './planIntentHandler.service.js';
import { planManagementService } from './planManagement.service.js';
import { executionCoordinatorService } from './executionCoordinator.service.js';
import type { Message, Chat, Sender, Plan } from '../types/index.js';
import type { PlanIntent } from '../types/intent.types.js';
import type { PlanState } from '../db/schema.js';

// Get mocked services for type assertions
const mockPlanManagementService = vi.mocked(planManagementService);
const mockExecutionCoordinatorService = vi.mocked(executionCoordinatorService);

// Create mock ClaudeClient
const mockClaudeClient = {
  chat: vi.fn(),
  runAgent: vi.fn(),
};

// Test data factories
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'sender-1',
    text: 'test message',
    date: new Date(),
    isBot: false,
    mediaType: null,
    mediaPath: null,
    replyToMessageId: null,
    forwardFromId: null,
    views: null,
    editDate: null,
    createdAt: new Date(),
    transcriptStatus: null,
    transcript: null,
    transcriptLanguage: null,
    transcriptDurationMs: null,
    transcriptError: null,
    ...overrides,
  } as Message;
}

function createMockChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    title: 'Test Chat',
    type: 'private',
    createdAt: new Date(),
    ...overrides,
  } as Chat;
}

function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-1',
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    isBot: false,
    createdAt: new Date(),
    ...overrides,
  } as Sender;
}

function createMockPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    title: 'Test Plan',
    content: '## Objective\nTest content\n\n## Tasks\n- [ ] Task 1',
    state: 'feedback' as PlanState,
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

describe('PlanIntentHandlerService', () => {
  let service: PlanIntentHandlerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanIntentHandlerService(mockClaudeClient as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handlePlanIntent', () => {
    const context = {
      message: createMockMessage({ text: 'create a plan to add user auth' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'create a plan to add user auth',
    };

    it('should route plan_propose intent correctly', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);
      mockClaudeClient.chat.mockResolvedValue({
        success: true,
        content: '## Objective\nAdd user authentication\n\n## Tasks\n- [ ] Add login endpoint',
      });
      mockPlanManagementService.createPlan.mockResolvedValue({
        success: true,
        plan: createMockPlan({ title: 'Add user auth' }),
      });

      const result = await service.handlePlanIntent('plan_propose', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('Plan created');
      expect(mockPlanManagementService.createPlan).toHaveBeenCalled();
    });

    it('should route plan_feedback intent correctly', async () => {
      const activePlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockClaudeClient.chat.mockResolvedValue({
        success: true,
        content: '## Objective\nUpdated content',
      });
      mockPlanManagementService.updatePlanContent.mockResolvedValue({
        success: true,
        plan: { ...activePlan, version: 2 },
      });
      mockPlanManagementService.addFeedback.mockResolvedValue({
        success: true,
        plan: { ...activePlan, version: 2 },
      });

      const feedbackContext = {
        ...context,
        messageText: 'add OAuth support',
      };

      const result = await service.handlePlanIntent('plan_feedback', feedbackContext);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.chat).toHaveBeenCalled();
      expect(mockPlanManagementService.updatePlanContent).toHaveBeenCalled();
    });

    it('should route plan_approve intent correctly', async () => {
      const activePlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockPlanManagementService.approvePlan.mockResolvedValue({
        success: true,
        plan: { ...activePlan, state: 'approved' as PlanState },
      });

      const result = await service.handlePlanIntent('plan_approve', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('approved');
      expect(mockPlanManagementService.approvePlan).toHaveBeenCalledWith(activePlan.id);
    });

    it('should route plan_execute intent correctly', async () => {
      const activePlan = createMockPlan({ state: 'approved' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockExecutionCoordinatorService.startExecution.mockResolvedValue({
        success: true,
        session: {
          id: 'exec-1',
          planId: activePlan.id,
          sessionId: 'session-1',
          status: 'running',
          progress: { tasksCompleted: 0, totalTasks: 1 },
        },
      });

      const result = await service.handlePlanIntent('plan_execute', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('Execution started');
      expect(mockExecutionCoordinatorService.startExecution).toHaveBeenCalled();
    });

    it('should route plan_status intent correctly', async () => {
      const activePlan = createMockPlan({ state: 'executing' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockExecutionCoordinatorService.getProgress.mockResolvedValue({
        tasksCompleted: 2,
        totalTasks: 5,
        currentIteration: 3,
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
      });

      const result = await service.handlePlanIntent('plan_status', context);

      expect(result.success).toBe(true);
      expect(result.progress).toBeDefined();
    });

    it('should route plan_cancel intent correctly', async () => {
      const activePlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockPlanManagementService.cancelPlan.mockResolvedValue({
        success: true,
      });

      const result = await service.handlePlanIntent('plan_cancel', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('cancelled');
      expect(mockPlanManagementService.cancelPlan).toHaveBeenCalledWith(activePlan.id);
    });

    it('should route plan_list intent correctly', async () => {
      const plans = [
        createMockPlan({ id: 'plan-1', title: 'Plan 1' }),
        createMockPlan({ id: 'plan-2', title: 'Plan 2' }),
      ];
      mockPlanManagementService.getPlansByChatId.mockResolvedValue(plans);

      const result = await service.handlePlanIntent('plan_list', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('Plan 1');
      expect(result.response).toContain('Plan 2');
    });

    it('should return error for unknown intent', async () => {
      const result = await service.handlePlanIntent('unknown_intent' as PlanIntent, context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('not sure');
    });
  });

  describe('plan_propose', () => {
    const context = {
      message: createMockMessage({ text: 'create a plan to add login' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'create a plan to add login',
    };

    it('should return error if active plan already exists', async () => {
      const existingPlan = createMockPlan({ title: 'Existing Plan' });
      mockPlanManagementService.getActivePlan.mockResolvedValue(existingPlan);

      const result = await service.handlePlanIntent('plan_propose', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('Active plan exists');
      expect(mockClaudeClient.chat).not.toHaveBeenCalled();
    });

    it('should generate plan content via Claude', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);
      mockClaudeClient.chat.mockResolvedValue({
        success: true,
        content: '## Objective\nAdd login functionality',
      });
      mockPlanManagementService.createPlan.mockResolvedValue({
        success: true,
        plan: createMockPlan(),
      });

      await service.handlePlanIntent('plan_propose', context);

      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        expect.stringContaining('add login'),
        expect.any(String)
      );
    });

    it('should handle Claude failure gracefully', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);
      mockClaudeClient.chat.mockResolvedValue({
        success: false,
        error: 'Claude unavailable',
      });

      const result = await service.handlePlanIntent('plan_propose', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('Error');
    });

    it('should extract plan request from message text', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);
      mockClaudeClient.chat.mockResolvedValue({
        success: true,
        content: '## Objective\nTest',
      });
      mockPlanManagementService.createPlan.mockResolvedValue({
        success: true,
        plan: createMockPlan(),
      });

      const contextWithPrefix = {
        ...context,
        messageText: 'create a plan to implement dark mode',
      };

      await service.handlePlanIntent('plan_propose', contextWithPrefix);

      // The prompt should contain the extracted request, not the full message
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        expect.stringContaining('implement dark mode'),
        expect.any(String)
      );
    });
  });

  describe('plan_feedback', () => {
    const context = {
      message: createMockMessage({ text: 'add more details' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'add more details',
    };

    it('should return error if no active plan', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);

      const result = await service.handlePlanIntent('plan_feedback', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain("don't have an active plan");
    });

    it('should return error if plan not in feedback state', async () => {
      const approvedPlan = createMockPlan({ state: 'approved' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(approvedPlan);

      const result = await service.handlePlanIntent('plan_feedback', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain("'approved' state");
    });

    it('should process feedback and update plan', async () => {
      const activePlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(activePlan);
      mockClaudeClient.chat.mockResolvedValue({
        success: true,
        content: '## Updated Content',
      });
      mockPlanManagementService.updatePlanContent.mockResolvedValue({
        success: true,
        plan: { ...activePlan, version: 2, content: '## Updated Content' },
      });
      mockPlanManagementService.addFeedback.mockResolvedValue({ success: true });

      const result = await service.handlePlanIntent('plan_feedback', context);

      expect(result.success).toBe(true);
      expect(mockPlanManagementService.updatePlanContent).toHaveBeenCalledWith(
        activePlan.id,
        expect.objectContaining({ content: '## Updated Content' })
      );
    });
  });

  describe('plan_approve', () => {
    const context = {
      message: createMockMessage({ text: 'looks good, approve' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'looks good, approve',
    };

    it('should return error if no active plan', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);

      const result = await service.handlePlanIntent('plan_approve', context);

      expect(result.success).toBe(false);
    });

    it('should approve plan in feedback state', async () => {
      const feedbackPlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(feedbackPlan);
      mockPlanManagementService.approvePlan.mockResolvedValue({
        success: true,
        plan: { ...feedbackPlan, state: 'approved' as PlanState },
      });

      const result = await service.handlePlanIntent('plan_approve', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('approved');
    });

    it('should confirm if plan already approved', async () => {
      const approvedPlan = createMockPlan({ state: 'approved' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(approvedPlan);

      const result = await service.handlePlanIntent('plan_approve', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('already approved');
      expect(mockPlanManagementService.approvePlan).not.toHaveBeenCalled();
    });
  });

  describe('plan_execute', () => {
    const context = {
      message: createMockMessage({ text: 'execute' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'execute',
    };

    it('should return error if no active plan', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);

      const result = await service.handlePlanIntent('plan_execute', context);

      expect(result.success).toBe(false);
    });

    it('should return error if plan not approved', async () => {
      const feedbackPlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(feedbackPlan);

      const result = await service.handlePlanIntent('plan_execute', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('Cannot execute');
    });

    it('should return error if already executing', async () => {
      const executingPlan = createMockPlan({ state: 'executing' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(executingPlan);

      const result = await service.handlePlanIntent('plan_execute', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('Already running');
    });

    it('should start execution for approved plan', async () => {
      const approvedPlan = createMockPlan({ state: 'approved' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(approvedPlan);
      mockExecutionCoordinatorService.startExecution.mockResolvedValue({
        success: true,
        session: {
          id: 'exec-1',
          progress: { tasksCompleted: 0, totalTasks: 3 },
        },
      });

      const result = await service.handlePlanIntent('plan_execute', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('Execution started');
      expect(mockExecutionCoordinatorService.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({ planId: approvedPlan.id }),
        expect.any(Function)
      );
    });
  });

  describe('plan_status', () => {
    const context = {
      message: createMockMessage({ text: "what's the status?" }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: "what's the status?",
    };

    it('should return error if no active plan', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);

      const result = await service.handlePlanIntent('plan_status', context);

      expect(result.success).toBe(false);
    });

    it('should return execution progress for executing plan', async () => {
      const executingPlan = createMockPlan({ state: 'executing' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(executingPlan);
      mockExecutionCoordinatorService.getProgress.mockResolvedValue({
        tasksCompleted: 3,
        totalTasks: 5,
        currentIteration: 10,
        tokensIn: 5000,
        tokensOut: 2000,
        cost: 0.15,
      });

      const result = await service.handlePlanIntent('plan_status', context);

      expect(result.success).toBe(true);
      expect(result.progress).toBeDefined();
      expect(result.progress?.tasksCompleted).toBe(3);
    });

    it('should return plan display for non-executing plan', async () => {
      const feedbackPlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(feedbackPlan);

      const result = await service.handlePlanIntent('plan_status', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain(feedbackPlan.title);
    });
  });

  describe('plan_cancel', () => {
    const context = {
      message: createMockMessage({ text: 'cancel' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'cancel',
    };

    it('should return error if no active plan', async () => {
      mockPlanManagementService.getActivePlan.mockResolvedValue(null);

      const result = await service.handlePlanIntent('plan_cancel', context);

      expect(result.success).toBe(false);
    });

    it('should stop execution and cancel executing plan', async () => {
      const executingPlan = createMockPlan({ state: 'executing' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(executingPlan);
      mockExecutionCoordinatorService.stopExecution.mockResolvedValue({ success: true });
      mockPlanManagementService.cancelPlan.mockResolvedValue({ success: true });

      const result = await service.handlePlanIntent('plan_cancel', context);

      expect(result.success).toBe(true);
      expect(mockExecutionCoordinatorService.stopExecution).toHaveBeenCalledWith(executingPlan.id);
      expect(mockPlanManagementService.cancelPlan).toHaveBeenCalledWith(executingPlan.id);
    });

    it('should cancel non-executing plan without stopping execution', async () => {
      const feedbackPlan = createMockPlan({ state: 'feedback' as PlanState });
      mockPlanManagementService.getActivePlan.mockResolvedValue(feedbackPlan);
      mockPlanManagementService.cancelPlan.mockResolvedValue({ success: true });

      const result = await service.handlePlanIntent('plan_cancel', context);

      expect(result.success).toBe(true);
      expect(mockExecutionCoordinatorService.stopExecution).not.toHaveBeenCalled();
      expect(mockPlanManagementService.cancelPlan).toHaveBeenCalledWith(feedbackPlan.id);
    });
  });

  describe('plan_list', () => {
    const context = {
      message: createMockMessage({ text: 'show my plans' }),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'show my plans',
    };

    it('should return message when no plans found', async () => {
      mockPlanManagementService.getPlansByChatId.mockResolvedValue([]);

      const result = await service.handlePlanIntent('plan_list', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('No plans found');
    });

    it('should list all plans for chat', async () => {
      const plans = [
        createMockPlan({ id: 'plan-1', title: 'First Plan', state: 'completed' as PlanState }),
        createMockPlan({ id: 'plan-2', title: 'Second Plan', state: 'feedback' as PlanState }),
        createMockPlan({ id: 'plan-3', title: 'Third Plan', state: 'executing' as PlanState }),
      ];
      mockPlanManagementService.getPlansByChatId.mockResolvedValue(plans);

      const result = await service.handlePlanIntent('plan_list', context);

      expect(result.success).toBe(true);
      expect(result.response).toContain('First Plan');
      expect(result.response).toContain('Second Plan');
      expect(result.response).toContain('Third Plan');
    });
  });

  describe('error handling', () => {
    const context = {
      message: createMockMessage(),
      chat: createMockChat(),
      sender: createMockSender(),
      messageText: 'test',
    };

    it('should handle service failures gracefully', async () => {
      // Test handling of service-level failures (returning success: false)
      mockPlanManagementService.getActivePlan.mockResolvedValue(createMockPlan({ state: 'feedback' as PlanState }));
      mockPlanManagementService.approvePlan.mockResolvedValue({
        success: false,
        message: 'Service unavailable',
      });

      const result = await service.handlePlanIntent('plan_approve', context);

      expect(result.success).toBe(false);
      expect(result.response).toContain('Error');
    });
  });
});
