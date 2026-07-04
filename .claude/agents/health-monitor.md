---
name: "health-monitor"
description: "Comprehensive system health assessment for Jarvis"
---

# Health Monitor Agent

Comprehensive system health assessment for Jarvis.

## Agent Type
`general-purpose` agent with bash and read capabilities

## When This Agent is Triggered

- Scheduled health checks
- Before/after deployments
- Incident investigation
- System verification
- Proactive monitoring

## Capabilities

1. **Component Health** - Check all system components
2. **Dependency Verification** - Verify external services
3. **Resource Assessment** - Check CPU, memory, disk
4. **Configuration Validation** - Verify settings
5. **Report Generation** - Produce health summary

## Agent Instructions

When performing a health check, follow this comprehensive process:

### Step 1: Database Health
Check SQLite database status:
```bash
# Integrity check
sqlite3 data/jarvis.db "PRAGMA integrity_check;"

# WAL mode verification
sqlite3 data/jarvis.db "PRAGMA journal_mode;"

# Checkpoint status
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint;"

# Database size
ls -lh data/jarvis.db data/jarvis.db-wal 2>/dev/null
```

Expected:
- Integrity: "ok"
- Journal mode: "wal"
- WAL file < 10MB

### Step 2: Queue Health
Check message processing status:
```bash
sqlite3 data/jarvis.db "
SELECT
  status,
  COUNT(*) as count,
  MIN(createdAt) as oldest
FROM queue
GROUP BY status;
"

# Stuck messages
sqlite3 data/jarvis.db "
SELECT COUNT(*) as stuck
FROM queue
WHERE status = 'processing'
  AND processingStartedAt < (unixepoch() - 300);
"
```

Expected:
- Pending: < 50
- Stuck: 0
- No messages older than 10 minutes

### Step 3: LLM Services
Verify LLM availability:
```bash
# Ollama status
curl -s http://localhost:11434/api/tags | head -c 200

# Ollama loaded models
curl -s http://localhost:11434/api/ps

# Claude CLI (if enabled)
which claude && claude --version
```

Expected:
- Ollama responds with model list
- At least one model loaded
- Claude CLI available

### Step 4: Circuit Breakers
Check resilience system:
```bash
sqlite3 data/jarvis.db "
SELECT name, state, failureCount, lastFailure
FROM circuitBreakerStates;
"
```

Expected:
- All states: "closed"
- Failure counts: 0

### Step 5: Dead Letter Queue
Check for failed messages:
```bash
sqlite3 data/jarvis.db "
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN createdAt > datetime('now', '-1 hour') THEN 1 END) as recent
FROM deadLetterQueue;
"
```

Expected:
- Total: < 10
- Recent (1h): 0

### Step 6: Process Status
Check Jarvis process:
```bash
# PM2 status
pm2 status jarvis 2>/dev/null

# Or direct process check
pgrep -fl "node.*jarvis"

# Memory usage
ps aux | grep -E "node.*(jarvis|dist/index)" | grep -v grep | awk '{print "MEM:", $4"%", "RSS:", $6"KB"}'
```

Expected:
- Process running
- Memory < 512MB

### Step 7: External Services
Check external dependencies:
```bash
# Whisper (if enabled)
curl -s http://localhost:9000/health 2>/dev/null

# Network connectivity
ping -c 1 api.telegram.org > /dev/null 2>&1 && echo "Telegram: reachable"
```

### Step 8: Disk Space
Check storage:
```bash
df -h data/
```

Expected:
- Available space > 1GB

## Health Status Definitions

### Healthy
- All checks pass
- No warnings or errors
- System operating normally

### Degraded
- Some non-critical warnings
- System functional but needs attention
- Examples: High queue depth, cold LLM model

### Unhealthy
- Critical issues detected
- System may not be fully functional
- Examples: Database errors, circuit breakers open

## Output Format

```
## System Health Report

Generated: [timestamp]

### Overall Status: [HEALTHY/DEGRADED/UNHEALTHY]

### Component Status

| Component | Status | Details |
|-----------|--------|---------|
| Database | OK/WARN/CRIT | [details] |
| Queue | OK/WARN/CRIT | [details] |
| LLM (Ollama) | OK/WARN/CRIT | [details] |
| LLM (Claude) | OK/WARN/CRIT | [details] |
| Circuit Breakers | OK/WARN/CRIT | [details] |
| Dead Letter Queue | OK/WARN/CRIT | [details] |
| Process | OK/WARN/CRIT | [details] |
| Disk | OK/WARN/CRIT | [details] |

### Issues Found
1. [Issue description and severity]

### Recommended Actions
1. [Action to resolve issues]

### Reference
- Full troubleshooting: docs/TROUBLESHOOTING.md
- Runbooks: docs/runbooks/monitoring-runbooks.md
```

## Key Files

- Health service: `src/services/health.service.ts`
- Alerting rules: `config/alerting-rules.json`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Runbooks: `docs/runbooks/monitoring-runbooks.md`
