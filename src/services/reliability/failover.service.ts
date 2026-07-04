/**
 * Failover Service
 *
 * Handles primary/backup switching, health-based routing, and graceful degradation.
 * Part of the reliability hardening subsystem.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger';
import type { HealthStatus } from '../health.service';

const logger = createLogger('FailoverService');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Service tier for prioritization
 */
export type ServiceTier = 'critical' | 'important' | 'standard' | 'optional';

/**
 * Degradation mode for the system
 */
export type DegradationMode = 'normal' | 'reduced' | 'minimal' | 'emergency';

/**
 * Failover strategy types
 */
export type FailoverStrategy = 'active-passive' | 'active-active' | 'round-robin' | 'weighted' | 'priority';

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  id: string;
  service: string;
  fallbackService?: string;
  fallbackFn?: (args: unknown, error: Error) => Promise<unknown>;
  priority: number;
  enabled: boolean;
  maxAttempts: number;
  delayMs: number;
  conditions?: string[];
}

/**
 * Backup service configuration
 */
export interface BackupServiceConfig {
  id: string;
  primaryService: string;
  backupService: string;
  strategy: FailoverStrategy;
  weight?: number;
  priority?: number;
  healthCheckIntervalMs: number;
  failoverThreshold: number;
  enabled: boolean;
}

/**
 * Failover event
 */
export interface FailoverEvent {
  id: string;
  fromService: string;
  toService: string;
  reason: string;
  timestamp: number;
  success: boolean;
  durationMs: number;
  automatic: boolean;
}

/**
 * Failover configuration
 */
export interface FailoverConfig {
  enabled: boolean;
  gracefulDegradationEnabled: boolean;
  redundancyEnabled: boolean;
  degradationThresholds: {
    reduced: number;
    minimal: number;
    emergency: number;
  };
  serviceTiers: Record<string, ServiceTier>;
}

/**
 * Failover statistics
 */
export interface FailoverStats {
  totalFailovers: number;
  successfulFailovers: number;
  currentDegradationMode: DegradationMode;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: FailoverConfig = {
  enabled: true,
  gracefulDegradationEnabled: true,
  redundancyEnabled: true,
  degradationThresholds: {
    reduced: 0.7,
    minimal: 0.4,
    emergency: 0.2,
  },
  serviceTiers: {},
};

// ============================================================================
// Failover Service
// ============================================================================

/**
 * FailoverService - Primary/backup switching and graceful degradation
 *
 * Features:
 * 1. Fallback strategies for services
 * 2. Backup service management
 * 3. Graceful degradation based on system health
 * 4. Service tier-based availability
 */
export class FailoverService extends EventEmitter {
  private config: FailoverConfig;
  private stats: FailoverStats;

  // Degradation management
  private currentMode: DegradationMode = 'normal';
  private fallbacks: Map<string, FallbackConfig[]> = new Map();

  // Redundancy
  private backupServices: Map<string, BackupServiceConfig> = new Map();
  private activeService: Map<string, string> = new Map();

  // Failover history
  private failoverHistory: FailoverEvent[] = [];
  private readonly maxHistorySize = 1000;

  constructor(config?: Partial<FailoverConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = this.initializeStats();

    logger.info('[Failover] Service initialized', {
      gracefulDegradation: this.config.gracefulDegradationEnabled,
      redundancy: this.config.redundancyEnabled,
    });
  }

  // ============================================================================
  // Graceful Degradation
  // ============================================================================

  /**
   * Register a fallback strategy for a service
   */
  registerFallback(
    service: string,
    fallback: Omit<FallbackConfig, 'id' | 'service'>
  ): string {
    const id = nanoid();
    const fullFallback: FallbackConfig = {
      ...fallback,
      id,
      service,
    };

    const existing = this.fallbacks.get(service) || [];
    existing.push(fullFallback);
    existing.sort((a, b) => a.priority - b.priority);
    this.fallbacks.set(service, existing);

    logger.info('[Failover] Fallback registered', { service, id, priority: fallback.priority });
    return id;
  }

