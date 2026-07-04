/**
 * Recovery Service
 * Handles automatic recovery from failures with configurable strategies
 */

import { createLogger } from '../utils/logger';
import { getErrorMessage, Timing, executeCallbacksAsync } from '../utils/index.js';
import {
  RETRY_COOLDOWN_MS,
  RECONNECT_COOLDOWN_MS,
  RECOVERY_MAX_HISTORY_SIZE,
  RECOVERY_DEFAULT_COOLDOWN_MS,
  RECOVERY_DEFAULT_MAX_ATTEMPTS,
  RECOVERY_BACKOFF_MULTIPLIER,
  RECOVERY_MAX_COOLDOWN_MS,
} from '../config/constants.js';

const logger = createLogger('RecoveryService');

/**
 * Custom error for recovery-related issues
 */
export class RecoveryError extends Error {
  public readonly code: string;
  public readonly service: string;

  constructor(message: string, service: string, code: string = 'RECOVERY_ERROR') {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
    this.service = service;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RecoveryError);
    }
  }
}

// Recovery action types
export type RecoveryAction = 'restart' | 'reconnect' | 'retry' | 'fallback' | 'escalate';

// Recovery strategy definition
export interface RecoveryStrategy {
  service: string;
  action: RecoveryAction;
  condition: (error: Error) => boolean;
  maxAttempts: number;
  cooldownMs: number;
  handler?: () => Promise<boolean>;
  fallbackHandler?: () => Promise<boolean>;
}

// Recovery result
export interface RecoveryResult {
  success: boolean;
  action: RecoveryAction;
  attempts: number;
  duration: number;
  error?: string;
}

// Recovery history entry
export interface RecoveryHistoryEntry {
  service: string;
  action: RecoveryAction;
  timestamp: Date;
  success: boolean;
  attempts: number;
  duration: number;
  error?: string;
  triggeredBy?: string;
}

// Recovery statistics
export interface RecoveryStats {
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  successRate: number;
  averageDuration: number;
  byService: Record<string, {
    total: number;
    successful: number;
    failed: number;
    lastRecoveryAt?: Date;
  }>;
  byAction: Record<RecoveryAction, number>;
}

// Recovery state for a service
interface ServiceRecoveryState {
  isRecovering: boolean;
  consecutiveFailures: number;
  lastRecoveryAt?: Date;
  lastFailureAt?: Date;
  cooldownUntil?: Date;
  currentAttempts: number;
}

// Callback types
type RecoveryStartCallback = (service: string, action: RecoveryAction) => void;
type RecoveryCompleteCallback = (service: string, result: RecoveryResult) => void;
type HealthStatusCallback = (service: string, healthy: boolean) => void;

/**
 * Recovery Service
 *
 * Manages automatic recovery from service failures with:
 * - Configurable recovery strategies per service
 * - Cooldown management with exponential backoff
 * - Recovery history and statistics
 * - Health service integration
 * - Event-based notifications
 */
export class RecoveryService {
  // Registered recovery strategies
  private strategies: Map<string, RecoveryStrategy[]> = new Map();

  // Current recovery state per service
  private serviceStates: Map<string, ServiceRecoveryState> = new Map();

  // Auto-recovery enabled services
  private autoRecoveryEnabled: Set<string> = new Set();

  // Recovery history
  private history: RecoveryHistoryEntry[] = [];
  private maxHistorySize: number = RECOVERY_MAX_HISTORY_SIZE;

  // Event callbacks
  private onRecoveryStartCallbacks: RecoveryStartCallback[] = [];
  private onRecoveryCompleteCallbacks: RecoveryCompleteCallback[] = [];
  private healthStatusCallbacks: HealthStatusCallback[] = [];

  // Default configuration
  private defaultCooldownMs: number = RECOVERY_DEFAULT_COOLDOWN_MS;
  private defaultMaxAttempts: number = RECOVERY_DEFAULT_MAX_ATTEMPTS;
  private backoffMultiplier: number = RECOVERY_BACKOFF_MULTIPLIER;
  private maxCooldownMs: number = RECOVERY_MAX_COOLDOWN_MS;

