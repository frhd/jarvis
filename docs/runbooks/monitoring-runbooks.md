# Monitoring Runbooks

This document provides step-by-step procedures for diagnosing and resolving common monitoring issues in the Jarvis system.

## Table of Contents

1. [High Response Time](#1-high-response-time)
2. [High Error Rate](#2-high-error-rate)
3. [Low Cache Hit Rate](#3-low-cache-hit-rate)
4. [High Queue Depth](#4-high-queue-depth)
5. [Database Performance Issues](#5-database-performance-issues)
6. [Memory/Resource Issues](#6-memoryresource-issues)

---

## 1. High Response Time

### Alert Trigger Conditions

- **Warning**: LLM response time P95 > 5 seconds
- **Critical**: LLM response time P95 > 10 seconds OR P99 > 15 seconds
- **Metric**: `llm_response_duration_seconds` histogram

### Symptoms

- Users experiencing delayed responses in Telegram
- Increased queue processing time
- Timeout errors in logs
- Dashboard shows elevated response time graphs

### Step-by-Step Diagnosis

#### Step 1: Identify the LLM Tier Affected

```bash
# Check recent LLM responses by model
sqlite3 data/jarvis.db "
SELECT
  model,
  COUNT(*) as count,
  AVG(responseTimeMs) as avg_time,
  MAX(responseTimeMs) as max_time
FROM llmResponses
WHERE createdAt > datetime('now', '-15 minutes')
GROUP BY model;
"
```

**Expected Output:**
- Ollama responses: < 2000ms average
- Claude responses: < 10000ms average

**If Ollama is slow:** Proceed to Step 2
**If Claude is slow:** Proceed to Step 3

#### Step 2: Check Ollama Service Status

```bash
# Test Ollama availability
curl -s http://localhost:11434/api/tags | jq '.'

# Check if model is loaded
curl -s http://localhost:11434/api/show -d '{
  "name": "llama3.2:3b"
}' | jq '.modelinfo'

# Test simple generation
time curl -s http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Hello",
  "stream": false
}' | jq '.eval_duration'
```

**Expected Output:**
- Ollama API responds within 200ms
- Model info returns successfully
- Simple generation completes < 500ms

**If Ollama is unresponsive:** Proceed to Resolution Step A
**If Ollama is slow but responsive:** Proceed to Resolution Step B

#### Step 3: Check Claude CLI Status

```bash
# Test Claude CLI availability
claude --version

# Test simple prompt (should complete in < 5s)
time claude --print "Say hello" 2>&1

# Check Claude CLI configuration
echo "Claude CLI path: $(which claude)"
echo "Claude model: ${CLAUDE_MODEL:-sonnet}"
```

**Expected Output:**
- Claude CLI version displays
- Simple prompt completes < 5 seconds
- Model is set to 'sonnet' or 'opus'

**If Claude is unresponsive:** Proceed to Resolution Step C
**If Claude is slow but responsive:** Proceed to Resolution Step D

#### Step 4: Check Network Latency

```bash
# Check Ollama network latency
time curl -s http://localhost:11434/api/tags > /dev/null

# Check internet connectivity (for Claude)
ping -c 3 claude.ai

# Check DNS resolution
time nslookup api.anthropic.com
```

**Expected Output:**
- Ollama responds < 50ms
- Ping to claude.ai succeeds with < 100ms latency
- DNS resolution < 200ms

### Resolution Steps

#### Resolution A: Restart Ollama Service

```bash
# Stop Ollama
pkill ollama

# Restart Ollama (macOS)
ollama serve > /tmp/ollama.log 2>&1 &

# Wait for service to be ready
sleep 5

# Verify model is available
ollama list | grep llama3.2

# Pull model if missing
ollama pull llama3.2:3b

# Test generation
curl -s http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "test",
  "stream": false
}'
```

**Verification:**
- Ollama service responds within 200ms
- Model generation completes < 1 second
- Check metrics dashboard for improved response times

#### Resolution B: Optimize Ollama Performance

```bash
# Check system resources
top -l 1 | grep "CPU usage"
vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages free:\s+(\d+)/ and printf("Free Memory: %.2f GB\n", $1 * $size / 1073741824);'

# Reduce concurrent Ollama requests if system is overloaded
# Edit .env file
echo "LLM_MAX_CONCURRENT_REQUESTS=2" >> .env

# Restart Jarvis service
npm run dev
```

**Alternative: Switch to smaller model**

```bash
# Pull lighter model
ollama pull llama3.2:1b

# Update .env
sed -i '' 's/LLM_MODEL=.*/LLM_MODEL=llama3.2:1b/' .env

# Restart service
npm run dev
```

#### Resolution C: Reinstall/Update Claude CLI

```bash
# Check Claude CLI installation
which claude

# Update Claude CLI (using npm)
npm install -g @anthropic-ai/claude-cli

# Or reinstall
npm uninstall -g @anthropic-ai/claude-cli
npm install -g @anthropic-ai/claude-cli

# Verify authentication
claude --version
claude auth status

# Re-authenticate if needed
claude auth login
```

#### Resolution D: Adjust Claude Timeout Settings

```bash
# Increase Claude timeout in .env
sed -i '' 's/CLAUDE_TIMEOUT_MS=.*/CLAUDE_TIMEOUT_MS=120000/' .env

# Restart service
npm run dev

# Monitor improvement
tail -f logs/jarvis.log | grep "Claude response time"
```

### Escalation Criteria

Escalate to senior engineering if:

- Response times remain > 15 seconds after all resolution steps
- Multiple LLM services failing simultaneously
- System resource exhaustion (CPU > 90%, Memory > 90%)
- External API outages confirmed (check status.anthropic.com)
- Pattern indicates DDoS or unusual traffic spike

---

## 2. High Error Rate

### Alert Trigger Conditions

- **Warning**: Error rate > 5% over 5 minutes
- **Critical**: Error rate > 10% over 5 minutes OR > 20% over 1 minute
- **Metric**: `message_processing_errors_total` counter

### Symptoms

- Processing status shows high failure rate
- Users not receiving responses
- Error logs flooding
- Queue backing up with failed messages

### Step-by-Step Diagnosis

#### Step 1: Identify Error Types

```bash
# Check recent errors from logs
tail -n 500 logs/jarvis.log | grep -i "error" | head -20

# Query failed queue items
sqlite3 data/jarvis.db "
SELECT
  status,
  COUNT(*) as count,
  GROUP_CONCAT(DISTINCT error, '; ') as error_samples
FROM queue
WHERE status IN ('failed', 'processing')
  AND updatedAt > datetime('now', '-1 hour')
GROUP BY status;
"

# Check error distribution
sqlite3 data/jarvis.db "
SELECT
  SUBSTR(error, 1, 50) as error_prefix,
  COUNT(*) as count
FROM queue
WHERE error IS NOT NULL
  AND createdAt > datetime('now', '-1 hour')
GROUP BY error_prefix
ORDER BY count DESC
LIMIT 10;
"
```

**Common Error Patterns:**
- `SQLITE_BUSY`: Database lock contention → Proceed to Step 2
- `Ollama connection refused`: LLM service down → Proceed to Step 3
- `Claude CLI timeout`: Claude processing timeout → Proceed to Step 4
- `Media download failed`: Telegram media errors → Proceed to Step 5
- `Null reference error`: Code bug → Proceed to Step 6

#### Step 2: Check Database Status

```bash
# Check database locks
lsof data/jarvis.db

# Check WAL file size
ls -lh data/jarvis.db-wal

# Check database integrity
sqlite3 data/jarvis.db "PRAGMA integrity_check;"

# Check active connections
sqlite3 data/jarvis.db "PRAGMA database_list;"
```

**Expected Output:**
- 1-2 processes accessing database
- WAL file < 10MB
- Integrity check returns "ok"

**If database issues found:** Proceed to Resolution Step A

#### Step 3: Check LLM Service Connectivity

```bash
# Test Ollama
curl -s http://localhost:11434/api/tags || echo "Ollama unreachable"

# Test Claude CLI
claude --version || echo "Claude CLI not available"

# Check environment variables
grep -E "(LLM_BASE_URL|CLAUDE_CLI_PATH)" .env
```

**If LLM services down:** Proceed to Resolution Step B

#### Step 4: Check Queue State

```bash
# Check stuck messages in 'processing' state
sqlite3 data/jarvis.db "
SELECT
  id,
  messageId,
  status,
  retryCount,
  ROUND((julianday('now') - julianday(updatedAt)) * 24 * 60) as stuck_minutes
FROM queue
WHERE status = 'processing'
  AND updatedAt < datetime('now', '-5 minutes')
ORDER BY stuck_minutes DESC
LIMIT 20;
"

# Check retry distribution
sqlite3 data/jarvis.db "
SELECT retryCount, COUNT(*)
FROM queue
WHERE status IN ('failed', 'pending')
GROUP BY retryCount;
"
```

**If stuck messages found:** Proceed to Resolution Step C

#### Step 5: Check Telegram Connectivity

```bash
# Check Telegram session
grep "SESSION_STRING" .env | head -c 50

# Check recent Telegram events in logs
tail -n 200 logs/jarvis.log | grep -i "telegram" | tail -10

# Test message sending (if applicable)
npm run validate
```

**If Telegram issues found:** Proceed to Resolution Step D

#### Step 6: Review Application Logs

```bash
# Check for stack traces
tail -n 1000 logs/jarvis.log | grep -A 10 "Error:"

# Check for unhandled rejections
tail -n 500 logs/jarvis.log | grep -i "unhandled"

# Check service startup
tail -n 100 logs/jarvis.log | grep -i "started\|initialized"
```

### Resolution Steps

#### Resolution A: Fix Database Issues

```bash
# Stop the application
pkill -f "node.*jarvis"

# Checkpoint WAL file
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Vacuum database
sqlite3 data/jarvis.db "VACUUM;"

# Re-enable WAL mode
sqlite3 data/jarvis.db "PRAGMA journal_mode=WAL;"

# Restart application
npm run dev

# Monitor for improvements
tail -f logs/jarvis.log | grep -i "database\|sqlite"
```

#### Resolution B: Restart LLM Services

```bash
# Restart Ollama
pkill ollama
ollama serve > /tmp/ollama.log 2>&1 &
sleep 3
ollama list

# Verify Claude CLI
claude --version

# Restart Jarvis with LLM enabled
export LLM_ENABLED=true
export CLAUDE_ENABLED=true
npm run dev
```

#### Resolution C: Clear Stuck Messages

```bash
# Reset stuck 'processing' messages to 'pending'
sqlite3 data/jarvis.db "
UPDATE queue
SET status = 'pending',
    updatedAt = datetime('now')
WHERE status = 'processing'
  AND updatedAt < datetime('now', '-10 minutes');
"

# Check affected count
sqlite3 data/jarvis.db "
SELECT changes();
"

# Move repeatedly failed messages to DLQ
sqlite3 data/jarvis.db "
UPDATE queue
SET status = 'failed',
    error = 'Moved to DLQ after ' || retryCount || ' retries'
WHERE retryCount >= 3
  AND status = 'pending';
"

# Restart retry worker
pkill -f "retry-worker"
npm run dev
```

#### Resolution D: Reconnect Telegram

```bash
# Stop application
pkill -f "node.*jarvis"

# Clear session cache (will require re-auth)
# Backup first
cp .env .env.backup

# Remove session string
sed -i '' 's/SESSION_STRING=.*/SESSION_STRING=/' .env

# Restart and re-authenticate
npm run dev

# Follow authentication prompts
# After successful auth, session will be saved
```

#### Resolution E: Emergency Circuit Breaker

```bash
# Temporarily disable LLM processing to stabilize
sed -i '' 's/LLM_ENABLED=true/LLM_ENABLED=false/' .env
sed -i '' 's/CLAUDE_ENABLED=true/CLAUDE_ENABLED=false/' .env

# Restart service
npm run dev

# Messages will be queued but not processed
# This allows time to investigate without message loss

# Re-enable after issue is resolved
sed -i '' 's/LLM_ENABLED=false/LLM_ENABLED=true/' .env
sed -i '' 's/CLAUDE_ENABLED=false/CLAUDE_ENABLED=true/' .env
npm run dev
```

### Escalation Criteria

Escalate if:

- Error rate > 25% after all resolution steps
- Database corruption detected
- Critical data loss suspected
- Multiple services failing simultaneously
- Issue persists > 30 minutes

---

## 3. Low Cache Hit Rate

### Alert Trigger Conditions

- **Warning**: Cache hit rate < 30% over 15 minutes
- **Critical**: Cache hit rate < 20% over 15 minutes
- **Metric**: Ratio of cache hits to total lookups

### Symptoms

- Increased LLM API calls
- Higher response times
- Elevated processing costs
- Cache metrics show poor performance

### Step-by-Step Diagnosis

#### Step 1: Check Cache Statistics

```bash
# Query cache performance
sqlite3 data/jarvis.db "
SELECT
  COUNT(*) as total_entries,
  COUNT(CASE WHEN hitCount > 0 THEN 1 END) as entries_with_hits,
  SUM(hitCount) as total_hits,
  AVG(hitCount) as avg_hits_per_entry,
  MAX(hitCount) as max_hits,
  COUNT(CASE WHEN createdAt > datetime('now', '-1 hour') THEN 1 END) as recent_entries
FROM semanticCache;
"

# Check cache age distribution
sqlite3 data/jarvis.db "
SELECT
  CASE
    WHEN createdAt > datetime('now', '-1 hour') THEN '< 1 hour'
    WHEN createdAt > datetime('now', '-1 day') THEN '< 1 day'
    WHEN createdAt > datetime('now', '-7 days') THEN '< 1 week'
    ELSE '> 1 week'
  END as age_bucket,
  COUNT(*) as count,
  SUM(hitCount) as total_hits
FROM semanticCache
GROUP BY age_bucket;
"

# Check similarity threshold distribution
sqlite3 data/jarvis.db "
SELECT
  embedding,
  inputText,
  hitCount,
  createdAt
FROM semanticCache
ORDER BY hitCount DESC
LIMIT 10;
"
```

**Expected Output:**
- Total entries > 100
- Average hits per entry > 2
- Recent entries (< 1 hour) > 10

**If cache is empty or sparse:** Proceed to Step 2
**If cache has entries but low hits:** Proceed to Step 3

#### Step 2: Check Cache Configuration

```bash
# Check cache settings in code
grep -r "SIMILARITY_THRESHOLD" src/

# Check if semantic cache is enabled
sqlite3 data/jarvis.db "
SELECT COUNT(*) FROM sqlite_master
WHERE type='table' AND name='semanticCache';
"

# Check embedding generation
tail -n 500 logs/jarvis.log | grep -i "embedding\|cache"
```

**Expected Output:**
- Similarity threshold typically 0.85-0.95
- semanticCache table exists
- Embedding generation logs present

#### Step 3: Analyze Cache Miss Patterns

```bash
# Check recent queries that missed cache
tail -n 1000 logs/jarvis.log | grep "Cache miss" | head -20

# Check message diversity
sqlite3 data/jarvis.db "
SELECT
  COUNT(DISTINCT senderId) as unique_senders,
  COUNT(DISTINCT chatId) as unique_chats,
  COUNT(*) as total_messages
FROM messages
WHERE createdAt > datetime('now', '-1 day');
"

# Sample recent message content (check for uniqueness)
sqlite3 data/jarvis.db "
SELECT
  id,
  SUBSTR(text, 1, 50) as message_preview
FROM messages
WHERE text IS NOT NULL
  AND createdAt > datetime('now', '-1 hour')
ORDER BY createdAt DESC
LIMIT 20;
"
```

**Analysis:**
- High message diversity → Low hit rate is expected
- Repetitive messages → Cache should be working, investigate threshold
- Many unique senders → Consider per-user cache warming

### Resolution Steps

#### Resolution A: Warm the Cache

```bash
# Identify common message patterns
sqlite3 data/jarvis.db "
SELECT
  LOWER(TRIM(text)) as normalized_text,
  COUNT(*) as frequency
FROM messages
WHERE text IS NOT NULL
  AND LENGTH(text) < 100
  AND createdAt > datetime('now', '-7 days')
GROUP BY normalized_text
HAVING frequency > 5
ORDER BY frequency DESC
LIMIT 20;
" > /tmp/common_messages.txt

# Manually process common messages to populate cache
# (This requires running the app with these test messages)
cat /tmp/common_messages.txt
```

**Note:** Cache warming requires processing representative messages through the system. Consider implementing an automated cache warming script for production.

#### Resolution B: Adjust Similarity Threshold

```bash
# Find current threshold in configuration
grep -r "similarityThreshold\|SIMILARITY_THRESHOLD" src/services/

# Lower threshold to increase hit rate (edit the service file)
# Example: Change from 0.95 to 0.90 or 0.85

# Test the change
npm run dev

# Monitor hit rate improvement
sqlite3 data/jarvis.db "
SELECT
  SUM(hitCount) as total_hits,
  COUNT(*) as total_entries
FROM semanticCache
WHERE createdAt > datetime('now', '-30 minutes');
"
```

**Threshold Guidelines:**
- 0.95+: Very strict, exact matches only
- 0.90-0.95: Recommended range
- 0.85-0.90: More permissive, may match different intents
- < 0.85: Too permissive, may return incorrect cached responses

#### Resolution C: Clear Stale Cache Entries

```bash
# Remove old unused cache entries
sqlite3 data/jarvis.db "
DELETE FROM semanticCache
WHERE hitCount = 0
  AND createdAt < datetime('now', '-7 days');
"

# Check deleted count
sqlite3 data/jarvis.db "SELECT changes();"

# Remove very old entries regardless of hits
sqlite3 data/jarvis.db "
DELETE FROM semanticCache
WHERE createdAt < datetime('now', '-30 days');
"

# Vacuum to reclaim space
sqlite3 data/jarvis.db "VACUUM;"

# Restart service to rebuild index
npm run dev
```

#### Resolution D: Verify Embedding Generation

```bash
# Test embedding generation manually
curl -s http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "Hello, how are you?"
}' | jq '.embedding | length'

# Expected: Should return 768 (or model-specific dimension)

# Check if embedding model is available
ollama list | grep "nomic-embed"

# Pull embedding model if missing
ollama pull nomic-embed-text

# Restart Jarvis
npm run dev
```

#### Resolution E: Implement Cache Preloading

```bash
# Create a cache preload script
cat > scripts/preload-cache.ts << 'EOF'
import { LLMService } from '../src/services/llm.service.js';
import { SemanticCacheRepository } from '../src/repositories/semanticCache.repository.js';
import { db } from '../src/db/index.js';

const commonPrompts = [
  "Hello",
  "Hi",
  "Good morning",
  "How are you?",
  "Thanks",
  "Thank you",
  "Bye",
  "Goodbye",
  "Yes",
  "No"
];

async function preloadCache() {
  const cacheRepo = new SemanticCacheRepository(db);
  const llmService = new LLMService(cacheRepo);

  for (const prompt of commonPrompts) {
    console.log(`Processing: ${prompt}`);
    await llmService.generateResponse(prompt, 'cache_warming');
  }

  console.log('Cache preloading complete');
}

preloadCache().catch(console.error);
EOF

# Run preload script
npx tsx scripts/preload-cache.ts
```

### Escalation Criteria

Escalate if:

- Cache hit rate < 10% after adjustments
- Embedding generation consistently failing
- Cache causing incorrect responses
- Database performance degraded due to cache queries
- Need to redesign caching strategy

---

## 4. High Queue Depth

### Alert Trigger Conditions

- **Warning**: Queue depth > 100 messages
- **Critical**: Queue depth > 500 messages OR growth rate > 50 messages/minute
- **Metric**: Count of messages with status 'pending' or 'processing'

### Symptoms

- Message processing delays
- Users experiencing slow response times
- Queue table growing rapidly
- Processing worker falling behind

### Step-by-Step Diagnosis

#### Step 1: Check Queue Status

```bash
# Check queue depth by status
sqlite3 data/jarvis.db "
SELECT
  status,
  COUNT(*) as count,
  MIN(createdAt) as oldest,
  MAX(createdAt) as newest,
  ROUND(AVG(retryCount), 2) as avg_retries
FROM queue
GROUP BY status
ORDER BY count DESC;
"

# Check queue growth rate (messages added in last 5 min)
sqlite3 data/jarvis.db "
SELECT
  COUNT(*) as messages_last_5min,
  COUNT(*) / 5.0 as rate_per_minute
FROM queue
WHERE createdAt > datetime('now', '-5 minutes');
"

# Check processing lag (oldest pending message)
sqlite3 data/jarvis.db "
SELECT
  id,
  messageId,
  priority,
  createdAt,
  ROUND((julianday('now') - julianday(createdAt)) * 24 * 60) as age_minutes
FROM queue
WHERE status = 'pending'
ORDER BY createdAt ASC
LIMIT 10;
"
```

**Expected Output:**
- Pending: < 50 messages
- Processing: < 10 messages
- Oldest pending: < 5 minutes old
- Rate: < 10 messages/minute

**If queue is backing up:** Proceed to Step 2

#### Step 2: Check Processing Rate

```bash
# Calculate processing rate (completed in last 5 minutes)
sqlite3 data/jarvis.db "
SELECT
  COUNT(*) as completed_last_5min,
  COUNT(*) / 5.0 as processing_rate_per_minute
FROM queue
WHERE status = 'completed'
  AND updatedAt > datetime('now', '-5 minutes');
"

# Compare ingestion vs processing rate
sqlite3 data/jarvis.db "
SELECT
  'Ingestion' as metric,
  COUNT(*) as last_5min,
  COUNT(*) / 5.0 as per_minute
FROM queue
WHERE createdAt > datetime('now', '-5 minutes')
UNION ALL
SELECT
  'Processing' as metric,
  COUNT(*) as last_5min,
  COUNT(*) / 5.0 as per_minute
FROM queue
WHERE status = 'completed'
  AND updatedAt > datetime('now', '-5 minutes');
"
```

**Analysis:**
- Processing rate should >= ingestion rate
- If processing rate < ingestion rate → Bottleneck exists

#### Step 3: Identify Bottlenecks

```bash
# Check average processing time by priority
sqlite3 data/jarvis.db "
SELECT
  priority,
  COUNT(*) as count,
  AVG(ROUND((julianday(updatedAt) - julianday(createdAt)) * 24 * 60 * 60)) as avg_processing_seconds
FROM queue
WHERE status = 'completed'
  AND updatedAt > datetime('now', '-30 minutes')
GROUP BY priority;
"

# Check for stuck processing messages
sqlite3 data/jarvis.db "
SELECT
  id,
  messageId,
  priority,
  createdAt,
  updatedAt,
  ROUND((julianday('now') - julianday(updatedAt)) * 24 * 60) as stuck_minutes
FROM queue
WHERE status = 'processing'
  AND updatedAt < datetime('now', '-5 minutes')
ORDER BY stuck_minutes DESC;
"

# Check LLM response times
sqlite3 data/jarvis.db "
SELECT
  model,
  COUNT(*) as count,
  AVG(responseTimeMs) as avg_ms,
  MAX(responseTimeMs) as max_ms
FROM llmResponses
WHERE createdAt > datetime('now', '-30 minutes')
GROUP BY model;
"
```

**Common Bottlenecks:**
- Slow LLM responses → See Runbook #1
- Stuck messages → Proceed to Resolution Step A
- High retry rate → Proceed to Resolution Step B
- Database locks → See Runbook #5

#### Step 4: Check System Resources

```bash
# Check CPU usage
top -l 1 | grep "CPU usage"

# Check memory
vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages free:\s+(\d+)/ and printf("Free Memory: %.2f GB\n", $1 * $size / 1073741824);'

# Check process count
ps aux | grep -E "(node|ollama)" | wc -l

# Check disk space
df -h data/
```

### Resolution Steps

#### Resolution A: Clear Stuck Messages

```bash
# Reset stuck 'processing' messages
sqlite3 data/jarvis.db "
UPDATE queue
SET status = 'pending',
    updatedAt = datetime('now')
WHERE status = 'processing'
  AND updatedAt < datetime('now', '-10 minutes');
"

# Log affected count
sqlite3 data/jarvis.db "SELECT changes();"

# Restart worker to pick up reset messages
pkill -f "retry-worker"
npm run dev
```

#### Resolution B: Process DLQ (Dead Letter Queue)

```bash
# Check DLQ size (failed messages)
sqlite3 data/jarvis.db "
SELECT COUNT(*) as dlq_size
FROM queue
WHERE status = 'failed';
"

# Sample failed messages to understand errors
sqlite3 data/jarvis.db "
SELECT
  id,
  SUBSTR(error, 1, 100) as error_preview,
  retryCount
FROM queue
WHERE status = 'failed'
ORDER BY createdAt DESC
LIMIT 20;
"

# Option 1: Retry failed messages (if errors were transient)
sqlite3 data/jarvis.db "
UPDATE queue
SET status = 'pending',
    retryCount = 0,
    error = NULL,
    updatedAt = datetime('now')
WHERE status = 'failed'
  AND createdAt > datetime('now', '-1 hour');
"

# Option 2: Archive old failed messages (permanent removal)
sqlite3 data/jarvis.db "
DELETE FROM queue
WHERE status = 'failed'
  AND createdAt < datetime('now', '-7 days');
"

# Vacuum to reclaim space
sqlite3 data/jarvis.db "VACUUM;"
```

#### Resolution C: Temporarily Increase Processing Capacity

```bash
# Disable non-critical features to speed up processing
# Option 1: Disable cache lookups temporarily
sed -i '' 's/SEMANTIC_CACHE_ENABLED=true/SEMANTIC_CACHE_ENABLED=false/' .env

# Option 2: Switch to faster LLM model
sed -i '' 's/LLM_MODEL=llama3.2:3b/LLM_MODEL=llama3.2:1b/' .env

# Option 3: Reduce context window
sed -i '' 's/RESPONSE_CONTEXT_WINDOW_SIZE=10/RESPONSE_CONTEXT_WINDOW_SIZE=3/' .env

# Restart service
npm run dev

# Monitor queue reduction
watch -n 10 'sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"'
```

#### Resolution D: Prioritize Critical Messages

```bash
# Lower priority of low-priority chats
sqlite3 data/jarvis.db "
UPDATE queue
SET priority = 5
WHERE status = 'pending'
  AND priority > 5
  AND messageId NOT IN (
    SELECT id FROM messages
    WHERE chatId IN ($PRIORITY_CHAT_IDS)
  );
"

# Re-prioritize messages from VIP chats
sqlite3 data/jarvis.db "
UPDATE queue
SET priority = 1
WHERE status = 'pending'
  AND messageId IN (
    SELECT id FROM messages
    WHERE chatId IN ($PRIORITY_CHAT_IDS)
  );
"

# Restart to apply priority changes
npm run dev
```

#### Resolution E: Emergency Queue Drain

```bash
# Stop ingestion temporarily (if needed)
# Create a feature flag to pause message ingestion
sed -i '' 's/INGESTION_ENABLED=true/INGESTION_ENABLED=false/' .env

# This allows processor to catch up without new messages
npm run dev

# Monitor queue draining
watch -n 5 'sqlite3 data/jarvis.db "SELECT COUNT(*) FROM queue WHERE status='\''pending'\'';"'

# Re-enable ingestion once queue < 50
sed -i '' 's/INGESTION_ENABLED=false/INGESTION_ENABLED=true/' .env
npm run dev
```

### Escalation Criteria

Escalate if:

- Queue depth > 1000 messages
- Queue growing faster than 100 messages/minute
- Processing completely stalled for > 15 minutes
- System resources exhausted
- Message loss risk identified

---

## 5. Database Performance Issues

### Alert Trigger Conditions

- **Warning**: Query latency P95 > 500ms OR metric aggregation > 2s
- **Critical**: Query latency P95 > 1s OR database locks detected
- **Metric**: Database operation duration, lock wait time

### Symptoms

- Slow application responses
- SQLITE_BUSY errors in logs
- Long-running queries
- WAL file growing unbounded
- Metric collection delays

### Step-by-Step Diagnosis

#### Step 1: Check Database Size and Files

```bash
# Check database file sizes
ls -lh data/jarvis.db*

# Check table sizes
sqlite3 data/jarvis.db "
SELECT
  name,
  SUM(pgsize) / 1024 / 1024 as size_mb,
  COUNT(*) as page_count
FROM dbstat
GROUP BY name
ORDER BY size_mb DESC;
"

# Check row counts
sqlite3 data/jarvis.db "
SELECT 'messages' as table_name, COUNT(*) as rows FROM messages
UNION ALL
SELECT 'queue', COUNT(*) FROM queue
UNION ALL
SELECT 'llmResponses', COUNT(*) FROM llmResponses
UNION ALL
SELECT 'semanticCache', COUNT(*) FROM semanticCache
UNION ALL
SELECT 'senders', COUNT(*) FROM senders
UNION ALL
SELECT 'chats', COUNT(*) FROM chats;
"
```

**Expected Output:**
- Database file < 500MB
- WAL file < 10MB
- Each table < 100MB
- Message count < 1M rows

**If database is large:** Proceed to Step 2

#### Step 2: Check for Lock Contention

```bash
# Check processes accessing database
lsof data/jarvis.db

# Check WAL checkpoint status
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint;"

# Check for long-running transactions
# (SQLite doesn't expose this directly, check application logs)
tail -n 500 logs/jarvis.log | grep -i "transaction\|lock\|busy"

# Check database mode
sqlite3 data/jarvis.db "PRAGMA journal_mode;"
```

**Expected Output:**
- 1-2 processes accessing database
- WAL checkpoint succeeds
- Journal mode: WAL
- No SQLITE_BUSY errors

**If locks detected:** Proceed to Resolution Step A

#### Step 3: Analyze Query Performance

```bash
# Enable query profiling (requires restart with debug logging)
export DEBUG=drizzle:*
npm run dev &

# Run metric aggregation manually
sqlite3 data/jarvis.db "
EXPLAIN QUERY PLAN
SELECT
  DATE(createdAt) as date,
  COUNT(*) as total_messages
FROM messages
WHERE createdAt > datetime('now', '-7 days')
GROUP BY date;
"

# Check index usage
sqlite3 data/jarvis.db "
SELECT
  name,
  tbl_name,
  sql
FROM sqlite_master
WHERE type = 'index'
ORDER BY tbl_name;
"

# Analyze table statistics
sqlite3 data/jarvis.db "ANALYZE;"
```

**If missing indexes or poor query plans:** Proceed to Resolution Step B

#### Step 4: Check WAL Performance

```bash
# Check WAL size over time
watch -n 5 'ls -lh data/jarvis.db-wal'

# Check WAL autocheckpoint setting
sqlite3 data/jarvis.db "PRAGMA wal_autocheckpoint;"

# Check page size
sqlite3 data/jarvis.db "PRAGMA page_size;"

# Check cache size
sqlite3 data/jarvis.db "PRAGMA cache_size;"
```

**Expected Output:**
- WAL autocheckpoint: 1000 pages
- Page size: 4096 bytes
- Cache size: -2000 (2MB)

### Resolution Steps

#### Resolution A: Resolve Lock Contention

```bash
# Stop application
pkill -f "node.*jarvis"

# Force WAL checkpoint
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Increase WAL autocheckpoint frequency
sqlite3 data/jarvis.db "PRAGMA wal_autocheckpoint=500;"

# Increase cache size for better performance
sqlite3 data/jarvis.db "PRAGMA cache_size=-8000;" # 8MB cache

# Restart application
npm run dev

# Monitor for improvements
tail -f logs/jarvis.log | grep -i "sqlite\|database"
```

#### Resolution B: Optimize Indexes

```bash
# Check existing indexes
sqlite3 data/jarvis.db "
SELECT name, tbl_name, sql
FROM sqlite_master
WHERE type='index' AND sql IS NOT NULL;
"

# Add missing indexes for common queries
sqlite3 data/jarvis.db "
-- Index for queue status queries
CREATE INDEX IF NOT EXISTS idx_queue_status_created
ON queue(status, createdAt);

-- Index for message chat/sender lookups
CREATE INDEX IF NOT EXISTS idx_messages_chat_created
ON messages(chatId, createdAt);

-- Index for LLM responses by model
CREATE INDEX IF NOT EXISTS idx_llm_responses_model_created
ON llmResponses(model, createdAt);

-- Index for semantic cache lookups
CREATE INDEX IF NOT EXISTS idx_semantic_cache_created
ON semanticCache(createdAt, hitCount);
"

# Update statistics
sqlite3 data/jarvis.db "ANALYZE;"

# Restart to apply changes
npm run dev
```

#### Resolution C: Prune Old Data

```bash
# Backup database first
cp data/jarvis.db data/jarvis.db.backup.$(date +%Y%m%d)

# Prune old messages (keep last 90 days)
sqlite3 data/jarvis.db "
DELETE FROM messages
WHERE createdAt < datetime('now', '-90 days')
  AND id NOT IN (
    SELECT messageId FROM queue WHERE status != 'completed'
  );
"

# Prune completed queue items (keep last 30 days)
sqlite3 data/jarvis.db "
DELETE FROM queue
WHERE status = 'completed'
  AND updatedAt < datetime('now', '-30 days');
"

# Prune old LLM responses (keep last 60 days)
sqlite3 data/jarvis.db "
DELETE FROM llmResponses
WHERE createdAt < datetime('now', '-60 days');
"

# Prune unused semantic cache (keep last 30 days or hitCount > 0)
sqlite3 data/jarvis.db "
DELETE FROM semanticCache
WHERE createdAt < datetime('now', '-30 days')
  AND hitCount = 0;
"

# Vacuum to reclaim space
sqlite3 data/jarvis.db "VACUUM;"

# Verify database integrity
sqlite3 data/jarvis.db "PRAGMA integrity_check;"

# Restart
npm run dev
```

#### Resolution D: Optimize Database Configuration

```bash
# Stop application
pkill -f "node.*jarvis"

# Apply performance optimizations
sqlite3 data/jarvis.db "
-- Increase cache size (16MB)
PRAGMA cache_size=-16000;

-- Set temp store to memory
PRAGMA temp_store=MEMORY;

-- Enable memory-mapped I/O (128MB)
PRAGMA mmap_size=134217728;

-- Optimize synchronous mode (still safe with WAL)
PRAGMA synchronous=NORMAL;

-- Set optimal busy timeout
PRAGMA busy_timeout=5000;
"

# Verify settings
sqlite3 data/jarvis.db "
PRAGMA cache_size;
PRAGMA temp_store;
PRAGMA mmap_size;
PRAGMA synchronous;
PRAGMA busy_timeout;
"

# Restart
npm run dev
```

#### Resolution E: Database Rebuild (Last Resort)

```bash
# DANGER: This will require downtime

# Stop application
pkill -f "node.*jarvis"

# Backup current database
cp data/jarvis.db data/jarvis.db.backup.$(date +%Y%m%d_%H%M%S)

# Export data
sqlite3 data/jarvis.db ".dump" > /tmp/jarvis_dump.sql

# Create new database
rm data/jarvis.db data/jarvis.db-wal data/jarvis.db-shm

# Run migrations to recreate schema
npm run db:migrate

# Import data
sqlite3 data/jarvis.db < /tmp/jarvis_dump.sql

# Verify integrity
sqlite3 data/jarvis.db "PRAGMA integrity_check;"

# Verify row counts
sqlite3 data/jarvis.db "
SELECT 'messages' as table_name, COUNT(*) as rows FROM messages
UNION ALL
SELECT 'queue', COUNT(*) FROM queue;
"

# Restart
npm run dev
```

### Escalation Criteria

Escalate if:

- Database corruption detected
- Performance degradation > 50% after optimizations
- Database size > 2GB despite pruning
- Persistent lock contention causing errors
- Need to migrate to different database system

---

## 6. Memory/Resource Issues

### Alert Trigger Conditions

- **Warning**: Memory usage > 512MB OR CPU > 70% sustained
- **Critical**: Memory usage > 1GB OR CPU > 90% OR process crashes
- **Metric**: Process memory RSS, CPU usage percentage

### Symptoms

- Application slowness
- Process crashes or restarts
- System becoming unresponsive
- Out of memory errors
- High swap usage

### Step-by-Step Diagnosis

#### Step 1: Check Process Resource Usage

```bash
# Check Node.js process memory
ps aux | grep -E "node.*jarvis" | awk '{print $4, $5, $6, $11}'

# Check detailed memory breakdown
node -e "console.log(process.memoryUsage())"

# Check CPU usage over time
top -l 5 -pid $(pgrep -f "node.*jarvis") -stats pid,command,cpu,mem

# Check system memory
vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages (free|active|inactive|wired down):\s+(\d+)/ and printf("%-20s: %.2f GB\n", $1, $2 * $size / 1073741824);'

# Check swap usage
sysctl vm.swapusage
```

**Expected Output:**
- Node.js memory: < 512MB
- CPU usage: < 50% average
- Free system memory: > 2GB
- Swap used: < 1GB

**If memory high:** Proceed to Step 2
**If CPU high:** Proceed to Step 3

#### Step 2: Identify Memory Leaks

```bash
# Take heap snapshot (requires --inspect flag)
# Restart app with: node --inspect dist/index.js

# Check for growing arrays/objects in logs
tail -n 1000 logs/jarvis.log | grep -i "memory\|heap"

# Check metric queue size (common leak source)
# This requires adding debug logging to the metric exporter

# Check database connection pool
lsof -p $(pgrep -f "node.*jarvis") | grep jarvis.db | wc -l

# Check pending promises/timers
# (Requires manual code inspection or adding debug logging)
```

**Common Memory Leak Sources:**
- Metric batches not being flushed
- Event listeners not being cleaned up
- Large objects cached in memory
- Database result sets not being released

#### Step 3: Identify CPU Bottlenecks

```bash
# Profile CPU usage (requires --prof flag)
# Restart app with: node --prof dist/index.js
# Run for 60 seconds, then stop

# Process profile
node --prof-process isolate-*.log > cpu-profile.txt
less cpu-profile.txt

# Check for tight loops in logs
tail -n 1000 logs/jarvis.log | grep -E "loop|retry|recursive"

# Check for excessive database queries
# Enable query logging
export DEBUG=drizzle:query
npm run dev

# Monitor query frequency
tail -f logs/jarvis.log | grep "SELECT\|INSERT\|UPDATE" | wc -l
```

**Common CPU Bottlenecks:**
- Infinite retry loops
- Excessive database queries
- Large JSON parsing
- Embedding generation for every message

#### Step 4: Check for Resource Accumulation

```bash
# Check metric queue size (if implemented)
sqlite3 data/jarvis.db "
SELECT COUNT(*) FROM queue WHERE status = 'pending';
"

# Check event listener count (requires code inspection)
# Look for: EventEmitter, on(), addEventListener()

# Check timer count
lsof -p $(pgrep -f "node.*jarvis") | grep -E "timer|interval"

# Check file descriptor count
lsof -p $(pgrep -f "node.*jarvis") | wc -l
```

**Expected Output:**
- Pending queue: < 100
- File descriptors: < 100
- Timers: < 20

### Resolution Steps

#### Resolution A: Force Metric Flush

```bash
# If metrics are batched in memory, force immediate flush
# This requires adding a flush mechanism to the metric exporter

# Restart app to clear accumulated metrics
pkill -f "node.*jarvis"
npm run dev

# Reduce batch size to prevent accumulation
# Edit src/services/metrics.service.ts or similar
# Change: batchSize from 1000 to 100
# Change: flushInterval from 60s to 10s

# Restart
npm run dev
```

#### Resolution B: Adjust Batch Sizes

```bash
# Edit configuration to reduce memory footprint
# Create/edit .env settings

cat >> .env << 'EOF'
# Reduce metric batch sizes
METRIC_BATCH_SIZE=50
METRIC_FLUSH_INTERVAL_MS=5000

# Reduce context window
RESPONSE_CONTEXT_WINDOW_SIZE=3

# Limit concurrent processing
MAX_CONCURRENT_PROCESSING=2
EOF

# Restart
npm run dev

# Monitor memory usage
watch -n 5 'ps aux | grep "node.*jarvis" | awk "{print \$4, \$6}"'
```

#### Resolution C: Clean Up Event Listeners

```bash
# Check for event listener leaks in code
grep -r "\.on\(" src/ | wc -l
grep -r "\.removeListener\|\.off\(" src/ | wc -l

# If many .on() but few .off(), there's likely a leak

# Add cleanup in shutdown handler (edit src/index.ts)
# Example:
# process.on('SIGTERM', async () => {
#   await telegramService.disconnect();
#   await metricsService.flush();
#   process.exit(0);
# });

# Restart
npm run dev
```

#### Resolution D: Implement Memory Limits

```bash
# Restart with Node.js memory limits
# Edit package.json scripts:
cat > package.json.tmp << 'EOF'
{
  "scripts": {
    "dev": "node --max-old-space-size=512 --expose-gc node_modules/.bin/tsx watch src/index.ts",
    "start": "node --max-old-space-size=512 dist/index.js"
  }
}
EOF

# Apply changes (merge with existing package.json)
# Then restart:
npm run dev

# Enable manual garbage collection if needed
# Add to src/index.ts:
# setInterval(() => {
#   if (global.gc) global.gc();
# }, 60000); // GC every minute
```

#### Resolution E: Process Restart Strategy

```bash
# Implement automatic restarts for memory management

# Option 1: Use PM2 (process manager)
npm install -g pm2

# Create PM2 config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'jarvis',
    script: 'dist/index.js',
    max_memory_restart: '512M',
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
EOF

# Start with PM2
npm run build
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Option 2: Use systemd with memory limits (Linux)
# Or launchd on macOS with resource limits
```

#### Resolution F: Database Connection Pooling

```bash
# Check for connection leaks
lsof -p $(pgrep -f "node.*jarvis") | grep jarvis.db

# Ensure proper connection management in code
# Edit database initialization to use single connection

# Example fix in src/db/index.ts:
# - Remove multiple db instances
# - Use singleton pattern
# - Properly close connections on shutdown

# Restart
npm run dev

# Verify single connection
lsof -p $(pgrep -f "node.*jarvis") | grep jarvis.db
```

### Escalation Criteria

Escalate if:

- Memory usage > 2GB despite optimizations
- Process crashes persist after restarts
- Memory leak source cannot be identified
- CPU usage consistently > 90%
- System-wide resource exhaustion
- Need to architect horizontal scaling solution

---

## General Troubleshooting Tips

### Quick Health Check

Run this comprehensive health check script:

```bash
#!/bin/bash
echo "=== Jarvis Health Check ==="
echo ""

echo "1. Service Status:"
pgrep -f "node.*jarvis" && echo "✓ Jarvis running" || echo "✗ Jarvis not running"
curl -s http://localhost:11434/api/tags > /dev/null && echo "✓ Ollama running" || echo "✗ Ollama not running"
claude --version > /dev/null 2>&1 && echo "✓ Claude CLI available" || echo "✗ Claude CLI not available"

echo ""
echo "2. Database Status:"
sqlite3 data/jarvis.db "PRAGMA integrity_check;" | grep -q "ok" && echo "✓ Database OK" || echo "✗ Database issues"
ls -lh data/jarvis.db data/jarvis.db-wal

echo ""
echo "3. Queue Status:"
sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"

echo ""
echo "4. Recent Errors:"
tail -n 100 logs/jarvis.log | grep -i "error" | tail -5

echo ""
echo "5. Resource Usage:"
ps aux | grep -E "node.*jarvis" | head -1
df -h data/

echo ""
echo "=== End Health Check ==="
```

Save as `scripts/health-check.sh` and run:

```bash
chmod +x scripts/health-check.sh
./scripts/health-check.sh
```

### Logging Best Practices

```bash
# Enable debug logging
export DEBUG=*
export LOG_LEVEL=debug
npm run dev

# Tail logs with filtering
tail -f logs/jarvis.log | grep -E "error|warn|metric"

# Rotate logs if they get large
mv logs/jarvis.log logs/jarvis.log.$(date +%Y%m%d)
touch logs/jarvis.log
pkill -HUP -f "node.*jarvis"  # Signal app to reopen log file
```

### Emergency Contacts

- **Infrastructure Team**: infrastructure@example.com
- **On-Call Engineer**: oncall@example.com
- **Telegram API Support**: https://core.telegram.org/support
- **Anthropic Support**: support@anthropic.com
- **Ollama Community**: https://github.com/ollama/ollama/issues

---

## Appendix: Metric Queries

### Quick Metric Dashboard

```sql
-- Overall system health (last hour)
SELECT
  'Messages Processed' as metric,
  COUNT(*) as value
FROM queue
WHERE status = 'completed'
  AND updatedAt > datetime('now', '-1 hour')

UNION ALL

SELECT
  'Current Queue Depth',
  COUNT(*)
FROM queue
WHERE status = 'pending'

UNION ALL

SELECT
  'Error Rate %',
  ROUND(
    100.0 * COUNT(CASE WHEN status = 'failed' THEN 1 END) / COUNT(*),
    2
  )
FROM queue
WHERE createdAt > datetime('now', '-1 hour')

UNION ALL

SELECT
  'Avg Response Time (ms)',
  ROUND(AVG(responseTimeMs))
FROM llmResponses
WHERE createdAt > datetime('now', '-1 hour')

UNION ALL

SELECT
  'Cache Hit Rate %',
  ROUND(
    100.0 * SUM(CASE WHEN hitCount > 0 THEN 1 ELSE 0 END) / COUNT(*),
    2
  )
FROM semanticCache
WHERE createdAt > datetime('now', '-1 hour');
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-23
**Maintainer**: DevOps Team
