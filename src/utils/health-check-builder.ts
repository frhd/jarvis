/**
 * Health Check Builder Utility
 *
 * Reduces boilerplate in health check factory functions by providing
 * a standardized wrapper that handles timing, error catching, and
 * status formatting.
 */

import { Timing } from './timing.js';
import { getErrorMessage } from './error-utils.js';

/** Health status values */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Full health check result with all fields */
export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
  message?: string;
  lastChecked: Date;
  metadata?: Record<string, unknown>;
}

/** Partial result returned from check functions (name, lastChecked, latencyMs added by builder) */
export type HealthCheckResult = Omit<ComponentHealth, 'name' | 'lastChecked' | 'latencyMs'>;

/**
 * Builder utility for creating standardized health checks.
 *
 * @example
 * ```typescript
 * export function createDatabaseHealthCheck(): HealthCheckFn {
 *   return () => HealthCheckBuilder.execute('database', async () => {
 *     const result = db.prepare('SELECT 1').get();
 *     if (!result) {
 *       return HealthCheckBuilder.unhealthy('Database query failed');
 *     }
 *     return HealthCheckBuilder.healthy({ walMode: true });
 *   });
 * }
 * ```
 */
export class HealthCheckBuilder {
  /**
   * Execute a health check function with automatic timing and error handling.
   *
   * @param name - Component name for the health check
   * @param checkFn - Async function that performs the check and returns a result
   * @returns Full ComponentHealth result with timing and metadata
   */
  static async execute(
    name: string,
    checkFn: () => Promise<HealthCheckResult>
  ): Promise<ComponentHealth> {
    const timing = new Timing();
    const lastChecked = new Date();

    try {
      const result = await checkFn();
      return {
        ...result,
        name,
        lastChecked,
        latencyMs: timing.elapsed(),
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: timing.elapsed(),
        error: getErrorMessage(error),
        lastChecked,
      };
    }
  }

  /**
   * Create a healthy status result.
   *
   * @param metadata - Optional diagnostic information
   */
  static healthy(metadata?: Record<string, unknown>): HealthCheckResult {
    return { status: 'healthy', metadata };
  }

  /**
   * Create a degraded status result (for warnings or non-critical issues).
   *
   * @param message - Description of the degraded state
   * @param metadata - Optional diagnostic information
   */
  static degraded(message: string, metadata?: Record<string, unknown>): HealthCheckResult {
    return { status: 'degraded', message, metadata };
  }

  /**
   * Create an unhealthy status result (for critical failures).
   *
   * @param error - Error description
   * @param metadata - Optional diagnostic information
   */
  static unhealthy(error: string, metadata?: Record<string, unknown>): HealthCheckResult {
    return { status: 'unhealthy', error, metadata };
  }

  /**
   * Create a result based on a condition.
   * Returns healthy if condition is true, otherwise unhealthy.
   *
   * @param condition - Boolean condition to evaluate
   * @param errorMessage - Error message if condition is false
   * @param metadata - Optional diagnostic information
   */
  static fromCondition(
    condition: boolean,
    errorMessage: string,
    metadata?: Record<string, unknown>
  ): HealthCheckResult {
    return condition
      ? HealthCheckBuilder.healthy(metadata)
      : HealthCheckBuilder.unhealthy(errorMessage, metadata);
  }

  /**
   * Create a result based on threshold comparison.
   * Returns healthy if value is below warning threshold,
   * degraded if between warning and critical, unhealthy if above critical.
   *
   * @param value - Current value to check
   * @param warningThreshold - Threshold for degraded status
   * @param criticalThreshold - Threshold for unhealthy status
   * @param metricName - Name of the metric being checked
   * @param metadata - Optional additional metadata
   */
  static fromThresholds(
    value: number,
    warningThreshold: number,
    criticalThreshold: number,
    metricName: string,
    metadata?: Record<string, unknown>
  ): HealthCheckResult {
    const fullMetadata = { ...metadata, [metricName]: value };

    if (value >= criticalThreshold) {
      return HealthCheckBuilder.unhealthy(
        `${metricName} (${value}) exceeds critical threshold (${criticalThreshold})`,
        fullMetadata
      );
    }

    if (value >= warningThreshold) {
      return HealthCheckBuilder.degraded(
        `${metricName} (${value}) exceeds warning threshold (${warningThreshold})`,
        fullMetadata
      );
    }

    return HealthCheckBuilder.healthy(fullMetadata);
  }
}
