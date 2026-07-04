/**
 * Health Monitoring Service
 *
 * Handles continuous health checks, anomaly detection, and alert triggering.
 * Part of the reliability hardening subsystem.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import type { HealthStatus, ComponentHealth } from '../health.service';

const logger = createLogger('HealthMonitoringService');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Health check severity
 */
export type HealthCheckSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Health check result with enhanced info
 */
export interface EnhancedHealthCheck {
  component: string;
  status: HealthStatus;
  severity: HealthCheckSeverity;
  latencyMs: number;
  lastSuccess: number | null;
  consecutiveFailures: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Chaos injection configuration
 */
export interface ChaosInjectionConfig {
  enabled: boolean;
  faultProbability: number;
  targetServices: string[];
  faultTypes: ('latency' | 'error' | 'timeout')[];
  maxLatencyMs: number;
  excludeProduction: boolean;
}

/**
 * Health monitoring configuration
 */
export interface HealthMonitoringConfig {
  enabled: boolean;
  chaosEnabled: boolean;
  healthCheckIntervalMs: number;
  notificationEnabled: boolean;
}

/**
 * Health monitoring statistics
 */
export interface HealthMonitoringStats {
  servicesHealthy: number;
  servicesDegraded: number;
  servicesUnhealthy: number;
  lastHealthCheck: number | null;
  chaosExperimentsRun: number;
}

/**
 * Custom error for chaos injection
 */
export class ChaosError extends Error {
  public readonly code: string;
  public readonly service?: string;

  constructor(message: string, code: string, service?: string) {
    super(message);
    this.name = 'ChaosError';
    this.code = code;
    this.service = service;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChaosError);
    }
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: HealthMonitoringConfig = {
  enabled: true,
  chaosEnabled: false, // Disabled by default for safety
  healthCheckIntervalMs: 30000,
  notificationEnabled: true,
};

const DEFAULT_CHAOS_CONFIG: ChaosInjectionConfig = {
  enabled: false,
  faultProbability: 0.1,
  targetServices: [],
  faultTypes: ['latency', 'error'],
  maxLatencyMs: 5000,
  excludeProduction: true,
};

// ============================================================================
// Health Monitoring Service
// ============================================================================

/**
 * HealthMonitoringService - Continuous health checks and chaos engineering
 *
 * Features:
 * 1. Enhanced health check monitoring
 * 2. Continuous health monitoring with intervals
 * 3. Chaos engineering capabilities for testing
 * 4. Anomaly detection and alerting
 */
export class HealthMonitoringService extends EventEmitter {
  private config: HealthMonitoringConfig;
  private chaosConfig: ChaosInjectionConfig;
  private stats: HealthMonitoringStats;

  // Health monitoring
  private healthStates: Map<string, EnhancedHealthCheck> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private healthCheckFns: Map<string, () => Promise<ComponentHealth>> = new Map();

  // Chaos engineering
  private chaosActive: boolean = false;

  constructor(config?: Partial<HealthMonitoringConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chaosConfig = { ...DEFAULT_CHAOS_CONFIG };
    this.stats = this.initializeStats();

    logger.info('[HealthMonitoring] Service initialized', {
      healthCheckIntervalMs: this.config.healthCheckIntervalMs,
      chaosEnabled: this.config.chaosEnabled,
    });
  }

  // ============================================================================
  // Health Check Hardening
  // ============================================================================

  /**
   * Register a health check function
   */
  registerHealthCheck(
    component: string,
    checkFn: () => Promise<ComponentHealth>,
    severity: HealthCheckSeverity = 'warning'
  ): void {
    this.healthCheckFns.set(component, checkFn);
    this.healthStates.set(component, {
      component,
      status: 'healthy',
      severity,
      latencyMs: 0,
      lastSuccess: null,
      consecutiveFailures: 0,
    });

    logger.debug('[HealthMonitoring] Health check registered', { component, severity });
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(): Promise<EnhancedHealthCheck[]> {
    const results: EnhancedHealthCheck[] = [];

    for (const [component, checkFn] of this.healthCheckFns) {
      const startTime = Date.now();
      const currentState = this.healthStates.get(component)!;

      try {
        const health = await checkFn();
        const latencyMs = Date.now() - startTime;

        const enhancedHealth: EnhancedHealthCheck = {
          component,
          status: health.status,
          severity: currentState.severity,
          latencyMs,
          lastSuccess: health.status === 'healthy' ? Date.now() : currentState.lastSuccess,
          consecutiveFailures: health.status === 'healthy' ? 0 : currentState.consecutiveFailures + 1,
          message: health.error,
          metadata: health.metadata,
        };

        this.healthStates.set(component, enhancedHealth);
        results.push(enhancedHealth);

        // Emit event for consecutive failures
        if (health.status === 'unhealthy' && enhancedHealth.consecutiveFailures >= 3) {
          this.emit('health-critical', {
            component,
            consecutiveFailures: enhancedHealth.consecutiveFailures,
            status: health.status,
          });
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const enhancedHealth: EnhancedHealthCheck = {
          component,
          status: 'unhealthy',
          severity: currentState.severity,
          latencyMs,
          lastSuccess: currentState.lastSuccess,
          consecutiveFailures: currentState.consecutiveFailures + 1,
          message: (error as Error).message,
        };

        this.healthStates.set(component, enhancedHealth);
        results.push(enhancedHealth);
      }
    }

    this.updateHealthStats(results);
    this.stats.lastHealthCheck = Date.now();

    return results;
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, this.config.healthCheckIntervalMs);

    // Run initial check
    this.runHealthChecks().catch((err) => {
      logger.error('[HealthMonitoring] Initial health check failed', { error: err.message });
    });

    logger.info('[HealthMonitoring] Health monitoring started', {
      intervalMs: this.config.healthCheckIntervalMs,
    });
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('[HealthMonitoring] Health monitoring stopped');
    }
  }

