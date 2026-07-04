# Jarvis Troubleshooting Guide

Solutions for common issues and debugging strategies.

## Table of Contents

- [Startup Issues](#startup-issues)
- [Telegram Issues](#telegram-issues)
- [LLM Issues](#llm-issues)
- [Database Issues](#database-issues)
- [Memory System Issues](#memory-system-issues)
- [Queue Issues](#queue-issues)
- [Performance Issues](#performance-issues)
- [Monitoring Issues](#monitoring-issues)
- [Error Reference](#error-reference)

---

## Startup Issues

### Application Fails to Start

**Symptoms:**
- Process exits immediately
- Error: "Cannot find module"
- Error: "ENOENT: no such file or directory"

**Solutions:**

1. **Check Node.js version**
   ```bash
   node --version  # Should be v20.x or later
   ```

2. **Reinstall dependencies**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Rebuild native modules**
   ```bash
   npm rebuild
   ```

4. **Check build output**
   ```bash
   npm run build
   ls dist/  # Should contain compiled JS files
   ```

### Missing Environment Variables

**Symptoms:**
- Error: "CONFIGURATION_MISSING"
- Error: "Required configuration key is missing"

**Solutions:**

1. **Verify .env file exists**
   ```bash
   ls -la .env
   ```

2. **Check required variables**
   ```bash
   # Required variables:
   grep -E "^(API_ID|API_HASH|PHONE_NUMBER)=" .env
   ```

3. **Copy from example**
   ```bash
   cp .env.example .env
   # Edit with your values
   ```

### sqlite-vec Loading Fails

**Symptoms:**
- Error: "Cannot load sqlite-vec"
- Error: "Native module compilation failed"

**Solutions:**

1. **Check system architecture**
   ```bash
   node -e "console.log(process.arch)"
   ```

2. **Reinstall better-sqlite3**
   ```bash
   npm rebuild better-sqlite3
   ```

3. **Install build tools (if needed)**
   ```bash
   # macOS
   xcode-select --install

   # Ubuntu/Debian
   sudo apt-get install build-essential python3

   # Alpine
   apk add build-base python3
   ```

---

## Telegram Issues

### Authentication Failed

**Symptoms:**
- Error: "TELEGRAM_AUTH_ERROR"
- Error: "AUTH_KEY_UNREGISTERED"
- Prompted for code repeatedly

**Solutions:**

1. **Verify API credentials**
   - Go to https://my.telegram.org/apps
   - Check API_ID and API_HASH match exactly
   - No leading/trailing spaces

2. **Check phone number format**
   ```bash
   # Correct format with country code:
   PHONE_NUMBER=+14155551234
   ```

3. **Clear session and re-authenticate**
   ```bash
   # Remove old session
   unset SESSION_STRING
   # Or in .env: SESSION_STRING=

   # Restart to get new auth prompt
   npm run dev
   ```

4. **Check for 2FA**
   - If 2FA enabled, you'll need to enter password
   - Ensure you have access to your Telegram app for the code

### Connection Lost

**Symptoms:**
- Error: "TELEGRAM_CONNECTION_ERROR"
- Error: "ECONNREFUSED"
- Messages not being received

**Solutions:**

1. **Check internet connectivity**
   ```bash
   ping api.telegram.org
   ```

2. **Check for network restrictions**
   - Corporate firewalls may block Telegram
   - Try using a VPN or different network

3. **Check session validity**
   - Session may have expired
   - Clear SESSION_STRING and re-authenticate

4. **Enable recovery**
   ```typescript
   // Automatic recovery is enabled by default
   recoveryService.enableAutoRecovery('telegram');
   ```

### Flood Wait Error

**Symptoms:**
- Error: "TELEGRAM_FLOOD_WAIT"
- Error: "FloodWaitError: X seconds"

**Solutions:**

1. **Wait for the specified time**
   - The error includes the wait time
   - Don't retry until it expires

2. **Reduce request frequency**
   - Space out message sending
   - Batch operations where possible

3. **Check for loops**
   - Ensure no infinite retry loops
   - Check circuit breaker is working

### Session Expired

**Symptoms:**
- Error: "TELEGRAM_SESSION_EXPIRED"
- Error: "AUTH_KEY_INVALID"

**Solutions:**

1. **Re-authenticate**
   ```bash
   # Clear session
   SESSION_STRING=

   # Restart application
   npm run dev
   ```

2. **Check for multiple sessions**
   - Only one session per phone number is recommended
   - Terminate other sessions via Telegram app

---

## LLM Issues

### Ollama Connection Failed

**Symptoms:**
- Error: "LLM_CONNECTION_ERROR"
- Error: "ECONNREFUSED localhost:11434"

**Solutions:**

1. **Check Ollama is running**
   ```bash
   curl http://localhost:11434/api/tags
   # Should return list of models
   ```

2. **Start Ollama**
   ```bash
   ollama serve
   ```

3. **Check URL configuration**
   ```bash
   # In .env
   LLM_BASE_URL=http://localhost:11434
   ```

4. **Check for port conflicts**
   ```bash
   lsof -i :11434
   ```

### Model Not Found

**Symptoms:**
- Error: "LLM_MODEL_NOT_FOUND"
- Error: "model 'xxx' not found"

**Solutions:**

1. **List available models**
   ```bash
   ollama list
   ```

2. **Pull the required model**
   ```bash
   ollama pull mistral-small:24b-instruct-2501-q4_K_M
   ollama pull nomic-embed-text
   ```

3. **Check model name**
   ```bash
   # Exact match required including tag
   LLM_MODEL=mistral-small:24b-instruct-2501-q4_K_M
   ```

### Timeout Errors

**Symptoms:**
- Error: "LLM_TIMEOUT"
- Error: "Request timed out after 30000ms"

**Solutions:**

1. **Increase timeout**
   ```bash
   LLM_TIMEOUT_MS=60000
   ```

2. **Use a smaller/faster model**
   ```bash
   # Smaller models are faster
   ollama pull mistral:7b
   LLM_MODEL=mistral:7b
   ```

3. **Check system resources**
   ```bash
   # CPU/Memory usage
   htop

   # GPU usage (if using)
   nvidia-smi
   ```

4. **Reduce max tokens**
   ```bash
   LLM_MAX_TOKENS=512
   ```

### Out of Memory

**Symptoms:**
- Error: "LLM_CONTEXT_LENGTH_EXCEEDED"
- Ollama crashes or becomes unresponsive

**Solutions:**

1. **Use smaller model**
   ```bash
   # Quantized models use less memory
   ollama pull mistral:7b-q4_K_M
   ```

2. **Reduce context**
   ```bash
   RAG_MAX_CONTEXT_TOKENS=1000
   RESPONSE_CONTEXT_WINDOW_SIZE=5
   ```

3. **Add more RAM or use GPU**
   - 8GB RAM minimum for 7B models
   - 16GB+ for larger models

### Claude CLI Issues

**Symptoms:**
- Error: "Claude CLI not found"
- Error: "CLAUDE_TIMEOUT"

**Solutions:**

1. **Verify installation**
   ```bash
   which claude
   claude --version
   ```

2. **Check authentication**
   ```bash
   claude auth
   ```

3. **Check path**
   ```bash
   CLAUDE_CLI_PATH=/usr/local/bin/claude
   ```

4. **Increase timeout**
   ```bash
   CLAUDE_TIMEOUT_MS=120000
   ```

---

## Database Issues

### Database Locked

**Symptoms:**
- Error: "DATABASE_TIMEOUT"
- Error: "SQLITE_BUSY"
- Error: "database is locked"

**Solutions:**

1. **Check for other processes**
   ```bash
   fuser data/jarvis.db
   lsof data/jarvis.db
   ```

2. **Kill zombie processes**
   ```bash
   pkill -f "node.*jarvis"
   ```

3. **Verify WAL mode**
   ```bash
   sqlite3 data/jarvis.db "PRAGMA journal_mode;"
   # Should return: wal
   ```

4. **Enable WAL if disabled**
   ```bash
   sqlite3 data/jarvis.db "PRAGMA journal_mode=WAL;"
   ```

### Migration Failed

**Symptoms:**
- Error: "DATABASE_MIGRATION_ERROR"
- Error: "table already exists"
- Error: "no such column"

**Solutions:**

1. **Check migration status**
   ```bash
   npm run db:studio
   # Look at __drizzle_migrations table
   ```

2. **Run pending migrations**
   ```bash
   npm run db:migrate
   ```

3. **Reset database (development only)**
   ```bash
   rm data/jarvis.db
   npm run db:migrate
   ```

### Constraint Violation

**Symptoms:**
- Error: "DATABASE_CONSTRAINT_VIOLATION"
- Error: "UNIQUE constraint failed"
- Error: "FOREIGN KEY constraint failed"

**Solutions:**

1. **Check for duplicates**
   ```bash
   sqlite3 data/jarvis.db "SELECT * FROM table WHERE id = 'xxx';"
   ```

2. **Verify foreign key exists**
   ```bash
   sqlite3 data/jarvis.db "SELECT * FROM parent_table WHERE id = 'xxx';"
   ```

3. **Use upsert where appropriate**
   ```typescript
   // Many repositories support upsert
   await repository.upsert(data);
   ```

### Corrupted Database

**Symptoms:**
- Error: "INTERNAL_STATE_CORRUPTION"
- Error: "database disk image is malformed"

**Solutions:**

1. **Check integrity**
   ```bash
   sqlite3 data/jarvis.db "PRAGMA integrity_check;"
   ```

2. **Attempt recovery**
   ```bash
   sqlite3 data/jarvis.db ".dump" > backup.sql
   sqlite3 data/jarvis-new.db < backup.sql
   mv data/jarvis-new.db data/jarvis.db
   ```

3. **Restore from backup**
   ```bash
   cp backup/jarvis-YYYYMMDD.db data/jarvis.db
   ```

---

## Memory System Issues

### Embeddings Not Working

**Symptoms:**
- Error: "EMBEDDING_CONNECTION_ERROR"
- Memories not being stored
- Semantic search returns empty

**Solutions:**

1. **Check embedding model**
   ```bash
   ollama list | grep nomic-embed-text
   ollama pull nomic-embed-text
   ```

2. **Enable embeddings**
   ```bash
   EMBEDDING_ENABLED=true
   EMBEDDING_MODEL=nomic-embed-text
   ```

3. **Check sqlite-vec**
   ```bash
   # Should not error
   node -e "require('better-sqlite3')('test.db').loadExtension('sqlite_vec')"
   ```

### Memory Not Retrieved

**Symptoms:**
- Relevant memories not appearing in context
- Low similarity scores

**Solutions:**

1. **Lower similarity threshold**
   ```bash
   RAG_SIMILARITY_THRESHOLD=0.5
   ```

2. **Increase top K**
   ```bash
   RAG_TOP_K=20
   ```

3. **Check memory exists**
   ```bash
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM memories WHERE senderId = 'xxx';"
   ```

4. **Verify embeddings exist**
   ```bash
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM embeddings WHERE sourceType = 'memory';"
   ```

### Dimension Mismatch

**Symptoms:**
- Error: "EMBEDDING_DIMENSION_MISMATCH"
- Error: "Vector dimensions don't match"

**Solutions:**

1. **Check configured dimensions**
   ```bash
   EMBEDDING_DIMENSIONS=768  # For nomic-embed-text
   ```

2. **Clear and regenerate embeddings**
   ```bash
   sqlite3 data/jarvis.db "DELETE FROM embeddings;"
   # Restart to regenerate
   ```

---

## Queue Issues

### Messages Stuck in Queue

**Symptoms:**
- Queue depth growing
- Messages not being processed
- Status stays "processing"

**Solutions:**

1. **Check queue status**
   ```bash
   sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"
   ```

2. **Check for stuck items**
   ```bash
   sqlite3 data/jarvis.db "SELECT * FROM queue WHERE status = 'processing' AND updatedAt < datetime('now', '-5 minutes');"
   ```

3. **Reset stuck items**
   ```bash
   sqlite3 data/jarvis.db "UPDATE queue SET status = 'pending' WHERE status = 'processing' AND updatedAt < datetime('now', '-5 minutes');"
   ```

4. **Check circuit breaker**
   ```bash
   sqlite3 data/jarvis.db "SELECT * FROM circuitBreakerStates;"
   ```

### Circuit Breaker Open

**Symptoms:**
- Error: "QUEUE_CIRCUIT_OPEN"
- Error: "Circuit breaker is open"

**Solutions:**

1. **Check circuit state**
   ```typescript
   const state = circuitBreakerService.getState('service-name');
   const stats = circuitBreakerService.getStats('service-name');
   ```

2. **Wait for reset**
   - Default timeout: 30 seconds
   - Will auto-transition to HALF_OPEN

3. **Manual reset (if needed)**
   ```typescript
   circuitBreakerService.reset('service-name');
   ```

4. **Fix underlying issue**
   - Check logs for failure cause
   - Resolve before resetting

### Dead Letter Queue Growing

**Symptoms:**
- Many items in DLQ
- High failure rate

**Solutions:**

1. **Check DLQ statistics**
   ```typescript
   const stats = await deadLetterQueueService.getStats();
   console.log(stats);
   ```

2. **Inspect failed items**
   ```bash
   sqlite3 data/jarvis.db "SELECT reason, COUNT(*) FROM deadLetterQueue GROUP BY reason;"
   ```

3. **Review error history**
   ```typescript
   const item = await deadLetterQueueService.inspectItem(id);
   console.log(item.errorHistory);
   ```

4. **Fix and reprocess**
   ```typescript
   // After fixing issue
   await deadLetterQueueService.reprocessItem(id);
   // Or reprocess all
   await deadLetterQueueService.reprocessAll();
   ```

5. **Purge old items**
   ```typescript
   await deadLetterQueueService.purgeOlderThan(7 * 24 * 60 * 60 * 1000);
   ```

---

## Performance Issues

### High Response Latency

**Symptoms:**
- Slow responses
- Response time > 5 seconds

**Solutions:**

1. **Enable caching**
   ```bash
   CACHE_ENABLED=true
   ```

2. **Use smaller model**
   ```bash
   LLM_MODEL=mistral:7b
   ```

3. **Reduce context size**
   ```bash
   RAG_MAX_CONTEXT_TOKENS=1000
   RAG_TOP_K=5
   ```

4. **Check system resources**
   ```bash
   htop  # CPU/Memory
   iostat -x 1  # Disk I/O
   ```

### High Memory Usage

**Symptoms:**
- Node.js process using > 1GB RAM
- Out of memory errors

**Solutions:**

1. **Reduce cache size**
   ```bash
   CACHE_MAX_ENTRIES=5000
   ```

2. **Limit metrics retention**
   ```bash
   METRICS_RETENTION_DAYS=7
   ```

3. **Increase Node.js heap**
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096"
   ```

4. **Profile memory**
   ```bash
   node --inspect dist/index.js
   # Connect Chrome DevTools
   ```

### Database Growing Large

**Symptoms:**
- Database file > 1GB
- Slow queries

**Solutions:**

1. **Check table sizes**
   ```bash
   sqlite3 data/jarvis.db "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC;"
   ```

2. **Clean up old data**
   ```bash
   # Archive old memories
   sqlite3 data/jarvis.db "UPDATE memories SET isArchived = 1 WHERE createdAt < datetime('now', '-90 days');"

   # Purge old metrics
   sqlite3 data/jarvis.db "DELETE FROM metrics WHERE timestamp < datetime('now', '-30 days');"

   # Purge expired cache
   sqlite3 data/jarvis.db "DELETE FROM semanticCache WHERE expiresAt < datetime('now');"
   ```

3. **Vacuum database**
   ```bash
   sqlite3 data/jarvis.db "VACUUM;"
   ```

---

## Monitoring Issues

### Metrics Not Recording

**Symptoms:**
- Empty dashboard
- No metric data

**Solutions:**

1. **Check metrics enabled**
   ```bash
   METRICS_ENABLED=true
   ```

2. **Verify flush interval**
   ```bash
   METRICS_FLUSH_INTERVAL_MS=5000
   ```

3. **Check metrics table**
   ```bash
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM metrics;"
   ```

4. **Manual flush**
   ```typescript
   await metricsService.flush();
   ```

### Alerts Not Firing

**Symptoms:**
- No alerts despite issues
- Alert rules not working

**Solutions:**

1. **Check alerting enabled**
   ```bash
   ALERTING_ENABLED=true
   ```

2. **Verify alert rules**
   ```bash
   cat config/alerting-rules.json
   ```

3. **Check cooldown**
   - Alerts won't fire during cooldown
   - Default: 15 minutes

4. **Lower thresholds for testing**
   ```json
   {
     "warningThreshold": 100,
     "criticalThreshold": 500
   }
   ```

---

## Error Reference

### Error Codes by Category

#### VALIDATION Errors
| Code | Severity | Description |
|------|----------|-------------|
| VALIDATION_INVALID_INPUT | LOW | Invalid input data |
| VALIDATION_MISSING_FIELD | LOW | Required field missing |
| VALIDATION_INVALID_FORMAT | LOW | Format doesn't match |
| VALIDATION_OUT_OF_RANGE | LOW | Value out of range |

#### DATABASE Errors
| Code | Severity | Description |
|------|----------|-------------|
| DATABASE_CONNECTION_ERROR | CRITICAL | Cannot connect to database |
| DATABASE_QUERY_ERROR | HIGH | Query execution failed |
| DATABASE_CONSTRAINT_VIOLATION | HIGH | Constraint violated |
| DATABASE_TIMEOUT | HIGH | Query timed out |

#### TELEGRAM Errors
| Code | Severity | Description |
|------|----------|-------------|
| TELEGRAM_CONNECTION_ERROR | HIGH | Connection failed |
| TELEGRAM_AUTH_ERROR | HIGH | Authentication failed |
| TELEGRAM_RATE_LIMITED | MEDIUM | Rate limited |
| TELEGRAM_FLOOD_WAIT | MEDIUM | Flood wait required |

#### LLM Errors
| Code | Severity | Description |
|------|----------|-------------|
| LLM_CONNECTION_ERROR | HIGH | Cannot connect to LLM |
| LLM_TIMEOUT | HIGH | Request timed out |
| LLM_MODEL_NOT_FOUND | HIGH | Model not available |
| LLM_CONTEXT_LENGTH_EXCEEDED | MEDIUM | Context too long |

#### QUEUE Errors
| Code | Severity | Description |
|------|----------|-------------|
| QUEUE_RETRY_EXHAUSTED | HIGH | All retries failed |
| QUEUE_CIRCUIT_OPEN | HIGH | Circuit breaker open |
| QUEUE_PROCESSING_ERROR | HIGH | Processing failed |
| QUEUE_DEAD_LETTER | HIGH | Moved to DLQ |

### Debugging Tips

1. **Enable verbose logging**
   ```bash
   DEBUG=jarvis:* npm run dev
   ```

2. **Check health status**
   ```typescript
   const health = await healthService.getSystemHealth();
   console.log(JSON.stringify(health, null, 2));
   ```

3. **Inspect recovery state**
   ```typescript
   const stats = recoveryService.getRecoveryStats();
   console.log(stats);
   ```

4. **Check recent errors**
   ```bash
   # From logs
   grep -i error logs/jarvis.log | tail -50

   # From DLQ
   sqlite3 data/jarvis.db "SELECT * FROM deadLetterQueue ORDER BY createdAt DESC LIMIT 10;"
   ```

5. **Use correlation IDs**
   - Errors include correlation IDs
   - Use to trace across logs

---

## Getting Help

If you're still stuck:

1. **Search existing issues**: https://github.com/your-repo/issues
2. **Check logs**: Look for error messages and stack traces
3. **Gather information**:
   - Node.js version
   - OS and architecture
   - Configuration (sanitized)
   - Error messages
   - Steps to reproduce
4. **Open an issue** with the above information
