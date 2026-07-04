---
name: "queue-health-auditor"
description: "Analyze queue health metrics and identify processing bottlenecks"
---

# Queue Health Auditor Agent

Analyze queue health metrics and identify processing bottlenecks to ensure reliable message processing.

## Agent Type
`Explore` agent with database query capabilities

## When This Agent is Triggered

- User asks about queue health or backlog status
- Investigating message processing delays
- Checking for stuck or stale queue items
- Reviewing worker performance and throughput
- Capacity planning for queue scaling

## Capabilities

1. **Queue Statistics** - Count items by status, analyze priority distribution
2. **Aging Analysis** - Identify jobs stuck beyond healthy thresholds
3. **Worker Health Check** - Assess worker status and processing times
4. **Dead Letter Queue Analysis** - Review failed message patterns
5. **Recommendations** - Generate actionable tuning suggestions

## Agent Instructions

When auditing queue health, follow this process:

### Phase 1: Queue Statistics

Gather current queue state from the database:

1. **Read the queue schema** from `src/db/schema.ts` to understand:
   - Status values: `pending`, `processing`, `completed`, `failed`
   - Priority field (integer, higher = processed first)
   - Timestamps: `createdAt`, `processedAt`, `processingStartedAt`, `nextRetryAt`
   - Attempt tracking: `attempts`, `lastError`
   - Priority boost tracking: `priorityBoostApplied`, `originalPriority`

2. **Query queue statistics** using the repository pattern:
   - Reference `src/repositories/queue.repository.ts` method `getStats()` for counts by status
   - Calculate totals and percentages for each status

3. **Analyze priority distribution**:
   - Count items by priority level
   - Identify any priority concentration (too many high-priority items)

### Phase 2: Aging Analysis

Identify items that have been waiting too long:

1. **Define aging thresholds** (based on escalation rules):
   - Warning: Items older than 5 minutes
   - Concern: Items older than 15 minutes
   - Critical: Items older than 30 minutes
   - Severe: Items older than 1 hour

2. **Check for stuck processing items**:
   - Reference `getStuckMessageStats()` in queue repository
   - These are items in `processing` status that have timed out
   - Default stuck threshold is configurable in `appConfig.retry.stuckMessageThresholdMs`

3. **Check pending item ages**:
   - Reference `getStaleItems()` for items waiting too long
   - Calculate age distribution in 15-minute buckets

4. **Review retry scheduling**:
   - Check `nextRetryAt` values for items awaiting retry
   - Identify any retry delays that seem excessive

### Phase 3: Worker Health Check

Assess the workers that process the queue:

1. **Review worker files** in `src/workers/`:
   - `retry.worker.ts` - Processes retries and recovers stuck messages
   - `priorityEscalation.worker.ts` - Boosts priority for stale items
   - `queueCleanup.worker.ts` - Purges old completed/failed entries
   - `dlqCleanup.worker.ts` - Manages dead letter queue retention

2. **Check worker configuration**:
   - Retry interval: `appConfig.retry.retryIntervalMs`
   - Stuck message threshold: `appConfig.retry.stuckMessageThresholdMs`
   - Max retry attempts: `appConfig.retry.maxAttempts`

3. **Analyze processing patterns**:
   - Check for items with high `attempts` count (repeated failures)
   - Review `lastError` messages for common failure patterns

### Phase 4: Dead Letter Queue Analysis

Review messages that exceeded max retries:

1. **Read DLQ schema** from `src/db/schema.ts`:
   - `deadLetterQueue` table stores failed messages
   - Contains `errorHistory` JSON array for debugging

2. **Check DLQ size and growth**:
   - Count total items in DLQ
   - Identify recent additions

3. **Analyze failure patterns**:
   - Group by `reason` field
   - Look for systemic issues vs isolated failures

### Phase 5: Generate Recommendations

Based on findings, provide actionable recommendations:

1. **Priority tuning**:
   - If too many high-priority items exist, suggest adjusting VIP thresholds
   - If escalation isn't working, review escalation rules

2. **Worker scaling**:
   - If backlog is growing, suggest reducing retry intervals
   - If stuck messages are common, suggest reducing stuck threshold

