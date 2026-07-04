# /add-worker - Create New Worker

Create a new background worker for periodic tasks.

## When to Use

- Adding scheduled/periodic tasks
- Background processing
- Cleanup operations
- Monitoring tasks

## Worker Architecture

```
src/workers/
├── retry.worker.ts            # Failed message retry
├── priorityEscalation.worker.ts # Queue priority boosting
├── dlqCleanup.worker.ts       # Dead letter queue cleanup
├── cacheCleanup.worker.ts     # Cache TTL enforcement
├── queueCleanup.worker.ts     # Queue retention cleanup
└── <new>.worker.ts            # Your new worker
```

## Worker Pattern

Workers in Jarvis follow these conventions:

1. **Constructor** accepts repositories/services as dependencies
2. **start/stop methods** to control the interval timer
3. **Private process method** for the actual work
4. **Logging** for visibility

## Worker Template

```typescript
// src/workers/<name>.worker.ts

import { logger } from '../utils/logger.js';
import { appConfig } from '../config/index.js';
// Import repositories/services as needed
// import { SomeRepository } from '../repositories/some.repository.js';

export interface <Name>WorkerConfig {
  intervalMs?: number;
  batchSize?: number;
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<<Name>WorkerConfig> = {
  intervalMs: 60000,  // 1 minute
  batchSize: 100,
  enabled: true,
};

export class <Name>Worker {
  private timer: NodeJS.Timeout | null = null;
  private config: Required<<Name>WorkerConfig>;
  private isRunning = false;

  constructor(
    // Inject dependencies
    // private someRepo: SomeRepository,
    config?: <Name>WorkerConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.timer) {
      logger.warn('[<Name>Worker] Already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('[<Name>Worker] Disabled by config');
      return;
    }

    logger.info('[<Name>Worker] Starting', {
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
    });

    // Run immediately on start
    this.runCycle();

    // Then run on interval
    this.timer = setInterval(() => {
      this.runCycle();
    }, this.config.intervalMs);
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (!this.timer) {
      return;
    }

    logger.info('[<Name>Worker] Stopping');
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Run one cycle of the worker
   */
  private async runCycle(): Promise<void> {
    if (this.isRunning) {
      logger.debug('[<Name>Worker] Skipping cycle - previous still running');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const processed = await this.process();

      logger.info('[<Name>Worker] Cycle completed', {
        processed,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.error('[<Name>Worker] Cycle failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process one batch of work
   * @returns Number of items processed
   */
  private async process(): Promise<number> {
    // Get items to process
    // const items = await this.someRepo.getItemsToProcess(this.config.batchSize);

    // if (items.length === 0) {
    //   return 0;
    // }

    // Process each item
    // for (const item of items) {
    //   await this.processItem(item);
    // }

    // return items.length;
    return 0;
  }

  /**
   * Check if worker is currently running
   */
  isActive(): boolean {
    return this.timer !== null;
  }
}
```

## Starting Workers

Workers are typically started in `src/index.ts`:

```typescript
import { <Name>Worker } from './workers/<name>.worker.js';
import { someRepository } from './repositories/index.js';

// Create worker instance
const <name>Worker = new <Name>Worker(
  someRepository,
  {
    intervalMs: appConfig.<name>.intervalMs,
    batchSize: appConfig.<name>.batchSize,
  }
);

// Start worker
<name>Worker.start();

// Stop on shutdown
process.on('SIGTERM', () => {
  <name>Worker.stop();
});
```

## Example: Metrics Aggregation Worker

```typescript
// src/workers/metricsAggregation.worker.ts
import { logger } from '../utils/logger.js';
import { MetricsRepository } from '../repositories/metrics.repository.js';

export class MetricsAggregationWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private metricsRepo: MetricsRepository,
    private intervalMs: number = 60000
  ) {}

  start(): void {
    if (this.timer) return;

    logger.info('[MetricsAggregationWorker] Starting', { intervalMs: this.intervalMs });

    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Aggregate metrics from last interval
      const aggregated = await this.metricsRepo.aggregateRecentMetrics(this.intervalMs);

      logger.debug('[MetricsAggregationWorker] Aggregated metrics', {
        count: aggregated,
      });
    } catch (error) {
      logger.error('[MetricsAggregationWorker] Failed', { error });
    } finally {
      this.isRunning = false;
    }
  }
}
```

## Checklist

- [ ] Create worker file: `src/workers/<name>.worker.ts`
- [ ] Define config interface with defaults
- [ ] Implement constructor with dependency injection
- [ ] Implement `start()` method
- [ ] Implement `stop()` method
- [ ] Implement private `process()` method
- [ ] Add concurrency guard (`isRunning` flag)
- [ ] Add comprehensive logging
- [ ] Wire up in `src/index.ts`
- [ ] Handle graceful shutdown

## Worker Types

| Worker | Purpose | Interval |
|--------|---------|----------|
| RetryWorker | Retry failed messages | 30s |
| PriorityEscalationWorker | Boost old message priority | 60s |
| DLQCleanupWorker | Clean dead letter queue | 1h |
| CacheCleanupWorker | Expire stale cache | 5m |
| QueueCleanupWorker | Archive old completed | 1h |

## Troubleshooting

### Worker Not Starting
- Check `enabled` config is `true`
- Verify worker is instantiated in `src/index.ts`
- Check for errors in constructor dependencies

### Worker Running But Not Processing
- Verify `isRunning` flag is being reset in `finally` block
- Check repository methods return data
- Add debug logging to `process()` method

### Worker Causing High CPU/Memory
- Reduce `batchSize` configuration
- Increase `intervalMs` between cycles
- Add rate limiting within `process()` method

### Worker Not Stopping Gracefully
- Ensure `stop()` clears the interval timer
- Wait for current cycle to complete before exit
- Add shutdown hook in `src/index.ts`

## Reference

- Retry worker: `src/workers/retry.worker.ts`
- App config: `src/config/index.ts`
- Worker instantiation: `src/index.ts`
