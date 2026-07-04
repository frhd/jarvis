/**
 * Runtime Config Integration Example
 *
 * This example demonstrates how to integrate the RuntimeConfigManager
 * with actual services in Jarvis for dynamic configuration updates.
 */

import { runtimeConfig } from '../../src/config/index.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Example: LLM Service with dynamic timeout updates
 */
class DynamicLLMService {
  private timeoutMs: number;
  private maxRetries: number;
  private temperature: number;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    // Initialize from current config
    this.timeoutMs = runtimeConfig.get('llm.timeoutMs') as number;
    this.maxRetries = runtimeConfig.get('llm.maxRetries') as number;
    this.temperature = runtimeConfig.get('llm.temperature') as number;

    // Subscribe to runtime changes
    this.unsubscribers.push(
      runtimeConfig.subscribe('llm.timeoutMs', (newValue: any) => {
        logger.info('LLM timeout updated', { old: this.timeoutMs, new: newValue });
        this.timeoutMs = newValue as number;
      })
    );

    this.unsubscribers.push(
      runtimeConfig.subscribe('llm.maxRetries', (newValue: any) => {
        logger.info('LLM max retries updated', { old: this.maxRetries, new: newValue });
        this.maxRetries = newValue as number;
      })
    );

    this.unsubscribers.push(
      runtimeConfig.subscribe('llm.temperature', (newValue: any) => {
        logger.info('LLM temperature updated', { old: this.temperature, new: newValue });
        this.temperature = newValue as number;
      })
    );

    logger.info('DynamicLLMService initialized', {
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
    });
  }

  async query(prompt: string): Promise<string> {
    logger.info('Querying LLM', {
      prompt,
      timeout: this.timeoutMs,
      retries: this.maxRetries,
      temperature: this.temperature,
    });

    // In a real service, this would make an actual LLM call
    // using the current configuration values
    return `Response with temp=${this.temperature}, timeout=${this.timeoutMs}`;
  }

  cleanup() {
    this.unsubscribers.forEach((unsub) => unsub());
    logger.info('DynamicLLMService cleaned up');
  }
}

/**
 * Example: Circuit Breaker with dynamic threshold updates
 */
class DynamicCircuitBreaker {
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private failureCount = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.failureThreshold = runtimeConfig.get('circuitBreaker.failureThreshold') as number;
    this.resetTimeoutMs = runtimeConfig.get('circuitBreaker.resetTimeoutMs') as number;

    this.unsubscribers.push(
      runtimeConfig.subscribe('circuitBreaker.failureThreshold', (newValue: any) => {
        logger.info('Circuit breaker threshold updated', {
          old: this.failureThreshold,
          new: newValue,
        });
        this.failureThreshold = newValue as number;
        // Re-evaluate state based on new threshold
        this.evaluateState();
      })
    );

    this.unsubscribers.push(
      runtimeConfig.subscribe('circuitBreaker.resetTimeoutMs', (newValue: any) => {
        logger.info('Circuit breaker reset timeout updated', {
          old: this.resetTimeoutMs,
          new: newValue,
        });
        this.resetTimeoutMs = newValue as number;
      })
    );

    logger.info('DynamicCircuitBreaker initialized', {
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
    });
  }

  recordFailure() {
    this.failureCount++;
    logger.info('Failure recorded', { count: this.failureCount, threshold: this.failureThreshold });
    this.evaluateState();
  }

  private evaluateState() {
    const previousState = this.state;

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    } else {
      this.state = 'CLOSED';
    }

    if (previousState !== this.state) {
      logger.warn('Circuit breaker state changed', {
        from: previousState,
        to: this.state,
        failures: this.failureCount,
        threshold: this.failureThreshold,
      });
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    logger.info('Circuit breaker reset');
  }

  cleanup() {
    this.unsubscribers.forEach((unsub) => unsub());
    logger.info('DynamicCircuitBreaker cleaned up');
  }
}

/**
 * Example: Configuration management service
 */
class ConfigManagementService {
  constructor() {
    // Log all config changes for audit trail
    runtimeConfig.on('change', (path: any, newValue: any, oldValue: any) => {
      logger.info('Configuration changed', {
        path,
        oldValue,
        newValue,
        timestamp: new Date().toISOString(),
      });
    });

    // Alert on critical config resets
    runtimeConfig.on('reset', (path: any, originalValue: any, oldValue: any) => {
      logger.warn('Configuration reset', {
        path,
        oldValue,
        originalValue,
        timestamp: new Date().toISOString(),
      });
    });

    logger.info('ConfigManagementService initialized');
  }

