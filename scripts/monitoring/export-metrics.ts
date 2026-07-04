#!/usr/bin/env tsx
/**
 * Metrics Export Script
 *
 * This script exports metrics in Prometheus format for external scraping.
 * It can be run periodically via cron or systemd timer.
 *
 * Usage:
 *   tsx scripts/monitoring/export-metrics.ts [options]
 *
 * Options:
 *   --output <path>       Output file path (default: data/monitoring/metrics.prom)
 *   --format <format>     Export format: prometheus, json, csv (default: prometheus)
 *   --from <timestamp>    Start timestamp (Unix seconds)
 *   --to <timestamp>      End timestamp (Unix seconds)
 *   --metric <name>       Specific metric name (for CSV export)
 *   --help                Show help message
 *
 * Examples:
 *   # Export all metrics in Prometheus format
 *   tsx scripts/monitoring/export-metrics.ts
 *
 *   # Export to custom location
 *   tsx scripts/monitoring/export-metrics.ts --output /var/lib/jarvis/metrics.prom
 *
 *   # Export JSON format
 *   tsx scripts/monitoring/export-metrics.ts --format json --output data/monitoring/metrics.json
 *
 *   # Export specific metric as CSV
 *   tsx scripts/monitoring/export-metrics.ts --format csv --metric response_time --output metrics.csv
 *
 *   # Export metrics for time range
 *   tsx scripts/monitoring/export-metrics.ts --from 1703001600 --to 1703088000
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { MetricsExporterService } from '../../src/services/metrics-exporter.service';
import { LLMResponseRepository } from '../../src/repositories/llmResponse.repository';
import { IntentLogRepository } from '../../src/repositories/intentLog.repository';
import { SemanticCacheRepository } from '../../src/repositories/semanticCache.repository';
import { QueueRepository } from '../../src/repositories/queue.repository';
import { logger } from '../../src/utils/logger';

// Parse command line arguments
interface Args {
  output: string;
  format: 'prometheus' | 'json' | 'csv';
  from?: number;
  to?: number;
  metric?: string;
  help: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    output: 'data/monitoring/metrics.prom',
    format: 'prometheus',
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    switch (arg) {
      case '--output':
        args.output = process.argv[++i];
        break;
      case '--format':
        const format = process.argv[++i];
        if (!['prometheus', 'json', 'csv'].includes(format)) {
          console.error(`Invalid format: ${format}. Must be: prometheus, json, csv`);
          process.exit(1);
        }
        args.format = format as 'prometheus' | 'json' | 'csv';
        break;
      case '--from':
        args.from = parseInt(process.argv[++i], 10);
        break;
      case '--to':
        args.to = parseInt(process.argv[++i], 10);
        break;
      case '--metric':
        args.metric = process.argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return args;
}

function showHelp(): void {
  const help = `
Metrics Export Script

Usage:
  tsx scripts/monitoring/export-metrics.ts [options]

Options:
  --output <path>       Output file path (default: data/monitoring/metrics.prom)
  --format <format>     Export format: prometheus, json, csv (default: prometheus)
  --from <timestamp>    Start timestamp (Unix seconds)
  --to <timestamp>      End timestamp (Unix seconds)
  --metric <name>       Specific metric name (for CSV export)
  --help, -h            Show this help message

Examples:
  # Export all metrics in Prometheus format
  tsx scripts/monitoring/export-metrics.ts

  # Export to custom location
  tsx scripts/monitoring/export-metrics.ts --output /var/lib/jarvis/metrics.prom

  # Export JSON format
  tsx scripts/monitoring/export-metrics.ts --format json --output data/monitoring/metrics.json

  # Export specific metric as CSV
  tsx scripts/monitoring/export-metrics.ts --format csv --metric response_time --output metrics.csv

  # Export metrics for time range
  tsx scripts/monitoring/export-metrics.ts --from 1703001600 --to 1703088000

Available CSV Metrics:
  - response_time    LLM response times by model
  - token_usage      Token usage by model
  - intents          Intent classifications
  - queue            Queue status counts
  - cache            Cache statistics
`;
  console.log(help);
}

async function exportMetrics(args: Args): Promise<void> {
  const startTime = Date.now();

  logger.info('[ExportMetrics] Starting metrics export', {
    format: args.format,
    output: args.output,
    from: args.from,
    to: args.to,
    metric: args.metric,
  });

  try {
    // Initialize repositories
    const llmResponseRepo = new LLMResponseRepository();
    const intentLogRepo = new IntentLogRepository();
    const cacheRepo = new SemanticCacheRepository();
    const queueRepo = new QueueRepository();

    // Initialize exporter service
    const exporterService = new MetricsExporterService(
      llmResponseRepo,
      intentLogRepo,
      cacheRepo,
      queueRepo
    );

    // Export based on format
    let content: string;

    switch (args.format) {
      case 'prometheus':
        content = await exporterService.exportPrometheus(args.from, args.to);
        break;

      case 'json':
        const jsonData = await exporterService.exportJSON(args.from, args.to);
        content = JSON.stringify(jsonData, null, 2);
        break;

      case 'csv':
        if (!args.metric) {
          console.error('Error: --metric is required for CSV export');
          console.log('\nAvailable metrics: response_time, token_usage, intents, queue, cache');
          process.exit(1);
        }
        content = await exporterService.exportCSV(args.metric, args.from, args.to);
        break;

      default:
        throw new Error(`Unsupported format: ${args.format}`);
    }

    // Ensure output directory exists
    const outputDir = dirname(args.output);
    mkdirSync(outputDir, { recursive: true });

    // Write to file
    writeFileSync(args.output, content, 'utf-8');

    const duration = Date.now() - startTime;
    const sizeKB = (content.length / 1024).toFixed(2);

    logger.info('[ExportMetrics] Export completed successfully', {
      format: args.format,
      output: args.output,
      sizeKB,
      durationMs: duration,
    });

    console.log(`✓ Metrics exported successfully`);
    console.log(`  Format:   ${args.format}`);
    console.log(`  Output:   ${args.output}`);
    console.log(`  Size:     ${sizeKB} KB`);
    console.log(`  Duration: ${duration} ms`);

    if (args.from || args.to) {
      console.log(`  From:     ${args.from ? new Date(args.from * 1000).toISOString() : 'beginning'}`);
      console.log(`  To:       ${args.to ? new Date(args.to * 1000).toISOString() : 'now'}`);
    }

  } catch (error) {
    logger.error('[ExportMetrics] Export failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.error(`✗ Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  await exportMetrics(args);
  process.exit(0);
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