  /**
   * Get current health state for a component
   */
  getHealthState(component: string): EnhancedHealthCheck | undefined {
    return this.healthStates.get(component);
  }

  /**
   * Get all health states
   */
  getAllHealthStates(): EnhancedHealthCheck[] {
    return Array.from(this.healthStates.values());
  }

  /**
   * Calculate healthy ratio
   */
  getHealthyRatio(): number {
    const total = this.healthStates.size;
    if (total === 0) return 1;

    let healthy = 0;
    for (const state of this.healthStates.values()) {
      if (state.status === 'healthy') {
        healthy++;
      }
    }

    return healthy / total;
  }

  /**
   * Record health success for a service
   */
  recordHealthSuccess(service: string): void {
    const state = this.healthStates.get(service);
    if (state) {
      state.consecutiveFailures = 0;
      state.lastSuccess = Date.now();
      state.status = 'healthy';
    }
  }

  /**
   * Record health failure for a service
   */
  recordHealthFailure(service: string, error: Error): void {
    const state = this.healthStates.get(service);
    if (state) {
      state.consecutiveFailures++;
      state.status = state.consecutiveFailures >= 3 ? 'unhealthy' : 'degraded';
      state.message = error.message;
    }
  }

  // ============================================================================
  // Chaos Engineering
  // ============================================================================

  /**
   * Enable chaos engineering mode
   */
  enableChaos(config?: Partial<ChaosInjectionConfig>): void {
    if (!this.config.chaosEnabled) {
      logger.warn('[HealthMonitoring] Chaos engineering is disabled in config');
      return;
    }

    if (config) {
      this.chaosConfig = { ...this.chaosConfig, ...config };
    }

    if (this.chaosConfig.excludeProduction && process.env.NODE_ENV === 'production') {
      logger.error('[HealthMonitoring] Cannot enable chaos in production environment');
      return;
    }

    this.chaosActive = true;
    this.emit('chaos-enabled', this.chaosConfig);

    logger.warn('[HealthMonitoring] Chaos engineering ENABLED', {
      faultProbability: this.chaosConfig.faultProbability,
      targetServices: this.chaosConfig.targetServices,
    });
  }

  /**
   * Disable chaos engineering mode
   */
  disableChaos(): void {
    this.chaosActive = false;
    this.emit('chaos-disabled');
    logger.info('[HealthMonitoring] Chaos engineering disabled');
  }

  /**
   * Check if chaos is active
   */
  isChaosActive(): boolean {
    return this.chaosActive;
  }

  /**
   * Check if chaos should be injected
   */
  shouldInjectChaos(service: string): boolean {
    if (!this.chaosActive || !this.chaosConfig.enabled) {
      return false;
    }

    if (this.chaosConfig.targetServices.length > 0 &&
        !this.chaosConfig.targetServices.includes(service)) {
      return false;
    }

    return Math.random() < this.chaosConfig.faultProbability;
  }

  /**
   * Inject chaos fault
   */
  async injectChaosFault(service: string): Promise<{ type: string; injected: boolean }> {
    if (!this.shouldInjectChaos(service)) {
      return { type: 'none', injected: false };
    }

    const faultTypes = this.chaosConfig.faultTypes;
    const faultType = faultTypes[Math.floor(Math.random() * faultTypes.length)];

    this.stats.chaosExperimentsRun++;

    switch (faultType) {
      case 'latency':
        const delay = Math.floor(Math.random() * this.chaosConfig.maxLatencyMs);
        await this.delay(delay);
        logger.debug('[HealthMonitoring] Chaos: Injected latency', { service, delayMs: delay });
        return { type: 'latency', injected: true };

      case 'error':
        logger.debug('[HealthMonitoring] Chaos: Injecting error', { service });
        throw new ChaosError(
          `Chaos injection: simulated error for ${service}`,
          'CHAOS_ERROR',
          service
        );

      case 'timeout':
        logger.debug('[HealthMonitoring] Chaos: Injecting timeout', { service });
        await this.delay(60000); // 60 second delay simulating timeout
        throw new ChaosError(
          `Chaos injection: timeout for ${service}`,
          'CHAOS_TIMEOUT',
          service
        );

      default:
        return { type: 'unknown', injected: false };
    }
  }

  /**
   * Wrap function with chaos injection
   */
  async withChaosInjection<T>(
    service: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (this.shouldInjectChaos(service)) {
      await this.injectChaosFault(service);
    }
    return fn();
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get health monitoring statistics
   */
  getStats(): HealthMonitoringStats {
    return { ...this.stats };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private initializeStats(): HealthMonitoringStats {
    return {
      servicesHealthy: 0,
      servicesDegraded: 0,
      servicesUnhealthy: 0,
      lastHealthCheck: null,
      chaosExperimentsRun: 0,
    };
  }

  private updateHealthStats(results: EnhancedHealthCheck[]): void {
    this.stats.servicesHealthy = results.filter(r => r.status === 'healthy').length;
    this.stats.servicesDegraded = results.filter(r => r.status === 'degraded').length;
    this.stats.servicesUnhealthy = results.filter(r => r.status === 'unhealthy').length;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the health monitoring service
   */
  async shutdown(): Promise<void> {
    logger.info('[HealthMonitoring] Shutting down...');
    this.stopHealthMonitoring();
    this.disableChaos();
    this.removeAllListeners();
    logger.info('[HealthMonitoring] Shutdown complete');
  }
}

export default HealthMonitoringService;
