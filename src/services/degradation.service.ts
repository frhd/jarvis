import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createLogger('DegradationService');

export type DegradationLevel = 'none' | 'partial' | 'full';

export interface FallbackStrategy {
  id: string;
  service: string;
  fallbackFn: (args: unknown, error: Error) => Promise<unknown> | unknown;
  condition?: (error: Error, degradationLevel: DegradationLevel) => boolean;
  priority?: number;
  description?: string;
}

export interface DegradationConfig {
  service: string;
  level: DegradationLevel;
  strategies: FallbackStrategy[];
  autoRecover: boolean;
  recoveryCheckIntervalMs: number;
  recoveryThreshold: number;
}

export interface ServiceHealth {
  service: string;
  healthy: boolean;
  responseTimeMs?: number;
  errorRate?: number;
  lastCheck?: Date;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs?: number;
    error?: string;
    lastChecked: Date;
    metadata?: Record<string, unknown>;
  }>;
  timestamp: Date;
}

export interface FallbackStats {
  service: string;
  strategyId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  lastExecutedAt: Date | null;
  avgExecutionTimeMs: number;
}

export interface DegradationEvent {
  service: string;
  previousLevel: DegradationLevel;
  newLevel: DegradationLevel;
  reason: string;
  timestamp: Date;
}

export interface DegradationReport {
  timestamp: Date;
  services: Array<{
    service: string;
    level: DegradationLevel;
    autoRecover: boolean;
    strategies: Array<{
      id: string;
      description?: string;
      stats: FallbackStats;
    }>;
    recoveryChecks: {
      consecutive: number;
      threshold: number;
      lastCheckAt: Date | null;
    };
  }>;
  summary: {
    totalServices: number;
    healthyServices: number;
    partiallyDegradedServices: number;
    fullyDegradedServices: number;
  };
}

const DEFAULT_RECOVERY_CHECK_INTERVAL_MS = 30000;
const DEFAULT_RECOVERY_THRESHOLD = 3;

/**
 * DegradationService - Manages service fallbacks and degraded operation modes
 *
 * Degradation Rules:
 * - LLM: Ollama fails -> use cached responses; Claude fails -> fallback to Ollama; both fail -> graceful error
 * - Embedding: fails -> skip memory/cache operations, continue without semantic search
 * - Queue: overloaded -> synchronous processing; DLQ too large -> alert and pause non-critical
 * - Database: slow -> aggressive caching; down -> cached data only, queue writes
 */
export class DegradationService extends EventEmitter {
  private configs: Map<string, DegradationConfig> = new Map();
  private fallbackStats: Map<string, Map<string, FallbackStats>> = new Map();
  private recoveryChecks: Map<string, { consecutive: number; lastCheckAt: Date | null }> = new Map();
  private recoveryIntervals: Map<string, NodeJS.Timeout> = new Map();
  private healthListeners: Map<string, (health: ServiceHealth) => void> = new Map();
  private healthUnsubscribes: Map<string, () => void> = new Map();

  private readonly defaultErrorMessages: Record<string, string> = {
    llm: 'I apologize, but I\'m having trouble processing your request right now. Please try again in a moment.',
    embedding: 'Semantic search is temporarily unavailable. Continuing with basic search.',
    queue: 'Message processing is experiencing delays. Your message has been queued.',
    database: 'Data access is currently limited. Some features may be unavailable.',
  };

