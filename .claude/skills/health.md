# /health - System Health Check

Check system health and diagnose issues with the Jarvis Telegram service.

## When to Use

- Regularly checking system status
- Before/after deployments
- When users report issues
- Investigating slow responses or errors

## What This Skill Does

Performs a comprehensive health check of all Jarvis components:

1. **Database Health** - SQLite connectivity, WAL mode, integrity
2. **Queue Status** - Pending/processing/failed message counts
3. **LLM Services** - Ollama availability and model warmth, Claude CLI
4. **External Services** - Telegram connection, Whisper server
5. **Circuit Breakers** - Current state of all circuit breakers
6. **Dead Letter Queue** - Failed messages requiring attention
7. **Resource Usage** - Process memory, disk space

## Execution Steps

### Step 1: Database Health
```bash
# Check database integrity and mode
sqlite3 data/jarvis.db "PRAGMA integrity_check;"
sqlite3 data/jarvis.db "PRAGMA journal_mode;"
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint;"
ls -lh data/jarvis.db data/jarvis.db-wal 2>/dev/null
```

### Step 2: Queue Status
```bash
# Check queue by status
sqlite3 data/jarvis.db "SELECT status, COUNT(*) as count FROM queue GROUP BY status;"

# Check for stuck messages (processing > 5 minutes)
sqlite3 data/jarvis.db "SELECT COUNT(*) as stuck FROM queue WHERE status = 'processing' AND processingStartedAt < (unixepoch() - 300);"

# Check oldest pending message (age in minutes)
sqlite3 data/jarvis.db "SELECT ROUND((unixepoch() - MIN(createdAt)) / 60.0, 1) as oldest_pending_minutes FROM queue WHERE status = 'pending';"
```

### Step 3: LLM Services
```bash
# Check Ollama
curl -s http://localhost:11434/api/tags | head -c 500
curl -s http://localhost:11434/api/ps | head -c 500

# Check Claude CLI
which claude && claude --version
```

### Step 4: Dead Letter Queue
```bash
# Check DLQ size and recent failures
sqlite3 data/jarvis.db "SELECT COUNT(*) as dlq_count FROM deadLetterQueue;"
sqlite3 data/jarvis.db "SELECT reason, COUNT(*) as count FROM deadLetterQueue GROUP BY reason ORDER BY count DESC LIMIT 5;"
```

### Step 5: Circuit Breakers
```bash
# Check circuit breaker states
sqlite3 data/jarvis.db "SELECT name, state, failureCount, lastFailure FROM circuitBreakerStates;"
```

### Step 6: Process Status
```bash
# Check if Jarvis is running
pm2 status jarvis 2>/dev/null || pgrep -fl "node.*jarvis"

# Check process memory
ps aux | grep -E "node.*(jarvis|dist/index)" | grep -v grep | awk '{print "PID:", $2, "MEM:", $4"%", "RSS:", $6"KB"}'
```

### Step 7: Recent Errors
```bash
# Check recent errors (if log exists)
tail -30 data/jarvis-error.log 2>/dev/null | head -20
```

### Step 8: Disk Space
```bash
df -h data/
```

## Health Status Interpretation

### Healthy System
- Database integrity: "ok"
- Journal mode: "wal"
- Pending queue: < 50 messages
- No stuck messages (processing > 5 min)
- Ollama responding with models
- DLQ count: < 10
- All circuit breakers: "closed"
- Memory usage: < 512MB

### Warning Signs
- Pending queue: 50-200 messages
- Stuck messages: 1-5
- DLQ count: 10-50
- Circuit breaker: "half_open"
- Memory: 512MB-1GB

### Critical Issues
- Database integrity: not "ok"
- Pending queue: > 200 messages
- Stuck messages: > 5
- Ollama not responding
- DLQ count: > 50
- Circuit breaker: "open"
- Memory: > 1GB

## Common Issues and Resolutions

### Database Locked
```bash
# Force WAL checkpoint
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### Ollama Cold Start
```bash
# Warm up the model (use model from OLLAMA_MODEL env var or check `ollama list`)
curl http://localhost:11434/api/generate -d '{"model":"llama3.1:8b","keep_alive":"1h","prompt":"warmup"}'
```

### Stuck Messages
```bash
# Reset stuck processing messages
sqlite3 data/jarvis.db "UPDATE queue SET status = 'pending', processingStartedAt = NULL WHERE status = 'processing' AND processingStartedAt < (unixepoch() - 600);"
```

### Circuit Breaker Open
```bash
# Check which service is failing
sqlite3 data/jarvis.db "SELECT * FROM circuitBreakerStates WHERE state != 'closed';"
# Wait 30 seconds for auto-reset, or fix underlying issue
```

## Reference

- Troubleshooting guide: `docs/TROUBLESHOOTING.md`
- Monitoring runbooks: `docs/runbooks/monitoring-runbooks.md`
- Health service: `src/services/health.service.ts`
