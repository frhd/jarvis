# /diagnose - Symptom-Based Diagnosis

Run diagnostic checks based on reported symptoms.

## When to Use

- User reports a problem but cause is unclear
- System behaving unexpectedly
- Need guided troubleshooting
- Following up on alerts

## Symptom Categories

1. **Slow Responses** - High latency, timeouts
2. **High Error Rate** - Processing failures
3. **Memory Issues** - High RAM usage, crashes
4. **Queue Backup** - Messages not processing
5. **Connection Issues** - Service unavailability

## Usage

When user reports a symptom, identify the category and run the corresponding diagnostics.

---

## Symptom: Slow Responses

**User reports:** "Responses are slow", "Taking forever", "Timeouts"

### Diagnostics
```bash
# 1. Check Ollama model warmth
curl -s http://localhost:11434/api/ps | head -c 200

# 2. Check recent response times
sqlite3 data/jarvis.db "
SELECT model, ROUND(AVG(responseTimeMs)) as avg_ms, COUNT(*) as count
FROM llmResponses
WHERE createdAt > datetime('now', '-15 minutes')
GROUP BY model;
"

# 3. Check cache hit rate
sqlite3 data/jarvis.db "
SELECT
  COUNT(CASE WHEN hitCount > 0 THEN 1 END) * 100.0 / COUNT(*) as hit_rate_pct
FROM semanticCache
WHERE createdAt > datetime('now', '-1 hour');
"

# 4. Check queue depth
sqlite3 data/jarvis.db "SELECT COUNT(*) FROM queue WHERE status = 'pending';"
```

### Likely Causes & Fixes
- **Cold Ollama model:** Warm with `curl http://localhost:11434/api/generate -d '{"model":"<MODEL>","keep_alive":"1h","prompt":"warmup"}'` (replace `<MODEL>` with your configured model, e.g., `llama3.1:8b`)
- **Low cache hit rate:** Normal for diverse queries, consider lowering similarity threshold
- **High queue depth:** See "Queue Backup" diagnostics

---

## Symptom: High Error Rate

**User reports:** "Messages failing", "Not getting responses", "Errors in logs"

### Diagnostics
```bash
# 1. Check error distribution
sqlite3 data/jarvis.db "
SELECT status, COUNT(*) as count
FROM queue
WHERE createdAt > datetime('now', '-1 hour')
GROUP BY status;
"

# 2. Check recent error types
tail -50 data/jarvis-error.log 2>/dev/null | grep -oE '"code":"[^"]+"' | sort | uniq -c | sort -rn

# 3. Check circuit breakers
sqlite3 data/jarvis.db "SELECT name, state, failureCount FROM circuitBreakerStates WHERE state != 'closed';"

# 4. Check DLQ
sqlite3 data/jarvis.db "
SELECT reason, COUNT(*) as count
FROM deadLetterQueue
WHERE createdAt > datetime('now', '-1 hour')
GROUP BY reason
ORDER BY count DESC LIMIT 5;
"
```

### Likely Causes & Fixes
- **Circuit breaker open:** Wait 30s for auto-reset, or fix underlying service
- **LLM connection errors:** Check Ollama with `curl http://localhost:11434/api/tags`
- **Database errors:** Run `sqlite3 data/jarvis.db "PRAGMA integrity_check;"`

---

## Symptom: Memory Issues

**User reports:** "High memory", "Out of memory", "Process crashing"

### Diagnostics
```bash
# 1. Check process memory
ps aux | grep -E "node.*(jarvis|dist/index)" | grep -v grep | awk '{print "MEM:", $4"%", "RSS:", $6"KB"}'

# 2. Check database size
ls -lh data/jarvis.db

# 3. Check metric accumulation
sqlite3 data/jarvis.db "SELECT COUNT(*) as pending_metrics FROM metrics WHERE timestamp > datetime('now', '-1 hour');"

# 4. Check cache size
sqlite3 data/jarvis.db "SELECT COUNT(*) as cache_entries FROM semanticCache;"
```

### Likely Causes & Fixes
- **Large database:** Run `sqlite3 data/jarvis.db "VACUUM;"`
- **Metric accumulation:** Reduce `METRICS_FLUSH_INTERVAL_MS`
- **Large cache:** Prune old entries with `DELETE FROM semanticCache WHERE createdAt < datetime('now', '-30 days');`

---

## Symptom: Queue Backup

**User reports:** "Messages not processing", "Long delays", "Queue growing"

### Diagnostics
```bash
# 1. Check queue status
sqlite3 data/jarvis.db "
SELECT status, COUNT(*) as count,
  MIN(createdAt) as oldest
FROM queue
GROUP BY status;
"

# 2. Check stuck messages
sqlite3 data/jarvis.db "
SELECT COUNT(*) as stuck
FROM queue
WHERE status = 'processing'
  AND processingStartedAt < (unixepoch() - 300);
"

# 3. Check processing rate
sqlite3 data/jarvis.db "
SELECT COUNT(*) as processed_last_5min
FROM queue
WHERE status = 'completed'
  AND processedAt > (unixepoch() - 300);
"

# 4. Check LLM availability
curl -s http://localhost:11434/api/tags > /dev/null && echo "Ollama OK" || echo "Ollama DOWN"
```

### Likely Causes & Fixes
- **Stuck messages:** Reset with `UPDATE queue SET status = 'pending', processingStartedAt = NULL WHERE status = 'processing' AND processingStartedAt < (unixepoch() - 600);`
- **LLM down:** Restart Ollama with `pkill ollama && ollama serve &`
- **High ingest rate:** Consider enabling `INGESTION_ENABLED=false` temporarily

---

## Symptom: Connection Issues

**User reports:** "Telegram not working", "Can't connect", "Service unavailable"

### Diagnostics
```bash
# 1. Check Telegram session
grep "SESSION_STRING" .env | head -c 50 && echo "..."

# 2. Check recent Telegram errors
grep -i "telegram" data/jarvis-error.log 2>/dev/null | tail -10

# 3. Check Ollama
curl -s http://localhost:11434/api/tags > /dev/null && echo "Ollama: OK" || echo "Ollama: DOWN"

# 4. Check Whisper (if enabled)
curl -s http://localhost:9000/health > /dev/null 2>&1 && echo "Whisper: OK" || echo "Whisper: DOWN or disabled"

# 5. Check process status
pgrep -fl "node.*jarvis" || echo "Jarvis not running"
```

### Likely Causes & Fixes
- **Telegram session expired:** Clear `SESSION_STRING` in `.env` and restart to re-authenticate
- **Ollama down:** Start with `ollama serve`
- **Process not running:** Start with `npm run dev` or `pm2 start jarvis`

---

## Quick Triage Script

Run all basic diagnostics at once:

```bash
echo "=== Quick Triage ==="
echo ""
echo "1. Process Status:"
pgrep -fl "node.*jarvis" || echo "NOT RUNNING"
echo ""
echo "2. Queue Status:"
sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"
echo ""
echo "3. Recent Errors:"
tail -5 data/jarvis-error.log 2>/dev/null || echo "No error log"
echo ""
echo "4. LLM Status:"
curl -s http://localhost:11434/api/ps 2>/dev/null | head -c 100 || echo "Ollama not responding"
echo ""
echo "5. Circuit Breakers:"
sqlite3 data/jarvis.db "SELECT name, state FROM circuitBreakerStates WHERE state != 'closed';" || echo "All closed"
echo ""
echo "=== End Triage ==="
```

## Reference

- Runbooks: `docs/runbooks/monitoring-runbooks.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Health service: `src/services/health.service.ts`