  /**
   * Emergency mode: Reduce all timeouts and disable expensive features
   */
  enterEmergencyMode() {
    logger.warn('ENTERING EMERGENCY MODE');

    // Reduce timeouts
    runtimeConfig.set('llm.timeoutMs', 5000);
    runtimeConfig.set('claude.timeoutMs', 10000);

    // Disable expensive features
    runtimeConfig.set('memory.enabled', false);
    runtimeConfig.set('rag.enabled', false);
    runtimeConfig.set('cache.enabled', false);

    // Reduce retries
    runtimeConfig.set('retry.maxAttempts', 2);

    const changes = runtimeConfig.getDiff();
    logger.warn('Emergency mode active', { changes });
  }

  /**
   * Exit emergency mode: Reset all config to original values
   */
  exitEmergencyMode() {
    logger.info('EXITING EMERGENCY MODE');
    runtimeConfig.resetAll();
    logger.info('Emergency mode deactivated');
  }

  /**
   * Get current configuration status
   */
  getStatus() {
    return {
      hasChanges: runtimeConfig.hasChanges(),
      changeCount: runtimeConfig.getChangeCount(),
      changes: runtimeConfig.getDiff(),
    };
  }

  /**
   * Apply performance profile
   */
  applyProfile(profile: 'fast' | 'balanced' | 'quality') {
    logger.info('Applying performance profile', { profile });

    switch (profile) {
      case 'fast':
        runtimeConfig.set('llm.temperature', 0.1);
        runtimeConfig.set('llm.maxTokens', 256);
        runtimeConfig.set('llm.timeoutMs', 10000);
        runtimeConfig.set('rag.topK', 5);
        break;

      case 'balanced':
        runtimeConfig.set('llm.temperature', 0.3);
        runtimeConfig.set('llm.maxTokens', 512);
        runtimeConfig.set('llm.timeoutMs', 30000);
        runtimeConfig.set('rag.topK', 10);
        break;

      case 'quality':
        runtimeConfig.set('llm.temperature', 0.7);
        runtimeConfig.set('llm.maxTokens', 1024);
        runtimeConfig.set('llm.timeoutMs', 60000);
        runtimeConfig.set('rag.topK', 20);
        break;
    }

    logger.info('Profile applied', { profile, changes: runtimeConfig.getDiff() });
  }
}

// Demo execution
async function demo() {
  logger.info('=== Runtime Config Integration Demo ===');

  // Initialize services
  const llmService = new DynamicLLMService();
  const circuitBreaker = new DynamicCircuitBreaker();
  const configManager = new ConfigManagementService();

  // Test 1: Normal operation
  logger.info('\n--- Test 1: Normal Operation ---');
  await llmService.query('What is the weather?');

  // Test 2: Runtime config update - services react automatically
  logger.info('\n--- Test 2: Runtime Config Update ---');
  runtimeConfig.set('llm.timeoutMs', 45000);
  runtimeConfig.set('llm.temperature', 0.5);
  await llmService.query('Tell me a joke');

  // Test 3: Circuit breaker with dynamic threshold
  logger.info('\n--- Test 3: Dynamic Circuit Breaker ---');
  circuitBreaker.recordFailure();
  circuitBreaker.recordFailure();
  circuitBreaker.recordFailure();
  logger.info('Lowering failure threshold at runtime...');
  runtimeConfig.set('circuitBreaker.failureThreshold', 3);
  circuitBreaker.recordFailure(); // Should trigger circuit breaker

  // Test 4: Performance profiles
  logger.info('\n--- Test 4: Performance Profiles ---');
  configManager.applyProfile('fast');
  await llmService.query('Quick response needed');

  await new Promise((resolve) => setTimeout(resolve, 100));

  configManager.applyProfile('quality');
  await llmService.query('Complex reasoning needed');

  // Test 5: Emergency mode
  logger.info('\n--- Test 5: Emergency Mode ---');
  logger.info('Status before emergency:', configManager.getStatus());
  configManager.enterEmergencyMode();
  logger.info('Status during emergency:', configManager.getStatus());

  await new Promise((resolve) => setTimeout(resolve, 100));

  configManager.exitEmergencyMode();
  logger.info('Status after emergency:', configManager.getStatus());

  // Cleanup
  logger.info('\n--- Cleanup ---');
  llmService.cleanup();
  circuitBreaker.cleanup();

  logger.info('=== Demo Complete ===');
}

// Run the demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch((error) => {
    logger.error('Demo failed', { error });
    process.exit(1);
  });
}

export { DynamicLLMService, DynamicCircuitBreaker, ConfigManagementService };
