# MetricsExporterService

Phase 4 implementation of the metrics exporter module for Jarvis.

## Overview

The `MetricsExporterService` aggregates metrics from various repositories and exports them in multiple formats for monitoring and analysis.

## Features

### 1. Multiple Export Formats

- **Prometheus**: Text format compatible with Prometheus monitoring
- **JSON**: Structured data for programmatic access
- **CSV**: Individual metric exports for spreadsheet analysis

### 2. Supported Metrics

- **Response Time**: LLM response times by model (Ollama, Claude)
- **Token Usage**: Token consumption by model and type (prompt/completion)
- **Intent Classification**: Classification counts, confidence, and duration
- **Queue Status**: Queue items by status (pending/processing/completed/failed)
- **Cache Statistics**: Cache entries, hits, hit rate, and distribution

### 3. Time-Based Filtering

All export methods support optional `from` and `to` parameters (Unix timestamps in seconds) to export metrics for specific time ranges.

## Usage

### Basic Export

```typescript
import { MetricsExporterService } from './metrics-exporter.service';
import { llmResponseRepository, intentLogRepository, semanticCacheRepository, queueRepository } from '../repositories';

const exporter = new MetricsExporterService(
  llmResponseRepository,
  intentLogRepository,
  semanticCacheRepository,
  queueRepository
);

// Export Prometheus format
const prometheusText = await exporter.exportPrometheus();

// Export JSON format
const jsonData = await exporter.exportJSON();

// Export specific metric as CSV
const responseTimeCSV = await exporter.exportCSV('response_time');
```

### Time Range Export

```typescript
// Last 24 hours
const now = Math.floor(Date.now() / 1000);
const oneDayAgo = now - 24 * 60 * 60;

const metrics = await exporter.exportJSON(oneDayAgo, now);
```

### Available CSV Metrics

- `response_time` - Response times by model
- `token_usage` - Token consumption by model
- `intents` - Intent classifications
- `queue` - Queue status
- `cache` - Cache statistics

## Prometheus Format Example

```
# HELP jarvis_response_time_ms Response time in milliseconds
# TYPE jarvis_response_time_ms histogram
jarvis_response_time_ms_sum{model="ollama"} 12345 1703350800
jarvis_response_time_ms_count{model="ollama"} 100 1703350800
jarvis_response_time_ms_avg{model="ollama"} 123.45 1703350800

# HELP jarvis_token_usage_total Total token usage by model
# TYPE jarvis_token_usage_total counter
jarvis_token_usage_total{model="ollama",type="prompt"} 50000 1703350800
jarvis_token_usage_total{model="ollama",type="completion"} 75000 1703350800
```

## JSON Format Example

```json
{
  "timestamp": 1703350800,
  "timeRange": {
    "from": null,
    "to": null
  },
  "metrics": {
    "responseTime": {
      "byModel": {
        "ollama": {
          "count": 100,
          "sum": 12345,
          "avg": 123.45,
          "min": 50,
          "max": 500
        }
      }
    },
    "tokenUsage": {
      "byModel": {
        "ollama": {
          "promptTokens": 50000,
          "completionTokens": 75000,
          "totalTokens": 125000,
          "count": 100
        }
      }
    },
    "intents": {
      "classifications": {
        "chat:simple_greeting": {
          "count": 50,
          "avgConfidence": 0.95,
          "avgDuration": 150
        }
      }
    },
    "queue": {
      "byStatus": {
        "pending": 5,
        "processing": 2,
        "completed": 1000,
        "failed": 10
      }
    },
    "cache": {
      "totalEntries": 100,
      "totalHits": 500,
      "avgHitCount": 5,
      "hitRate": 45.5,
      "entriesByIntent": {
        "simple_greeting": 30
      },
      "entriesByModel": {
        "ollama": 100
      }
    }
  }
}
```

## CSV Format Example

### Response Time CSV
```csv
model,count,sum_ms,avg_ms,min_ms,max_ms
ollama,100,12345,123.45,50,500
claude,50,150000,3000,1000,8000
```

### Token Usage CSV
```csv
model,count,prompt_tokens,completion_tokens,total_tokens
ollama,100,50000,75000,125000
claude,50,25000,30000,55000
```

## Integration Examples

See `metrics-exporter.example.ts` for complete examples including:

- Basic export in all formats
- Time-range filtering
- Scheduled exports
- HTTP endpoint for Prometheus scraping
- File-based exports

## Dependencies

- `LLMResponseRepository` - LLM response data
- `IntentLogRepository` - Intent classification logs
- `SemanticCacheRepository` - Cache statistics
- `QueueRepository` - Queue status

## Implementation Details

The service uses Drizzle ORM to aggregate data directly from the database tables:

- `llmResponses` - Response times and token usage
- `intentClassificationLogs` - Intent classifications
- `semanticCache` - Cache entries and hits
- `queue` - Queue items and status

All aggregations are performed in SQL for optimal performance.

## Logger Prefix

All log messages use the `[MetricsExporter]` prefix for easy filtering.