3. **Error pattern fixes**:
   - Identify common error messages from DLQ
   - Suggest fixes for recurring failure modes

4. **Cleanup scheduling**:
   - Suggest retention policy adjustments based on queue size

## Key Files to Reference

| Purpose | Path |
|---------|------|
| Queue table schema | `src/db/schema.ts` (queue, deadLetterQueue tables) |
| Queue operations | `src/repositories/queue.repository.ts` |
| Retry worker | `src/workers/retry.worker.ts` |
| Priority escalation worker | `src/workers/priorityEscalation.worker.ts` |
| Priority escalation service | `src/services/priorityEscalation.service.ts` |
| Queue cleanup worker | `src/workers/queueCleanup.worker.ts` |
| DLQ cleanup worker | `src/workers/dlqCleanup.worker.ts` |
| Configuration | `src/config/index.ts` (retry, queue settings) |

## Priority Level Reference

From `src/types/queue.types.ts`:
- `LOW = 0` - Baseline priority
- `NORMAL = 1` - Standard messages
- `HIGH = 2` - Important messages
- `URGENT = 3` - Time-sensitive messages
- `VIP = 4` - Maximum priority

## Escalation Rules Reference

Default escalation rules (from `PriorityEscalationService`):
- 5 minutes: +1 priority boost (up to HIGH)
- 15 minutes: +2 priority boost (up to URGENT)
- 30 minutes: +3 priority boost (up to VIP)

## Output Format

When reporting queue health, structure the response as:

```markdown
# Queue Health Audit Report

## Summary
[Overall health status: Healthy / Warning / Critical]

## Queue Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| Pending | X | Y% |
| Processing | X | Y% |
| Completed | X | Y% |
| Failed | X | Y% |

## Priority Distribution
| Priority | Count | Notes |
|----------|-------|-------|
| VIP (4) | X | Highest priority |
| URGENT (3) | X | |
| HIGH (2) | X | |
| NORMAL (1) | X | |
| LOW (0) | X | Baseline |

## Aging Analysis

### Pending Items by Age
| Age Bucket | Count |
|------------|-------|
| < 5 min | X |
| 5-15 min | X |
| 15-30 min | X |
| 30-60 min | X |
| > 60 min | X |

### Stuck Processing Items
- Count: X
- Oldest Age: Y minutes
- [If any, list details]

## Worker Status
[Assessment of worker configuration and health]

## Dead Letter Queue
- Total Items: X
- Recent Failures (24h): Y
- Top Failure Reasons:
  1. [Reason] - N occurrences
  2. [Reason] - M occurrences

## Recommendations

### Priority Tuning
- [Specific recommendation]

### Worker Scaling
- [Specific recommendation]

### Error Pattern Fixes
- [Specific recommendation]

### Cleanup Scheduling
- [Specific recommendation]

## Priority Actions
1. [Most urgent action]
2. [Second priority]
3. [Third priority]
```

## Analysis Patterns

### Stuck Message Detection
```sql
-- Messages in processing status for too long
SELECT id, messageId, createdAt, processingStartedAt
FROM queue
WHERE status = 'processing'
AND datetime(createdAt) < datetime('now', '-5 minutes');
```

### Retry Backlog Analysis
```sql
-- Items awaiting retry with nextRetryAt in the future
SELECT id, messageId, attempts, nextRetryAt, lastError
FROM queue
WHERE status = 'pending'
AND attempts > 0
AND nextRetryAt > datetime('now')
ORDER BY nextRetryAt ASC;
```

### Priority Escalation Status
```sql
-- Items that have had priority boosted
SELECT id, messageId, priority, originalPriority, priorityBoostApplied
FROM queue
WHERE priorityBoostApplied = 1
AND status = 'pending';
```

## Thresholds for Health Assessment

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Pending items | < 10 | 10-50 | > 50 |
| Processing items | < 5 | 5-10 | > 10 |
| Items stuck > 15m | 0 | 1-5 | > 5 |
| Items stuck > 1h | 0 | 0 | > 0 |
| DLQ size (24h) | < 5 | 5-20 | > 20 |
| Avg retry attempts | < 1 | 1-2 | > 2 |
