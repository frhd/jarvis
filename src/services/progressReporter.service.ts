/**
 * Progress Reporter Service
 *
 * Handles formatting and sending progress notifications during plan execution.
 * Integrates with TelegramService for real-time progress updates.
 */

import { logger } from '../utils/logger.js';
import type { TelegramService } from './telegram.service.js';
import type {
  ExecutionProgressReport,
  ProgressNotification,
} from '../types/plan.types.js';

// ============================================================================
// Types
// ============================================================================

export interface ProgressReporterConfig {
  /** Minimum interval between progress updates (ms) */
  updateThrottleMs: number;
  /** Whether to include token usage in progress reports */
  includeTokenUsage: boolean;
  /** Whether to include cost in progress reports */
  includeCost: boolean;
  /** Whether to include files modified in progress reports */
  includeFilesModified: boolean;
  /** Maximum number of files to show in progress report */
  maxFilesToShow: number;
  /** Notify only on task completion milestones */
  milestoneOnly: boolean;
}

export interface NotificationContext {
  chatId: string;
  planId: string;
  planTitle: string;
  messageId?: number; // For editing existing message
}

export interface SendNotificationResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ProgressReporterConfig = {
  updateThrottleMs: 30000, // 30 seconds minimum between updates
  includeTokenUsage: true,
  includeCost: true,
  includeFilesModified: true,
  maxFilesToShow: 5,
  milestoneOnly: false,
};

// ============================================================================
// Progress Reporter Service
// ============================================================================

export class ProgressReporterService {
  private config: ProgressReporterConfig;
  private telegramService: TelegramService | null = null;
  private lastUpdateTime: Map<string, number> = new Map();
  private lastTasksCompleted: Map<string, number> = new Map();
  private progressMessageIds: Map<string, number> = new Map();

