import { createLogger } from '../utils/logger';
import { MetricsService } from './metrics.service';

const logger = createLogger('ErrorTracking');

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ErrorCode =
  | 'UNKNOWN_ERROR'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'LLM_ERROR'
  | 'TELEGRAM_ERROR'
  | 'QUEUE_ERROR'
  | 'MEDIA_ERROR'
  | 'CONFIG_ERROR'
  | 'CIRCUIT_BREAKER_ERROR'
  | 'EMBEDDING_ERROR'
  | 'CACHE_ERROR';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode = 'UNKNOWN_ERROR',
    public readonly severity: ErrorSeverity = 'medium',
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface TrackedError {
  id: string;
  timestamp: number;
  code: ErrorCode;
  severity: ErrorSeverity;
  message: string;
  context?: Record<string, unknown>;
  stackTrace?: string;
  correlationId?: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface ErrorCount {
  code?: ErrorCode;
  severity?: ErrorSeverity;
  count: number;
}

export interface ErrorRate {
  perMinute: number;
  perHour: number;
  total: number;
  timeRange: TimeRange;
}

export interface TopError {
  code: ErrorCode;
  count: number;
  lastOccurrence: number;
  severity: ErrorSeverity;
}

export interface ErrorTrend {
  code: ErrorCode;
  currentCount: number;
  previousCount: number;
  changePercent: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface ErrorReport {
  generatedAt: number;
  timeRange: TimeRange;
  totalErrors: number;
  errorsByCode: ErrorCount[];
  errorsBySeverity: ErrorCount[];
  errorRate: ErrorRate;
  topErrors: TopError[];
  trends: ErrorTrend[];
  criticalErrors: TrackedError[];
}

class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private count: number = 0;

  constructor(private readonly maxSize: number) {
    this.buffer = new Array(maxSize);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    const start = this.count < this.maxSize ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  getRecent(limit: number): T[] {
    const all = this.getAll();
    return all.slice(-limit);
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }
}

/**
 * ErrorTrackingService - Track, aggregate, and analyze errors
 *
 * Features: Circular buffer storage (max 1000), error categorization,
 * aggregation, rate calculation, spike detection, and trend analysis.
 */
export class ErrorTrackingService {
  private errors: CircularBuffer<TrackedError>;
  private metricsService: MetricsService | null = null;
  private errorIdCounter: number = 0;
  private readonly maxErrors: number;

  constructor(config?: { maxErrors?: number }) {
    this.maxErrors = config?.maxErrors ?? 1000;
    this.errors = new CircularBuffer(this.maxErrors);
    logger.info('Service initialized', { maxErrors: this.maxErrors });
  }

  setMetricsService(metricsService: MetricsService): void {
    this.metricsService = metricsService;
    logger.debug('MetricsService attached');
  }

  trackError(
    error: Error | AppError | string,
    options?: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      context?: Record<string, unknown>;
      correlationId?: string;
    }
  ): TrackedError {
    const startTime = Date.now();

    let message: string;
    let code: ErrorCode;
    let severity: ErrorSeverity;
    let stackTrace: string | undefined;

    if (error instanceof AppError) {
      message = error.message;
      code = options?.code ?? error.code;
      severity = options?.severity ?? error.severity;
      stackTrace = error.stack;
    } else if (error instanceof Error) {
      message = error.message;
      code = options?.code ?? 'UNKNOWN_ERROR';
      severity = options?.severity ?? 'medium';
      stackTrace = error.stack;
    } else {
      message = String(error);
      code = options?.code ?? 'UNKNOWN_ERROR';
      severity = options?.severity ?? 'medium';
    }

    const trackedError: TrackedError = {
      id: `err_${++this.errorIdCounter}_${Date.now()}`,
      timestamp: Date.now(),
      code,
      severity,
      message,
      context: options?.context,
      stackTrace,
      correlationId: options?.correlationId,
    };

    this.errors.push(trackedError);

    if (this.metricsService) {
      this.metricsService.increment('jarvis_errors_total', { code, severity });
      const duration = Date.now() - startTime;
      this.metricsService.histogram('jarvis_error_handling_duration_ms', duration, { code });
    }

    this.logError(trackedError);

    return trackedError;
  }

  getErrorsByCode(code: ErrorCode, timeRange?: TimeRange): ErrorCount {
    const errors = this.getErrorsInRange(timeRange);
    const count = errors.filter((e) => e.code === code).length;
    return { code, count };
  }

  getErrorsBySeverity(severity: ErrorSeverity, timeRange?: TimeRange): ErrorCount {
    const errors = this.getErrorsInRange(timeRange);
    const count = errors.filter((e) => e.severity === severity).length;
    return { severity, count };
  }

  getErrorRate(timeRange?: TimeRange): ErrorRate {
    const now = Date.now();
    const range = timeRange ?? {
      start: now - 60 * 60 * 1000,
      end: now,
    };

    const errors = this.getErrorsInRange(range);
    const total = errors.length;
    const durationMs = range.end - range.start;
    const durationMinutes = durationMs / (60 * 1000);
    const durationHours = durationMs / (60 * 60 * 1000);

    return {
      perMinute: durationMinutes > 0 ? total / durationMinutes : 0,
      perHour: durationHours > 0 ? total / durationHours : 0,
      total,
      timeRange: range,
    };
  }

  getTopErrors(limit: number = 10, timeRange?: TimeRange): TopError[] {
    const errors = this.getErrorsInRange(timeRange);
    const errorMap = new Map<ErrorCode, { count: number; lastOccurrence: number; severity: ErrorSeverity }>();

    for (const error of errors) {
      const existing = errorMap.get(error.code);
      if (existing) {
        existing.count++;
        if (error.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = error.timestamp;
          existing.severity = error.severity;
        }
      } else {
        errorMap.set(error.code, {
          count: 1,
          lastOccurrence: error.timestamp,
          severity: error.severity,
        });
      }
    }

    const topErrors: TopError[] = Array.from(errorMap.entries())
      .map(([code, data]) => ({
        code,
        count: data.count,
        lastOccurrence: data.lastOccurrence,
        severity: data.severity,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return topErrors;
  }

  detectSpike(code: ErrorCode, threshold: number, windowMs: number = 60000): boolean {
    const now = Date.now();
    const timeRange = { start: now - windowMs, end: now };
    const errorCount = this.getErrorsByCode(code, timeRange);
    return errorCount.count > threshold;
  }

  getErrorTrends(periodMs: number = 60 * 60 * 1000): ErrorTrend[] {
    const now = Date.now();
    const currentRange = { start: now - periodMs, end: now };
    const previousRange = { start: now - 2 * periodMs, end: now - periodMs };

    const currentErrors = this.getErrorsInRange(currentRange);
    const previousErrors = this.getErrorsInRange(previousRange);

    const currentCounts = new Map<ErrorCode, number>();
    const previousCounts = new Map<ErrorCode, number>();

    for (const error of currentErrors) {
      currentCounts.set(error.code, (currentCounts.get(error.code) ?? 0) + 1);
    }

    for (const error of previousErrors) {
      previousCounts.set(error.code, (previousCounts.get(error.code) ?? 0) + 1);
    }

    const allCodes = new Set([...currentCounts.keys(), ...previousCounts.keys()]);

    const trends: ErrorTrend[] = [];
    for (const code of allCodes) {
      const currentCount = currentCounts.get(code) ?? 0;
      const previousCount = previousCounts.get(code) ?? 0;

      let changePercent = 0;
      let trend: ErrorTrend['trend'] = 'stable';

      if (previousCount === 0 && currentCount > 0) {
        changePercent = 100;
        trend = 'increasing';
      } else if (previousCount > 0) {
        changePercent = ((currentCount - previousCount) / previousCount) * 100;
        if (changePercent > 10) {
          trend = 'increasing';
        } else if (changePercent < -10) {
          trend = 'decreasing';
        }
      }

      trends.push({
        code,
        currentCount,
        previousCount,
        changePercent,
        trend,
      });
    }

    return trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  }

  generateErrorReport(timeRange?: TimeRange): ErrorReport {
    const now = Date.now();
    const range = timeRange ?? {
      start: now - 24 * 60 * 60 * 1000,
      end: now,
    };

    const errors = this.getErrorsInRange(range);

    const codeCounts = new Map<ErrorCode, number>();
    for (const error of errors) {
      codeCounts.set(error.code, (codeCounts.get(error.code) ?? 0) + 1);
    }
    const errorsByCode: ErrorCount[] = Array.from(codeCounts.entries()).map(([code, count]) => ({
      code,
      count,
    }));

    const severityCounts = new Map<ErrorSeverity, number>();
    for (const error of errors) {
      severityCounts.set(error.severity, (severityCounts.get(error.severity) ?? 0) + 1);
    }
    const errorsBySeverity: ErrorCount[] = Array.from(severityCounts.entries()).map(
      ([severity, count]) => ({
        severity,
        count,
      })
    );

    const criticalErrors = errors
      .filter((e) => e.severity === 'critical')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    return {
      generatedAt: now,
      timeRange: range,
      totalErrors: errors.length,
      errorsByCode,
      errorsBySeverity,
      errorRate: this.getErrorRate(range),
      topErrors: this.getTopErrors(10, range),
      trends: this.getErrorTrends((range.end - range.start) / 2),
      criticalErrors,
    };
  }

  getRecentErrors(limit: number = 50): TrackedError[] {
    return this.errors.getRecent(limit).reverse();
  }

  getErrorsByCorrelationId(correlationId: string): TrackedError[] {
    return this.errors.getAll().filter((e) => e.correlationId === correlationId);
  }

  clear(): void {
    this.errors.clear();
    this.errorIdCounter = 0;
    logger.info('Error tracking cleared');
  }

  getTotalErrorCount(): number {
    return this.errors.size();
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down...');
    this.clear();
    logger.info('Shutdown complete');
  }

  private getErrorsInRange(timeRange?: TimeRange): TrackedError[] {
    const allErrors = this.errors.getAll();

    if (!timeRange) {
      return allErrors;
    }

    return allErrors.filter((e) => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end);
  }

  private logError(error: TrackedError): void {
    const logData = {
      errorId: error.id,
      code: error.code,
      severity: error.severity,
      correlationId: error.correlationId,
      context: error.context,
    };

    switch (error.severity) {
      case 'critical':
        logger.error(`CRITICAL: ${error.message}`, logData);
        break;
      case 'high':
        logger.error(error.message, logData);
        break;
      case 'medium':
        logger.warn(error.message, logData);
        break;
      case 'low':
        logger.info(error.message, logData);
        break;
    }
  }
}

export const errorTrackingService = new ErrorTrackingService();
