/**
 * Proactive Messaging System Types
 *
 * Defines types for the proactive messaging system that allows Jarvis
 * to initiate conversations based on schedules, context, and events.
 */

// ============================================================================
// Enum Types
// ============================================================================

export type ProactiveScheduleType = 'at' | 'every' | 'cron';

export type ProactiveMessageType =
  | 'greeting'
  | 'checkin'
  | 'summary'
  | 'reminder'
  | 'followup'
  | 'custom';

export type ProactiveJobStatus = 'ok' | 'error' | 'skipped' | 'running';

export type ProactiveDeliveryStatus = 'sent' | 'queued' | 'failed';

// ============================================================================
// Context Configuration
// ============================================================================

export interface ProactiveContextConfig {
  /** Include user memories in context (default: true) */
  includeMemories?: boolean;
  /** Include user preferences in context (default: true) */
  includePreferences?: boolean;
  /** Number of recent messages to include (default: 5) */
  recentMessages?: number;
  /** Include conversation summaries (default: false) */
  includeSummaries?: boolean;
  /** Custom context keys to include */
  customContext?: Record<string, unknown>;
}

// ============================================================================
// Token Usage Tracking
// ============================================================================

export interface ProactiveTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

// ============================================================================
// Job Creation/Update Types
// ============================================================================

export interface CreateProactiveJobInput {
  name: string;
  description?: string;
  enabled?: boolean;
  scheduleType: ProactiveScheduleType;
  scheduleValue: string;
  timezone?: string;
  targetChatId?: string;
  targetSenderId?: string;
  messageType: ProactiveMessageType;
  messageTemplate?: string;
  contextConfig?: ProactiveContextConfig;
  deleteAfterRun?: boolean;
}

export interface UpdateProactiveJobInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  scheduleType?: ProactiveScheduleType;
  scheduleValue?: string;
  timezone?: string;
  targetChatId?: string;
  targetSenderId?: string;
  messageType?: ProactiveMessageType;
  messageTemplate?: string;
  contextConfig?: ProactiveContextConfig;
  deleteAfterRun?: boolean;
}

// ============================================================================
// Job Query Types
// ============================================================================

export interface ProactiveJobFilters {
  enabled?: boolean;
  messageType?: ProactiveMessageType;
  scheduleType?: ProactiveScheduleType;
  targetChatId?: string;
  targetSenderId?: string;
}

export interface ProactiveRunFilters {
  jobId?: string;
  status?: ProactiveJobStatus;
  deliveryStatus?: ProactiveDeliveryStatus;
  startAfter?: Date;
  startBefore?: Date;
}

// ============================================================================
// Execution Types
// ============================================================================

/**
 * Execution context for a proactive job.
 * Uses generic type T to avoid circular dependency with db schema types.
 * When used, T should be ProactiveJob from types/index.ts
 */
export interface ProactiveExecutionContext<T = unknown> {
  job: T;
  now: Date;
  timezone: string;
  isQuietHours: boolean;
  memories?: Array<{ content: string; type: string }>;
  preferences?: Array<{ key: string; value: string; category: string }>;
  recentMessages?: Array<{ text: string; createdAt: Date; isBot: boolean }>;
}

export interface ProactiveExecutionResult {
  success: boolean;
  status: ProactiveJobStatus;
  deliveryStatus?: ProactiveDeliveryStatus;
  generatedMessage?: string;
  error?: string;
  tokenUsage?: ProactiveTokenUsage;
  durationMs: number;
}

// ============================================================================
// Message Generation Types
// ============================================================================

export interface ProactiveMessageContext {
  messageType: ProactiveMessageType;
  timezone: string;
  localTime: Date;
  dayOfWeek: string;
  userName?: string;
  userPreferences?: Array<{ key: string; value: string; category: string }>;
  recentConversation?: Array<{ text: string; createdAt: Date; isBot: boolean }>;
  memories?: Array<{ content: string; type: string }>;
  recentProactiveMessages?: Array<{ text: string; sentAt: Date }>;
  customTemplate?: string;
  customContext?: Record<string, unknown>;
}

export interface ProactiveMessageResult {
  message: string;
  model: string;
  tokenUsage: ProactiveTokenUsage;
}

// ============================================================================
// Scheduler Types
// ============================================================================

export interface SchedulerState {
  isRunning: boolean;
  nextWakeTime: Date | null;
  activeJobCount: number;
  lastTickAt: Date | null;
}

/**
 * Info about a scheduled job.
 * Uses generic type T to avoid circular dependency with db schema types.
 * When used, T should be ProactiveJob from types/index.ts
 */
export interface ScheduledJobInfo<T = unknown> {
  job: T;
  nextRunAt: Date;
  timeUntilMs: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ProactiveConfig {
  enabled: boolean;
  defaultTimezone: string;
  maxConcurrentJobs: number;
  stuckJobThresholdMs: number;
  defaultContextMessages: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  respectQuietHours: boolean;
  targetChatId?: string;
}

// ============================================================================
// Default Job Templates
// ============================================================================

export interface DefaultJobTemplate {
  name: string;
  description: string;
  scheduleType: ProactiveScheduleType;
  scheduleValue: string;
  messageType: ProactiveMessageType;
  contextConfig: ProactiveContextConfig;
}

export const DEFAULT_JOB_TEMPLATES: DefaultJobTemplate[] = [
  {
    name: 'Morning Greeting',
    description: 'Daily morning greeting at 8am',
    scheduleType: 'cron',
    scheduleValue: '0 8 * * *',
    messageType: 'greeting',
    contextConfig: {
      includeMemories: true,
      includePreferences: true,
      recentMessages: 3,
    },
  },
  {
    name: 'Daily Summary',
    description: 'Daily conversation summary at 7pm',
    scheduleType: 'cron',
    scheduleValue: '0 19 * * *',
    messageType: 'summary',
    contextConfig: {
      includeMemories: false,
      includePreferences: true,
      recentMessages: 10,
      includeSummaries: true,
    },
  },
  {
    name: 'Idle Check-in',
    description: 'Check in after 12 hours of no messages',
    scheduleType: 'every',
    scheduleValue: '43200000', // 12 hours in ms
    messageType: 'checkin',
    contextConfig: {
      includeMemories: true,
      includePreferences: true,
      recentMessages: 5,
    },
  },
  {
    name: 'Weekly Recap',
    description: 'Weekly summary on Sunday at 6pm',
    scheduleType: 'cron',
    scheduleValue: '0 18 * * 0',
    messageType: 'summary',
    contextConfig: {
      includeMemories: true,
      includePreferences: true,
      recentMessages: 0,
      includeSummaries: true,
    },
  },
];
