import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';
import { resolvePm2Binary } from '../utils/pm2-binary.js';
import { connection } from '../db/client';
import {
  getErrorMessage,
  Timing,
  HealthCheckBuilder,
  type HealthStatus,
  type ComponentHealth,
} from '../utils/index.js';
import { HEALTH_CHECK_TIMEOUT_MS } from '../config/constants.js';

const logger = createLogger('HealthService');

// ============================================================================
// Types (Re-export from utils for backward compatibility)
// ============================================================================

export type { HealthStatus, ComponentHealth } from '../utils/index.js';

export interface SystemHealth {
  status: HealthStatus;
  components: ComponentHealth[];
  timestamp: Date;
}

export interface HealthCheckOptions {
  /** Interval in ms for periodic health checks */
  interval?: number;
  /** Timeout in ms for health check execution */
  timeout?: number;
  /** If true, this component being unhealthy makes system unhealthy */
  critical?: boolean;
}

export type HealthCheckFn = () => Promise<ComponentHealth>;

interface RegisteredCheck {
  name: string;
  checkFn: HealthCheckFn;
  options: Required<HealthCheckOptions>;
}

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
// Built-in Health Check Factories
// ============================================================================

/**
 * Create a database health check
 */
export function createDatabaseHealthCheck(): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('database', async () => {
      const result = connection.prepare('SELECT 1 as test').get();
      if (!result) {
        return HealthCheckBuilder.unhealthy('Database query returned no result');
      }

      const walResult = connection.pragma('journal_mode');
      const walMode = (walResult as { journal_mode: string }[])[0]?.journal_mode || 'unknown';
      const isWalEnabled = walMode.toLowerCase() === 'wal';

      return HealthCheckBuilder.healthy({
        walEnabled: isWalEnabled,
        journalMode: walMode,
      });
    });
}

/**
 * Create a queue health check
 */
export function createQueueHealthCheck(
  queueRepository: { getStats: () => Promise<{ pending: number; processing: number; completed: number; failed: number }> },
  options: { stuckThreshold?: number; pendingWarningThreshold?: number } = {}
): HealthCheckFn {
  const { stuckThreshold = 100, pendingWarningThreshold = 1000 } = options;

  return () =>
    HealthCheckBuilder.execute('queue', async () => {
      const stats = await queueRepository.getStats();

      const metadata = {
        pending: stats.pending,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
        processingRate: stats.completed > 0 ? stats.completed / (stats.completed + stats.pending + stats.processing) : 0,
      };

      if (stats.processing > stuckThreshold) {
        return HealthCheckBuilder.degraded(`${stats.processing} messages stuck in processing`, metadata);
      }

      if (stats.pending > pendingWarningThreshold) {
        return HealthCheckBuilder.degraded(`Queue backup: ${stats.pending} pending messages`, metadata);
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

/**
 * Create an LLM (Ollama) health check
 */
export function createLLMHealthCheck(
  llmClient: { healthCheck: () => Promise<{ healthy: boolean; model: string; error?: string }> }
): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('llm', async () => {
      const result = await llmClient.healthCheck();
      const metadata = { model: result.model };

      return result.healthy
        ? HealthCheckBuilder.healthy(metadata)
        : HealthCheckBuilder.unhealthy(result.error || 'LLM health check failed', metadata);
    });
}

/**
 * Create an Ollama model warmth health check
 * Checks if the model is loaded in memory via /api/ps endpoint
 */
export function createOllamaWarmthHealthCheck(
  options: {
    baseUrl?: string;
    model?: string;
  } = {}
): HealthCheckFn {
  const { baseUrl = 'http://localhost:11434', model = 'llama3.1:8b' } = options;

  return () =>
    HealthCheckBuilder.execute('ollamaWarmth', async () => {
      const response = await fetch(`${baseUrl}/api/ps`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return HealthCheckBuilder.unhealthy('Ollama not responding');
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          size: number;
          expires_at?: string;
        }>;
      };

      const loadedModels = data.models || [];
      const modelBaseName = model.split(':')[0];
      const targetModel = loadedModels.find((m) => m.name.includes(modelBaseName));

      if (!targetModel) {
        return HealthCheckBuilder.degraded(`Model ${model} not loaded (cold start risk)`, {
          loadedModels: loadedModels.map((m) => m.name),
          expectedModel: model,
          warm: false,
        });
      }

      let expiryInfo = '';
      if (targetModel.expires_at) {
        const expiresAt = new Date(targetModel.expires_at);
        const minutesRemaining = Math.round((expiresAt.getTime() - Date.now()) / 60000);
        expiryInfo = `expires in ${minutesRemaining}m`;
      }

      return HealthCheckBuilder.healthy({
        model: targetModel.name,
        sizeMB: Math.round(targetModel.size / 1024 / 1024),
        expiryInfo,
        warm: true,
      });
    });
}

/**
 * Create a Whisper health check for voice transcription
 */
export function createWhisperHealthCheck(
  voiceProcessingService: { healthCheck: () => Promise<{ healthy: boolean; error?: string }> }
): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('whisper', async () => {
      const result = await voiceProcessingService.healthCheck();
      return result.healthy
        ? HealthCheckBuilder.healthy()
        : HealthCheckBuilder.unhealthy(result.error || 'Whisper health check failed');
    });
}

/**
 * Create a Claude CLI health check
 */
export function createClaudeHealthCheck(
  claudeClient: { healthCheck: () => Promise<{ healthy: boolean; error?: string }> }
): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('claude', async () => {
      const result = await claudeClient.healthCheck();
      return result.healthy
        ? HealthCheckBuilder.healthy()
        : HealthCheckBuilder.unhealthy(result.error || 'Claude health check failed');
    });
}