  /**
   * Get fallbacks for a service
   */
  getFallbacks(service: string): FallbackConfig[] {
    return this.fallbacks.get(service) || [];
  }

  /**
   * Execute with fallback support
   */
  async executeWithFallback<T>(
    service: string,
    primaryFn: () => Promise<T>,
    args?: unknown,
    onSuccess?: (service: string) => void,
    onFailure?: (service: string, error: Error) => void
  ): Promise<T> {
    if (!this.config.gracefulDegradationEnabled) {
      return primaryFn();
    }

    const fallbacks = this.fallbacks.get(service) || [];

    // Try primary first
    try {
      const result = await primaryFn();
      onSuccess?.(service);
      return result;
    } catch (error) {
      onFailure?.(service, error as Error);

      // Try fallbacks in priority order
      for (const fallback of fallbacks) {
        if (!fallback.enabled) continue;

        for (let attempt = 1; attempt <= fallback.maxAttempts; attempt++) {
          try {
            if (fallback.delayMs > 0 && attempt > 1) {
              await this.delay(fallback.delayMs * attempt);
            }

            let result: T;
            if (fallback.fallbackFn) {
              result = (await fallback.fallbackFn(args, error as Error)) as T;
            } else if (fallback.fallbackService) {
              // Would delegate to fallback service
              throw new Error(`Fallback service ${fallback.fallbackService} not directly callable`);
            } else {
              continue;
            }

            logger.info('[Failover] Fallback succeeded', {
              service,
              fallbackId: fallback.id,
              attempt,
            });

            return result;
          } catch (fallbackError) {
            logger.warn('[Failover] Fallback attempt failed', {
              service,
              fallbackId: fallback.id,
              attempt,
              error: (fallbackError as Error).message,
            });
          }
        }
      }

      // All fallbacks failed
      throw error;
    }
  }

  /**
   * Set the system degradation mode
   */
  setDegradationMode(mode: DegradationMode, reason: string): void {
    const previousMode = this.currentMode;
    this.currentMode = mode;
    this.stats.currentDegradationMode = mode;

    this.emit('degradation-change', { previousMode, newMode: mode, reason });

    logger.warn('[Failover] Degradation mode changed', {
      previousMode,
      newMode: mode,
      reason,
    });
  }

  /**
   * Get current degradation mode
   */
  getDegradationMode(): DegradationMode {
    return this.currentMode;
  }

  /**
   * Update degradation mode based on health ratio
   */
  updateDegradationFromHealthRatio(healthyRatio: number): void {
    let newMode: DegradationMode = 'normal';
    if (healthyRatio <= this.config.degradationThresholds.emergency) {
      newMode = 'emergency';
    } else if (healthyRatio <= this.config.degradationThresholds.minimal) {
      newMode = 'minimal';
    } else if (healthyRatio <= this.config.degradationThresholds.reduced) {
      newMode = 'reduced';
    }

    if (newMode !== this.currentMode) {
      this.setDegradationMode(newMode, `Health ratio: ${(healthyRatio * 100).toFixed(1)}%`);
    }
  }

  /**
   * Check if a service should be available based on degradation mode and tier
   */
  isServiceAvailable(service: string): boolean {
    const tier = this.config.serviceTiers[service] || 'standard';

    switch (this.currentMode) {
      case 'emergency':
        return tier === 'critical';
      case 'minimal':
        return tier === 'critical' || tier === 'important';
      case 'reduced':
        return tier !== 'optional';
      case 'normal':
      default:
        return true;
    }
  }

  /**
   * Set service tier
   */
  setServiceTier(service: string, tier: ServiceTier): void {
    this.config.serviceTiers[service] = tier;
    logger.debug('[Failover] Service tier set', { service, tier });
  }

  // ============================================================================
  // Redundancy Management
  // ============================================================================

