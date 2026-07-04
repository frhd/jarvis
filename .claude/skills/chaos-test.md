# /chaos-test - Run Chaos Engineering Tests

Run chaos engineering scenarios to test system resilience.

## When to Use

- Testing failure recovery
- Validating circuit breakers
- Stress testing queue
- Verifying graceful degradation

## Chaos Test Location

```
tests/queue/chaos-engineering.test.ts
```

## Running Chaos Tests

```bash
# Run all chaos tests
npx vitest tests/queue/chaos-engineering.test.ts

# Run with verbose output
npx vitest tests/queue/chaos-engineering.test.ts --reporter=verbose

# Run specific test
npx vitest tests/queue/chaos-engineering.test.ts -t "circuit breaker"
```

## Chaos Scenarios

### 1. Circuit Breaker Validation

Tests that circuit breaker opens after consecutive failures:

```typescript
describe('Circuit Breaker', () => {
  it('should open after threshold failures', async () => {
    // Simulate 5 consecutive failures
    // Verify circuit breaker opens
    // Verify requests are rejected when open
    // Verify half-open state after timeout
    // Verify recovery on success
  });
});
```

### 2. Queue Resilience

Tests queue behavior under stress:

```typescript
describe('Queue Resilience', () => {
  it('should handle high message volume', async () => {
    // Enqueue 1000 messages rapidly
    // Verify no messages lost
    // Verify processing continues
  });

  it('should recover from processing failures', async () => {
    // Inject random failures
    // Verify retry mechanism
    // Verify eventual completion
  });
});
```

### 3. DLQ Overflow

Tests dead letter queue handling:

```typescript
describe('Dead Letter Queue', () => {
  it('should handle DLQ overflow', async () => {
    // Fill DLQ with failed messages
    // Verify system remains stable
    // Verify cleanup works
  });
});
```

### 4. Priority Starvation

Tests priority escalation:

```typescript
describe('Priority Escalation', () => {
  it('should prevent priority starvation', async () => {
    // Enqueue mix of priorities
    // Verify low priority eventually processed
    // Verify escalation works
  });
});
```

### 5. Latency Injection

Tests timeout handling:

```typescript
describe('Latency Injection', () => {
  it('should handle slow LLM responses', async () => {
    // Inject artificial latency
    // Verify timeout triggers
    // Verify retry with backoff
  });
});
```

## Chaos Configuration

```typescript
const CHAOS_CONFIG = {
  // Failure injection rate (0-1)
  failureRate: 0.3,

  // Latency injection (ms)
  latencyMin: 100,
  latencyMax: 5000,

  // Load test parameters
  messageCount: 1000,
  concurrentWorkers: 5,

  // Circuit breaker thresholds
  failureThreshold: 5,
  resetTimeoutMs: 30000,
};
```

## Writing Custom Chaos Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Custom Chaos Scenario', () => {
  let originalService: SomeService;

  beforeEach(() => {
    // Store original
    originalService = someService;

    // Inject chaos
    someService = new ChaosWrapper(originalService, {
      failureRate: 0.5,
    });
  });

  afterEach(() => {
    // Restore original
    someService = originalService;
  });

  it('should handle failures gracefully', async () => {
    const results = [];

    // Run multiple operations
    for (let i = 0; i < 100; i++) {
      try {
        results.push(await someService.doSomething());
      } catch (error) {
        // Expected failures
      }
    }

    // Verify partial success
    expect(results.length).toBeGreaterThan(40);
    expect(results.length).toBeLessThan(60);
  });
});
```

## Chaos Wrapper Pattern

```typescript
class ChaosWrapper<T> {
  constructor(
    private service: T,
    private config: { failureRate: number; latencyMs?: number }
  ) {}

  async call<R>(method: () => Promise<R>): Promise<R> {
    // Inject latency
    if (this.config.latencyMs) {
      await sleep(Math.random() * this.config.latencyMs);
    }

    // Inject failure
    if (Math.random() < this.config.failureRate) {
      throw new Error('Chaos injection: simulated failure');
    }

    return method();
  }
}
```

## Monitoring During Chaos

Watch these metrics during chaos tests:

```bash
# Queue depth
watch -n 1 'sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"'

# Circuit breaker states
watch -n 1 'sqlite3 data/jarvis.db "SELECT * FROM circuitBreakerStates;"'

# Error rate
watch -n 5 'tail -100 data/jarvis-error.log | wc -l'
```

## Expected Behavior

| Scenario | Expected |
|----------|----------|
| High failure rate | Circuit breaker opens |
| Queue overflow | Messages queued, not lost |
| DLQ full | Oldest items archived |
| Slow responses | Timeouts, retries |
| Process crash | Recovery on restart |

## Reference

- Chaos tests: `tests/queue/chaos-engineering.test.ts`
- Load tests: `tests/queue/queue-load.test.ts`
- Circuit breaker: `src/services/circuitBreaker.service.ts`
- Retry strategy: `src/services/retryStrategy.service.ts`
