# Feature Flags System

A centralized, type-safe feature flag management system for the Jarvis project.

## Overview

The feature flags system provides a unified way to manage feature toggles across the application. It supports:

- Type-safe flag names using TypeScript
- Runtime flag updates (in-memory only)
- Flag organization by category
- Backward compatibility with existing `appConfig`
- Convenience helper functions for common flags
- Detailed flag metadata and snapshots

## Quick Start

### Import and Use

```typescript
import { featureFlags, FeatureFlagNames } from './config/feature-flags';

// Check if a feature is enabled
if (featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED)) {
  // Feature is enabled
}

// Or use convenience helpers
import { isLLMEnabled, isClaudeEnabled } from './config/feature-flags';

if (isLLMEnabled()) {
  // LLM is enabled
}
```

## Available Feature Flags

### LLM Flags
- `llm.enabled` - Enable/disable LLM integration (Ollama)
- `llm.skipOnUnhealthy` - Skip LLM processing when service is unhealthy
- `claude.enabled` - Enable/disable Claude Code CLI integration
- `intent.enabled` - Enable/disable intent classification

### AI Response Flags
- `aiResponse.enabled` - Enable/disable AI auto-responses in private chats
- `aiResponse.typingIndicator` - Show typing indicator while generating response

### Tools Flags
- `webSearch.enabled` - Enable/disable web search capability
- `tools.enabled` - Enable/disable tool usage

### Memory Flags
- `embedding.enabled` - Enable/disable semantic embeddings
- `memory.enabled` - Enable/disable long-term memory system
- `rag.enabled` - Enable/disable Retrieval-Augmented Generation

### Performance Flags
- `cache.enabled` - Enable/disable semantic caching

### Monitoring Flags
- `metrics.enabled` - Enable/disable metrics collection
- `alerting.enabled` - Enable/disable alerting system

### Queue Flags
- `priorityEscalation.enabled` - Enable/disable priority escalation for aged messages

## API Reference

### Basic Operations

#### Check if a flag is enabled
```typescript
const isEnabled = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
```

#### Get all flags
```typescript
const allFlags = featureFlags.getAllFlags();
// Returns: { 'llm.enabled': true, 'claude.enabled': false, ... }
```

#### Get flags by category
```typescript
const byCategory = featureFlags.getFlagsByCategory();
// Returns: { LLM: { 'llm.enabled': true, ... }, Memory: { ... }, ... }
```

### Runtime Updates

#### Set a single flag
```typescript
featureFlags.setFlag(FeatureFlagNames.LLM_ENABLED, false);
```

#### Set multiple flags
```typescript
featureFlags.setFlags({
  [FeatureFlagNames.LLM_ENABLED]: true,
  [FeatureFlagNames.CLAUDE_ENABLED]: false,
});
```

#### Reset to default
```typescript
// Reset single flag
featureFlags.resetFlag(FeatureFlagNames.LLM_ENABLED);

// Reset all flags
featureFlags.resetAllFlags();
```

### Metadata and Debugging

#### Get flag configuration
```typescript
const config = featureFlags.getFlagConfig(FeatureFlagNames.LLM_ENABLED);
// Returns: { name, defaultValue, description, category }
```

#### Get all configurations
```typescript
const allConfigs = featureFlags.getAllConfigs();
```

#### Get snapshot
```typescript
const snapshot = featureFlags.getSnapshot();
// Returns array with: name, value, defaultValue, description, category, isModified
```

### Convenience Helpers

```typescript
import {
  isLLMEnabled,
  isClaudeEnabled,
  isResponseEnabled,
  isWebSearchEnabled,
  isMemoryEnabled,
  isRAGEnabled,
  isCacheEnabled,
  isMetricsEnabled,
} from './config/feature-flags';

if (isLLMEnabled()) {
  // LLM feature logic
}
```

## Default Values

Feature flags read their default values from environment variables:

