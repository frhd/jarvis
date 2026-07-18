import { connection } from '../../db/client';
import { HealthCheckBuilder } from '../../utils/index.js';
import type { HealthCheckFn } from './types.js';

// ============================================================================
// Built-in Health Check Factories (external service / repository dependent)
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
