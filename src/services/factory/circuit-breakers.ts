import { CircuitBreakerService } from '../circuitBreaker.service.js';
import { circuitBreakerRepository } from '../../repositories/index.js';
import { appConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CircuitBreakers');

// Circuit breaker configuration from app config
export const circuitBreakerConfig = {
  failureThreshold: appConfig.circuitBreaker.failureThreshold,
  resetTimeoutMs: appConfig.circuitBreaker.resetTimeoutMs,
  halfOpenRequests: appConfig.circuitBreaker.halfOpenRequests,
};

// Ollama circuit breaker for LLM service protection
export const ollamaCircuitBreaker = new CircuitBreakerService(
  'ollama',
  circuitBreakerConfig,
  circuitBreakerRepository
);

// Claude circuit breaker for Claude client protection
export const claudeCircuitBreaker = new CircuitBreakerService(
  'claude',
  circuitBreakerConfig,
  circuitBreakerRepository
);

/**
 * Initialize all circuit breakers by loading their persisted state.
 * This should be called during application startup.
 * Initialization is asynchronous but doesn't block startup.
 */
export async function initializeCircuitBreakers(): Promise<void> {
  try {
    await Promise.all([
      ollamaCircuitBreaker.initialize(),
      claudeCircuitBreaker.initialize(),
    ]);
  } catch (err) {
    // Log error but don't throw - circuit breakers will work with in-memory state
    // This can happen when circuitBreakerStates table doesn't exist (e.g., CEO database)
    logger.warn('Circuit breaker initialization failed, using in-memory state', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
