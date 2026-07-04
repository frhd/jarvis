# Dead Letter Queue (DLQ) Implementation

## Overview

The Dead Letter Queue (DLQ) is a critical component of the message processing system that handles messages that have failed processing after all retry attempts have been exhausted. It provides a mechanism for:

- Storing failed messages for later inspection and reprocessing
- Analyzing failure patterns and root causes
- Manual intervention and recovery
- Preventing message loss

## Architecture

### Components

1. **DeadLetterQueueRepository** (`src/repositories/deadLetterQueue.repository.ts`)
   - Data access layer for the DLQ
   - Handles database operations and JSON parsing/serialization
   - Provides pagination and filtering capabilities

2. **DeadLetterQueueService** (`src/services/deadLetterQueue.service.ts`)
   - Business logic for DLQ operations
   - Orchestrates movement of items to/from DLQ
   - Provides inspection and reprocessing capabilities

3. **Database Schema** (`deadLetterQueue` table)
   - Stores failed queue items with full error history
   - Maintains references to original queue items and messages
   - Tracks retry attempts and failure metadata

## Database Schema

```sql
CREATE TABLE deadLetterQueue (
  id TEXT PRIMARY KEY,
  originalQueueId TEXT NOT NULL REFERENCES queue(id),
  messageId TEXT NOT NULL REFERENCES messages(id),
  reason TEXT NOT NULL,
  errorHistory TEXT NOT NULL,  -- JSON array of ErrorRecord
  attempts INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,               -- JSON object
  createdAt INTEGER NOT NULL,
  lastAttemptAt INTEGER
);
```

## Data Types

### DLQReason Enum

```typescript
enum DLQReason {
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
  MANUAL_MOVE = 'MANUAL_MOVE',
}
```

### ErrorRecord

```typescript
interface ErrorRecord {
  timestamp: Date;
  error: string;
  attempt: number;
}
```

### DeadLetterItemParsed

```typescript
interface DeadLetterItemParsed {
  id: string;
  originalQueueId: string;
  messageId: string;
  reason: string;
  errorHistory: ErrorRecord[];
  attempts: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
}
```

### DLQStats

```typescript
interface DLQStats {
  total: number;
  byReason: Record<string, number>;
  oldestItemAge?: number;
  recentFailures: number;
}
```

## Repository API

### DeadLetterQueueRepository

#### `add(item: AddDeadLetterItemInput): Promise<DeadLetterItemParsed>`

Adds a new item to the dead letter queue.

**Parameters:**
- `item.originalQueueId`: Reference to the original queue item
- `item.messageId`: Reference to the failed message
- `item.reason`: Reason for failure (use DLQReason enum)
- `item.errorHistory`: Array of error records
- `item.attempts`: Number of attempts made (optional, defaults to 0)
- `item.metadata`: Additional metadata (optional)
- `item.lastAttemptAt`: Timestamp of last attempt (optional)

**Returns:** The created DLQ item with parsed JSON fields

**Example:**
```typescript
const dlqItem = await dlqRepository.add({
  originalQueueId: queueItem.id,
  messageId: message.id,
  reason: DLQReason.MAX_RETRIES_EXCEEDED,
  errorHistory: [
    { timestamp: new Date(), error: 'Timeout', attempt: 1 },
    { timestamp: new Date(), error: 'Connection refused', attempt: 2 },
  ],
  attempts: 5,
  metadata: { priority: 1, lastError: 'Connection refused' },
});
```

#### `getById(id: string): Promise<DeadLetterItemParsed | null>`

Retrieves a DLQ item by its ID.

#### `getByMessageId(messageId: string): Promise<DeadLetterItemParsed | null>`

Retrieves a DLQ item by the associated message ID.

#### `getAll(options?: { limit?: number; offset?: number }): Promise<DeadLetterItemParsed[]>`

Retrieves all DLQ items with optional pagination.

**Default:** limit=100, offset=0

#### `getByReason(reason: string): Promise<DeadLetterItemParsed[]>`

Retrieves all DLQ items with a specific failure reason.

#### `remove(id: string): Promise<boolean>`

Removes an item from the DLQ. Returns true if the item was removed.

#### `updateAttempts(id: string, attempts: number): Promise<void>`

Updates the attempt count for a DLQ item. Also updates `lastAttemptAt` to current time.

#### `getStats(): Promise<{ total: number; byReason: Record<string, number> }>`

Returns aggregate statistics about the DLQ:
- Total number of items
- Count of items grouped by reason

#### `getOlderThan(ageMs: number): Promise<DeadLetterItemParsed[]>`

Retrieves items older than the specified age in milliseconds.

#### `purgeOlderThan(ageMs: number): Promise<number>`

Permanently deletes items older than the specified age. Returns the number of items deleted.