  /**
   * Register a backup service
   */
  registerBackupService(config: Omit<BackupServiceConfig, 'id'>): string {
    const id = nanoid();
    const fullConfig: BackupServiceConfig = { ...config, id };
    this.backupServices.set(id, fullConfig);
    this.activeService.set(config.primaryService, config.primaryService);

    logger.info('[Failover] Backup service registered', {
      id,
      primary: config.primaryService,
      backup: config.backupService,
      strategy: config.strategy,
    });

    return id;
  }

  /**
   * Get active service (primary or backup)
   */
  getActiveService(primaryService: string): string {
    return this.activeService.get(primaryService) || primaryService;
  }

  /**
   * Switch to backup service
   */
  async switchToBackup(primaryService: string, reason: string): Promise<boolean> {
    for (const [_, config] of this.backupServices) {
      if (config.primaryService === primaryService && config.enabled) {
        const result = await this.executeFailover(primaryService, reason, config.backupService);
        return result.success;
      }
    }
    return false;
  }

  /**
   * Switch back to primary service
   */
  async switchToPrimary(primaryService: string, healthStatus?: HealthStatus): Promise<boolean> {
    const currentActive = this.activeService.get(primaryService);
    if (currentActive === primaryService) {
      return true; // Already on primary
    }

    // Check primary health before switching back
    if (healthStatus && healthStatus !== 'healthy') {
      logger.warn('[Failover] Primary service not healthy, staying on backup', {
        primary: primaryService,
        status: healthStatus,
      });
      return false;
    }

    this.activeService.set(primaryService, primaryService);
    logger.info('[Failover] Switched back to primary', { primaryService });
    return true;
  }

  // ============================================================================
  // Failover Orchestration
  // ============================================================================

  /**
   * Execute failover for a service
   */
  async executeFailover(
    fromService: string,
    reason: string,
    toService?: string
  ): Promise<FailoverEvent> {
    if (!this.config.enabled) {
      return {
        id: nanoid(),
        fromService,
        toService: toService || fromService,
        reason,
        timestamp: Date.now(),
        success: false,
        durationMs: 0,
        automatic: true,
      };
    }

    const startTime = Date.now();
    let targetService = toService;
    let success = false;

    // Find backup service if not specified
    if (!targetService) {
      for (const [_, config] of this.backupServices) {
        if (config.primaryService === fromService && config.enabled) {
          targetService = config.backupService;
          break;
        }
      }
    }

    if (!targetService) {
      logger.warn('[Failover] No backup service available', { fromService });
      targetService = fromService;
    } else {
      // Perform failover
      this.activeService.set(fromService, targetService);
      success = true;
      this.emit('failover', { fromService, toService: targetService, reason });
    }

    const event: FailoverEvent = {
      id: nanoid(),
      fromService,
      toService: targetService,
      reason,
      timestamp: Date.now(),
      success,
      durationMs: Date.now() - startTime,
      automatic: true,
    };

    this.recordFailoverEvent(event);
    this.stats.totalFailovers++;
    if (success) {
      this.stats.successfulFailovers++;
    }

    logger.info('[Failover] Failover executed', {
      from: fromService,
      to: targetService,
      success,
      reason,
    });

    return event;
  }

  // ============================================================================
  // Statistics and History
  // ============================================================================

  /**
   * Get failover statistics
   */
  getStats(): FailoverStats {
    return { ...this.stats };
  }

  /**
   * Get recent failover history
   */
  getFailoverHistory(limit: number = 10): FailoverEvent[] {
    return this.failoverHistory.slice(0, limit);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private initializeStats(): FailoverStats {
    return {
      totalFailovers: 0,
      successfulFailovers: 0,
      currentDegradationMode: 'normal',
    };
  }

  private recordFailoverEvent(event: FailoverEvent): void {
    this.failoverHistory.unshift(event);
    if (this.failoverHistory.length > this.maxHistorySize) {
      this.failoverHistory = this.failoverHistory.slice(0, this.maxHistorySize);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the failover service
   */
  async shutdown(): Promise<void> {
    logger.info('[Failover] Shutting down...');
    this.removeAllListeners();
    logger.info('[Failover] Shutdown complete');
  }
}

export default FailoverService;
