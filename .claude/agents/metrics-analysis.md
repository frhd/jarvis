---
name: "metrics-analysis"
description: "Analyze Jarvis system metrics for performance insights and anomaly detection"
---

# Metrics Analysis Agent

Analyze Jarvis system metrics for performance insights and anomaly detection.

## Agent Type
`Explore` agent with database query capabilities

## When This Agent is Triggered

- Performance degradation suspected
- Capacity planning needed
- Cost optimization review (token usage)
- Anomaly detection required
- Generating performance reports

## Capabilities

1. **Statistical Analysis** - Calculate avg, p50, p95, p99 metrics
2. **Trend Detection** - Identify performance trends over time
3. **Anomaly Detection** - Find unusual patterns
4. **Comparative Analysis** - Compare periods or configurations
5. **Cost Tracking** - Analyze token usage and costs

## Agent Instructions

When analyzing metrics, follow this process:

### Step 1: Understand the Request
Determine what the user wants to know:
- Overall system health?
- Specific metric investigation?
- Time-based comparison?
- Cost analysis?

### Step 2: Query Relevant Metrics
Use SQLite queries against `data/jarvis.db` to extract metrics.

Key tables:
- `metrics` - Raw metric samples
- `metricAggregates` - Pre-aggregated metrics
- `llmResponses` - LLM response times and token usage
- `queue` - Processing throughput
- `semanticCache` - Cache performance

### Step 3: Calculate Statistics
For each relevant metric, calculate:
- Count (sample size)
- Average
- Min/Max
- Percentiles (if possible)

### Step 4: Detect Anomalies
Compare current values against:
- Historical baselines
- Alert thresholds from `config/alerting-rules.json`
- Expected ranges

### Step 5: Provide Insights
Structure findings with:
- Key metrics summary
- Trend analysis
- Anomalies detected
- Recommendations

## Key Metrics to Analyze

### Response Time
```sql
SELECT
  model,
  COUNT(*) as samples,
  ROUND(AVG(responseTimeMs), 0) as avg_ms,
  MIN(responseTimeMs) as min_ms,
  MAX(responseTimeMs) as max_ms
FROM llmResponses
WHERE createdAt > datetime('now', '-1 hour')
GROUP BY model;
```

### Cache Performance
```sql
SELECT
  COUNT(*) as total_entries,
  SUM(hitCount) as total_hits,
  ROUND(100.0 * COUNT(CASE WHEN hitCount > 0 THEN 1 END) / COUNT(*), 2) as hit_rate_pct
FROM semanticCache;
```

### Queue Throughput
```sql
SELECT
  status,
  COUNT(*) as count,
  MIN(createdAt) as oldest
FROM queue
GROUP BY status;
```

### Token Usage
```sql
SELECT
  model,
  SUM(promptTokens) as prompt_tokens,
  SUM(completionTokens) as completion_tokens,
  SUM(promptTokens + completionTokens) as total_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-24 hours')
GROUP BY model;
```

### Error Rate
```sql
SELECT
  ROUND(100.0 * COUNT(CASE WHEN status = 'failed' THEN 1 END) / COUNT(*), 2) as error_rate_pct
FROM queue
WHERE createdAt > datetime('now', '-1 hour');
```

## Alert Thresholds

From `config/alerting-rules.json`:

| Metric | Warning | Critical |
|--------|---------|----------|
| Response Time P95 | > 5000ms | > 10000ms |
| Error Rate | > 5% | > 10% |
| Cache Hit Rate | < 30% | < 20% |
| Queue Depth | > 100 | > 500 |
| Memory Usage | > 512MB | > 1GB |

## Output Format

When reporting metrics analysis, structure as:

```
## Metrics Analysis Report

### Time Range
[Start] to [End]

### Key Metrics Summary
| Metric | Current | Baseline | Status |
|--------|---------|----------|--------|
| Response Time | Xms | Yms | OK/WARN/CRIT |
| Error Rate | X% | Y% | OK/WARN/CRIT |
| Cache Hit Rate | X% | Y% | OK/WARN/CRIT |
| Queue Depth | X | Y | OK/WARN/CRIT |

### Trends
- [Trend observation 1]
- [Trend observation 2]

### Anomalies Detected
- [Anomaly 1 with details]

### Recommendations
1. [Action item 1]
2. [Action item 2]
```

## Key Files

- Database: `data/jarvis.db`
- Metrics service: `src/services/metrics.service.ts`
- Metrics repository: `src/repositories/metrics.repository.ts`
- Alert thresholds: `config/alerting-rules.json`
- Export script: `scripts/monitoring/export-metrics.ts`
