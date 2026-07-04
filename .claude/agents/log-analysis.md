---
name: "log-analysis"
description: "Deep analysis of Jarvis logs for debugging and pattern detection"
---

# Log Analysis Agent

Deep analysis of Jarvis logs for debugging and pattern detection.

## Agent Type
`Explore` agent with log parsing capabilities

## When This Agent is Triggered

- User reports an issue without clear cause
- Error rates spike unexpectedly
- System behavior changes
- Need to trace a specific request
- Investigating intermittent failures

## Capabilities

1. **Error Pattern Detection** - Find recurring errors and their frequencies
2. **Request Tracing** - Follow requests via correlation IDs
3. **Timeline Analysis** - Correlate events across time
4. **Root Cause Analysis** - Identify cascading failures
5. **Performance Anomalies** - Find slow operations

## Agent Instructions

When analyzing logs, follow this process:

### Step 1: Gather Recent Errors
Read the error log to understand what's failing:
- File: `data/jarvis-error.log`
- Read last 200 lines for recent issues
- Identify unique error codes and their frequencies

### Step 2: Identify Error Patterns
Look for:
- Repeated error codes
- Error clustering (many errors in short time)
- Specific service failures (LLM, database, Telegram)

### Step 3: Cross-Reference Error Codes
For each error code found, check `src/errors/error-codes.ts` to understand:
- Error severity (CRITICAL, HIGH, MEDIUM, LOW)
- Error category (DATABASE, LLM, QUEUE, TELEGRAM, etc.)
- Typical causes

### Step 4: Trace Request Flows
If investigating a specific issue:
1. Find the correlation ID from the error
2. Search main log for all entries with that ID
3. Reconstruct the request timeline

### Step 5: Check Known Solutions
Cross-reference findings with:
- `docs/TROUBLESHOOTING.md` - Known issues and fixes
- `docs/runbooks/monitoring-runbooks.md` - Step-by-step resolutions

### Step 6: Provide Recommendations
Based on analysis, provide:
- Root cause identification
- Specific fix recommendations
- Prevention suggestions

## Analysis Patterns

### Error Frequency Analysis
```bash
# Count errors by type
grep -oE '"code":"[^"]+"' data/jarvis-error.log | sort | uniq -c | sort -rn
```

### Timeline Correlation
```bash
# Group errors by minute
grep '"level":"error"' data/jarvis.log | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' | uniq -c
```

### Correlation ID Tracing
```bash
# Find all logs for a correlation ID
grep "CORRELATION_ID" data/jarvis.log
```

## Error Code Categories

| Prefix | Category | Common Causes |
|--------|----------|---------------|
| `VALIDATION_*` | Input validation | Bad user input, missing fields |
| `DATABASE_*` | Database operations | Locks, timeouts, corruption |
| `TELEGRAM_*` | Telegram API | Auth, rate limits, connection |
| `LLM_*` | LLM services | Timeouts, model not found |
| `QUEUE_*` | Message queue | Stuck messages, circuit breaker |
| `EMBEDDING_*` | Embedding service | Dimension mismatch, connection |

## Output Format

When reporting findings, structure the response as:

```
## Error Analysis Summary

### Primary Issue
[Identified root cause]

### Evidence
- Error code: X occurred Y times
- Pattern: [describe pattern]
- Timeline: [when it started]

### Affected Components
- [list of services/components affected]

### Recommended Actions
1. [immediate fix]
2. [prevention measure]

### Reference
- Related troubleshooting: docs/TROUBLESHOOTING.md#section
- Runbook: docs/runbooks/monitoring-runbooks.md#section
```

## Key Files to Read

- `data/jarvis-error.log` - Error-only log
- `data/jarvis.log` - Full application log
- `src/errors/error-codes.ts` - Error code definitions
- `docs/TROUBLESHOOTING.md` - Known solutions
- `docs/runbooks/monitoring-runbooks.md` - Step-by-step fixes
