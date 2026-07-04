# /debug-logs - Log Analysis

Analyze Jarvis logs for errors, patterns, and anomalies.

## When to Use

- Investigating specific errors
- Understanding system behavior
- Debugging slow responses
- Tracing request flows
- Finding patterns in failures

## What This Skill Does

1. **Error Analysis** - Identify error types, frequencies, and patterns
2. **Performance Analysis** - Find slow operations and bottlenecks
3. **Request Tracing** - Follow requests via correlation IDs
4. **Pattern Detection** - Detect recurring issues and trends
5. **Circuit Breaker Events** - Track trips and recoveries

## Log Locations

| Log | Path | Content |
|-----|------|---------|
| Main log | `data/jarvis.log` | All application logs |
| Error log | `data/jarvis-error.log` | Errors only |
| PM2 logs | `~/.pm2/logs/jarvis-*.log` | PM2 managed logs |

## Execution Steps

### Step 1: Recent Errors Overview
```bash
# Count errors by type in last 100 lines
tail -100 data/jarvis-error.log 2>/dev/null | grep -oE '"code":"[^"]+"' | sort | uniq -c | sort -rn | head -10
```

### Step 2: Error Details
```bash
# Show recent error messages with context
tail -50 data/jarvis-error.log 2>/dev/null
```

### Step 3: Slow Operations
```bash
# Find operations > 3 seconds
grep -E 'duration.*[0-9]{4,}ms|responseTimeMs.*[0-9]{4,}' data/jarvis.log 2>/dev/null | tail -20
```

### Step 4: Circuit Breaker Events
```bash
# Find circuit breaker trips and recoveries
grep -i 'circuit' data/jarvis.log 2>/dev/null | tail -20
```

### Step 5: LLM Timeouts
```bash
# Find LLM timeout patterns
grep -iE 'timeout|LLM_TIMEOUT|CLAUDE_TIMEOUT' data/jarvis.log 2>/dev/null | tail -20
```

### Step 6: Dead Letter Queue Events
```bash
# Find DLQ additions
grep -i 'dead.?letter\|dlq' data/jarvis.log 2>/dev/null | tail -20
```

### Step 7: Authentication Issues
```bash
# Find auth-related errors
grep -iE 'auth|session|telegram.*error' data/jarvis.log 2>/dev/null | tail -20
```

## Tracing a Request

To trace a specific request using its correlation ID:

```bash
# Find correlation ID from error
grep -oE 'correlationId":"[^"]+"' data/jarvis-error.log | tail -5

# Trace full request flow
CORRELATION_ID="<paste_id_here>"
grep "$CORRELATION_ID" data/jarvis.log
```

## Error Code Reference

Common error codes from `src/errors/error-codes.ts`:

| Code | Severity | Description |
|------|----------|-------------|
| `VALIDATION_INVALID_INPUT` | LOW | Invalid input data |
| `DATABASE_CONNECTION_ERROR` | CRITICAL | Cannot connect to database |
| `DATABASE_QUERY_ERROR` | HIGH | Query execution failed |
| `DATABASE_TIMEOUT` | HIGH | Query timed out |
| `TELEGRAM_CONNECTION_ERROR` | HIGH | Telegram connection failed |
| `TELEGRAM_AUTH_ERROR` | HIGH | Authentication failed |
| `TELEGRAM_RATE_LIMITED` | MEDIUM | Rate limited by Telegram |
| `LLM_CONNECTION_ERROR` | HIGH | Cannot connect to LLM |
| `LLM_TIMEOUT` | HIGH | LLM request timed out |
| `LLM_MODEL_NOT_FOUND` | HIGH | Model not available |
| `QUEUE_RETRY_EXHAUSTED` | HIGH | All retries failed |
| `QUEUE_CIRCUIT_OPEN` | HIGH | Circuit breaker open |

## Analysis Patterns

### High Error Rate
```bash
# Error rate in last hour (requires timestamps)
grep -c "error" data/jarvis.log | head -1
```

### Error Clustering
```bash
# Find errors by minute
grep -E '"level":"error"' data/jarvis.log | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' | uniq -c | tail -20
```

### Response Time Distribution
```bash
# Extract response times
grep -oE 'responseTimeMs"?:?[0-9]+' data/jarvis.log | grep -oE '[0-9]+' | sort -n | awk '{a[NR]=$1}END{print "Min:",a[1],"Median:",a[int(NR/2)],"Max:",a[NR]}'
```

## Common Issues

### Too Many SQLITE_BUSY Errors
- Check for concurrent database access
- Verify WAL mode is enabled
- See runbook: High Error Rate

### LLM Timeout Spikes
- Check Ollama model warmth
- Verify network connectivity
- See runbook: High Response Time

### Telegram Flood Wait
- Reduce message sending frequency
- Check for retry loops
- Wait for flood timer to expire

## Reference

- Error codes: `src/errors/error-codes.ts`
- Error classes: `src/errors/error-classes.ts`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
