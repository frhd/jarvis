# Jarvis Monitoring Scripts

This directory contains scripts for setting up and managing the Jarvis monitoring infrastructure.

## Overview

The monitoring stack consists of:
- **Metrics Collection**: Built-in metrics service tracking LLM performance, cache hits, queue depth, etc.
- **Metrics Export**: Prometheus format export for external scraping
- **Alerting**: Configurable alert rules for anomaly detection
- **Aggregation**: Time-series data aggregation for historical analysis

## Quick Start

### 1. Setup Monitoring

Run the setup script to configure automated metrics export:

```bash
# Auto-detect scheduler (cron or systemd) and set up with defaults
bash scripts/monitoring/setup.sh

# Use specific scheduler with custom interval
bash scripts/monitoring/setup.sh --scheduler cron --interval 5

# Custom output path
bash scripts/monitoring/setup.sh --output /var/lib/jarvis/metrics.prom
```

### 2. Configure Alerting

Alerting rules are defined in `/config/alerting-rules.json`. The default configuration includes:
- Response time alerts (warning at 10s, critical at 30s)
- Error rate monitoring
- Cache performance alerts
- Queue depth monitoring
- Intent classification confidence tracking

To customize:
1. Edit `config/alerting-rules.json`
2. Adjust thresholds, severity levels, or enable/disable rules
3. Restart your application to load new rules

### 3. Access Metrics

Metrics are exported in Prometheus format to the configured output path (default: `data/monitoring/metrics.prom`).

Configure your Prometheus server to scrape this file:

```yaml
scrape_configs:
  - job_name: 'jarvis'
    scrape_interval: 60s
    static_configs:
      - targets: ['localhost:9090']
    file_sd_configs:
      - files:
        - '/path/to/jarvis/data/monitoring/metrics.prom'
```

## Scripts

### `setup.sh`

Sets up the monitoring infrastructure with automated metric export.

**Usage:**
```bash
bash scripts/monitoring/setup.sh [options]
```

**Options:**
- `--scheduler <cron|systemd|none>` - Scheduler to use (default: auto-detect)
- `--interval <minutes>` - Export interval in minutes (default: 1)
- `--output <path>` - Metrics output path (default: data/monitoring/metrics.prom)
- `--uninstall` - Remove monitoring setup
- `--help` - Show help message

**Examples:**
```bash
# Basic setup with auto-detection
bash scripts/monitoring/setup.sh

# Cron with 5-minute interval
bash scripts/monitoring/setup.sh --scheduler cron --interval 5

# Systemd (requires sudo)
sudo bash scripts/monitoring/setup.sh --scheduler systemd --interval 1

# Remove setup
bash scripts/monitoring/setup.sh --uninstall
```

### `export-metrics.ts`

Exports metrics in various formats (Prometheus, JSON, CSV).

**Usage:**
```bash
tsx scripts/monitoring/export-metrics.ts [options]
```

**Options:**
- `--output <path>` - Output file path (default: data/monitoring/metrics.prom)
- `--format <format>` - Export format: prometheus, json, csv (default: prometheus)
- `--from <timestamp>` - Start timestamp (Unix seconds)
- `--to <timestamp>` - End timestamp (Unix seconds)
- `--metric <name>` - Specific metric name (for CSV export)
- `--help` - Show help message

**Examples:**
```bash
# Export all metrics in Prometheus format
tsx scripts/monitoring/export-metrics.ts

# Export JSON format with time range
tsx scripts/monitoring/export-metrics.ts \
  --format json \
  --from 1703001600 \
  --to 1703088000 \
  --output metrics.json

# Export specific metric as CSV
tsx scripts/monitoring/export-metrics.ts \
  --format csv \
  --metric response_time \
  --output response_times.csv

# Available CSV metrics:
# - response_time    (LLM response times by model)
# - token_usage      (Token usage by model)
# - intents          (Intent classifications)
# - queue            (Queue status counts)
# - cache            (Cache statistics)
```

## Available Metrics

### Response Time Metrics
- `jarvis_response_time_ms` - Overall response time
- `jarvis_llm_response_time_ms` - LLM-specific response time (by model)
- `jarvis_ollama_response_time_ms` - Ollama response time
- `jarvis_claude_response_time_ms` - Claude CLI response time
- `jarvis_cache_lookup_time_ms` - Cache lookup time

### Token Usage Metrics
- `jarvis_token_usage_total` - Total tokens (prompt, completion, total)

### Cache Metrics
- `jarvis_cache_entries` - Total cache entries
- `jarvis_cache_hits_total` - Total cache hits
- `jarvis_cache_hit_rate` - Cache hit rate percentage
- `jarvis_cache_size` - Current cache size

### Intent Classification Metrics
- `jarvis_intent_classifications_total` - Total classifications by intent
- `jarvis_intent_confidence` - Average confidence score
- `jarvis_intent_classification_time_ms` - Classification duration
- `jarvis_intent_escalation` - Escalation count

### Queue Metrics
- `jarvis_queue_items` - Queue items by status (pending, processing, completed, failed)
- `jarvis_queue_depth` - Current queue depth
- `jarvis_queue_wait_time_ms` - Queue wait time
- `jarvis_queue_processing_time_ms` - Queue processing time