  /**
   * Default recovery strategy configurations.
   * Each entry defines the strategy parameters without the service name (added during registration).
   */
  private readonly DEFAULT_STRATEGY_CONFIGS: Array<{
    serviceName: string;
    config: Omit<RecoveryStrategy, 'service'>;
  }> = [
    {
      serviceName: 'database',
      config: {
        action: 'reconnect',
        condition: (error) =>
          error.message.includes('connection') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('SQLITE_BUSY'),
        maxAttempts: 5,
        cooldownMs: 2000,
        handler: async () => {
          logger.info('Attempting database reconnection...');
          return true;
        },
      },
    },
    {
      serviceName: 'telegram',
      config: {
        action: 'reconnect',
        condition: (error) =>
          error.message.includes('disconnect') ||
          error.message.includes('CONNECTION_') ||
          error.message.includes('NETWORK_'),
        maxAttempts: 5,
        cooldownMs: 3000,
      },
    },
    {
      serviceName: 'telegram',
      config: {
        action: 'restart',
        condition: (error) =>
          error.message.includes('AUTH_KEY_') ||
          error.message.includes('SESSION_'),
        maxAttempts: 2,
        cooldownMs: 10000,
      },
    },
    {
      serviceName: 'ollama',
      config: {
        action: 'retry',
        condition: (error) =>
          error.message.includes('timeout') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('503'),
        maxAttempts: 3,
        cooldownMs: 5000,
      },
    },
    {
      serviceName: 'ollama',
      config: {
        action: 'fallback',
        condition: (error) =>
          error.message.includes('model not found') ||
          error.message.includes('out of memory'),
        maxAttempts: 1,
        cooldownMs: 60000,
      },
    },
    {
      serviceName: 'claude',
      config: {
        action: 'retry',
        condition: (error) =>
          error.message.includes('timeout') ||
          error.message.includes('rate limit') ||
          error.message.includes('overloaded'),
        maxAttempts: 3,
        cooldownMs: 10000,
      },
    },
    {
      serviceName: 'claude',
      config: {
        action: 'fallback',
        condition: (error) =>
          error.message.includes('API error') ||
          error.message.includes('authentication'),
        maxAttempts: 1,
        cooldownMs: 30000,
      },
    },
    {
      serviceName: 'queue',
      config: {
        action: 'retry',
        condition: (error) =>
          error.message.includes('stuck') ||
          error.message.includes('processing timeout'),
        maxAttempts: 3,
        cooldownMs: 5000,
      },
    },
    {
      serviceName: 'queue',
      config: {
        action: 'restart',
        condition: (error) =>
          error.message.includes('deadlock') ||
          error.message.includes('corruption'),
        maxAttempts: 1,
        cooldownMs: 30000,
      },
    },
    {
      serviceName: 'circuitBreaker',
      config: {
        action: 'retry',
        condition: (error) =>
          error.message.includes('HALF_OPEN') ||
          error.message.includes('recovering'),
        maxAttempts: 3,
        cooldownMs: 5000,
      },
    },
  ];

  constructor() {
    this.initializeDefaultStrategies();
    logger.info('Recovery service initialized');
  }

  /**
   * Initialize default recovery strategies from configuration.
   */
  private initializeDefaultStrategies(): void {
    this.registerStrategiesFromConfig();
    logger.debug('Default recovery strategies initialized');
  }

  /**
   * Register all strategies from the configuration array.
   */
  private registerStrategiesFromConfig(): void {
    for (const { serviceName, config } of this.DEFAULT_STRATEGY_CONFIGS) {
      this.registerStrategy(serviceName, {
        service: serviceName,
        ...config,
      });
    }
  }

  /**
   * Register a recovery strategy for a service
   */
  registerStrategy(service: string, strategy: RecoveryStrategy): void {
    const existing = this.strategies.get(service) || [];
    existing.push(strategy);
    this.strategies.set(service, existing);

    // Initialize service state if not exists
    if (!this.serviceStates.has(service)) {
      this.serviceStates.set(service, {
        isRecovering: false,
        consecutiveFailures: 0,
        currentAttempts: 0,
      });
    }

    logger.info('Recovery strategy registered', {
      service,
      action: strategy.action,
      maxAttempts: strategy.maxAttempts,
      cooldownMs: strategy.cooldownMs,
    });
  }