/**
 * Create a Telegram connection health check
 */
export function createTelegramHealthCheck(
  telegramService: { getClient: () => unknown }
): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('telegram', async () => {
      // Try to get client - throws if not connected
      telegramService.getClient();
      return HealthCheckBuilder.healthy({ connected: true });
    });
}

/**
 * Create a DLQ health check
 */
export function createDLQHealthCheck(
  dlqService: { getStats: () => Promise<{ total: number; oldestItemAge?: number; recentFailures: number }> },
  options: { sizeWarningThreshold?: number; ageWarningThresholdMs?: number } = {}
): HealthCheckFn {
  const {
    sizeWarningThreshold = 100,
    ageWarningThresholdMs = 24 * 60 * 60 * 1000, // 24 hours
  } = options;

  return () =>
    HealthCheckBuilder.execute('dlq', async () => {
      const stats = await dlqService.getStats();
      const metadata = {
        total: stats.total,
        oldestItemAgeMs: stats.oldestItemAge,
        recentFailures: stats.recentFailures,
      };

      const issues: string[] = [];

      if (stats.total > sizeWarningThreshold) {
        issues.push(`DLQ has ${stats.total} items`);
      }

      if (stats.oldestItemAge && stats.oldestItemAge > ageWarningThresholdMs) {
        const ageHours = Math.round(stats.oldestItemAge / (1000 * 60 * 60));
        issues.push(`oldest item is ${ageHours}h old`);
      }

      if (issues.length > 0) {
        return HealthCheckBuilder.degraded(issues.join('; '), metadata);
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

/**
 * Create a circuit breakers health check
 */
export function createCircuitBreakersHealthCheck(
  circuitBreakers: Array<{ getState: () => string; getStats: () => { serviceName: string } }>
): HealthCheckFn {
  return () =>
    HealthCheckBuilder.execute('circuitBreakers', async () => {
      const states: Record<string, string> = {};

      for (const cb of circuitBreakers) {
        const stats = cb.getStats();
        states[stats.serviceName] = cb.getState();
      }

      const metadata = { states };

      const openCircuits = Object.entries(states)
        .filter(([, state]) => state === 'OPEN')
        .map(([name]) => name);

      if (openCircuits.length > 0) {
        return HealthCheckBuilder.degraded(`Open circuits: ${openCircuits.join(', ')}`, metadata);
      }

      const halfOpenCircuits = Object.entries(states)
        .filter(([, state]) => state === 'HALF_OPEN')
        .map(([name]) => name);

      if (halfOpenCircuits.length > 0) {
        return HealthCheckBuilder.degraded(`Half-open circuits: ${halfOpenCircuits.join(', ')}`, metadata);
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

/**
 * Create a stuck messages health check
 * Monitors for messages stuck in 'processing' status beyond threshold
 */
export function createStuckMessagesHealthCheck(
  queueRepository: {
    getStuckMessageStats: (thresholdMs: number) => Promise<{
      count: number;
      oldestAgeMinutes: number;
      ageDistribution: { ageMinutes: number; count: number }[];
      byPriority: { priority: number; count: number }[];
    }>;
  },
  options: {
    thresholdMs?: number;
    warningCount?: number;
    criticalCount?: number;
    criticalAgeMinutes?: number;
  } = {}
): HealthCheckFn {
  const {
    thresholdMs = 60 * 60 * 1000, // 1 hour default
    warningCount = 5,
    criticalCount = 10,
    criticalAgeMinutes = 120, // 2 hours
  } = options;

  return () =>
    HealthCheckBuilder.execute('stuckMessages', async () => {
      const stats = await queueRepository.getStuckMessageStats(thresholdMs);

      const metadata = {
        stuckCount: stats.count,
        oldestAgeMinutes: stats.oldestAgeMinutes,
        thresholdMs,
        warningThreshold: warningCount,
        criticalThreshold: criticalCount,
        ageDistribution: stats.ageDistribution,
        byPriority: stats.byPriority,
      };

      // Check for critical conditions
      if (stats.count >= criticalCount) {
        return HealthCheckBuilder.unhealthy(
          `${stats.count} stuck messages (>=${criticalCount} critical threshold)`,
          metadata
        );
      }

      if (stats.oldestAgeMinutes >= criticalAgeMinutes) {
        return HealthCheckBuilder.unhealthy(
          `Oldest stuck message is ${stats.oldestAgeMinutes} minutes old (>=${criticalAgeMinutes}min critical threshold)`,
          metadata
        );
      }

      if (stats.count >= warningCount) {
        return HealthCheckBuilder.degraded(
          `${stats.count} stuck messages (>=${warningCount} warning threshold)`,
          metadata
        );
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

/**
 * Create a PM2 restart count health check
 * Monitors PM2 service restarts and alerts when exceeding threshold
 */
export function createPM2RestartHealthCheck(
  options: {
    warningThreshold?: number;
    criticalThreshold?: number;
    restartRateThresholdPerHour?: number;
    checkIntervalMs?: number;
  } = {}
): HealthCheckFn {
  const {
    warningThreshold = 10, // 10+ restarts triggers warning
    criticalThreshold = 20, // 20+ restarts triggers critical alert
    restartRateThresholdPerHour = 30, // 30+ restarts/hour triggers degraded warning (increased for Telegram TIMEOUT tolerance)
    checkIntervalMs = 5 * 60 * 1000, // Check every 5 minutes
  } = options;

  let lastKnownRestarts: Record<string, number> = {};
  let lastCheckTime = 0;
  let initialized = false;

  return () =>
    HealthCheckBuilder.execute('pm2Restart', async () => {
      const now = Date.now();

      // Only check periodically to avoid excessive PM2 queries
      if (now - lastCheckTime < checkIntervalMs) {
        return HealthCheckBuilder.healthy({
          restartCounts: lastKnownRestarts,
          lastChecked: new Date(lastCheckTime),
        });
      }
      lastCheckTime = now;

      try {
        const pm2Data = await getPM2Data();
        const restartCounts: Record<string, number> = {};
        const unstableRestartCounts: Record<string, number> = {};

        // Initialize known restarts on first check to avoid counting historical restarts
        if (!initialized) {
          for (const process of pm2Data.processes) {
            const restartTime = process.pm2_env?.restart_time || 0;
            lastKnownRestarts[process.name] = restartTime;
          }
          initialized = true;
          logger.debug('[PM2RestartHealthCheck] Initialized restart tracking', {
            restartCounts: lastKnownRestarts,
          });
          return HealthCheckBuilder.healthy({
            restartCounts: lastKnownRestarts,
            lastChecked: new Date(),
            initialized: true,
          });
        }

        for (const process of pm2Data.processes) {
          const restartTime = process.pm2_env?.restart_time || 0;
          const unstableRestarts = process.unstable_restarts || 0;
          const prevRestarts = lastKnownRestarts[process.name] || 0;

          // Count new restarts since last check
          const newRestarts = Math.max(0, restartTime - prevRestarts);
          restartCounts[process.name] = restartTime;
          unstableRestartCounts[process.name] = unstableRestarts;
        }

        // Update known restarts
        lastKnownRestarts = restartCounts;

        // Check for critical unstable restarts (actual crashes)
        for (const [name, unstableRestarts] of Object.entries(unstableRestartCounts)) {
          const totalRestarts = restartCounts[name] || 0;

          // Unstable restarts indicate actual crashes - treat as critical
          if (unstableRestarts > 0) {
            return HealthCheckBuilder.unhealthy(
              `CRITICAL: ${name} has ${unstableRestarts} unstable restart(s) (${totalRestarts} total). Unstable restarts indicate crashes.`,
              {
                serviceName: name,
                restartCount: totalRestarts,
                unstableRestarts,
                severity: 'critical',
              }
            );
          }

          // High total restart count with 0 unstable restarts is likely normal PM2 behavior
          // Only warn if it's unusually high (e.g., restart rate > restartRateThresholdPerHour/hour)
          if (totalRestarts >= warningThreshold) {
            const hoursSinceCreation = pm2Data.processes.find(p => p.name === name)?.pm2_env?.created_at
              ? (Date.now() - pm2Data.processes.find(p => p.name === name)!.pm2_env!.created_at) / (1000 * 60 * 60)
              : 1; // Default to 1 hour if unknown

            const restartRate = totalRestarts / Math.max(1, hoursSinceCreation);

            // Only flag degraded if restart rate is high and unstable restarts is 0
            if (restartRate > restartRateThresholdPerHour) {
              return HealthCheckBuilder.degraded(
                `Service instability: ${name} has restarted ${totalRestarts} times (${restartRate.toFixed(1)}/hour). No crashes detected (unstable_restarts=0).`,
                {
                  serviceName: name,
                  restartCount: totalRestarts,
                  restartRate: restartRate.toFixed(1),
                  unstableRestarts: 0,
                  severity: 'warning',
                }
              );
            }
          }
        }

        return HealthCheckBuilder.healthy({
          restartCounts,
          lastChecked: new Date(),
        });
      } catch (error) {
        return HealthCheckBuilder.unhealthy(
          `PM2 restart check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { error: error instanceof Error ? error.message : 'Unknown error' }
        );
      }
    });
}

/**
 * Get PM2 process data including restart counts
 */
async function getPM2Data(): Promise<{ processes: Array<{ name: string; pm2_env: { restart_time: number; created_at: number }; unstable_restarts: number }> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePm2Binary(), ['jlist'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('PM2 status check timed out'));
    }, 10000);

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        try {
          const processes = JSON.parse(stdout.trim()) as Array<{
            name: string;
            pm2_env: { restart_time: number; created_at: number };
            unstable_restarts: number;
          }>;
          resolve({ processes });
        } catch {
          reject(new Error('Failed to parse PM2 JSON'));
        }
      } else {
        reject(new Error(`PM2 check failed: ${stderr || `exit code ${code}`}`));
      }
    });

    proc.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to run PM2: ${error.message}`));
    });
  });
}

/**
 * Create a message length health check
 * Monitors summarization and truncation rates for message length handling
 */
export function createMessageLengthHealthCheck(
  messageLengthService: { getMetrics: () => { summarizationCount: number; truncationCount: number } },
  options: {
    summarizationWarningThreshold?: number;
    truncationWarningThreshold?: number;
    truncationCriticalThreshold?: number;
  } = {}
): HealthCheckFn {
  const {
    summarizationWarningThreshold = 20, // 20+ summarizations is a warning
    truncationWarningThreshold = 5, // 5+ truncations is a warning
    truncationCriticalThreshold = 10, // 10+ truncations is critical
  } = options;

  // Track previous counts to detect new occurrences since last check
  let lastSummarizationCount = 0;
  let lastTruncationCount = 0;

  return () =>
    HealthCheckBuilder.execute('messageLength', async () => {
      const metrics = messageLengthService.getMetrics();

      // Calculate new occurrences since last check
      const newSummarizations = metrics.summarizationCount - lastSummarizationCount;
      const newTruncations = metrics.truncationCount - lastTruncationCount;

      // Update tracking
      lastSummarizationCount = metrics.summarizationCount;
      lastTruncationCount = metrics.truncationCount;

      const metadata = {
        totalSummarizations: metrics.summarizationCount,
        totalTruncations: metrics.truncationCount,
        recentSummarizations: newSummarizations,
        recentTruncations: newTruncations,
        summarizationWarningThreshold,
        truncationWarningThreshold,
        truncationCriticalThreshold,
      };

      if (newTruncations >= truncationCriticalThreshold) {
        return HealthCheckBuilder.unhealthy(
          `High truncation rate: ${newTruncations} truncations since last check`,
          metadata
        );
      }

      if (newTruncations >= truncationWarningThreshold) {
        return HealthCheckBuilder.degraded(
          `Elevated truncation rate: ${newTruncations} truncations since last check`,
          metadata
        );
      }

      if (newSummarizations >= summarizationWarningThreshold) {
        return HealthCheckBuilder.degraded(
          `High summarization rate: ${newSummarizations} summarizations since last check`,
          metadata
        );
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

/**
 * Create a memory health check
 */
export function createMemoryHealthCheck(
  options: { warningThreshold?: number; criticalThreshold?: number } = {}
): HealthCheckFn {
  const { warningThreshold = 0.85, criticalThreshold = 0.95 } = options;

  return () =>
    HealthCheckBuilder.execute('memory', async () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
      const rssMB = memUsage.rss / 1024 / 1024;
      const externalMB = memUsage.external / 1024 / 1024;
      const arrayBuffersMB = (memUsage.arrayBuffers || 0) / 1024 / 1024;

      const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;

      const metadata = {
        heapUsedMB: Math.round(heapUsedMB * 100) / 100,
        heapTotalMB: Math.round(heapTotalMB * 100) / 100,
        rssMB: Math.round(rssMB * 100) / 100,
        externalMB: Math.round(externalMB * 100) / 100,
        arrayBuffersMB: Math.round(arrayBuffersMB * 100) / 100,
        heapUsagePercent: Math.round(heapUsagePercent * 10000) / 100,
      };

      if (heapUsagePercent >= criticalThreshold) {
        return HealthCheckBuilder.unhealthy(
          `Memory usage critical: ${(heapUsagePercent * 100).toFixed(1)}% (${heapUsedMB.toFixed(0)}MB / ${heapTotalMB.toFixed(0)}MB)`,
          metadata
        );
      }

      if (heapUsagePercent >= warningThreshold) {
        return HealthCheckBuilder.degraded(
          `Memory usage high: ${(heapUsagePercent * 100).toFixed(1)}% (${heapUsedMB.toFixed(0)}MB / ${heapTotalMB.toFixed(0)}MB)`,
          metadata
        );
      }

      return HealthCheckBuilder.healthy(metadata);
    });
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const healthService = new HealthService();

export default healthService;