**Example:**
```typescript
// Purge items older than 30 days
const deleted = await dlqRepository.purgeOlderThan(30 * 24 * 60 * 60 * 1000);
```

## Service API

### DeadLetterQueueService

#### Constructor

```typescript
constructor(
  dlqRepository: DeadLetterQueueRepository,
  queueRepository: QueueRepository,
  messageRepository?: MessageRepository,
  chatRepository?: ChatRepository
)
```

#### `moveToDeadLetter(queueItemId: string, reason: string, errorHistory: ErrorRecord[]): Promise<DeadLetterItemParsed>`

Moves a queue item to the dead letter queue.

**Process:**
1. Retrieves the queue item
2. Creates a DLQ entry with full error history
3. Marks the original queue item as failed
4. Returns the DLQ item

**Example:**
```typescript
const dlqItem = await dlqService.moveToDeadLetter(
  queueItem.id,
  DLQReason.MAX_RETRIES_EXCEEDED,
  [
    { timestamp: new Date(), error: 'Timeout', attempt: 1 },
    { timestamp: new Date(), error: 'Service unavailable', attempt: 2 },
  ]
);
```

#### `reprocessItem(dlqItemId: string): Promise<boolean>`

Reprocesses a single DLQ item by moving it back to the main queue.

**Process:**
1. Retrieves the DLQ item
2. Re-enqueues the message with normal priority
3. Updates the attempt counter
4. Returns true if successful

#### `reprocessAll(): Promise<{ success: number; failed: number }>`

Reprocesses all items in the DLQ. Returns counts of successful and failed reprocessing attempts.

**Example:**
```typescript
const result = await dlqService.reprocessAll();
console.log(`Reprocessed ${result.success} items, ${result.failed} failed`);
```

#### `inspectItem(dlqItemId: string): Promise<DeadLetterItemParsed & { message?: Message; chat?: Chat } | null>`

Retrieves a DLQ item with full details including the related message and chat (if available).

**Example:**
```typescript
const details = await dlqService.inspectItem(dlqItemId);
if (details) {
  console.log('Message text:', details.message?.text);
  console.log('Chat title:', details.chat?.title);
  console.log('Error history:', details.errorHistory);
}
```

#### `getStats(): Promise<DLQStats>`

Returns comprehensive statistics about the DLQ including:
- Total count
- Count by reason
- Age of oldest item
- Count of recent failures (last hour)

#### `purgeOld(maxAgeMs: number): Promise<number>`

Purges items older than the specified age. Returns the count of purged items.

#### `getItemsByReason(reason: string): Promise<DeadLetterItemParsed[]>`

Retrieves all items with a specific failure reason.

#### `getAllItems(options?: { limit?: number; offset?: number }): Promise<DeadLetterItemParsed[]>`

Retrieves all DLQ items with optional pagination.

#### `removeItem(dlqItemId: string): Promise<boolean>`

Removes a specific item from the DLQ.

## Usage Examples

### Example 1: Moving a Failed Queue Item to DLQ

```typescript
import { DeadLetterQueueService } from './services/deadLetterQueue.service';
import { DLQReason } from './types';

// In processor service after max retries
if (attempts >= maxAttempts) {
  const errorHistory = [
    { timestamp: attempt1Time, error: 'Timeout', attempt: 1 },
    { timestamp: attempt2Time, error: 'Connection error', attempt: 2 },
    { timestamp: attempt3Time, error: 'Service unavailable', attempt: 3 },
  ];

  await dlqService.moveToDeadLetter(
    queueItem.id,
    DLQReason.MAX_RETRIES_EXCEEDED,
    errorHistory
  );
}
```

### Example 2: Monitoring DLQ

```typescript
// Get DLQ statistics
const stats = await dlqService.getStats();
console.log('DLQ Stats:', {
  total: stats.total,
  maxRetries: stats.byReason[DLQReason.MAX_RETRIES_EXCEEDED] || 0,
  circuitBreaker: stats.byReason[DLQReason.CIRCUIT_BREAKER_OPEN] || 0,
  recentFailures: stats.recentFailures,
});

// Alert if too many recent failures
if (stats.recentFailures > 10) {
  console.warn('High failure rate detected!');
}
```

### Example 3: Reprocessing Failed Items

```typescript
// Reprocess items that failed due to circuit breaker
const circuitBreakerItems = await dlqService.getItemsByReason(
  DLQReason.CIRCUIT_BREAKER_OPEN
);

for (const item of circuitBreakerItems) {
  const success = await dlqService.reprocessItem(item.id);
  if (success) {
    console.log(`Reprocessed item ${item.id}`);
  }
}
```

### Example 4: Inspecting Failed Messages