  /**
   * Attempt recovery for a service
   */
  async attemptRecovery(service: string, error: Error): Promise<RecoveryResult> {
    const timing = new Timing();
    const state = this.getOrCreateState(service);

    // Check if already recovering
    if (state.isRecovering) {
      logger.warn('Recovery already in progress', { service });
      return {
        success: false,
        action: 'retry',
        attempts: state.currentAttempts,
        duration: 0,
        error: 'Recovery already in progress',
      };
    }

    // Check cooldown
    if (state.cooldownUntil && new Date() < state.cooldownUntil) {
      const remainingMs = state.cooldownUntil.getTime() - Date.now();
      logger.warn('Service is in cooldown', { service, remainingMs });
      return {
        success: false,
        action: 'retry',
        attempts: state.currentAttempts,
        duration: 0,
        error: `Service in cooldown for ${remainingMs}ms`,
      };
    }

    // Find matching strategy
    const strategies = this.strategies.get(service) || [];
    const matchingStrategy = strategies.find((s) => s.condition(error));

    if (!matchingStrategy) {
      logger.warn('No matching recovery strategy found', {
        service,
        errorMessage: error.message,
      });
      return {
        success: false,
        action: 'escalate',
        attempts: 0,
        duration: timing.elapsed(),
        error: 'No matching recovery strategy',
      };
    }

    // Check max attempts
    if (state.currentAttempts >= matchingStrategy.maxAttempts) {
      logger.warn('Max recovery attempts reached', {
        service,
        attempts: state.currentAttempts,
        maxAttempts: matchingStrategy.maxAttempts,
      });

      // Try fallback if available
      if (matchingStrategy.fallbackHandler) {
        return this.executeFallback(service, matchingStrategy, state, timing);
      }

      // Apply extended cooldown
      this.applyCooldown(service, state, matchingStrategy.cooldownMs);

      return {
        success: false,
        action: 'escalate',
        attempts: state.currentAttempts,
        duration: timing.elapsed(),
        error: 'Max recovery attempts exceeded',
      };
    }

    // Execute recovery
    return this.executeRecovery(service, matchingStrategy, state, error, timing);
  }

  /**
   * Execute the recovery action
   */
  private async executeRecovery(
    service: string,
    strategy: RecoveryStrategy,
    state: ServiceRecoveryState,
    error: Error,
    timing: Timing
  ): Promise<RecoveryResult> {
    state.isRecovering = true;
    state.currentAttempts++;

    // Notify listeners
    this.notifyRecoveryStart(service, strategy.action);

    logger.info('Starting recovery', {
      service,
      action: strategy.action,
      attempt: state.currentAttempts,
      maxAttempts: strategy.maxAttempts,
    });

    try {
      let success = false;

      // Execute the recovery handler if provided
      if (strategy.handler) {
        success = await strategy.handler();
      } else {
        // Default recovery behavior based on action
        success = await this.executeDefaultRecovery(service, strategy.action, error);
      }

      if (success) {
        // Reset state on success
        state.consecutiveFailures = 0;
        state.currentAttempts = 0;
        state.lastRecoveryAt = new Date();
        state.cooldownUntil = undefined;

        const result: RecoveryResult = {
          success: true,
          action: strategy.action,
          attempts: state.currentAttempts,
          duration: timing.elapsed(),
        };

        this.recordHistory(service, result);
        this.notifyRecoveryComplete(service, result);
        this.notifyHealthStatus(service, true);

        logger.info('Recovery successful', { service, action: strategy.action, duration: result.duration });

        return result;
      } else {
        throw new RecoveryError('Recovery handler returned false', service);
      }
    } catch (recoveryError) {
      state.consecutiveFailures++;
      state.lastFailureAt = new Date();

      // Apply exponential backoff cooldown
      const cooldownMs = this.calculateCooldown(
        strategy.cooldownMs,
        state.consecutiveFailures
      );
      this.applyCooldown(service, state, cooldownMs);

      const result: RecoveryResult = {
        success: false,
        action: strategy.action,
        attempts: state.currentAttempts,
        duration: timing.elapsed(),
        error: getErrorMessage(recoveryError),
      };

      this.recordHistory(service, result);
      this.notifyRecoveryComplete(service, result);

      logger.error('Recovery failed', {
        service,
        action: strategy.action,
        error: result.error,
        nextCooldownMs: cooldownMs,
      });

      return result;
    } finally {
      state.isRecovering = false;
    }
  }

  /**
   * Execute fallback handler
   */
  private async executeFallback(
    service: string,
    strategy: RecoveryStrategy,
    state: ServiceRecoveryState,
    timing: Timing
  ): Promise<RecoveryResult> {
    logger.info('Attempting fallback recovery', { service });

    try {
      const success = await strategy.fallbackHandler!();

      const result: RecoveryResult = {
        success,
        action: 'fallback',
        attempts: state.currentAttempts,
        duration: timing.elapsed(),
        error: success ? undefined : 'Fallback handler failed',
      };

      if (success) {
        state.consecutiveFailures = 0;
        state.currentAttempts = 0;
        this.notifyHealthStatus(service, true);
      }

      this.recordHistory(service, result);
      this.notifyRecoveryComplete(service, result);

      return result;
    } catch (error) {
      const result: RecoveryResult = {
        success: false,
        action: 'fallback',
        attempts: state.currentAttempts,
        duration: timing.elapsed(),
        error: getErrorMessage(error),
      };

      this.recordHistory(service, result);
      this.notifyRecoveryComplete(service, result);

      return result;
    }
  }

