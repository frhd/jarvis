import { createLogger } from '../../utils/logger';
import {
  getErrorMessage,
  Timing,
  type HealthStatus,
  type ComponentHealth,
} from '../../utils/index.js';
import type {
  SystemHealth,
  HealthCheckOptions,
  HealthCheckFn,
  RegisteredCheck,
} from './types.js';

const logger = createLogger('HealthService');

// ============================================================================
// Health Check Service
// ============================================================================

export class HealthService {
  private checks: Map<string, RegisteredCheck> = new Map();
  private lastResults: Map<string, ComponentHealth> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private healthChangeCallbacks: Set<(health: SystemHealth) => void> = new Set();
  private previousSystemStatus: HealthStatus | null = null;

  private static readonly DEFAULT_OPTIONS: Required<HealthCheckOptions> = {
    interval: 30000, // 30 seconds
    timeout: 5000,   // 5 seconds
    critical: false,
  };

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a health check function
   */
  registerCheck(
    name: string,
    checkFn: HealthCheckFn,
    options: HealthCheckOptions = {}
  ): void {
    const mergedOptions: Required<HealthCheckOptions> = {
      ...HealthService.DEFAULT_OPTIONS,
      ...options,
    };

    this.checks.set(name, {
      name,
      checkFn,
      options: mergedOptions,
    });

    logger.info('Health check registered', { name, options: mergedOptions });
  }

  /**
   * Remove a health check
   */
  unregisterCheck(name: string): boolean {
    const removed = this.checks.delete(name);
    if (removed) {
      this.lastResults.delete(name);
      logger.info('Health check unregistered', { name });
    }
    return removed;
  }

  // ============================================================================
  // Health Check Execution
  // ============================================================================

  /**
   * Run all registered health checks in parallel
   */
  async checkAll(): Promise<ComponentHealth[]> {
    const timing = new Timing();
    const checkPromises: Promise<ComponentHealth>[] = [];

    for (const [name, check] of this.checks) {
      checkPromises.push(this.runCheck(name, check));
    }

    const results = await Promise.all(checkPromises);

    // Store results
    for (const result of results) {
      this.lastResults.set(result.name, result);
    }

    logger.debug('All health checks completed', {
      count: results.length,
      totalDurationMs: timing.elapsed(),
    });

    return results;
  }

  /**
   * Run a single health check with timeout
   */
  private async runCheck(name: string, check: RegisteredCheck): Promise<ComponentHealth> {
    const timing = new Timing();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Health check timed out after ${check.options.timeout}ms`));
        }, check.options.timeout);
      });

      const result = await Promise.race([check.checkFn(), timeoutPromise]);
      return result;
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: timing.elapsed(),
        error: getErrorMessage(error),
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Get aggregated system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const components = await this.checkAll();
    const status = this.determineSystemStatus(components);

    const health: SystemHealth = {
      status,
      components,
      timestamp: new Date(),
    };

    // Check for status changes and notify
    if (this.previousSystemStatus !== null && this.previousSystemStatus !== status) {
      this.notifyHealthChange(health);
    }
    this.previousSystemStatus = status;

    return health;
  }

  /**
   * Get health status for a specific component
   */
  async getComponentHealth(name: string): Promise<ComponentHealth | null> {
    const check = this.checks.get(name);
    if (!check) {
      return null;
    }

    const result = await this.runCheck(name, check);
    this.lastResults.set(name, result);
    return result;
  }

  /**
   * Quick boolean check if system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.getSystemHealth();
    return health.status === 'healthy';
  }

  /**
   * Get cached results without running checks
   */
  getCachedHealth(): SystemHealth {
    const components = Array.from(this.lastResults.values());
    return {
      status: this.determineSystemStatus(components),
      components,
      timestamp: new Date(),
    };
  }

  /**
   * Manually mark a component as healthy (used by recovery service)
   */
  markHealthy(name: string): void {
    const existingResult = this.lastResults.get(name);
    const newResult: ComponentHealth = {
      name,
      status: 'healthy',
      lastChecked: new Date(),
      metadata: existingResult?.metadata,
    };
    this.lastResults.set(name, newResult);
    logger.info('Component marked healthy', { name });
  }

  /**
   * Manually mark a component as unhealthy (used for immediate status updates)
   */
  markUnhealthy(name: string, error?: string): void {
    const existingResult = this.lastResults.get(name);
    const newResult: ComponentHealth = {
      name,
      status: 'unhealthy',
      error,
      lastChecked: new Date(),
      metadata: existingResult?.metadata,
    };
    this.lastResults.set(name, newResult);
    logger.warn('Component marked unhealthy', { name, error });
  }

  /**
   * Manually mark a component as degraded
   */
  markDegraded(name: string, error?: string): void {
    const existingResult = this.lastResults.get(name);
    const newResult: ComponentHealth = {
      name,
      status: 'degraded',
      error,
      lastChecked: new Date(),
      metadata: existingResult?.metadata,
    };
    this.lastResults.set(name, newResult);
    logger.warn('Component marked degraded', { name, error });
  }

  // ============================================================================
  // Status Determination
  // ============================================================================

  /**
   * Determine overall system status based on component health
   */
  private determineSystemStatus(components: ComponentHealth[]): HealthStatus {
    if (components.length === 0) {
      return 'healthy'; // No checks registered
    }

    let hasUnhealthyCritical = false;
    let hasUnhealthyNonCritical = false;
    let hasDegraded = false;

    for (const component of components) {
      const check = this.checks.get(component.name);
      const isCritical = check?.options.critical ?? false;

      if (component.status === 'unhealthy') {
        if (isCritical) {
          hasUnhealthyCritical = true;
        } else {
          hasUnhealthyNonCritical = true;
        }
      } else if (component.status === 'degraded') {
        hasDegraded = true;
      }
    }

    // Any critical component unhealthy = system unhealthy
    if (hasUnhealthyCritical) {
      return 'unhealthy';
    }

    // Non-critical components unhealthy = system degraded
    if (hasUnhealthyNonCritical || hasDegraded) {
      return 'degraded';
    }

    return 'healthy';
  }

  // ============================================================================
  // Continuous Monitoring
  // ============================================================================

  /**
   * Start periodic health checks
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      logger.warn('Monitoring already started');
      return;
    }

    logger.info('Starting health monitoring', { intervalMs });

    // Run initial check
    this.getSystemHealth().catch((err) => {
      logger.error('Initial health check failed', { error: err.message });
    });

    this.monitoringInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        logger.debug('Periodic health check completed', {
          status: health.status,
          componentCount: health.components.length,
        });
      } catch (error) {
        logger.error('Periodic health check failed', {
          error: getErrorMessage(error),
        });
      }
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Health monitoring stopped');
    }
  }

  /**
   * Subscribe to health status changes
   */
  onHealthChange(callback: (health: SystemHealth) => void): () => void {
    this.healthChangeCallbacks.add(callback);
    return () => {
      this.healthChangeCallbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of health change
   */
  private notifyHealthChange(health: SystemHealth): void {
    logger.info('System health status changed', {
      previousStatus: this.previousSystemStatus,
      newStatus: health.status,
    });

    for (const callback of this.healthChangeCallbacks) {
      try {
        callback(health);
      } catch (error) {
        logger.error('Health change callback error', {
          error: getErrorMessage(error),
        });
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const healthService = new HealthService();
