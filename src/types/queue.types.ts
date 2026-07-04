/**
 * Queue System Types
 * Advanced queue management with priority escalation, circuit breaker, and dead letter queue
 */

export enum PriorityLevel {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3,
  VIP = 4,
}

export interface EscalationRule {
  ageThresholdMs: number;
  priorityBoost: number;
  maxPriority: number;
}

export interface PriorityConfig {
  baselinePriority: number;
  escalationRules: EscalationRule[];
  vipUserIds: string[];
  vipChatIds: string[];
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  baselinePriority: PriorityLevel.NORMAL,
  escalationRules: [
    {
      ageThresholdMs: 5 * 60 * 1000, // 5 minutes
      priorityBoost: 1,
      maxPriority: PriorityLevel.HIGH,
    },
    {
      ageThresholdMs: 15 * 60 * 1000, // 15 minutes
      priorityBoost: 2,
      maxPriority: PriorityLevel.URGENT,
    },
    {
      ageThresholdMs: 30 * 60 * 1000, // 30 minutes
      priorityBoost: 3,
      maxPriority: PriorityLevel.VIP,
    },
  ],
  vipUserIds: [],
  vipChatIds: [],
};

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  /** Random jitter factor (0-1). Actual delay = calculatedDelay * (1 ± jitterFactor) */
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenRequests: 3,
};

export enum CircuitBreakerStateEnum {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface ErrorRecord {
  timestamp: Date;
  error: string;
  attempt: number;
}

export interface DeadLetterItemWithParsedErrors {
  id: string;
  originalQueueId: string;
  messageId: string;
  reason: string;
  errorHistory: ErrorRecord[];
  createdAt: Date;
  lastAttemptAt: Date;
  retryCount: number;
  metadata: Record<string, unknown>;
}

export enum DLQReason {
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
  MANUAL_MOVE = 'MANUAL_MOVE',
}

export interface DLQStats {
  total: number;
  byReason: Record<string, number>;
  oldestItemAge?: number;
  recentFailures: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  byPriority: Record<PriorityLevel, number>;
  messagesPerSecond: number;
  averageProcessingTimeMs: number;
  medianProcessingTimeMs: number;
  p95ProcessingTimeMs: number;
  p99ProcessingTimeMs: number;
  successRate: number;
  retryRate: number;
  deadLetterRate: number;
  oldestPendingAgeMs: number;
  averagePendingAgeMs: number;
  circuitBreakerState: CircuitBreakerStateEnum;
  circuitBreakerFailures: number;
  circuitBreakerLastOpen?: Date;
  totalRetries: number;
  averageRetriesPerMessage: number;
  windowStartTime: Date;
  windowEndTime: Date;
}

export interface EnqueueOptions {
  priority?: number;
  timeoutMs?: number;
  retryConfig?: Partial<RetryConfig>;
  metadata?: Record<string, unknown>;
}

export interface DequeueOptions {
  batchSize?: number;
  minPriority?: number;
  lockDurationMs?: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  priority: number;
  reason: string;
}

export interface QueueEvent {
  type: QueueEventType;
  timestamp: Date;
  queueId: string;
  messageId: string;
  data?: Record<string, unknown>;
}

export enum QueueEventType {
  ENQUEUED = 'enqueued',
  DEQUEUED = 'dequeued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
  PRIORITY_ESCALATED = 'priority_escalated',
  DEAD_LETTERED = 'dead_lettered',
  CIRCUIT_OPENED = 'circuit_opened',
  CIRCUIT_CLOSED = 'circuit_closed',
  CIRCUIT_HALF_OPENED = 'circuit_half_opened',
}

export interface QueueHealthMetrics {
  healthScore: number;
  indicators: {
    queueDepth: HealthIndicator;
    processingSpeed: HealthIndicator;
    errorRate: HealthIndicator;
    circuitBreakerStatus: HealthIndicator;
    ageDistribution: HealthIndicator;
  };
  recommendations: string[];
  timestamp: Date;
}

export interface HealthIndicator {
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;
  value: number | string;
  threshold: number | string;
  message: string;
}

export interface QueueConfig {
  priorityConfig: PriorityConfig;
  retryConfig: RetryConfig;
  circuitBreakerConfig: CircuitBreakerConfig;
  maxConcurrentProcessing: number;
  processingTimeoutMs: number;
  maxQueueSize?: number;
  maxDeadLetterSize?: number;
  enableMetrics: boolean;
  metricsWindowMs: number;
  enableAutoEscalation: boolean;
  escalationCheckIntervalMs: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  priorityConfig: DEFAULT_PRIORITY_CONFIG,
  retryConfig: DEFAULT_RETRY_CONFIG,
  circuitBreakerConfig: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  maxConcurrentProcessing: 5,
  processingTimeoutMs: 30000,
  maxQueueSize: 10000,
  maxDeadLetterSize: 1000,
  enableMetrics: true,
  metricsWindowMs: 60000,
  enableAutoEscalation: true,
  escalationCheckIntervalMs: 60000,
};
