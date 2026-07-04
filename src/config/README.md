# Runtime Configuration System

The Runtime Configuration Manager provides a powerful system for updating configuration values at runtime without requiring a service restart. This is particularly useful for:

- Dynamic feature toggling
- Performance tuning during high load
- Emergency response scenarios
- A/B testing different configurations
- Real-time debugging and optimization

## Overview

The system wraps the static `appConfig` with a runtime layer that:

1. Tracks all configuration changes
2. Provides dot-notation access to nested config values
3. Emits events when configuration changes
4. Supports subscriptions for reactive updates
5. Allows resetting to original values
6. Maintains a full audit trail of changes

## Basic Usage

### Importing

```typescript
import { runtimeConfig } from '@/config';
// or
import { runtimeConfig } from '@/config/runtime-config';
```

### Getting Configuration Values

```typescript
// Get nested values using dot notation
const timeout = runtimeConfig.get('llm.timeoutMs');
const enabled = runtimeConfig.get('llm.enabled');
const chatIds = runtimeConfig.get('priority.chatIds');

// Returns undefined for invalid paths
const invalid = runtimeConfig.get('invalid.path'); // undefined
```

### Setting Configuration Values

```typescript
// Update values at runtime
runtimeConfig.set('llm.timeoutMs', 60000);
runtimeConfig.set('cache.enabled', true);
runtimeConfig.set('retry.maxAttempts', 10);

// Type validation ensures values match original types
runtimeConfig.set('llm.timeoutMs', 'invalid'); // Throws error
```

### Subscribing to Changes

```typescript
// Subscribe to specific config paths
const unsubscribe = runtimeConfig.subscribe(
  'llm.timeoutMs',
  (newValue, oldValue, path) => {
    console.log(`${path} changed from ${oldValue} to ${newValue}`);
    // React to the change...
  }
);

// Clean up when done
unsubscribe();
```

### Resetting Values

```typescript
// Reset a specific value to its original
runtimeConfig.set('llm.timeoutMs', 60000);
runtimeConfig.reset('llm.timeoutMs'); // Back to original value

// Reset all changes
runtimeConfig.resetAll();
```

### Tracking Changes

```typescript
// Check if any changes have been made
if (runtimeConfig.hasChanges()) {
  console.log(`${runtimeConfig.getChangeCount()} values have been modified`);
}

// Check if a specific path has been modified
if (runtimeConfig.isModified('llm.timeoutMs')) {
  console.log('LLM timeout has been modified');
}

// Get a full diff of all changes
const changes = runtimeConfig.getDiff();
changes.forEach((change) => {
  console.log(`${change.path}:`);
  console.log(`  Original: ${change.originalValue}`);
  console.log(`  Current: ${change.currentValue}`);
  console.log(`  Changed at: ${change.timestamp}`);
});
```

### Snapshots

```typescript
// Get current configuration snapshot
const current = runtimeConfig.getSnapshot();

// Get original configuration (before any changes)
const original = runtimeConfig.getOriginal();

// Snapshots are deep clones - safe to modify
current.llm.timeoutMs = 99999; // Won't affect runtime config
```

## Advanced Patterns

### Service Integration

Services can subscribe to configuration changes and react automatically:

```typescript
class LLMService {
  private timeoutMs: number;
  private unsubscribe: () => void;

  constructor() {
    // Get initial value
    this.timeoutMs = runtimeConfig.get('llm.timeoutMs') as number;

    // Subscribe to runtime changes
    this.unsubscribe = runtimeConfig.subscribe('llm.timeoutMs', (newValue) => {
      console.log(`LLM timeout updated to ${newValue}ms`);
      this.timeoutMs = newValue as number;
      // Optionally: reconnect clients, update pools, etc.
    });
  }

  async callLLM(prompt: string) {
    // Use the current timeout value
    return await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  cleanup() {
    this.unsubscribe();
  }
}
```

### Global Event Listening