  /**
   * Execute default recovery behavior based on action type
   */
  private async executeDefaultRecovery(
    service: string,
    action: RecoveryAction,
    _error: Error
  ): Promise<boolean> {
    logger.debug('Executing default recovery', { service, action });

    switch (action) {
      case 'retry':
        // Simple retry - wait briefly and signal success to allow caller to retry
        await this.sleep(RETRY_COOLDOWN_MS);
        return true;

      case 'reconnect':
        // Reconnect - signal success to allow caller to attempt reconnection
        await this.sleep(RECONNECT_COOLDOWN_MS);
        return true;

      case 'restart':
        // Restart - would require service-specific implementation
        logger.warn('Restart action requires custom handler', { service });
        return false;

      case 'fallback':
        // Fallback - would require service-specific implementation
        logger.warn('Fallback action requires custom handler', { service });
        return false;

      case 'escalate':
        // Escalation - mark as handled but signal for external intervention
        logger.warn('Escalating service failure', { service });
        return false;

      default:
        return false;
    }
  }

  /**
   * Get recovery history for a service
   */
  getRecoveryHistory(service?: string): RecoveryHistoryEntry[] {
    if (service) {
      return this.history.filter((entry) => entry.service === service);
    }
    return [...this.history];
  }

  /**
   * Enable automatic recovery for a service
   */
  enableAutoRecovery(service: string): void {
    this.autoRecoveryEnabled.add(service);
    logger.info('Auto-recovery enabled', { service });
  }

  /**
   * Disable automatic recovery for a service
   */
  disableAutoRecovery(service: string): void {
    this.autoRecoveryEnabled.delete(service);
    logger.info('Auto-recovery disabled', { service });
  }

  /**
   * Check if recovery is in progress for a service
   */
  isRecovering(service: string): boolean {
    const state = this.serviceStates.get(service);
    return state?.isRecovering || false;
  }

  /**
   * Check if auto-recovery is enabled for a service
   */
  isAutoRecoveryEnabled(service: string): boolean {
    return this.autoRecoveryEnabled.has(service);
  }