- `LLM_ENABLED` → `llm.enabled`
- `CLAUDE_ENABLED` → `claude.enabled`
- `RESPONSE_ENABLED` → `aiResponse.enabled`
- `RESPONSE_TYPING_INDICATOR` → `aiResponse.typingIndicator`
- `SEARCH_ENABLED` → `webSearch.enabled`
- `TOOLS_ENABLED` → `tools.enabled`
- `INTENT_CLASSIFICATION_ENABLED` → `intent.enabled`
- `EMBEDDING_ENABLED` → `embedding.enabled`
- `MEMORY_ENABLED` → `memory.enabled`
- `RAG_ENABLED` → `rag.enabled`
- `CACHE_ENABLED` → `cache.enabled`
- `METRICS_ENABLED` → `metrics.enabled`
- `ALERTING_ENABLED` → `alerting.enabled`
- `PRIORITY_ESCALATION_ENABLED` → `priorityEscalation.enabled`

## Backward Compatibility

The feature flags system is fully backward compatible with the existing `appConfig`:

```typescript
// Old way (still works)
import { appConfig } from './config';
if (appConfig.llm.enabled) {
  // ...
}

// New way
import { featureFlags, FeatureFlagNames } from './config/feature-flags';
if (featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED)) {
  // ...
}

// Both approaches work and read from the same environment variables
```

## Use Cases

### Feature Gating
```typescript
if (featureFlags.isEnabled(FeatureFlagNames.RAG_ENABLED)) {
  // Use RAG for message processing
} else {
  // Use simple processing
}
```

### A/B Testing
```typescript
// Temporarily enable/disable features for testing
const originalValue = featureFlags.isEnabled(FeatureFlagNames.CACHE_ENABLED);
featureFlags.setFlag(FeatureFlagNames.CACHE_ENABLED, false);

// Run tests...

// Restore original value
featureFlags.setFlag(FeatureFlagNames.CACHE_ENABLED, originalValue);
```

### Admin Dashboard
```typescript
// Get current state for display
const snapshot = featureFlags.getSnapshot();
console.table(snapshot);

// Allow admins to toggle features
function handleToggle(flagName: string, value: boolean) {
  featureFlags.setFlag(flagName as FeatureFlagName, value);
}
```

### Development Configuration
```typescript
// Disable expensive features in development
if (process.env.NODE_ENV === 'development') {
  featureFlags.setFlags({
    [FeatureFlagNames.METRICS_ENABLED]: false,
    [FeatureFlagNames.ALERTING_ENABLED]: false,
  });
}
```

## Testing

Run the test suite:
```bash
npx tsx src/tests/config/feature-flags.test.ts
```

The test suite covers:
- Singleton instance creation
- Flag value initialization
- Runtime updates
- Category organization
- Flag metadata
- Snapshot functionality
- Error handling
- Convenience helpers
- Instance independence
- Backward compatibility

## Architecture Notes

### No Circular Dependencies

The feature flags system reads directly from environment variables to avoid circular dependency issues with `appConfig` and `runtime-config.ts`. This ensures the module can be imported anywhere without initialization order problems.

### Singleton Pattern

A singleton instance (`featureFlags`) is exported for application-wide use. You can also create new instances for testing or isolated contexts:

```typescript
import { FeatureFlags } from './config/feature-flags';
const testFlags = new FeatureFlags();
```

### In-Memory Only

Runtime flag updates are stored in-memory only and do not persist to environment variables or configuration files. Flags reset to their environment variable defaults on application restart.

## Examples

See `src/config/feature-flags.example.ts` for comprehensive usage examples including:
- Basic flag checks
- Runtime updates
- Bulk configuration
- Admin API patterns
- Migration strategies

## Future Enhancements

Potential future improvements:
- Persistent flag updates (database-backed)
- Per-user feature flags
- Gradual rollout percentages
- Time-based flag activation
- Flag usage analytics
- Remote flag updates via API