```typescript
// Listen to all configuration changes
runtimeConfig.on('change', (path, newValue, oldValue) => {
  logger.info('Config changed', { path, oldValue, newValue });
});

// Listen to resets
runtimeConfig.on('reset', (path, originalValue, oldValue) => {
  logger.info('Config reset', { path, originalValue, oldValue });
});

// Listen to reset all events
runtimeConfig.on('resetAll', () => {
  logger.info('All config values reset to original');
});
```

### Dynamic Feature Flags

```typescript
// Enable feature during off-peak hours
if (isOffPeakHours()) {
  runtimeConfig.set('memory.enabled', true);
  runtimeConfig.set('rag.enabled', true);
}

// Disable expensive features during high load
if (systemLoad > 0.8) {
  runtimeConfig.set('cache.enabled', false);
  runtimeConfig.set('embedding.enabled', false);
}
```

### Emergency Response

```typescript
// Quick response to production issues
async function enterEmergencyMode() {
  // Reduce timeouts to fail faster
  runtimeConfig.set('llm.timeoutMs', 5000);
  runtimeConfig.set('claude.timeoutMs', 10000);

  // Disable non-critical features
  runtimeConfig.set('memory.enabled', false);
  runtimeConfig.set('rag.enabled', false);
  runtimeConfig.set('cache.enabled', false);

  // Reduce retry attempts
  runtimeConfig.set('retry.maxAttempts', 2);

  logger.warn('Entered emergency mode', {
    changes: runtimeConfig.getDiff(),
  });
}

async function exitEmergencyMode() {
  runtimeConfig.resetAll();
  logger.info('Exited emergency mode');
}
```

### A/B Testing

```typescript
// Test different configurations
const configVariantA = {
  'llm.temperature': 0.3,
  'llm.maxTokens': 512,
};

const configVariantB = {
  'llm.temperature': 0.7,
  'llm.maxTokens': 1024,
};

// Apply variant based on user
const variant = getUserVariant(userId);
const config = variant === 'A' ? configVariantA : configVariantB;

for (const [path, value] of Object.entries(config)) {
  runtimeConfig.set(path, value);
}
```

## API Reference

### Methods

#### `get(path: string): ConfigValue | undefined`

Get a configuration value by dot notation path.

**Parameters:**
- `path` - Dot notation path (e.g., 'llm.timeoutMs')

**Returns:** The configuration value or `undefined` if not found

---

#### `set(path: string, value: ConfigValue): void`

Set a configuration value at runtime.

**Parameters:**
- `path` - Dot notation path
- `value` - New value to set

**Throws:** Error if path is invalid or value type doesn't match original

---

#### `reset(path: string): void`

Reset a configuration value to its original value.

**Parameters:**
- `path` - Dot notation path to reset

**Throws:** Error if path is invalid

---

#### `resetAll(): void`

Reset all configuration values to their original state.

---

#### `subscribe(path: string, callback: ConfigListener): () => void`

Subscribe to changes on a specific configuration path.

**Parameters:**
- `path` - Dot notation path to watch
- `callback` - Function called when value changes: `(newValue, oldValue, path) => void`

**Returns:** Unsubscribe function

---

#### `unsubscribe(path: string, callback: ConfigListener): void`

Unsubscribe from configuration path changes.

**Parameters:**
- `path` - Dot notation path
- `callback` - Previously registered callback

---

#### `getSnapshot(): Record<string, any>`

Get a deep clone of the current full configuration.

**Returns:** Current configuration snapshot

---

#### `getOriginal(): Record<string, any>`

Get a deep clone of the original configuration before any changes.

**Returns:** Original configuration snapshot

---

#### `getDiff(): ConfigChange[]`

Get an array of all changes from the original configuration.

**Returns:** Array of config changes with:
- `path` - Configuration path
- `originalValue` - Value before changes
- `currentValue` - Current value
- `timestamp` - When the change was made

---

#### `hasChanges(): boolean`

