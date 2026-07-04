# Monitoring Quick Start Guide

Get your monitoring stack up and running in 5 minutes.

## Step 1: Setup (1 minute)

Run the automated setup script:

```bash
cd /Users/jarvis/src/jarvis
bash scripts/monitoring/setup.sh
```

This will:
- ✓ Check dependencies (Node.js, tsx)
- ✓ Create monitoring directories
- ✓ Set up automated metric export (cron or systemd)
- ✓ Run a test export

## Step 2: Verify (1 minute)

Check that metrics are being exported:

```bash
# View the exported metrics file
cat data/monitoring/metrics.prom

# Should see something like:
# # HELP jarvis_response_time_ms Response time in milliseconds
# # TYPE jarvis_response_time_ms histogram
# jarvis_response_time_ms_sum{model="ollama"} 1234 1703001600
# jarvis_response_time_ms_count{model="ollama"} 10 1703001600
```

Check the export logs:

```bash
tail -f logs/metrics-export.log
```

## Step 3: Configure Alerts (1 minute)

Review the default alerting rules:

```bash
npx tsx scripts/monitoring/load-alerting-rules.ts
```

Edit if needed:

```bash
# Edit the rules
nano config/alerting-rules.json

# Validate your changes
npx tsx scripts/monitoring/load-alerting-rules.ts --validate
```

## Step 4: Enable Monitoring (1 minute)

Update your `.env` file:

```bash
# Metrics (should already be enabled)
METRICS_ENABLED=true
METRICS_FLUSH_INTERVAL_MS=5000
METRICS_RETENTION_DAYS=30

# Alerting (enable if needed)
ALERTING_ENABLED=true
ALERTING_CHECK_INTERVAL_MS=60000
```

Restart your application to load the settings.

## Step 5: Integrate with Prometheus (1 minute)

Add this to your Prometheus `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'jarvis'
    scrape_interval: 60s
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: 'jarvis'
    file_sd_configs:
      - files:
        - '/Users/jarvis/src/jarvis/data/monitoring/metrics.prom'
        refresh_interval: 60s
```

Reload Prometheus:

```bash
curl -X POST http://localhost:9090/-/reload
```

## Done! 🎉

Your monitoring is now active. Here's what's happening:

1. **Metrics Collection**: Your app records metrics for every LLM request, cache hit, queue operation, etc.
2. **Aggregation**: Metrics are aggregated every minute into time-series data
3. **Export**: Every minute, metrics are exported to Prometheus format
4. **Alerting**: Alert rules check metrics every minute and notify on anomalies
5. **Scraping**: Prometheus scrapes the exported metrics file

## Quick Commands

```bash
# View current metrics
cat data/monitoring/metrics.prom

# Export metrics manually
npx tsx scripts/monitoring/export-metrics.ts

# Export JSON format
npx tsx scripts/monitoring/export-metrics.ts --format json --output metrics.json

# View alerting rules
npx tsx scripts/monitoring/load-alerting-rules.ts

# Check export logs
tail -f logs/metrics-export.log

# Check scheduler status
crontab -l | grep jarvis                    # For cron
systemctl status jarvis-metrics-export.timer  # For systemd
```

## Troubleshooting

### Metrics file is empty

Run a manual export to see the error:

```bash
npx tsx scripts/monitoring/export-metrics.ts
```

Common issues:
- Application not running (no metrics collected)
- Database doesn't exist (run migrations)
- Permissions issue (check file/directory permissions)

### Scheduler not running

**Cron:**
```bash
# Check if cron job exists
crontab -l | grep jarvis

# Re-run setup
bash scripts/monitoring/setup.sh
```

**Systemd:**
```bash
# Check timer status
systemctl status jarvis-metrics-export.timer

# Check service logs
journalctl -u jarvis-metrics-export.service -f

# Restart timer
sudo systemctl restart jarvis-metrics-export.timer
```

### No data in Prometheus

1. Check if metrics file exists and has data:
   ```bash
   ls -lh data/monitoring/metrics.prom
   cat data/monitoring/metrics.prom
   ```

2. Check Prometheus scrape status:
   - Open Prometheus UI: http://localhost:9090
   - Go to Status → Targets
   - Find the 'jarvis' job
   - Check if it's UP and when last scraped

3. Check Prometheus logs:
   ```bash
   docker logs prometheus  # If running in Docker
   ```

## Next Steps

1. **Set up Grafana Dashboard**: Create visualizations for your metrics
2. **Configure Alert Notifications**: Set up webhook/email notifications for alerts
3. **Tune Alert Thresholds**: Adjust based on your baseline metrics after 1 week
4. **Add Custom Metrics**: Instrument additional parts of your application

## Useful Queries

Once data is in Prometheus, try these queries:

```promql
# Average response time (last 5 minutes)
rate(jarvis_response_time_ms_sum[5m]) / rate(jarvis_response_time_ms_count[5m])

# Cache hit rate
jarvis_cache_hit_rate

# Current queue depth
jarvis_queue_items{status="pending"}

# Error rate (per minute)
rate(jarvis_llm_request_error[1m]) * 60

# 95th percentile response time
histogram_quantile(0.95, rate(jarvis_response_time_ms_bucket[5m]))
```

## Support

- **Full Documentation**: [scripts/monitoring/README.md](./README.md)
- **Alerting Rules Reference**: [config/alerting-rules.json](../../config/alerting-rules.json)
- **Logs**: Check `logs/metrics-export.log` and `logs/app.log`
