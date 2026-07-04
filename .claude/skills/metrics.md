# /metrics - Metrics Analysis

Export and analyze Jarvis system metrics.

## When to Use

- Monitoring system performance
- Capacity planning
- Cost optimization (token usage)
- Detecting anomalies
- Generating performance reports

## What This Skill Does

1. **Export Metrics** - Generate Prometheus/JSON/CSV exports
2. **Response Time Analysis** - Track latency trends
3. **Cache Performance** - Analyze hit rates
4. **Token Usage** - Track LLM costs
5. **Queue Metrics** - Monitor processing capacity
6. **Anomaly Detection** - Find unusual patterns

## Key Metrics

| Metric | Description | Healthy Range |
|--------|-------------|---------------|
| `response_time_ms` | Overall response latency | < 5000ms |
| `llm_response_time_ms` | LLM-specific latency | < 10000ms |
| `cache_hit_rate` | Semantic cache effectiveness | > 30% |
| `queue_depth` | Pending message count | < 50 |
| `token_usage` | LLM tokens consumed | varies |
| `error_rate` | Processing failure rate | < 5% |

## Execution Steps

### Step 1: Quick Metrics Summary
```bash
# Recent metrics summary
sqlite3 data/jarvis.db "
SELECT
  name,
  COUNT(*) as samples,
  ROUND(AVG(value), 2) as avg,
  ROUND(MIN(value), 2) as min,
  ROUND(MAX(value), 2) as max
FROM metrics
WHERE timestamp > datetime('now', '-1 hour')
GROUP BY name
ORDER BY name;
"
```

### Step 2: Response Time Analysis
```bash
# LLM response times by model
sqlite3 data/jarvis.db "
SELECT
  model,
  COUNT(*) as count,
  ROUND(AVG(responseTimeMs), 0) as avg_ms,
  ROUND(MIN(responseTimeMs), 0) as min_ms,
  ROUND(MAX(responseTimeMs), 0) as max_ms
FROM llmResponses
WHERE createdAt > datetime('now', '-1 hour')
GROUP BY model;
"
```

### Step 3: Cache Performance
```bash
# Cache hit statistics
sqlite3 data/jarvis.db "
SELECT
  COUNT(*) as total_entries,
  SUM(hitCount) as total_hits,
  ROUND(AVG(hitCount), 2) as avg_hits_per_entry,
  COUNT(CASE WHEN hitCount > 0 THEN 1 END) as entries_with_hits
FROM semanticCache;
"
```

### Step 4: Queue Throughput
```bash
# Processing rate (last hour)
sqlite3 data/jarvis.db "
SELECT
  strftime('%Y-%m-%d %H:00', processedAt, 'unixepoch') as hour,
  COUNT(*) as processed,
  ROUND(COUNT(*) / 60.0, 1) as per_minute
FROM queue
WHERE status = 'completed'
  AND processedAt > (unixepoch() - 3600)
GROUP BY hour;
"
```

### Step 5: Error Rate
```bash
# Error rate by status
sqlite3 data/jarvis.db "
SELECT
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM queue WHERE createdAt > datetime('now', '-1 hour')), 2) as percentage
FROM queue
WHERE createdAt > datetime('now', '-1 hour')
GROUP BY status;
"
```

### Step 6: Token Usage
```bash
# Token usage by model (if tracked)
sqlite3 data/jarvis.db "
SELECT
  model,
  SUM(promptTokens) as prompt_tokens,
  SUM(completionTokens) as completion_tokens,
  SUM(promptTokens + completionTokens) as total_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-24 hours')
GROUP BY model;
"
```

## Export Metrics

### Prometheus Format
```bash
npx tsx scripts/monitoring/export-metrics.ts --format=prometheus
```

### JSON Format
```bash
npx tsx scripts/monitoring/export-metrics.ts --format=json --from=$(date -v-1H +%s 2>/dev/null || date -d '1 hour ago' +%s)
```

### CSV Format
```bash
npx tsx scripts/monitoring/export-metrics.ts --format=csv
```

## Dashboard Query

```sql
-- Comprehensive health dashboard
SELECT
  'Messages Processed' as metric,
  COUNT(*) as value
FROM queue
WHERE status = 'completed'
  AND processedAt > (unixepoch() - 3600)

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
    100.0 * COUNT(CASE WHEN status = 'failed' THEN 1 END) / NULLIF(COUNT(*), 0),
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
    100.0 * SUM(CASE WHEN hitCount > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    2
  )
FROM semanticCache
WHERE createdAt > datetime('now', '-24 hours');
```

## Alerting Thresholds

From `config/alerting-rules.json`:

| Alert | Warning | Critical |
|-------|---------|----------|
| Response Time P95 | > 5s | > 10s |
| Error Rate | > 5% | > 10% |
| Cache Hit Rate | < 30% | < 20% |
| Queue Depth | > 100 | > 500 |
| Memory Usage | > 512MB | > 1GB |

## Reference

- Metrics service: `src/services/metrics.service.ts`
- Metrics repository: `src/repositories/metrics.repository.ts`
- Export script: `scripts/monitoring/export-metrics.ts`
- Alerting rules: `config/alerting-rules.json`