  /**
   * Default fallback strategy configurations.
   * Each entry defines the strategy parameters without the service name (added during registration).
   */
  private readonly DEFAULT_FALLBACK_CONFIGS: Array<{
    serviceName: string;
    config: Omit<FallbackStrategy, 'service'>;
  }> = [
    {
      serviceName: 'ollama',
      config: {
        id: 'use-cached-response',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.debug('LLM fallback: Attempting to use cached response');
          throw new Error('No cached response available');
        },
        condition: (_error, level) => level !== 'none',
        priority: 10,
        description: 'Use cached responses from SemanticCache when Ollama fails',
      },
    },
    {
      serviceName: 'claude',
      config: {
        id: 'fallback-to-ollama',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.debug('Claude fallback: Delegating to Ollama');
          throw new Error('Ollama fallback not configured');
        },
        condition: (_error, level) => level !== 'none',
        priority: 10,
        description: 'Fall back to Ollama for all requests when Claude fails',
      },
    },
    {
      serviceName: 'llm',
      config: {
        id: 'graceful-error',
        fallbackFn: async (_args: unknown, _error: Error) => {
          return this.defaultErrorMessages.llm;
        },
        condition: (_error, level) => level === 'full',
        priority: 100,
        description: 'Return graceful error message when both LLM providers fail',
      },
    },
    {
      serviceName: 'embedding',
      config: {
        id: 'skip-semantic-operations',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.debug('Embedding fallback: Skipping semantic operations');
          return null;
        },
        condition: (_error, level) => level !== 'none',
        priority: 10,
        description: 'Skip memory/cache operations when embedding service fails',
      },
    },
    {
      serviceName: 'queue',
      config: {
        id: 'synchronous-processing',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.debug('Queue fallback: Switching to synchronous processing');
          return { synchronous: true };
        },
        condition: (error, level) => {
          return level === 'partial' || error.message.includes('overload');
        },
        priority: 10,
        description: 'Switch to synchronous processing when queue is overloaded',
      },
    },
    {
      serviceName: 'queue',
      config: {
        id: 'pause-non-critical',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.warn('Queue fallback: Pausing non-critical processing due to DLQ size');
          return { pauseNonCritical: true };
        },
        condition: (error, level) => {
          return level === 'full' || error.message.includes('DLQ');
        },
        priority: 20,
        description: 'Alert and pause non-critical processing when DLQ is too large',
      },
    },
    {
      serviceName: 'database',
      config: {
        id: 'aggressive-caching',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.debug('Database fallback: Enabling aggressive caching');
          return { aggressiveCaching: true };
        },
        condition: (error, level) => {
          return level === 'partial' || error.message.includes('slow') || error.message.includes('timeout');
        },
        priority: 10,
        description: 'Enable aggressive caching when database is slow',
      },
    },
    {
      serviceName: 'database',
      config: {
        id: 'cached-data-only',
        fallbackFn: async (_args: unknown, _error: Error) => {
          logger.warn('Database fallback: Returning cached data only, queuing writes');
          return { cachedOnly: true, queueWrites: true };
        },
        condition: (_error, level) => level === 'full',
        priority: 20,
        description: 'Return cached data only and queue writes when database is down',
      },
    },
  ];

  constructor() {
    super();
    this.initializeDefaultStrategies();
    logger.info('Degradation service initialized');
  }

  /**
   * Initialize default fallback strategies from configuration.
   */
  private initializeDefaultStrategies(): void {
    this.registerFallbacksFromConfig();
    logger.debug('Default degradation strategies initialized');
  }

  /**
   * Register all fallback strategies from the configuration array.
   */
  private registerFallbacksFromConfig(): void {
    for (const { serviceName, config } of this.DEFAULT_FALLBACK_CONFIGS) {
      this.registerFallback(serviceName, config);
    }
  }

  registerFallback(
    service: string,
    strategy: Omit<FallbackStrategy, 'service'>
  ): void {
    const config = this.getOrCreateConfig(service);

    const existingIndex = config.strategies.findIndex(s => s.id === strategy.id);

    const fullStrategy: FallbackStrategy = {
      ...strategy,
      service,
      priority: strategy.priority ?? 100,
    };

    if (existingIndex >= 0) {
      config.strategies[existingIndex] = fullStrategy;
      logger.debug(`Updated fallback strategy "${strategy.id}" for service "${service}"`);
    } else {
      config.strategies.push(fullStrategy);
      config.strategies.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
      logger.debug(`Registered fallback strategy "${strategy.id}" for service "${service}"`);
    }

    this.initializeStats(service, strategy.id);
  }

  removeFallback(service: string, strategyId: string): boolean {
    const config = this.configs.get(service);
    if (!config) return false;

    const index = config.strategies.findIndex(s => s.id === strategyId);
    if (index < 0) return false;

    config.strategies.splice(index, 1);

    const serviceStats = this.fallbackStats.get(service);
    if (serviceStats) {
      serviceStats.delete(strategyId);
    }

    logger.debug(`Removed fallback strategy "${strategyId}" from service "${service}"`);
    return true;
  }

  /**
   * Execute a function with fallback support.
   * Tries the original function first, then falls back on failure.
   */
  async executeFallback<T = unknown, R = unknown>(
    service: string,
    originalFn: (args: T) => Promise<R>,
    args: T
  ): Promise<R> {
    const config = this.configs.get(service);
    const level = config?.level ?? 'none';

    if (level === 'full') {
      logger.debug(`Service "${service}" is fully degraded, using fallback directly`);
      return this.tryFallbacks(service, args, new Error('Service fully degraded'));
    }

    try {
      const result = await originalFn(args);
      this.recordSuccessfulExecution(service);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Primary function failed for service "${service}": ${err.message}`);
      return this.tryFallbacks(service, args, err);
    }
  }

  private async tryFallbacks<T, R>(
    service: string,
    args: T,
    error: Error
  ): Promise<R> {
    const config = this.configs.get(service);
    if (!config || config.strategies.length === 0) {
      throw error;
    }

    const level = config.level;

    for (const strategy of config.strategies) {
      if (strategy.condition && !strategy.condition(error, level)) {
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await strategy.fallbackFn(args, error);
        const executionTime = Date.now() - startTime;

        this.recordFallbackExecution(service, strategy.id, true, executionTime);

        logger.info(`Fallback "${strategy.id}" succeeded for service "${service}"`, {
          executionTimeMs: executionTime,
        });

        return result as R;
      } catch (fallbackError) {
        const executionTime = Date.now() - startTime;
        this.recordFallbackExecution(service, strategy.id, false, executionTime);

        logger.warn(`Fallback "${strategy.id}" failed for service "${service}": ${
          fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
        }`);
      }
    }

    const gracefulError = this.getGracefulError(service);
    throw new Error(gracefulError);
  }

  setDegradationLevel(service: string, level: DegradationLevel, reason: string = 'Manual update'): void {
    const config = this.getOrCreateConfig(service);
    const previousLevel = config.level;

    if (previousLevel === level) {
      return;
    }

    config.level = level;

    this.recoveryChecks.set(service, { consecutive: 0, lastCheckAt: null });

    if (level === 'none') {
      this.stopRecoveryCheck(service);
    } else if (config.autoRecover) {
      this.startRecoveryCheck(service);
    }

    const event: DegradationEvent = {
      service,
      previousLevel,
      newLevel: level,
      reason,
      timestamp: new Date(),
    };

    this.emit('degradation', event);

    logger.info(`Degradation level changed for "${service}"`, {
      previousLevel,
      newLevel: level,
      reason,
    });
  }

  getDegradationLevel(service: string): DegradationLevel {
    return this.configs.get(service)?.level ?? 'none';
  }

  setAutoRecover(service: string, enabled: boolean): void {
    const config = this.getOrCreateConfig(service);
    config.autoRecover = enabled;

    if (enabled && config.level !== 'none') {
      this.startRecoveryCheck(service);
    } else {
      this.stopRecoveryCheck(service);
    }

    logger.debug(`Auto-recovery ${enabled ? 'enabled' : 'disabled'} for service "${service}"`);
  }

  async detectRecovery(
    service: string,
    healthCheckFn?: () => Promise<boolean>
  ): Promise<boolean> {
    const config = this.configs.get(service);
    if (!config || config.level === 'none') {
      return true;
    }

    const checks = this.recoveryChecks.get(service) ?? { consecutive: 0, lastCheckAt: null };

    try {
      const healthy = healthCheckFn ? await healthCheckFn() : true;

      if (healthy) {
        checks.consecutive++;
        checks.lastCheckAt = new Date();

        logger.debug(`Recovery check passed for "${service}" (${checks.consecutive}/${config.recoveryThreshold})`);

        if (checks.consecutive >= config.recoveryThreshold) {
          this.setDegradationLevel(service, 'none', 'Automatic recovery after successful health checks');
          return true;
        }
      } else {
        checks.consecutive = 0;
        logger.debug(`Recovery check failed for "${service}", resetting counter`);
      }

      this.recoveryChecks.set(service, checks);
      return false;
    } catch (error) {
      checks.consecutive = 0;
      checks.lastCheckAt = new Date();
      this.recoveryChecks.set(service, checks);

      logger.warn(`Recovery check error for "${service}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`);
      return false;
    }
  }

  private startRecoveryCheck(service: string): void {
    if (this.recoveryIntervals.has(service)) {
      return;
    }

    const config = this.configs.get(service);
    if (!config) return;

    const interval = setInterval(async () => {
      await this.detectRecovery(service);
    }, config.recoveryCheckIntervalMs);

    this.recoveryIntervals.set(service, interval);
    logger.debug(`Started recovery checks for "${service}" (interval: ${config.recoveryCheckIntervalMs}ms)`);
  }

  private stopRecoveryCheck(service: string): void {
    const interval = this.recoveryIntervals.get(service);
    if (interval) {
      clearInterval(interval);
      this.recoveryIntervals.delete(service);
      logger.debug(`Stopped recovery checks for "${service}"`);
    }
  }

  handleHealthChange(health: ServiceHealth): void {
    const { service, healthy, errorRate, responseTimeMs } = health;

    let newLevel: DegradationLevel = 'none';
    let reason = '';

    if (!healthy) {
      newLevel = 'full';
      reason = 'Service reported unhealthy';
    } else if (errorRate !== undefined && errorRate > 0.5) {
      newLevel = 'full';
      reason = `High error rate: ${(errorRate * 100).toFixed(1)}%`;
    } else if (errorRate !== undefined && errorRate > 0.1) {
      newLevel = 'partial';
      reason = `Elevated error rate: ${(errorRate * 100).toFixed(1)}%`;
    } else if (responseTimeMs !== undefined && responseTimeMs > 10000) {
      newLevel = 'partial';
      reason = `Slow response time: ${responseTimeMs}ms`;
    }

    const currentLevel = this.getDegradationLevel(service);

    if (this.compareLevels(newLevel, currentLevel) > 0) {
      this.setDegradationLevel(service, newLevel, reason);
    }
  }

  registerHealthListener(
    healthSource: EventEmitter | { onHealthChange?: (callback: (health: SystemHealth) => void) => () => void },
    eventName: string = 'health'
  ): (() => void) | void {
    if ('onHealthChange' in healthSource && typeof healthSource.onHealthChange === 'function') {
      const unsubscribe = healthSource.onHealthChange((systemHealth: SystemHealth) => {
        for (const component of systemHealth.components) {
          const serviceHealth: ServiceHealth = {
            service: component.name,
            healthy: component.status === 'healthy',
            responseTimeMs: component.latencyMs,
            lastCheck: component.lastChecked,
            details: component.metadata,
          };
          this.handleHealthChange(serviceHealth);
        }
      });
      this.healthUnsubscribes.set(eventName, unsubscribe);
      logger.info(`Registered health listener for callback-based health service`);
      return unsubscribe;
    }

    const emitter = healthSource as EventEmitter;
    const listener = (health: ServiceHealth) => this.handleHealthChange(health);
    emitter.on(eventName, listener);
    this.healthListeners.set(eventName, listener);
    logger.info(`Registered health listener for event "${eventName}"`);
  }

  unregisterHealthListener(
    healthSource: EventEmitter | { onHealthChange?: (callback: (health: SystemHealth) => void) => () => void },
    eventName: string = 'health'
  ): void {
    const unsubscribe = this.healthUnsubscribes.get(eventName);
    if (unsubscribe) {
      unsubscribe();
      this.healthUnsubscribes.delete(eventName);
      logger.debug(`Unregistered callback-based health listener`);
      return;
    }

    const listener = this.healthListeners.get(eventName);
    if (listener) {
      const emitter = healthSource as EventEmitter;
      emitter.off(eventName, listener);
      this.healthListeners.delete(eventName);
      logger.debug(`Unregistered health listener for event "${eventName}"`);
    }
  }

  getFallbackStats(): Map<string, FallbackStats[]> {
    const result = new Map<string, FallbackStats[]>();

    for (const [service, strategies] of this.fallbackStats) {
      result.set(service, Array.from(strategies.values()));
    }

    return result;
  }

  getServiceStats(service: string): FallbackStats[] {
    const serviceStats = this.fallbackStats.get(service);
    if (!serviceStats) return [];
    return Array.from(serviceStats.values());
  }

  getDegradationReport(): DegradationReport {
    const services: DegradationReport['services'] = [];

    let healthyCount = 0;
    let partialCount = 0;
    let fullCount = 0;

    for (const [serviceName, config] of this.configs) {
      const serviceStats = this.fallbackStats.get(serviceName);
      const recoveryInfo = this.recoveryChecks.get(serviceName) ?? { consecutive: 0, lastCheckAt: null };

      const strategies = config.strategies.map(s => ({
        id: s.id,
        description: s.description,
        stats: serviceStats?.get(s.id) ?? this.createEmptyStats(serviceName, s.id),
      }));

      services.push({
        service: serviceName,
        level: config.level,
        autoRecover: config.autoRecover,
        strategies,
        recoveryChecks: {
          consecutive: recoveryInfo.consecutive,
          threshold: config.recoveryThreshold,
          lastCheckAt: recoveryInfo.lastCheckAt,
        },
      });

      switch (config.level) {
        case 'none':
          healthyCount++;
          break;
        case 'partial':
          partialCount++;
          break;
        case 'full':
          fullCount++;
          break;
      }
    }

    return {
      timestamp: new Date(),
      services,
      summary: {
        totalServices: this.configs.size,
        healthyServices: healthyCount,
        partiallyDegradedServices: partialCount,
        fullyDegradedServices: fullCount,
      },
    };
  }

  private getOrCreateConfig(service: string): DegradationConfig {
    let config = this.configs.get(service);

    if (!config) {
      config = {
        service,
        level: 'none',
        strategies: [],
        autoRecover: true,
        recoveryCheckIntervalMs: DEFAULT_RECOVERY_CHECK_INTERVAL_MS,
        recoveryThreshold: DEFAULT_RECOVERY_THRESHOLD,
      };
      this.configs.set(service, config);
      this.fallbackStats.set(service, new Map());
      this.recoveryChecks.set(service, { consecutive: 0, lastCheckAt: null });
    }

    return config;
  }

  private initializeStats(service: string, strategyId: string): void {
    let serviceStats = this.fallbackStats.get(service);
    if (!serviceStats) {
      serviceStats = new Map();
      this.fallbackStats.set(service, serviceStats);
    }

    if (!serviceStats.has(strategyId)) {
      serviceStats.set(strategyId, this.createEmptyStats(service, strategyId));
    }
  }

  private createEmptyStats(service: string, strategyId: string): FallbackStats {
    return {
      service,
      strategyId,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      lastExecutedAt: null,
      avgExecutionTimeMs: 0,
    };
  }

  private recordFallbackExecution(
    service: string,
    strategyId: string,
    success: boolean,
    executionTimeMs: number
  ): void {
    const serviceStats = this.fallbackStats.get(service);
    if (!serviceStats) return;

    const stats = serviceStats.get(strategyId);
    if (!stats) return;

    stats.totalExecutions++;
    if (success) {
      stats.successfulExecutions++;
    } else {
      stats.failedExecutions++;
    }
    stats.lastExecutedAt = new Date();

    const prevTotal = stats.totalExecutions - 1;
    if (prevTotal > 0) {
      stats.avgExecutionTimeMs = (stats.avgExecutionTimeMs * prevTotal + executionTimeMs) / stats.totalExecutions;
    } else {
      stats.avgExecutionTimeMs = executionTimeMs;
    }
  }

  private recordSuccessfulExecution(service: string): void {
    const config = this.configs.get(service);
    if (!config || config.level === 'none') return;

    const checks = this.recoveryChecks.get(service) ?? { consecutive: 0, lastCheckAt: null };
    checks.consecutive++;
    checks.lastCheckAt = new Date();
    this.recoveryChecks.set(service, checks);
  }

  private getGracefulError(service: string): string {
    const baseService = service.split('-')[0];
    return this.defaultErrorMessages[baseService] ??
           this.defaultErrorMessages[service] ??
           'Service is temporarily unavailable. Please try again later.';
  }

  private compareLevels(a: DegradationLevel, b: DegradationLevel): number {
    const order: Record<DegradationLevel, number> = {
      'none': 0,
      'partial': 1,
      'full': 2,
    };
    return Math.sign(order[a] - order[b]);
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down degradation service...');

    for (const [service, interval] of this.recoveryIntervals) {
      clearInterval(interval);
      logger.debug(`Stopped recovery interval for "${service}"`);
    }
    this.recoveryIntervals.clear();

    for (const [eventName, unsubscribe] of this.healthUnsubscribes) {
      unsubscribe();
      logger.debug(`Unsubscribed from health listener "${eventName}"`);
    }
    this.healthUnsubscribes.clear();

    this.removeAllListeners();
    this.healthListeners.clear();

    logger.info('Degradation service shutdown complete');
  }
}

export const degradationService = new DegradationService();

export default DegradationService;
