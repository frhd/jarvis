import { CircuitBreakerRepository } from '../repositories/circuitBreaker.repository';
import { CircuitState } from '../types';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/index.js';

/**
 * Custom error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  public readonly serviceName: string;
  public readonly nextAttemptAt: Date | null;

  constructor(serviceName: string, nextAttemptAt: Date | null) {
    super(`Circuit breaker is OPEN for service: ${serviceName}`);
    this.name = 'CircuitOpenError';
    this.serviceName = serviceName;
    this.nextAttemptAt = nextAttemptAt;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CircuitOpenError);
    }
  }
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit after opening */
  resetTimeoutMs: number;
  /** Number of requests to allow in HALF_OPEN state */
  halfOpenRequests: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  halfOpenRequests: 3,
};

/**
 * Circuit Breaker Service
 *
 * Implements the circuit breaker pattern to protect against cascading failures.
 *
 * State transitions:
 * - CLOSED: Normal operation, track failures
 *   - When failures >= threshold: transition to OPEN
 * - OPEN: Reject all calls immediately with CircuitOpenError
 *   - After resetTimeoutMs: transition to HALF_OPEN
 * - HALF_OPEN: Allow halfOpenRequests through
 *   - If any fail: back to OPEN
 *   - If all succeed: back to CLOSED
 */
export class CircuitBreakerService {
  private serviceName: string;
  private config: CircuitBreakerConfig;
  private repository: CircuitBreakerRepository;

  // In-memory state (synced with DB for performance)
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastStateChangeAt: Date = new Date();
  private nextAttemptAt: Date | null = null;
  private halfOpenAttempts: number = 0;

  constructor(
    serviceName: string,
    config: Partial<CircuitBreakerConfig> = {},
    repository?: CircuitBreakerRepository
  ) {
    this.serviceName = serviceName;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.repository = repository || new CircuitBreakerRepository();
  }

  /**
   * Initialize circuit breaker by loading state from database
   */
  async initialize(): Promise<void> {
    await this.loadState();
    logger.info('[CircuitBreaker] Initialized', {
      serviceName: this.serviceName,
      state: this.state,
      config: this.config,
    });
  }

  /**
   * Main method to execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.isOpen()) {
      throw new CircuitOpenError(this.serviceName, this.nextAttemptAt);
    }

    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN' && this.shouldAttemptReset()) {
      await this.transitionTo('HALF_OPEN');
    }

    // In HALF_OPEN state, limit the number of requests
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        throw new CircuitOpenError(this.serviceName, this.nextAttemptAt);
      }
      this.halfOpenAttempts++;
      await this.saveState();
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure(error as Error);
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  async recordSuccess(): Promise<void> {
    this.successCount++;
    this.lastSuccessAt = new Date();

    if (this.state === 'HALF_OPEN') {
      // Check if we've completed all half-open requests successfully
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        await this.transitionTo('CLOSED');
        logger.info('[CircuitBreaker] Circuit closed after successful half-open tests', {
          serviceName: this.serviceName,
        });
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }

    await this.saveState();

    logger.debug('[CircuitBreaker] Success recorded', {
      serviceName: this.serviceName,
      state: this.state,
      successCount: this.successCount,
      failureCount: this.failureCount,
    });
  }

  /**
   * Record a failed operation
   */
  async recordFailure(error: Error): Promise<void> {
    this.failureCount++;
    this.lastFailureAt = new Date();

    logger.warn('[CircuitBreaker] Failure recorded', {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      error: getErrorMessage(error),
    });

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open state immediately opens the circuit
      await this.transitionTo('OPEN');
      logger.warn('[CircuitBreaker] Circuit opened due to half-open failure', {
        serviceName: this.serviceName,
      });
    } else if (this.state === 'CLOSED') {
      // Check if we've exceeded the failure threshold
      if (this.failureCount >= this.config.failureThreshold) {
        await this.transitionTo('OPEN');
        logger.error('[CircuitBreaker] Circuit opened due to failure threshold', {
          serviceName: this.serviceName,
          failureCount: this.failureCount,
          threshold: this.config.failureThreshold,
        });
      }
    }

    await this.saveState();
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if circuit is open (blocking calls)
   */
  isOpen(): boolean {
    if (this.state === 'OPEN' && this.shouldAttemptReset()) {
      return false; // Allow transition to HALF_OPEN
    }
    return this.state === 'OPEN';
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   */
  async reset(): Promise<void> {
    await this.transitionTo('CLOSED');
    logger.info('[CircuitBreaker] Circuit manually reset', {
      serviceName: this.serviceName,
    });
  }

  /**
   * Load state from database
   */
  async loadState(): Promise<void> {
    const record = await this.repository.findByServiceName(this.serviceName);

    if (record) {
      this.state = record.state;
      this.failureCount = record.failureCount;
      this.successCount = record.successCount;
      this.lastFailureAt = record.lastFailureAt;
      this.lastSuccessAt = record.lastSuccessAt;
      this.lastStateChangeAt = record.lastStateChangeAt;
      this.nextAttemptAt = record.nextAttemptAt;
      this.halfOpenAttempts = record.halfOpenAttempts;

      logger.debug('[CircuitBreaker] State loaded from database', {
        serviceName: this.serviceName,
        state: this.state,
      });
    } else {
      // Initialize new circuit breaker in database
      await this.saveState();
      logger.debug('[CircuitBreaker] New circuit breaker initialized', {
        serviceName: this.serviceName,
      });
    }
  }

  /**
   * Persist state to database
   */
  async saveState(): Promise<void> {
    await this.repository.upsert({
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      lastStateChangeAt: this.lastStateChangeAt,
      nextAttemptAt: this.nextAttemptAt,
      halfOpenAttempts: this.halfOpenAttempts,
    });

    logger.debug('[CircuitBreaker] State saved to database', {
      serviceName: this.serviceName,
      state: this.state,
    });
  }

  /**
   * Transition to a new state
   */
  private async transitionTo(newState: CircuitState): Promise<void> {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeAt = new Date();

    if (newState === 'OPEN') {
      this.nextAttemptAt = new Date(Date.now() + this.config.resetTimeoutMs);
    } else if (newState === 'HALF_OPEN') {
      this.halfOpenAttempts = 0;
      this.nextAttemptAt = null;
    } else if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
      this.nextAttemptAt = null;
    }

    await this.saveState();

    logger.info('[CircuitBreaker] State transition', {
      serviceName: this.serviceName,
      oldState,
      newState,
      nextAttemptAt: this.nextAttemptAt,
    });
  }

  /**
   * Check if enough time has passed to attempt reset from OPEN to HALF_OPEN
   */
  private shouldAttemptReset(): boolean {
    if (this.state !== 'OPEN' || !this.nextAttemptAt) {
      return false;
    }
    return Date.now() >= this.nextAttemptAt.getTime();
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      lastStateChangeAt: this.lastStateChangeAt,
      nextAttemptAt: this.nextAttemptAt,
      halfOpenAttempts: this.halfOpenAttempts,
      config: this.config,
    };
  }
}
