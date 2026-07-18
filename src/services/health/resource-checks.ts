import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger';
import { resolvePm2Binary } from '../../utils/pm2-binary.js';
import { HealthCheckBuilder } from '../../utils/index.js';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';
import type { HealthCheckFn } from './types.js';

const logger = createLogger('HealthService');

// ============================================================================
// Built-in Health Check Factories (runtime / system resource dependent)
// ============================================================================

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
