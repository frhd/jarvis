# Jarvis Configuration Reference

Complete reference for all configuration options.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Feature Flags](#feature-flags)
- [Runtime Configuration](#runtime-configuration)
- [Configuration Validation](#configuration-validation)
- [Configuration Versioning](#configuration-versioning)

---

## Environment Variables

### Telegram Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `API_ID` | number | **required** | Telegram API ID from my.telegram.org |
| `API_HASH` | string | **required** | Telegram API hash from my.telegram.org |
| `PHONE_NUMBER` | string | **required** | Phone number with country code (+1234567890) |
| `SESSION_STRING` | string | - | Cached session (generated after first auth) |

### Database Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_PATH` | string | `./data/jarvis.db` | SQLite database file path |

### Media Storage

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MEDIA_BASE_PATH` | string | `./data/media` | Base directory for media storage |

### LLM Configuration (Ollama)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LLM_ENABLED` | boolean | `false` | Enable Ollama LLM integration |
| `LLM_BASE_URL` | string | `http://localhost:11434` | Ollama server URL |
| `LLM_MODEL` | string | `mistral-small:24b-instruct-2501-q4_K_M` | Model name |
| `LLM_TIMEOUT_MS` | number | `30000` | Request timeout in milliseconds |
| `LLM_MAX_RETRIES` | number | `2` | Max retry attempts |
| `LLM_TEMPERATURE` | number | `0.3` | Model temperature (0-1) |
| `LLM_MAX_TOKENS` | number | `1024` | Max output tokens |
| `LLM_HEALTH_CHECK_INTERVAL_MS` | number | `60000` | Health check interval |
| `LLM_SKIP_ON_UNHEALTHY` | boolean | `true` | Skip LLM when unhealthy |

### AI Response Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RESPONSE_ENABLED` | boolean | `false` | Enable auto-responses |
| `RESPONSE_CONTEXT_WINDOW_SIZE` | number | `10` | Messages for context |
| `RESPONSE_SYSTEM_PROMPT` | string | - | System prompt for responses |
| `RESPONSE_TYPING_INDICATOR` | boolean | `true` | Show typing indicator |
| `RESPONSE_TEMPERATURE` | number | `0.7` | Response temperature |
| `RESPONSE_MAX_TOKENS` | number | `512` | Max response tokens |

### Claude CLI Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLAUDE_ENABLED` | boolean | `false` | Enable Claude CLI integration |
| `CLAUDE_CLI_PATH` | string | `claude` | Path to claude CLI executable |
| `CLAUDE_TIMEOUT_MS` | number | `60000` | CLI timeout in milliseconds |
| `CLAUDE_MODEL` | string | `sonnet` | Claude model (sonnet, opus, haiku) |
| `CLAUDE_SYSTEM_PROMPT` | string | - | System prompt for Claude |

### Intent Classification

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `INTENT_CLASSIFICATION_ENABLED` | boolean | `true` | Enable intent classification |
| `INTENT_TIMEOUT_MS` | number | `5000` | Classification timeout |
| `INTENT_TEMPERATURE` | number | `0.1` | Temperature for consistency |

### Web Search

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WEB_SEARCH_ENABLED` | boolean | `true` | Enable web search |
| `WEB_SEARCH_MAX_RESULTS` | number | `5` | Max results to fetch |
| `WEB_SEARCH_TIMEOUT_MS` | number | `10000` | Search timeout |

### Tools

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TOOLS_ENABLED` | boolean | `true` | Enable tool usage |
| `TOOLS_MAX_ITERATIONS` | number | `3` | Max tool iterations |

### Embedding Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EMBEDDING_ENABLED` | boolean | `false` | Enable embeddings |
| `EMBEDDING_MODEL` | string | `nomic-embed-text` | Embedding model name |
| `EMBEDDING_DIMENSIONS` | number | `768` | Vector dimensions |
| `EMBEDDING_TIMEOUT_MS` | number | `10000` | Embedding timeout |

### Memory System

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MEMORY_ENABLED` | boolean | `false` | Enable memory system |
| `MEMORY_MAX_PER_SENDER` | number | `100` | Max memories per sender |
| `MEMORY_ARCHIVE_AFTER_DAYS` | number | `90` | Days before archiving |
| `MEMORY_MIN_CONFIDENCE` | number | `50` | Min confidence (0-100) |

### RAG Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RAG_ENABLED` | boolean | `false` | Enable RAG pipeline |
| `RAG_TOP_K` | number | `10` | Top K results to retrieve |
| `RAG_SIMILARITY_THRESHOLD` | number | `0.7` | Min similarity for retrieval |
| `RAG_RECENCY_DECAY_HOURS` | number | `168` | Recency decay window (hours) |
| `RAG_MAX_CONTEXT_TOKENS` | number | `2000` | Max context tokens |
| `RAG_RECENT_MESSAGES_COUNT` | number | `5` | Recent messages to include |

### Semantic Cache

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CACHE_ENABLED` | boolean | `false` | Enable semantic caching |
| `CACHE_SIMILARITY_THRESHOLD` | number | `0.92` | Cache hit threshold |
| `CACHE_MAX_ENTRIES` | number | `10000` | Max cache entries |
| `CACHE_TTL_GREETING_HOURS` | number | `24` | TTL for greetings |
| `CACHE_TTL_FACTUAL_HOURS` | number | `168` | TTL for factual questions |
| `CACHE_TTL_PERSONAL_HOURS` | number | `720` | TTL for personal questions |
| `CACHE_TTL_DEFAULT_HOURS` | number | `24` | Default TTL |

### Retry Strategy

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RETRY_MAX_ATTEMPTS` | number | `5` | Max retry attempts |
| `RETRY_INTERVAL_MS` | number | `60000` | Retry check interval |
| `RETRY_BASE_DELAY_MS` | number | `1000` | Initial retry delay |
| `RETRY_MAX_DELAY_MS` | number | `300000` | Max retry delay (5 min) |
| `RETRY_BACKOFF_MULTIPLIER` | number | `2` | Exponential backoff factor |
| `RETRY_JITTER_FACTOR` | number | `0.25` | Jitter factor (0-1) |

### Circuit Breaker

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CIRCUIT_FAILURE_THRESHOLD` | number | `5` | Failures before opening |
| `CIRCUIT_RESET_TIMEOUT_MS` | number | `30000` | Time before half-open |
| `CIRCUIT_HALF_OPEN_REQUESTS` | number | `3` | Test requests in half-open |

### Dead Letter Queue

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DLQ_RETENTION_DAYS` | number | `7` | Days to retain DLQ items |
| `DLQ_CLEANUP_INTERVAL_MS` | number | `3600000` | Cleanup interval (1 hour) |

### Priority Escalation

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PRIORITY_ESCALATION_ENABLED` | boolean | `true` | Enable priority escalation |
| `PRIORITY_CHECK_INTERVAL_MS` | number | `60000` | Check interval |
| `PRIORITY_CHAT_IDS` | string | - | Comma-separated VIP chat IDs |
| `PRIORITY_USER_IDS` | string | - | Comma-separated VIP user IDs |

### Metrics

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `METRICS_ENABLED` | boolean | `true` | Enable metrics collection |
| `METRICS_FLUSH_INTERVAL_MS` | number | `5000` | Flush interval |
| `METRICS_RETENTION_DAYS` | number | `30` | Data retention period |
| `METRICS_AGGREGATION_INTERVAL_MS` | number | `60000` | Aggregation interval |

### Alerting

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ALERTING_ENABLED` | boolean | `true` | Enable alerting |
| `ALERTING_CHECK_INTERVAL_MS` | number | `60000` | Check interval |
| `ALERTING_DEFAULT_WINDOW_MS` | number | `300000` | Alert window (5 min) |
| `ALERTING_DEFAULT_COOLDOWN_MS` | number | `900000` | Cooldown period (15 min) |

### Multi-Model LLM (Optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OPENAI_API_KEY` | string | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | string | - | Anthropic API key |
| `GEMINI_API_KEY` | string | - | Google Gemini API key |

---

## Feature Flags

Feature flags provide runtime control over functionality. Located in `src/config/feature-flags.ts`.

### Available Flags

#### LLM Category

| Flag | Default | Description |
|------|---------|-------------|
| `llm.enabled` | `false` | Ollama LLM integration |
| `llm.skipOnUnhealthy` | `true` | Skip when Ollama unhealthy |
| `claude.enabled` | `false` | Claude CLI integration |
| `intent.enabled` | `true` | Intent classification |

#### AI Response Category

| Flag | Default | Description |
|------|---------|-------------|
| `aiResponse.enabled` | `false` | Auto-responses in chats |
| `aiResponse.typingIndicator` | `true` | Show typing indicator |

#### Tools Category

| Flag | Default | Description |
|------|---------|-------------|
| `webSearch.enabled` | `true` | Web search capability |
| `tools.enabled` | `true` | Tool usage |

#### Memory Category

| Flag | Default | Description |
|------|---------|-------------|
| `embedding.enabled` | `false` | Semantic embeddings |
| `memory.enabled` | `false` | Long-term memory |
| `rag.enabled` | `false` | RAG context building |

#### Performance Category

| Flag | Default | Description |
|------|---------|-------------|
| `cache.enabled` | `false` | Semantic caching |

#### Monitoring Category

| Flag | Default | Description |
|------|---------|-------------|
| `metrics.enabled` | `true` | Metrics collection |
| `alerting.enabled` | `true` | Alert system |

#### Queue Category

| Flag | Default | Description |
|------|---------|-------------|
| `priorityEscalation.enabled` | `true` | Priority escalation |

### Usage

```typescript
import { featureFlags } from './config';

// Check flag
if (featureFlags.isEnabled('memory.enabled')) {
  // Use memory system
}

// Toggle at runtime (in-memory only)
featureFlags.setFlag('cache.enabled', true);

// Reset to default
featureFlags.resetFlag('cache.enabled');

// Get all flags
const all = featureFlags.getAllFlags();
const byCategory = featureFlags.getFlagsByCategory();
```

---

## Runtime Configuration

Runtime configuration allows dynamic updates without restart. Located in `src/config/runtime-config.ts`.

### Usage

```typescript
import { runtimeConfig } from './config';

// Get value (dot notation)
const timeout = runtimeConfig.get('llm.timeoutMs');

// Set value
runtimeConfig.set('llm.timeoutMs', 5000);

// Reset to original
runtimeConfig.reset('llm.timeoutMs');
runtimeConfig.resetAll();

// Subscribe to changes
const unsubscribe = runtimeConfig.subscribe('llm.timeoutMs', (newValue, oldValue) => {
  console.log(`Changed from ${oldValue} to ${newValue}`);
});

// Check for modifications
if (runtimeConfig.hasChanges()) {
  const diff = runtimeConfig.getDiff();
  // Returns: [{ path, originalValue, currentValue, changedAt }]
}

// Get full configuration
const snapshot = runtimeConfig.getSnapshot();
const original = runtimeConfig.getOriginal();
```

### Change Events

```typescript
runtimeConfig.on('change', ({ path, oldValue, newValue }) => {
  console.log(`Config ${path} changed`);
});

runtimeConfig.on('reset', ({ path, value }) => {
  console.log(`Config ${path} reset to ${value}`);
});

runtimeConfig.on('resetAll', () => {
  console.log('All config reset');
});
```

### Supported Paths

All configuration sections support dot notation:

- `database.*`
- `telegram.*`
- `llm.*`
- `aiResponse.*`
- `claude.*`
- `intentClassification.*`
- `embedding.*`
- `memory.*`
- `rag.*`
- `cache.*`
- `retry.*`
- `circuitBreaker.*`
- `dlq.*`
- `priorityEscalation.*`
- `metrics.*`
- `alerting.*`

---

## Configuration Validation

Configuration is validated using Zod schemas. Located in `src/config/schema.ts`.

### Validation Helpers

```typescript
import { validateConfig, configSchema } from './config/schema';

// Validate full config
const result = configSchema.safeParse(config);
if (!result.success) {
  console.error(result.error.issues);
}

// Or use helper (throws on error)
const validatedConfig = validateConfig(config);
```

### Custom Validators

| Validator | Description |
|-----------|-------------|
| `positiveInt` | Positive integers only |
| `nonNegativeInt` | Zero or positive integers |
| `positiveFloat` | Positive decimals |
| `probability` | Range 0.0 to 1.0 |
| `urlString` | Valid URL format |
| `nonEmptyString` | Non-empty strings |

### Schema Sections

Each configuration section has a dedicated schema:

```typescript
// Example: LLM schema
const llmSchema = z.object({
  enabled: z.boolean(),
  baseUrl: urlString,
  model: nonEmptyString,
  timeoutMs: positiveInt,
  maxRetries: nonNegativeInt,
  temperature: probability,
  maxTokens: positiveInt,
  healthCheckIntervalMs: positiveInt,
  skipOnUnhealthy: z.boolean(),
});
```

---

## Configuration Versioning

Configuration versioning handles breaking changes. Located in `src/config/version.ts`.

### Current Version

```typescript
import { CONFIG_VERSION } from './config/version';
// Currently: '1.0.0'
```

### Migrations

```typescript
import { configMigrator } from './config/version';

// Register migration
configMigrator.registerMigration(
  '1.0.0',  // from version
  '1.1.0',  // to version
  (config) => ({
    ...config,
    newFeature: { enabled: false, setting: 'default' },
  }),
  'Added newFeature configuration section'
);

// Apply migrations
const result = configMigrator.migrate(config, '1.0.0', '1.1.0');
// Returns: { success: boolean, config: Config, migrations: string[] }

// Check migration path
if (configMigrator.hasMigrationPath('1.0.0', '2.0.0')) {
  // Path exists
}

// Validate against version
const validation = configMigrator.validateConfig(config, '1.0.0');
// Returns: { valid: boolean, errors: string[] }
```

### Migration Best Practices

1. **Add defaults for new fields**
   ```typescript
   (config) => ({
     ...config,
     newField: config.newField ?? 'default',
   })
   ```

2. **Preserve existing data**
   ```typescript
   (config) => ({
     ...config,
     renamed: config.oldName,
     // Don't delete oldName immediately
   })
   ```

3. **Handle missing optional fields**
   ```typescript
   (config) => ({
     ...config,
     optional: config.optional ?? undefined,
   })
   ```

4. **Document breaking changes**
   ```typescript
   configMigrator.registerMigration(
     '1.0.0',
     '2.0.0',
     migration,
     'BREAKING: Renamed llm.model to llm.modelName'
   );
   ```

---

## Configuration Files

### .env.example

Template for environment configuration:

```bash
# Copy to .env and fill in values
cp .env.example .env
```

### config/alerting-rules.json

Default alert rules:

```json
{
  "rules": [
    {
      "name": "high_llm_response_time",
      "metric": "llm_response_time_ms",
      "condition": "gt",
      "warningThreshold": 10000,
      "criticalThreshold": 30000,
      "windowMs": 300000,
      "cooldownMs": 900000
    }
  ]
}
```

### config/feature-flags.json (Optional)

Override feature flag defaults:

```json
{
  "llm.enabled": true,
  "memory.enabled": true,
  "cache.enabled": true
}
```

---

## Configuration Hierarchy

Configuration is resolved in this order (later overrides earlier):

1. **Defaults** - Hardcoded in schema
2. **Environment Variables** - From `.env` or system
3. **Feature Flags** - Runtime toggles
4. **Runtime Config** - Dynamic updates

```
Defaults → Environment → Feature Flags → Runtime
```

Note: Feature flags and runtime config are in-memory only and reset on restart.