```typescript
// Inspect a failed message with full details
const details = await dlqService.inspectItem(dlqItemId);

if (details) {
  console.log('Failed Message Details:');
  console.log('- Reason:', details.reason);
  console.log('- Attempts:', details.attempts);
  console.log('- Message:', details.message?.text);
  console.log('- Chat:', details.chat?.title);
  console.log('- Error History:');
  details.errorHistory.forEach((error, i) => {
    console.log(`  ${i + 1}. [${error.timestamp}] ${error.error}`);
  });
}
```

### Example 5: Periodic Cleanup

```typescript
// Run as a scheduled job (e.g., daily)
async function cleanupOldDLQItems() {
  // Purge items older than 30 days
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const purgedCount = await dlqService.purgeOld(thirtyDays);

  console.log(`Purged ${purgedCount} old DLQ items`);
}
```

## Integration with Existing Systems

### Processor Service Integration

To integrate the DLQ with the existing processor service:

```typescript
// In processor.service.ts
async handleProcessingResult(queueItem: QueueItem, result: ProcessingResult): Promise<void> {
  if (result.success) {
    await this.queueRepo.markCompleted(queueItem.id);
  } else {
    const newAttempts = await this.queueRepo.incrementAttempts(queueItem.id);

    if (newAttempts >= appConfig.retry.maxAttempts) {
      // Move to DLQ instead of just marking as failed
      const errorHistory: ErrorRecord[] = [
        {
          timestamp: new Date(),
          error: result.error || 'Unknown error',
          attempt: newAttempts,
        },
      ];

      await this.dlqService.moveToDeadLetter(
        queueItem.id,
        DLQReason.MAX_RETRIES_EXCEEDED,
        errorHistory
      );

      logger.error('[Processor] Message moved to DLQ', {
        messageId: queueItem.messageId,
        attempts: newAttempts,
      });
    } else {
      // Still retrying
      logger.warn('[Processor] Message failed, will retry', {
        messageId: queueItem.messageId,
        attempts: newAttempts,
      });
    }
  }
}
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **DLQ Size**: Total number of items in the DLQ
   ```typescript
   const stats = await dlqService.getStats();
   metrics.gauge('dlq.total', stats.total);
   ```

2. **Failure Rate**: Number of items added to DLQ per time period
   ```typescript
   metrics.gauge('dlq.recent_failures', stats.recentFailures);
   ```

3. **Failure Reasons**: Distribution of failure reasons
   ```typescript
   Object.entries(stats.byReason).forEach(([reason, count]) => {
     metrics.gauge(`dlq.by_reason.${reason}`, count);
   });
   ```

4. **DLQ Age**: Age of oldest item in the DLQ
   ```typescript
   if (stats.oldestItemAge) {
     metrics.gauge('dlq.oldest_item_age_ms', stats.oldestItemAge);
   }
   ```

### Recommended Alerts

1. **High DLQ Size**: Alert when DLQ size exceeds threshold
   ```typescript
   if (stats.total > 100) {
     alerting.send('DLQ size exceeded threshold', { total: stats.total });
   }
   ```

2. **High Failure Rate**: Alert on spike in failures
   ```typescript
   if (stats.recentFailures > 10) {
     alerting.send('High failure rate detected', { count: stats.recentFailures });
   }
   ```

3. **Old Items**: Alert on items that have been in DLQ too long
   ```typescript
   const sevenDays = 7 * 24 * 60 * 60 * 1000;
   if (stats.oldestItemAge && stats.oldestItemAge > sevenDays) {
     alerting.send('Old items in DLQ', { age: stats.oldestItemAge });
   }
   ```

## Best Practices

1. **Regular Monitoring**: Check DLQ stats regularly (at least daily)
2. **Periodic Cleanup**: Purge old items periodically (e.g., after 30 days)
3. **Root Cause Analysis**: Analyze failure patterns by reason
4. **Manual Intervention**: Review and reprocess items manually when appropriate
5. **Alerting**: Set up alerts for unusual DLQ activity
6. **Retention Policy**: Define how long to keep DLQ items before purging

## Testing

Run the test suite to verify DLQ functionality:

```bash
npx tsx src/tests/deadLetterQueue.test.ts
```

The test suite validates:
- Adding items to DLQ
- Retrieving items by ID and reason
- Statistics calculation
- Updating attempts
- Removing items
- Inspection capabilities

## Future Enhancements

Potential improvements to consider:

1. **Automatic Reprocessing**: Schedule automatic reprocessing of certain failure types
2. **Retention Policies**: Configurable retention based on failure reason
3. **Export Capabilities**: Export DLQ items for external analysis
4. **Batch Operations**: Bulk reprocessing and removal operations
5. **Priority-Based Reprocessing**: Reprocess high-priority items first
6. **Webhooks**: Notify external systems when items are added to DLQ
