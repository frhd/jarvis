/**
 * Execution Coordinator Service
 *
 * Manages plan execution via loop.sh spawning, progress monitoring,
 * and completion handling for the plan-execute workflow system.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, unlinkSync, writeFileSync, promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/error-classes.js';
import { ErrorCode } from '../errors/error-codes.js';
import {
  planRepository,
  planExecutionRepository,
} from '../repositories/index.js';
import { planManagementService } from './planManagement.service.js';
import { parseLoopLog, parseLoopLogIncremental } from '../utils/loopLogParser.js';
import { parseImplMd } from '../utils/implMdParser.js';
import type {
  Plan,
  PlanExecution,
  NewPlanExecution,
} from '../types/index.js';
import type {
  StartExecutionInput,
  ExecutionProgressReport,
  ExecutionSession,
  LoopLogMetrics,
  PlanMetadata,
} from '../types/plan.types.js';
import { randomUUID } from 'crypto';
import {
  EXECUTION_PROGRESS_INTERVAL_MS,
  MAX_EXECUTION_TIME_MS,
  GRACEFUL_SHUTDOWN_WAIT_MS,
  LONG_CONTENT_PREVIEW_LENGTH,
  ERROR_PREVIEW_LENGTH,
} from '../config/constants.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionStartResult {
  success: boolean;
  session?: ExecutionSession;
  message?: string;
}

export interface ExecutionStopResult {
  success: boolean;
  message?: string;
  finalProgress?: ExecutionProgressReport;
}

export interface ProgressCallback {
  (progress: ExecutionProgressReport, planId: string): void | Promise<void>;
}

export interface CompletionCallback {
  (progress: ExecutionProgressReport, status: 'completed' | 'failed' | 'cancelled'): void | Promise<void>;
}

interface ActiveExecution {
  process: ChildProcess;
  planId: string;
  executionId: string;
  sessionId: string;
  loopLogPath: string;
  workingDirectory: string;
  lastLogLine: number;
  monitorTimer?: NodeJS.Timeout;
  progressCallback?: ProgressCallback;
  completionCallback?: CompletionCallback;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  loopShPath: path.resolve(process.cwd(), 'loop/loop.sh'),
  loopDir: path.resolve(process.cwd(), 'loop'),
  progressIntervalMs: EXECUTION_PROGRESS_INTERVAL_MS,
  maxExecutionTimeMs: MAX_EXECUTION_TIME_MS,
};

// ============================================================================
// Execution Coordinator Service
// ============================================================================

export class ExecutionCoordinatorService {
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private config = DEFAULT_CONFIG;

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }
  }

  /**
   * Start execution of an approved plan
   */
  async startExecution(
    input: StartExecutionInput,
    progressCallback?: ProgressCallback
  ): Promise<ExecutionStartResult> {
    const { planId, promptFile, workingDirectory } = input;

    try {
      // 1. Validate plan exists and is in approved state
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return { success: false, message: 'Plan not found' };
      }

      if (plan.state !== 'approved') {
        return {
          success: false,
          message: `Plan must be in 'approved' state to execute. Current state: ${plan.state}`,
        };
      }

      // 2. Check if there's already an active execution for this plan
      const existingExecution = this.activeExecutions.get(planId);
      if (existingExecution) {
        return {
          success: false,
          message: 'Plan is already being executed',
        };
      }

      // 3. Transition plan to executing state
      const transitionResult = await planManagementService.startExecution(planId);
      if (!transitionResult.success) {
        return {
          success: false,
          message: transitionResult.message ?? 'Failed to transition plan to executing state',
        };
      }

      // 4. Create execution record in database
      const sessionId = randomUUID();
      const loopLogPath = path.join(this.config.loopDir, 'loop.log');
      const resolvedPromptFile = promptFile ?? path.join(this.config.loopDir, 'prompt.md');
      const resolvedWorkingDir = workingDirectory ?? process.cwd();

      const executionData: Omit<NewPlanExecution, 'id'> = {
        planId,
        sessionId,
        status: 'running',
        promptFile: resolvedPromptFile,
        loopLogPath,
        totalIterations: 0,
        currentIteration: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        progressReport: JSON.stringify(this.createInitialProgress()),
      };

      const execution = await planExecutionRepository.create(executionData);

      logger.info('[ExecutionCoordinator] Starting execution', {
        planId,
        executionId: execution.id,
        sessionId,
        promptFile: resolvedPromptFile,
      });

      // 5. Remove any stale BREAK file
      this.removeBreakFile();

      // 6. Spawn loop.sh process
      const loopProcess = this.spawnLoopProcess(resolvedPromptFile);

      // 7. Track active execution
      const activeExecution: ActiveExecution = {
        process: loopProcess,
        planId,
        executionId: execution.id,
        sessionId,
        loopLogPath,
        workingDirectory: resolvedWorkingDir,
        lastLogLine: 0,
        progressCallback,
      };

      this.activeExecutions.set(planId, activeExecution);

      // 8. Set up process event handlers
      this.setupProcessHandlers(activeExecution);

      // 9. Start progress monitoring
      this.startProgressMonitor(activeExecution);

      // 10. Create and return session
      const session = this.createExecutionSession(execution, plan);

      return {
        success: true,
        session,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ExecutionCoordinator] Failed to start execution', {
        error: errorMessage,
        planId,
      });

      // Try to revert plan state
      await planManagementService.failPlan(planId, `Execution startup failed: ${errorMessage}`);

      return {
        success: false,
        message: `Failed to start execution: ${errorMessage}`,
      };
    }
  }

  /**
   * Stop an active execution by signaling BREAK
   */
  async stopExecution(planId: string): Promise<ExecutionStopResult> {
    const activeExecution = this.activeExecutions.get(planId);
    if (!activeExecution) {
      return { success: false, message: 'No active execution found for this plan' };
    }

    try {
      logger.info('[ExecutionCoordinator] Stopping execution via BREAK signal', { planId });

      // Signal the loop to stop
      this.signalBreak();

      // Wait briefly for graceful shutdown
      await this.sleep(GRACEFUL_SHUTDOWN_WAIT_MS);

      // Get final progress
      const finalProgress = await this.getProgress(planId);

      // If process is still running, kill it
      if (!activeExecution.process.killed) {
        activeExecution.process.kill('SIGTERM');
      }

      return {
        success: true,
        message: 'Execution stopped',
        finalProgress: finalProgress ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ExecutionCoordinator] Failed to stop execution', { error: errorMessage, planId });
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Force kill an execution without graceful shutdown
   */
  async killExecution(planId: string): Promise<ExecutionStopResult> {
    const activeExecution = this.activeExecutions.get(planId);
    if (!activeExecution) {
      return { success: false, message: 'No active execution found for this plan' };
    }

    try {
      logger.warn('[ExecutionCoordinator] Force killing execution', { planId });

      // Kill the process
      activeExecution.process.kill('SIGKILL');

      // Clean up
      await this.handleExecutionComplete(activeExecution, 'cancelled');

      return {
        success: true,
        message: 'Execution killed',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ExecutionCoordinator] Failed to kill execution', { error: errorMessage, planId });
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Get current progress for an active or completed execution
   */
  async getProgress(planId: string): Promise<ExecutionProgressReport | null> {
    const activeExecution = this.activeExecutions.get(planId);

    if (activeExecution) {
      // Active execution - parse latest from log
      return this.parseProgressFromLog(activeExecution);
    }

    // Check database for completed execution
    const execution = await planExecutionRepository.findLatestByPlanId(planId);
    if (execution && execution.progressReport) {
      try {
        return JSON.parse(execution.progressReport) as ExecutionProgressReport;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Signal the loop to stop via BREAK file
   */
  signalBreak(): void {
    const breakPath = path.join(this.config.loopDir, 'BREAK');
    try {
      writeFileSync(breakPath, '');
      logger.info('[ExecutionCoordinator] BREAK signal sent', { breakPath });
    } catch (error) {
      logger.error('[ExecutionCoordinator] Failed to create BREAK file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        breakPath,
      });
    }
  }

  /**
   * Check if BREAK file exists
   */
  isBreakSignaled(): boolean {
    const breakPath = path.join(this.config.loopDir, 'BREAK');
    return existsSync(breakPath);
  }

  /**
   * Remove BREAK file
   */
  removeBreakFile(): void {
    const breakPath = path.join(this.config.loopDir, 'BREAK');
    try {
      if (existsSync(breakPath)) {
        unlinkSync(breakPath);
        logger.debug('[ExecutionCoordinator] Removed stale BREAK file');
      }
    } catch (error) {
      logger.warn('[ExecutionCoordinator] Failed to remove BREAK file', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check if an execution is currently active
   */
  isExecutionActive(planId: string): boolean {
    return this.activeExecutions.has(planId);
  }

  /**
   * Get all active executions
   */
  getActiveExecutions(): string[] {
    return Array.from(this.activeExecutions.keys());
  }

  /**
   * Set a completion callback for an active execution
   * Called when execution completes with final progress and status
   */
  setCompletionCallback(planId: string, callback: CompletionCallback): void {
    const activeExecution = this.activeExecutions.get(planId);
    if (activeExecution) {
      activeExecution.completionCallback = callback;
      logger.debug('[ExecutionCoordinator] Completion callback registered', { planId });
    } else {
      logger.warn('[ExecutionCoordinator] Cannot set completion callback - no active execution', { planId });
    }
  }

  /**
   * Get execution metrics from loop.log
   */
  async getLoopMetrics(planId: string): Promise<LoopLogMetrics | null> {
    const activeExecution = this.activeExecutions.get(planId);
    const loopLogPath = activeExecution?.loopLogPath ?? path.join(this.config.loopDir, 'loop.log');

    try {
      const content = await fs.readFile(loopLogPath, 'utf-8');
      return parseLoopLog(content);
    } catch (error) {
      logger.warn('[ExecutionCoordinator] Failed to parse loop log', {
        error: error instanceof Error ? error.message : 'Unknown error',
        loopLogPath,
      });
      return null;
    }
  }

  /**
   * Recover from crashed executions on startup
   */
  async recoverCrashedExecutions(): Promise<number> {
    try {
      const runningExecutions = await planExecutionRepository.findRunning();
      let recoveredCount = 0;

      for (const execution of runningExecutions) {
        logger.warn('[ExecutionCoordinator] Found orphaned running execution', {
          executionId: execution.id,
          planId: execution.planId,
        });

        // Mark as failed since we can't recover the process
        await planExecutionRepository.markFailed(
          execution.id,
          JSON.stringify({ error: 'Execution was running when service restarted' })
        );

        // Transition plan to failed state
        await planManagementService.failPlan(
          execution.planId,
          'Execution interrupted by service restart'
        );

        recoveredCount++;
      }

      if (recoveredCount > 0) {
        logger.info('[ExecutionCoordinator] Recovered crashed executions', { count: recoveredCount });
      }

      return recoveredCount;
    } catch (error) {
      logger.error('[ExecutionCoordinator] Failed to recover crashed executions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Spawn the loop.sh process
   */
  private spawnLoopProcess(promptFile: string): ChildProcess {
    const loopProcess = spawn('sh', [this.config.loopShPath, promptFile], {
      cwd: this.config.loopDir,
      env: {
        ...process.env,
        // Ensure proper terminal settings
        TERM: 'xterm-256color',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    logger.info('[ExecutionCoordinator] Loop process spawned', {
      pid: loopProcess.pid,
      promptFile,
    });

    return loopProcess;
  }

  /**
   * Set up event handlers for the spawned process
   */
  private setupProcessHandlers(activeExecution: ActiveExecution): void {
    const { process: loopProcess, planId, executionId } = activeExecution;

    // Handle stdout (optional logging)
    loopProcess.stdout?.on('data', (data: Buffer) => {
      // Log a summary, not the full output
      const output = data.toString();
      if (output.includes('[Loop')) {
        logger.debug('[ExecutionCoordinator] Loop output', { planId, summary: output.slice(0, LONG_CONTENT_PREVIEW_LENGTH) });
      }
    });

    // Handle stderr
    loopProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();
      logger.warn('[ExecutionCoordinator] Loop stderr', { planId, error: error.slice(0, ERROR_PREVIEW_LENGTH) });
    });

    // Handle process exit
    loopProcess.on('close', async (code, signal) => {
      logger.info('[ExecutionCoordinator] Loop process exited', {
        planId,
        executionId,
        code,
        signal,
      });

      const status = code === 0 ? 'completed' : 'failed';
      await this.handleExecutionComplete(activeExecution, status);
    });

    // Handle process error
    loopProcess.on('error', async (error) => {
      logger.error('[ExecutionCoordinator] Loop process error', {
        planId,
        executionId,
        error: error.message,
      });

      await this.handleExecutionComplete(activeExecution, 'failed');
    });
  }

  /**
   * Start periodic progress monitoring
   */
  private startProgressMonitor(activeExecution: ActiveExecution): void {
    const { planId } = activeExecution;

    const monitorTimer = setInterval(async () => {
      try {
        // Parse progress from log
        const progress = await this.parseProgressFromLog(activeExecution);

        if (progress) {
          // Update database
          await this.updateExecutionProgress(activeExecution, progress);

          // Call progress callback if provided
          if (activeExecution.progressCallback) {
            await activeExecution.progressCallback(progress, planId);
          }

          // Check for BREAK signal (loop completed its tasks)
          if (this.isBreakSignaled()) {
            logger.info('[ExecutionCoordinator] BREAK signal detected', { planId });
            // Let the process exit naturally
          }
        }
      } catch (error) {
        logger.warn('[ExecutionCoordinator] Progress monitor error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          planId,
        });
      }
    }, this.config.progressIntervalMs);

    activeExecution.monitorTimer = monitorTimer;
  }

  /**
   * Parse progress from loop.log incrementally
   */
  private async parseProgressFromLog(activeExecution: ActiveExecution): Promise<ExecutionProgressReport> {
    const { loopLogPath, lastLogLine, workingDirectory } = activeExecution;

    try {
      // Parse log incrementally
      const { metrics, lastLine } = await parseLoopLogIncremental(loopLogPath, lastLogLine);
      activeExecution.lastLogLine = lastLine;

      // Try to parse impl.md for task progress
      let tasksCompleted = 0;
      let totalTasks = 0;
      const filesModified: string[] = [];

      const implMdPath = path.join(workingDirectory, 'impl.md');
      if (existsSync(implMdPath)) {
        try {
          const implContent = await fs.readFile(implMdPath, 'utf-8');
          const implDoc = parseImplMd(implContent);

          // Count tasks from impl.md
          const countTasks = (tasks: typeof implDoc.tasks): { completed: number; total: number } => {
            let completed = 0;
            let total = 0;
            for (const task of tasks) {
              total++;
              if (task.completed) completed++;
              if (task.subtasks) {
                const subtaskCounts = countTasks(task.subtasks);
                completed += subtaskCounts.completed;
                total += subtaskCounts.total;
              }
            }
            return { completed, total };
          };

          const taskCounts = countTasks(implDoc.tasks);
          tasksCompleted = taskCounts.completed;
          totalTasks = taskCounts.total;
          filesModified.push(...implDoc.filesModified);
        } catch {
          // Ignore impl.md parse errors
        }
      }

      return {
        currentIteration: metrics.totalIterations,
        tasksCompleted,
        totalTasks,
        tokensIn: metrics.totalTokensIn + metrics.totalCacheRead,
        tokensOut: metrics.totalTokensOut,
        cost: metrics.totalCost,
        filesModified,
        lastActivity: new Date().toISOString(),
      };
    } catch (error) {
      logger.warn('[ExecutionCoordinator] Failed to parse progress from log', {
        error: error instanceof Error ? error.message : 'Unknown error',
        loopLogPath,
      });

      return this.createInitialProgress();
    }
  }

  /**
   * Update execution progress in database
   */
  private async updateExecutionProgress(
    activeExecution: ActiveExecution,
    progress: ExecutionProgressReport
  ): Promise<void> {
    try {
      await planExecutionRepository.updateProgress(activeExecution.executionId, {
        currentIteration: progress.currentIteration,
        totalIterations: progress.totalIterations,
        totalTokensIn: progress.tokensIn,
        totalTokensOut: progress.tokensOut,
        totalCost: progress.cost,
        progressReport: JSON.stringify(progress),
      });
    } catch (error) {
      logger.warn('[ExecutionCoordinator] Failed to update execution progress', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionId: activeExecution.executionId,
      });
    }
  }

  /**
   * Handle execution completion (success, failure, or cancellation)
   */
  private async handleExecutionComplete(
    activeExecution: ActiveExecution,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    const { planId, executionId, monitorTimer, completionCallback } = activeExecution;

    // Stop progress monitoring
    if (monitorTimer) {
      clearInterval(monitorTimer);
    }

    // Get final progress
    const finalProgress = await this.parseProgressFromLog(activeExecution);

    // Update execution record
    if (status === 'completed') {
      await planExecutionRepository.markCompleted(executionId, {
        totalIterations: finalProgress.currentIteration,
        totalTokensIn: finalProgress.tokensIn,
        totalTokensOut: finalProgress.tokensOut,
        totalCost: finalProgress.cost,
        progressReport: JSON.stringify(finalProgress),
      });
    } else if (status === 'failed') {
      await planExecutionRepository.markFailed(executionId, JSON.stringify(finalProgress));
    } else {
      await planExecutionRepository.markCancelled(executionId);
    }

    // Update plan state
    if (status === 'completed') {
      await planManagementService.completePlan(planId);
    } else {
      await planManagementService.failPlan(
        planId,
        status === 'cancelled' ? 'Execution was cancelled' : 'Execution failed'
      );
    }

    // Call completion callback for notifications
    if (completionCallback) {
      try {
        await completionCallback(finalProgress, status);
        logger.debug('[ExecutionCoordinator] Completion callback executed', { planId, status });
      } catch (error) {
        logger.warn('[ExecutionCoordinator] Completion callback failed', {
          planId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Remove from active executions
    this.activeExecutions.delete(planId);

    // Clean up BREAK file if present
    this.removeBreakFile();

    logger.info('[ExecutionCoordinator] Execution complete', {
      planId,
      executionId,
      status,
      iterations: finalProgress.currentIteration,
      cost: finalProgress.cost,
    });
  }

  /**
   * Create initial progress object
   */
  private createInitialProgress(): ExecutionProgressReport {
    return {
      currentIteration: 0,
      tasksCompleted: 0,
      totalTasks: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      filesModified: [],
    };
  }

  /**
   * Create execution session object
   */
  private createExecutionSession(execution: PlanExecution, plan: Plan): ExecutionSession {
    const progressReport = execution.progressReport
      ? JSON.parse(execution.progressReport) as ExecutionProgressReport
      : this.createInitialProgress();

    return {
      id: execution.id,
      planId: execution.planId,
      sessionId: execution.sessionId,
      status: execution.status,
      promptFile: execution.promptFile,
      loopLogPath: execution.loopLogPath,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      progress: progressReport,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const executionCoordinatorService = new ExecutionCoordinatorService();