  /**
   * Subscribe to recovery start events
   */
  onRecoveryStart(callback: RecoveryStartCallback): () => void {
    this.onRecoveryStartCallbacks.push(callback);
    return () => {
      const index = this.onRecoveryStartCallbacks.indexOf(callback);
      if (index > -1) {
        this.onRecoveryStartCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to recovery complete events
   */
  onRecoveryComplete(callback: RecoveryCompleteCallback): () => void {
    this.onRecoveryCompleteCallbacks.push(callback);
    return () => {
      const index = this.onRecoveryCompleteCallbacks.indexOf(callback);
      if (index > -1) {
        this.onRecoveryCompleteCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to health status updates
   */
  onHealthStatus(callback: HealthStatusCallback): () => void {
    this.healthStatusCallbacks.push(callback);
    return () => {
      const index = this.healthStatusCallbacks.indexOf(callback);
      if (index > -1) {
        this.healthStatusCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): RecoveryStats {
    const stats: RecoveryStats = {
      totalRecoveries: this.history.length,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      successRate: 0,
      averageDuration: 0,
      byService: {},
      byAction: {
        restart: 0,
        reconnect: 0,
        retry: 0,
        fallback: 0,
        escalate: 0,
      },
    };

    let totalDuration = 0;

    for (const entry of this.history) {
      if (entry.success) {
        stats.successfulRecoveries++;
      } else {
        stats.failedRecoveries++;
      }

      totalDuration += entry.duration;
      stats.byAction[entry.action]++;

      // Update service stats
      if (!stats.byService[entry.service]) {
        stats.byService[entry.service] = {
          total: 0,
          successful: 0,
          failed: 0,
        };
      }

      stats.byService[entry.service].total++;
      if (entry.success) {
        stats.byService[entry.service].successful++;
        stats.byService[entry.service].lastRecoveryAt = entry.timestamp;
      } else {
        stats.byService[entry.service].failed++;
      }
    }

    if (this.history.length > 0) {
      stats.successRate = stats.successfulRecoveries / this.history.length;
      stats.averageDuration = totalDuration / this.history.length;
    }

    return stats;
  }

  /**
   * Handle health degradation (integration with health service)
   */
  async handleHealthDegradation(service: string, error?: Error): Promise<RecoveryResult | null> {
    if (!this.isAutoRecoveryEnabled(service)) {
      logger.debug('Auto-recovery not enabled for service', { service });
      return null;
    }

    const actualError = error || new Error(`Health degradation detected for ${service}`);
    return this.attemptRecovery(service, actualError);
  }

  /**
   * Reset recovery state for a service
   */
  resetServiceState(service: string): void {
    this.serviceStates.set(service, {
      isRecovering: false,
      consecutiveFailures: 0,
      currentAttempts: 0,
    });
    logger.info('Recovery state reset', { service });
  }

  /**
   * Get service recovery state
   */
  getServiceState(service: string): ServiceRecoveryState | undefined {
    return this.serviceStates.get(service);
  }

  /**
   * Get all registered services
   */
  getRegisteredServices(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get strategies for a service
   */
  getStrategies(service: string): RecoveryStrategy[] {
    return this.strategies.get(service) || [];
  }

  /**
   * Clear recovery history
   */
  clearHistory(): void {
    this.history = [];
    logger.info('Recovery history cleared');
  }

  /**
   * Set custom recovery handler for a service
   */
  setRecoveryHandler(
    service: string,
    action: RecoveryAction,
    handler: () => Promise<boolean>
  ): void {
    const strategies = this.strategies.get(service) || [];
    const strategy = strategies.find((s) => s.action === action);

    if (strategy) {
      strategy.handler = handler;
      logger.info('Custom recovery handler set', { service, action });
    } else {
      logger.warn('Strategy not found for handler', { service, action });
    }
  }

  /**
   * Set fallback handler for a service
   */
  setFallbackHandler(
    service: string,
    handler: () => Promise<boolean>
  ): void {
    const strategies = this.strategies.get(service) || [];

    for (const strategy of strategies) {
      strategy.fallbackHandler = handler;
    }

    logger.info('Fallback handler set for all strategies', { service });
  }

  // Private helper methods

  private getOrCreateState(service: string): ServiceRecoveryState {
    let state = this.serviceStates.get(service);
    if (!state) {
      state = {
        isRecovering: false,
        consecutiveFailures: 0,
        currentAttempts: 0,
      };
      this.serviceStates.set(service, state);
    }
    return state;
  }

  private calculateCooldown(baseCooldown: number, consecutiveFailures: number): number {
    const multiplier = Math.pow(this.backoffMultiplier, consecutiveFailures - 1);
    const cooldown = baseCooldown * multiplier;
    return Math.min(cooldown, this.maxCooldownMs);
  }

  private applyCooldown(
    service: string,
    state: ServiceRecoveryState,
    cooldownMs: number
  ): void {
    state.cooldownUntil = new Date(Date.now() + cooldownMs);
    logger.debug('Cooldown applied', { service, cooldownMs, until: state.cooldownUntil });
  }

  private recordHistory(service: string, result: RecoveryResult): void {
    const entry: RecoveryHistoryEntry = {
      service,
      action: result.action,
      timestamp: new Date(),
      success: result.success,
      attempts: result.attempts,
      duration: result.duration,
      error: result.error,
    };

    this.history.unshift(entry);

    // Trim history if too large
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }
  }

  private notifyRecoveryStart(service: string, action: RecoveryAction): void {
    for (const callback of this.onRecoveryStartCallbacks) {
      try {
        callback(service, action);
      } catch (error) {
        logger.error('Error in recovery start callback', {
          error: getErrorMessage(error),
        });
      }
    }
  }

  private notifyRecoveryComplete(service: string, result: RecoveryResult): void {
    for (const callback of this.onRecoveryCompleteCallbacks) {
      try {
        callback(service, result);
      } catch (error) {
        logger.error('Error in recovery complete callback', {
          error: getErrorMessage(error),
        });
      }
    }
  }

  private notifyHealthStatus(service: string, healthy: boolean): void {
    for (const callback of this.healthStatusCallbacks) {
      try {
        callback(service, healthy);
      } catch (error) {
        logger.error('Error in health status callback', {
          error: getErrorMessage(error),
        });
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const recoveryService = new RecoveryService();