Check if any configuration values have been modified.

**Returns:** `true` if there are changes

---

#### `getChangeCount(): number`

Get the number of modified configuration values.

**Returns:** Count of changes

---

#### `isModified(path: string): boolean`

Check if a specific path has been modified.

**Parameters:**
- `path` - Dot notation path

**Returns:** `true` if path has been modified

## Events

The runtime config manager extends `EventEmitter` and emits the following events:

### `change`

Emitted whenever a configuration value changes (via `set()` or `reset()`).

```typescript
runtimeConfig.on('change', (path, newValue, oldValue) => {
  // Handle change
});
```

### `reset`

Emitted when a configuration value is reset to its original value.

```typescript
runtimeConfig.on('reset', (path, originalValue, oldValue) => {
  // Handle reset
});
```

### `resetAll`

Emitted when all configuration values are reset.

```typescript
runtimeConfig.on('resetAll', () => {
  // Handle reset all
});
```

## Configuration Paths

All configuration paths from `appConfig` are available via dot notation:

```typescript
// Database
'database.path'

// LLM
'llm.enabled'
'llm.baseUrl'
'llm.model'
'llm.timeoutMs'
'llm.maxRetries'
'llm.temperature'
'llm.maxTokens'
'llm.healthCheckIntervalMs'
'llm.skipOnUnhealthy'

// Response
'response.enabled'
'response.contextWindowSize'
'response.systemPrompt'
'response.typingIndicator'
'response.temperature'
'response.maxTokens'

// Retry
'retry.maxAttempts'
'retry.retryIntervalMs'
'retry.baseDelayMs'
'retry.maxDelayMs'
'retry.backoffMultiplier'
'retry.jitterFactor'

// Circuit Breaker
'circuitBreaker.failureThreshold'
'circuitBreaker.resetTimeoutMs'
'circuitBreaker.halfOpenRequests'

// Memory
'memory.enabled'
'memory.maxMemoriesPerSender'
'memory.archiveAfterDays'
'memory.minConfidence'

// RAG
'rag.enabled'
'rag.topK'
'rag.similarityThreshold'
'rag.recencyDecayHours'
'rag.maxContextTokens'
'rag.recentMessagesCount'

// Cache
'cache.enabled'
'cache.similarityThreshold'
'cache.maxEntries'
'cache.ttl.simpleGreeting'
'cache.ttl.factualQuestion'
'cache.ttl.personalQuestion'
'cache.ttl.default'

// Metrics
'metrics.enabled'
'metrics.flushIntervalMs'
'metrics.retentionDays'
'metrics.aggregationIntervalMs'

// And many more...
```

## Best Practices

1. **Subscribe in constructors, unsubscribe in cleanup**: Always clean up subscriptions to prevent memory leaks

2. **Use specific paths**: Subscribe to specific paths rather than polling the entire config

3. **Type safety**: The system validates types at runtime, but you should still cast appropriately:
   ```typescript
   const timeout = runtimeConfig.get('llm.timeoutMs') as number;
   ```

4. **Audit changes**: Use `getDiff()` to audit all configuration changes for debugging

5. **Emergency rollback**: Keep the ability to `resetAll()` readily available for quick rollback

6. **Log changes**: Always log configuration changes for audit trails:
   ```typescript
   runtimeConfig.on('change', (path, newValue, oldValue) => {
     logger.info('Config changed', { path, oldValue, newValue });
   });
   ```

## Testing

Run the comprehensive test suite:

```bash
npm test src/tests/config/runtime-config.test.ts
```

The test suite includes 42 tests covering:
- Getting/setting nested values
- Type validation
- Change tracking
- Subscriptions and notifications
- Reset functionality
- Snapshots and diffs
- Error handling

## Examples

See `/Users/jarvis/src/jarvis/src/config/runtime-config.example.ts` for complete working examples demonstrating all features.

Run the examples:

```bash
npx tsx src/config/runtime-config.example.ts
```
