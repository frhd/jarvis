/**
 * Plan Workflow System Types
 *
 * Types for the plan-execute workflow including state management,
 * execution tracking, and progress reporting.
 */

import type { PlanState, ExecutionStatus } from '../db/schema.js';

// ============================================================================
// Plan State Machine
// ============================================================================

/**
 * Valid state transitions for the plan state machine.
 * IDLE → PROPOSING → FEEDBACK ↔ (iterate) → APPROVED → EXECUTING → COMPLETED/FAILED
 */
export const PLAN_STATE_TRANSITIONS: Record<PlanState, PlanState[]> = {
  idle: ['proposing'],
  proposing: ['feedback', 'failed'],
  feedback: ['feedback', 'approved', 'failed'], // Can iterate on feedback
  approved: ['executing', 'feedback'], // Can go back to feedback if needed
  executing: ['completed', 'failed'],
  completed: ['idle'], // Can start a new plan
  failed: ['idle', 'proposing'], // Can retry or start fresh
} as const;

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: PlanState, to: PlanState): boolean {
  return PLAN_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// Plan Metadata
// ============================================================================

export interface PlanMetadata {
  tags?: string[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  estimatedTasks?: number;
  completedTasks?: number;
  implMdPath?: string;
  workingDirectory?: string;
  // Additional context from the original request
  originalRequest?: string;
  requestedBy?: string;
  // Failure information
  failureReason?: string;
}

// ============================================================================
// Plan Input/Output Types
// ============================================================================

export interface CreatePlanInput {
  title: string;
  content: string;
  createdBy?: string;
  chatId?: string;
  metadata?: PlanMetadata;
}

export interface UpdatePlanInput {
  title?: string;
  content?: string;
  metadata?: PlanMetadata;
}

export interface PlanWithFeedback {
  id: string;
  title: string;
  content: string;
  state: PlanState;
  version: number;
  createdBy: string | null;
  chatId: string | null;
  metadata: PlanMetadata;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  completedAt: Date | null;
  feedbackHistory: PlanFeedbackEntry[];
}

export interface PlanFeedbackEntry {
  id: string;
  senderId: string;
  feedback: string;
  version: number;
  createdAt: Date;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface StartExecutionInput {
  planId: string;
  promptFile?: string;
  workingDirectory?: string;
}

export interface ExecutionProgressReport {
  currentIteration: number;
  totalIterations?: number;
  tasksCompleted: number;
  totalTasks: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  filesModified: string[];
  lastActivity?: string;
  errors?: string[];
}

export interface ExecutionSession {
  id: string;
  planId: string;
  sessionId: string;
  status: ExecutionStatus;
  promptFile: string | null;
  loopLogPath: string | null;
  startedAt: Date;
  completedAt: Date | null;
  progress: ExecutionProgressReport;
}

// ============================================================================
// impl.md Format Types
// ============================================================================

export interface ImplMdTask {
  description: string;
  completed: boolean;
  subtasks?: ImplMdTask[];
}

export interface ImplMdProgress {
  iteration: number;
  timestamp: Date;
  completedTasks: string[];
  status: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
}

export interface ImplMdDocument {
  title: string;
  status: PlanState;
  createdDate: string;
  lastUpdated: string;
  executionStarted?: string;
  objective: string;
  context: string;
  tasks: ImplMdTask[];
  progress: ImplMdProgress[];
  filesModified: string[];
  notes: string;
}

// ============================================================================
// Plan Intent Types
// ============================================================================

export type PlanIntentAction =
  | 'propose' // User wants to create a new plan
  | 'feedback' // User is providing feedback on current plan
  | 'approve' // User approves the current plan
  | 'execute' // User wants to start execution
  | 'status' // User wants status update
  | 'cancel' // User wants to cancel current plan
  | 'list'; // User wants to see all plans

export interface DetectedPlanIntent {
  type: PlanIntentAction;
  confidence: number;
  extractedContent?: string; // For propose: the request, for feedback: the feedback text
}

// ============================================================================
// Progress Reporting Types
// ============================================================================

export interface ProgressUpdateOptions {
  chatId: string;
  planId: string;
  includeTokenUsage?: boolean;
  includeCost?: boolean;
  includeFilesModified?: boolean;
}

export interface NotificationContext {
  chatId: string;
  planId: string;
  planTitle: string;
  messageId?: number; // For editing existing message
}

export interface ProgressNotification {
  type: 'milestone' | 'periodic' | 'error' | 'completion';
  planId: string;
  planTitle: string;
  message: string;
  progress: ExecutionProgressReport;
  timestamp: Date;
}

// ============================================================================
// Loop.log Parsing Types
// ============================================================================

export interface LoopLogEntry {
  iteration: number;
  timestamp: Date;
  tokensIn: number;
  tokensOut: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost: number;
  duration?: number;
}

export interface LoopLogMetrics {
  totalIterations: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  averageDuration?: number;
  entries: LoopLogEntry[];
}
