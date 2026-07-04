/**
 * Circuit Breaker Service - Usage Examples
 *
 * This file demonstrates how to use the CircuitBreakerService to protect
 * against cascading failures in your application.
 */

import { CircuitBreakerService, CircuitOpenError } from '../../src/services/circuitBreaker.service.js';
import { CircuitBreakerRepository } from '../../src/repositories/circuitBreaker.repository.js';

/**
 * Example 1: Basic Usage
 *
 * Wrap any async operation that might fail with the circuit breaker
 */
async function basicExample() {
  // Create a circuit breaker for a specific service
  const breaker = new CircuitBreakerService('ollama-api', {
    failureThreshold: 5,
    resetTimeoutMs: 30000, // 30 seconds
    halfOpenRequests: 3,
  });

  // Initialize (loads state from database)
  await breaker.initialize();

  // Wrap your API call
  try {
    const result = await breaker.execute(async () => {
      // Your potentially failing operation
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        body: JSON.stringify({ model: 'llama2', prompt: 'Hello' }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    });

    console.log('Success:', result);
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      // Circuit is open - don't attempt the operation
      console.error('Circuit is OPEN, operation blocked');
      console.error('Next attempt at:', error.nextAttemptAt);
    } else {
      // Operation failed for another reason
      console.error('Operation failed:', error);
    }
  }
}

/**
 * Example 2: Protecting LLM Client Calls
 *
 * Wrap LLM client calls to prevent cascading failures when Ollama is down
 */
async function llmExample() {
  const breaker = new CircuitBreakerService('llm-client');
  await breaker.initialize();

  // In your LLM client class, wrap calls like this:
  async function callLLM(prompt: string) {
    return breaker.execute(async () => {
      // Your actual LLM call
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama2',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API failed: ${response.statusText}`);
      }

      return response.json();
    });
  }

  // Usage
  try {
    const result = await callLLM('What is the weather today?');
    console.log('LLM Response:', result);
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      console.log('LLM service is temporarily unavailable');
      // Fall back to a default response or cached result
      return { content: 'Service temporarily unavailable, please try again later' };
    }
    throw error;
  }
}

/**
 * Example 3: Protecting Database Operations
 *
 * Use circuit breaker for external database calls
 */
async function databaseExample() {
  const breaker = new CircuitBreakerService('postgres-db', {
    failureThreshold: 3, // Lower threshold for critical services
    resetTimeoutMs: 60000, // 1 minute
    halfOpenRequests: 2,
  });

  await breaker.initialize();

  async function queryDatabase(query: string) {
    return breaker.execute(async () => {
      // Your database query
      // const result = await pool.query(query);
      // return result.rows;
      return [];
    });
  }

  try {
    const data = await queryDatabase('SELECT * FROM users');
    console.log('Query result:', data);
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      console.log('Database circuit is open, using cache or degraded mode');
    }
  }
}

/**
 * Example 4: Monitoring Circuit State
 *
 * Check circuit state and get statistics
 */
async function monitoringExample() {
  const breaker = new CircuitBreakerService('my-service');
  await breaker.initialize();

  // Check if circuit is open
  if (breaker.isOpen()) {
    console.log('Circuit is OPEN - operations will be blocked');
  }

  // Get current state
  const state = breaker.getState();
  console.log('Current state:', state); // 'CLOSED', 'OPEN', or 'HALF_OPEN'

  // Get detailed statistics
  const stats = breaker.getStats();
  console.log('Circuit breaker stats:', {
    serviceName: stats.serviceName,
    state: stats.state,
    failureCount: stats.failureCount,
    successCount: stats.successCount,
    lastFailure: stats.lastFailureAt,
    lastSuccess: stats.lastSuccessAt,
    nextAttempt: stats.nextAttemptAt,
  });
}

/**
 * Example 5: Manual Circuit Control
 *
 * Manually reset a circuit breaker
 */
async function manualControlExample() {
  const breaker = new CircuitBreakerService('external-api');
  await breaker.initialize();

  // After fixing the underlying issue, manually reset the circuit
  await breaker.reset();
  console.log('Circuit has been manually reset to CLOSED state');
}

/**
 * Example 6: Multiple Circuit Breakers
 *
 * Use different circuit breakers for different services
 */
async function multipleBreakersExample() {
  // Shared repository for all circuit breakers
  const repository = new CircuitBreakerRepository();

  // Different breakers for different services
  const ollamaBreaker = new CircuitBreakerService(
    'ollama',
    { failureThreshold: 5 },
    repository
  );

  const claudeBreaker = new CircuitBreakerService(
    'claude-cli',
    { failureThreshold: 3, resetTimeoutMs: 60000 },
    repository
  );

  const telegramBreaker = new CircuitBreakerService(
    'telegram-api',
    { failureThreshold: 10 },
    repository
  );

  await Promise.all([
    ollamaBreaker.initialize(),
    claudeBreaker.initialize(),
    telegramBreaker.initialize(),
  ]);

  // Use each breaker independently
  try {
    await ollamaBreaker.execute(() => callOllamaAPI());
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      console.log('Ollama circuit open, using fallback');
    }
  }

  try {
    await claudeBreaker.execute(() => callClaudeAPI());
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      console.log('Claude circuit open, using fallback');
    }
  }
}

// Placeholder functions
async function callOllamaAPI() {
  return { response: 'test' };
}

async function callClaudeAPI() {
  return { response: 'test' };
}

/**
 * Example 7: Integration with Existing Services
 *
 * How to integrate circuit breaker into existing LLMService
 */
class EnhancedLLMService {
  private circuitBreaker: CircuitBreakerService;

  constructor() {
    this.circuitBreaker = new CircuitBreakerService('llm-service', {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenRequests: 3,
    });
  }

  async initialize() {
    await this.circuitBreaker.initialize();
  }

  async chat(messages: any[]) {
    try {
      return await this.circuitBreaker.execute(async () => {
        // Your actual LLM call logic here
        const response = await this.performLLMCall(messages);
        return response;
      });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        // Circuit is open - return cached response or skip
        console.log('LLM circuit is open, skipping analysis');
        return {
          success: true,
          skipped: true,
          content: 'LLM temporarily unavailable',
        };
      }
      throw error;
    }
  }

  private async performLLMCall(messages: any[]) {
    // Your actual implementation
    return { content: 'response' };
  }

  getCircuitState() {
    return this.circuitBreaker.getState();
  }

  getCircuitStats() {
    return this.circuitBreaker.getStats();
  }
}

export {
  basicExample,
  llmExample,
  databaseExample,
  monitoringExample,
  manualControlExample,
  multipleBreakersExample,
  EnhancedLLMService,
};