### Request Metrics
- `jarvis_llm_request` - Total LLM requests
- `jarvis_llm_request_success` - Successful LLM requests
- `jarvis_llm_request_error` - Failed LLM requests

### Message Processing Metrics
- `jarvis_message_processed` - Total messages processed
- `jarvis_message_processing_time_ms` - Message processing duration
- `jarvis_message_failed` - Failed message processing

## Alerting Rules

Alert rules are configured in `config/alerting-rules.json`. Each rule includes:

```json
{
  "name": "High LLM Response Time",
  "metricName": "llm_response_time_ms",
  "threshold": 10000,
  "operator": "gt",
  "severity": "warning",
  "enabled": true,
  "windowMs": 300000,
  "cooldownMs": 900000
}
```

**Fields:**
- `name` - Human-readable alert name
- `metricName` - Metric to monitor
- `threshold` - Alert threshold value
- `operator` - Comparison operator (gt, lt, eq, gte, lte)
- `severity` - Alert severity (info, warning, error, critical)
- `enabled` - Whether the rule is active
- `windowMs` - Time window for aggregation (milliseconds)
- `cooldownMs` - Minimum time between alerts (milliseconds)
- `tags` - Optional metric labels for filtering

### Default Rules

1. **High LLM Response Time** (warning at 10s, critical at 30s)
2. **High Error Rate** (5+ errors in 5 minutes)
3. **Low Cache Hit Rate** (below 20%)
4. **High Queue Depth** (warning at 100, critical at 500)
5. **Low Intent Confidence** (below 30%)
6. **High Escalation Rate** (10+ escalations in 15 minutes)
7. **High Ollama Response Time** (above 5s)
8. **High Claude Response Time** (above 15s)
9. **Cache Lookup Performance** (above 1s)
10. **High Message Processing Time** (above 20s)
11. **High Queue Wait Time** (above 5s)
12. **High Memory Retrieval Time** (above 2s)

## Integration with Prometheus

### Prometheus Configuration

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'jarvis'
    scrape_interval: 60s
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: 'jarvis'
          environment: 'production'
    file_sd_configs:
      - files:
        - '/path/to/jarvis/data/monitoring/metrics.prom'
        refresh_interval: 60s
```

### Grafana Dashboard

Example Grafana queries:

```promql
# Average response time by model (last 5 minutes)
rate(jarvis_response_time_ms_sum[5m]) / rate(jarvis_response_time_ms_count[5m])

# Cache hit rate
jarvis_cache_hit_rate

# Queue depth over time
jarvis_queue_items{status="pending"}

# Error rate (per minute)
rate(jarvis_llm_request_error[1m]) * 60
```

## Troubleshooting

### Metrics Not Exporting

1. Check if the export script runs successfully:
   ```bash
   tsx scripts/monitoring/export-metrics.ts
   ```

2. Check logs:
   ```bash
   tail -f logs/metrics-export.log
   ```

3. Verify scheduler is running:
   ```bash
   # For cron
   crontab -l | grep jarvis

   # For systemd
   systemctl status jarvis-metrics-export.timer
   ```

### Missing Metrics

1. Ensure metrics service is enabled in `.env`:
   ```bash
   METRICS_ENABLED=true
   ```

2. Check if metrics are being recorded:
   ```bash
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM metrics;"
   ```

3. Verify metric aggregation is running:
   ```bash
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM metricAggregates;"
   ```

### Alerts Not Triggering

1. Check if alerting is enabled:
   ```bash
   ALERTING_ENABLED=true
   ```

2. Verify alert rules are loaded (check application logs)

3. Test metric values against thresholds:
   ```bash
   tsx scripts/monitoring/export-metrics.ts --format json | jq '.metrics'
   ```

## Maintenance

### Cleanup Old Metrics

Raw metrics are aggregated into time-series data. You can safely delete old raw metrics:

```sql
-- Delete raw metrics older than 30 days
DELETE FROM metrics WHERE timestamp < datetime('now', '-30 days');

-- Aggregates are preserved for historical analysis
```

### Backup Metrics Data

```bash
# Backup SQLite database
sqlite3 data/jarvis.db ".backup data/backups/jarvis-$(date +%Y%m%d).db"

# Export historical metrics
tsx scripts/monitoring/export-metrics.ts \
  --format json \
  --from $(date -d '30 days ago' +%s) \
  --output "backups/metrics-$(date +%Y%m%d).json"
```

## Environment Variables

Configure monitoring behavior in `.env`:

```bash
# Metrics Configuration
METRICS_ENABLED=true                      # Enable metrics collection
METRICS_FLUSH_INTERVAL_MS=5000           # Flush buffer every 5 seconds
METRICS_RETENTION_DAYS=30                # Keep raw metrics for 30 days
METRICS_AGGREGATION_INTERVAL_MS=60000    # Aggregate every minute

# Alerting Configuration
ALERTING_ENABLED=true                    # Enable alerting
ALERTING_CHECK_INTERVAL_MS=60000         # Check alerts every minute
ALERTING_WINDOW_MS=300000                # 5-minute window for aggregation
ALERTING_COOLDOWN_MS=900000              # 15-minute cooldown between alerts
```

## Support

For issues or questions:
1. Check application logs: `logs/app.log`
2. Check export logs: `logs/metrics-export.log`
3. Review metric data: `sqlite3 data/jarvis.db`
4. Verify configuration: `config/alerting-rules.json`