  constructor(config?: Partial<ProgressReporterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the Telegram service for sending notifications
   */
  setTelegramService(telegramService: TelegramService): void {
    this.telegramService = telegramService;
  }

  /**
   * Send a progress update notification
   * Handles throttling and milestone detection
   */
  async sendProgressUpdate(
    context: NotificationContext,
    progress: ExecutionProgressReport
  ): Promise<SendNotificationResult> {
    const { chatId, planId, planTitle } = context;

    // Check if we should send an update
    if (!this.shouldSendUpdate(planId, progress)) {
      return { success: true }; // Skipped due to throttling
    }

    // Update tracking state
    this.lastUpdateTime.set(planId, Date.now());
    this.lastTasksCompleted.set(planId, progress.tasksCompleted);

    // Format the progress message
    const notification = this.createProgressNotification(
      planId,
      planTitle,
      progress,
      'periodic'
    );

    return this.sendNotification(chatId, notification);
  }

  /**
   * Send a milestone notification (task completed, iteration milestone)
   */
  async sendMilestoneNotification(
    context: NotificationContext,
    progress: ExecutionProgressReport,
    milestone: string
  ): Promise<SendNotificationResult> {
    const { chatId, planId, planTitle } = context;

    const notification = this.createProgressNotification(
      planId,
      planTitle,
      progress,
      'milestone'
    );

    // Add milestone info to message
    notification.message = `🎯 ${milestone}\n\n${notification.message}`;

    return this.sendNotification(chatId, notification);
  }

  /**
   * Send an error notification
   */
  async sendErrorNotification(
    context: NotificationContext,
    progress: ExecutionProgressReport,
    errorMessage: string
  ): Promise<SendNotificationResult> {
    const { chatId, planId, planTitle } = context;

    const notification = this.createProgressNotification(
      planId,
      planTitle,
      progress,
      'error'
    );

    notification.message = `⚠️ **Error during execution**\n\n${errorMessage}\n\n${notification.message}`;

    return this.sendNotification(chatId, notification);
  }

  /**
   * Send a completion notification
   */
  async sendCompletionNotification(
    context: NotificationContext,
    progress: ExecutionProgressReport,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<SendNotificationResult> {
    const { chatId, planId, planTitle } = context;

    const notification = this.createProgressNotification(
      planId,
      planTitle,
      progress,
      'completion'
    );

    let statusEmoji: string;
    let statusText: string;

    switch (status) {
      case 'completed':
        statusEmoji = '✅';
        statusText = 'Execution completed successfully';
        break;
      case 'failed':
        statusEmoji = '❌';
        statusText = 'Execution failed';
        break;
      case 'cancelled':
        statusEmoji = '⏹️';
        statusText = 'Execution was cancelled';
        break;
    }

    notification.message = `${statusEmoji} **${statusText}**\n\n**${planTitle}**\n\n${notification.message}`;

    // Clear tracking state for this plan
    this.clearPlanState(planId);

    return this.sendNotification(chatId, notification);
  }

  /**
   * Format progress report for display
   */
  formatProgressReport(progress: ExecutionProgressReport): string {
    const lines: string[] = [];

    // Progress bar
    const progressBar = this.createProgressBar(
      progress.tasksCompleted,
      progress.totalTasks || progress.tasksCompleted + 1
    );
    lines.push(`${progressBar}`);

    // Task completion
    lines.push(
      `📋 Tasks: ${progress.tasksCompleted}/${progress.totalTasks || '?'} completed`
    );

    // Iteration count
    lines.push(`🔄 Iteration: ${progress.currentIteration}`);

    // Token usage
    if (this.config.includeTokenUsage) {
      lines.push(
        `📊 Tokens: ${this.formatNumber(progress.tokensIn)} in / ${this.formatNumber(progress.tokensOut)} out`
      );
    }

    // Cost
    if (this.config.includeCost && progress.cost > 0) {
      lines.push(`💰 Cost: $${progress.cost.toFixed(2)}`);
    }

    // Files modified
    if (this.config.includeFilesModified && progress.filesModified.length > 0) {
      const filesToShow = progress.filesModified.slice(0, this.config.maxFilesToShow);
      lines.push(`\n📁 Files modified:`);
      for (const file of filesToShow) {
        lines.push(`  • ${this.truncatePath(file)}`);
      }
      if (progress.filesModified.length > this.config.maxFilesToShow) {
        lines.push(
          `  • ... and ${progress.filesModified.length - this.config.maxFilesToShow} more`
        );
      }
    }

    // Last activity
    if (progress.lastActivity) {
      const lastActivityTime = new Date(progress.lastActivity);
      lines.push(`\n⏱️ Last update: ${this.formatTimeAgo(lastActivityTime)}`);
    }

    // Errors
    if (progress.errors && progress.errors.length > 0) {
      lines.push(`\n⚠️ Errors: ${progress.errors.length}`);
      for (const error of progress.errors.slice(0, 3)) {
        lines.push(`  • ${error.slice(0, 100)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Create a text-based progress bar
   */
  createProgressBar(completed: number, total: number): string {
    const barLength = 10;
    const progress = total > 0 ? completed / total : 0;
    const filledLength = Math.round(barLength * progress);
    const emptyLength = barLength - filledLength;

    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(emptyLength);
    const percentage = Math.round(progress * 100);

    return `[${filled}${empty}] ${percentage}%`;
  }

  /**
   * Get the stored message ID for a plan (for editing)
   */
  getProgressMessageId(planId: string): number | undefined {
    return this.progressMessageIds.get(planId);
  }

  /**
   * Store a message ID for later editing
   */
  setProgressMessageId(planId: string, messageId: number): void {
    this.progressMessageIds.set(planId, messageId);
  }

  /**
   * Clear all tracking state for a plan
   */
  clearPlanState(planId: string): void {
    this.lastUpdateTime.delete(planId);
    this.lastTasksCompleted.delete(planId);
    this.progressMessageIds.delete(planId);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Determine if we should send an update based on throttling and milestones
   */
  private shouldSendUpdate(
    planId: string,
    progress: ExecutionProgressReport
  ): boolean {
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime.get(planId) || 0;
    const lastTasks = this.lastTasksCompleted.get(planId) || 0;

    // Always allow first update
    if (lastUpdate === 0) {
      return true;
    }

    // Check for milestone (task completed)
    if (progress.tasksCompleted > lastTasks) {
      return true;
    }

    // In milestone-only mode, don't send periodic updates
    if (this.config.milestoneOnly) {
      return false;
    }

    // Check throttling
    const timeSinceLastUpdate = now - lastUpdate;
    return timeSinceLastUpdate >= this.config.updateThrottleMs;
  }

  /**
   * Create a progress notification object
   */
  private createProgressNotification(
    planId: string,
    planTitle: string,
    progress: ExecutionProgressReport,
    type: ProgressNotification['type']
  ): ProgressNotification {
    return {
      type,
      planId,
      planTitle,
      message: this.formatProgressReport(progress),
      progress,
      timestamp: new Date(),
    };
  }

  /**
   * Send a notification via Telegram
   */
  private async sendNotification(
    chatId: string,
    notification: ProgressNotification
  ): Promise<SendNotificationResult> {
    if (!this.telegramService) {
      logger.warn('[ProgressReporter] TelegramService not configured, skipping notification');
      return { success: false, error: 'TelegramService not configured' };
    }

    try {
      const result = await this.telegramService.sendMessage(chatId, notification.message);

      if (result) {
        logger.debug('[ProgressReporter] Notification sent', {
          planId: notification.planId,
          type: notification.type,
          messageId: result.id,
        });
        return { success: true, messageId: result.id };
      }

      // Message was queued (connection issues)
      logger.warn('[ProgressReporter] Notification queued due to connection issues', {
        planId: notification.planId,
      });
      return { success: true }; // Still considered success, just queued

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ProgressReporter] Failed to send notification', {
        error: errorMessage,
        planId: notification.planId,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Format a number with K/M suffixes
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }

  /**
   * Truncate a file path for display
   */
  private truncatePath(filePath: string, maxLength: number = 40): string {
    if (filePath.length <= maxLength) {
      return filePath;
    }
    const filename = filePath.split('/').pop() || filePath;
    if (filename.length >= maxLength - 3) {
      return `...${filename.slice(-(maxLength - 3))}`;
    }
    return `...${filePath.slice(-(maxLength - 3))}`;
  }

  /**
   * Format a time as "X ago" string
   */
  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) {
      return 'just now';
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}

// Export singleton instance
export const progressReporterService = new ProgressReporterService();
