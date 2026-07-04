# Configuration Migration Guide

This guide explains how to use Jarvis's configuration versioning and migration system.

## Quick Start

### For Users

If you're upgrading Jarvis to a new version that requires configuration changes:

1. **Check the changelog** for breaking changes
2. **Backup your current `.env` file**
3. **Compare with new `.env.example`** to see what changed
4. **Update your `.env`** with any new required fields
5. **Restart Jarvis** - the system will handle the rest

### For Developers

If you're adding a new feature that changes configuration structure:

1. **Copy the migration template**:
   ```bash
   cp src/config/migrations/TEMPLATE.ts src/config/migrations/1.0.0-to-1.1.0.ts
   ```

2. **Implement the migration** (see template for examples)

3. **Register it in `index.ts`**

4. **Update `CONFIG_VERSION` in `version.ts`**

5. **Update `.env.example`** with new fields

6. **Test the migration** thoroughly

## Architecture

### Components

```
src/config/
├── version.ts              # CONFIG_VERSION constant and ConfigMigrator class
├── migrations/
│   ├── index.ts           # Migration registry
│   ├── README.md          # Detailed migration documentation
│   ├── TEMPLATE.ts        # Template for new migrations
│   ├── USAGE_EXAMPLE.ts   # Code examples
│   └── 1.0.0-to-1.1.0.ts # Actual migrations (as created)
```

### Key Concepts

- **CONFIG_VERSION**: Current configuration schema version (semver)
- **ConfigMigrator**: Handles migration between versions
- **Migration Function**: Transforms config from old to new format
- **Migration Chain**: Automatic sequential migration through multiple versions

## Version Numbers

We use [Semantic Versioning](https://semver.org/):

- **MAJOR.MINOR.PATCH** (e.g., 1.0.0)
- **MAJOR**: Breaking changes requiring migration
- **MINOR**: New features, backward-compatible
- **PATCH**: Bug fixes, no config changes

## Creating a Migration

### Step 1: Determine Version Numbers

Current version: `1.0.0`
Next version: `1.1.0` (if adding features) or `2.0.0` (if breaking changes)

### Step 2: Create Migration File

```bash
cp src/config/migrations/TEMPLATE.ts src/config/migrations/1.0.0-to-1.1.0.ts
```

### Step 3: Implement Migration Logic

```typescript
import { ConfigMigrator } from '../version';

const FROM_VERSION = '1.0.0';
const TO_VERSION = '1.1.0';
const DESCRIPTION = 'Added embedding configuration for semantic search';

export function migration_1_0_0_to_1_1_0(migrator: ConfigMigrator): void {
  migrator.registerMigration(
    FROM_VERSION,
    TO_VERSION,
    (config) => {
      // Always create a copy
      const newConfig = { ...config };

      // Add new section with sensible defaults
      newConfig.embedding = {
        enabled: false,
        model: 'nomic-embed-text',
        dimensions: 768,
        timeoutMs: 10000,
      };

      // Rename existing field if needed
      if (newConfig.llm?.url) {
        newConfig.llm.baseUrl = newConfig.llm.url;
        delete newConfig.llm.url;
      }

      return newConfig;
    },
    DESCRIPTION
  );
}
```

### Step 4: Register Migration

Edit `src/config/migrations/index.ts`:

```typescript
import { migration_1_0_0_to_1_1_0 } from './1.0.0-to-1.1.0';

export function registerAllMigrations(migrator: ConfigMigrator): void {
  migration_1_0_0_to_1_1_0(migrator);
  // Add more as they're created...
}

export function getAvailableMigrations(): Array<[string, string]> {
  return [
    ['1.0.0', '1.1.0'],
    // Add more version pairs...
  ];
}
```

### Step 5: Update Version Constant

Edit `src/config/version.ts`:

```typescript
export const CONFIG_VERSION = '1.1.0';  // Changed from '1.0.0'
```

### Step 6: Update .env.example

Add documentation for new configuration options:

```bash
# ==============================================================================
# EMBEDDING CONFIGURATION
# ==============================================================================
# Vector embeddings for semantic search and memory

# [OPTIONAL] Enable embedding generation (default: false)
EMBEDDING_ENABLED=true

# [OPTIONAL] Embedding model to use (default: nomic-embed-text)
EMBEDDING_MODEL=nomic-embed-text
# ... etc
```

### Step 7: Test the Migration

Create a test file or add to your test suite:

```typescript
import { configMigrator } from '../version';
import { registerAllMigrations } from '../migrations';

describe('Config Migration 1.0.0 to 1.1.0', () => {
  beforeAll(() => {
    registerAllMigrations(configMigrator);
  });

  it('should add embedding configuration', () => {
    const oldConfig = {
      database: { path: '/data/jarvis.db' },
      llm: { enabled: true, url: 'http://localhost:11434' },
    };

    const result = configMigrator.migrate(oldConfig, '1.0.0', '1.1.0');

    expect(result.success).toBe(true);
    expect(result.config.embedding).toBeDefined();
    expect(result.config.embedding.enabled).toBe(false);
    expect(result.config.llm.baseUrl).toBe('http://localhost:11434');
    expect(result.config.llm.url).toBeUndefined();
  });

  it('should handle missing optional fields gracefully', () => {
    const minimalConfig = {
      database: { path: '/data/jarvis.db' },
    };

    const result = configMigrator.migrate(minimalConfig, '1.0.0', '1.1.0');

    expect(result.success).toBe(true);
    expect(result.config.embedding).toBeDefined();
  });
});
```

## Migration Patterns

### Adding a New Section

```typescript
(config) => ({
  ...config,
  newSection: {
    enabled: false,
    setting: 'default',
  },
})
```

### Renaming a Field

```typescript
(config) => {
  const { oldName, ...rest } = config;
  return {
    ...rest,
    newName: oldName,
  };
}
```

### Changing Data Type

```typescript
(config) => ({
  ...config,
  retry: {
    ...config.retry,
    delayMs: config.retry.delaySeconds * 1000,
  },
})
```

### Conditional Transformation

```typescript
(config) => {
  const newConfig = { ...config };

  if (newConfig.feature?.oldField) {
    newConfig.feature.newField = transform(newConfig.feature.oldField);
    delete newConfig.feature.oldField;
  }

  return newConfig;
}
```

## Best Practices

### 1. Always Provide Defaults

New fields should have sensible defaults that maintain backward compatibility:

```typescript
// Good
newConfig.newFeature = {
  enabled: false,  // Safe default
  timeout: 5000,   // Reasonable default
};

// Bad
newConfig.newFeature = undefined;  // Requires immediate configuration
```

### 2. Preserve Data

Never delete data without careful consideration:

```typescript
// Good - transform and preserve
if (config.oldFormat) {
  newConfig.newFormat = {
    data: config.oldFormat,
    migrated: true,
    migratedAt: new Date().toISOString(),
  };
}

// Bad - potential data loss
delete config.oldFormat;
```

### 3. Handle Edge Cases

Check for missing, null, or unexpected values:

```typescript
// Good
if (config.optional?.nested?.field) {
  newConfig.transformed = config.optional.nested.field;
}

// Bad - throws on undefined
const value = config.optional.nested.field;
```

### 4. Document Breaking Changes

```typescript
/**
 * Migration from 1.0.0 to 2.0.0
 *
 * BREAKING CHANGES:
 * - Renamed LLM_URL to LLM_BASE_URL (env var and config)
 * - Changed RETRY_DELAY from seconds to milliseconds
 * - Removed deprecated USE_LEGACY_MODE option
 * - Split SERVER_ADDRESS into SERVER_HOST and SERVER_PORT
 *
 * MIGRATION NOTES:
 * - All existing retry delays will be multiplied by 1000
 * - Legacy mode users should use the new feature flags system
 * - Server address "localhost:3000" becomes host="localhost", port=3000
 */
```

### 5. Test Thoroughly

Test with:
- Valid configs from previous version
- Configs with missing optional fields
- Configs with extra/unknown fields
- Edge cases (empty strings, zero, null, undefined)
- Large configs with many nested objects

## Common Scenarios

### Scenario 1: Adding a New Optional Feature

```typescript
// Add with disabled default
newConfig.analytics = {
  enabled: false,
  trackingId: '',
};
```

### Scenario 2: Making a Required Field Optional

```typescript
// Provide a fallback default
newConfig.llm = {
  ...config.llm,
  model: config.llm?.model || 'mistral',
};
```

### Scenario 3: Splitting a Configuration

```typescript
// Split combined field
if (config.serverAddress) {
  const [host, port] = config.serverAddress.split(':');
  newConfig.server = {
    host: host || 'localhost',
    port: parseInt(port) || 3000,
  };
  delete newConfig.serverAddress;
}
```

### Scenario 4: Merging Configurations

```typescript
// Combine related fields
newConfig.database = {
  path: config.dbPath,
  maxConnections: config.dbMaxConnections,
  timeout: config.dbTimeout,
};
delete newConfig.dbPath;
delete newConfig.dbMaxConnections;
delete newConfig.dbTimeout;
```

## Troubleshooting

### Migration Not Applied

**Symptom**: Config doesn't change after migration

**Solutions**:
- Ensure migration is registered in `index.ts`
- Check version numbers match exactly
- Verify `registerAllMigrations()` is called at startup
- Check migration function actually modifies config

### Migration Chain Breaks

**Symptom**: Error "No migration path from X to Y"

**Solutions**:
- Ensure each migration's `toVersion` matches next migration's `fromVersion`
- Create intermediate migrations if needed
- Check migration registration order

### Invalid Config After Migration

**Symptom**: Application fails to start after migration

**Solutions**:
- Review migration logic for missing required fields
- Ensure defaults are provided for all required fields
- Validate data type transformations
- Use `validateConfig()` to identify issues

### Performance Issues

**Symptom**: Migration takes too long

**Solutions**:
- Avoid deep cloning large objects unnecessarily
- Use shallow spread `{...config}` when possible
- Process arrays efficiently (map/filter instead of loops)
- Consider batching if processing many configs

## Release Checklist

Before releasing a version with configuration changes:

- [ ] Migration file created and implemented
- [ ] Migration registered in `index.ts`
- [ ] `CONFIG_VERSION` updated in `version.ts`
- [ ] `.env.example` updated with new fields
- [ ] Migration tested with sample data
- [ ] Edge cases tested (missing fields, null values)
- [ ] Backward compatibility verified
- [ ] Breaking changes documented in migration file
- [ ] Breaking changes documented in CHANGELOG
- [ ] Release notes prepared
- [ ] Rollback procedure documented (if needed)

## Future Improvements

Potential enhancements to the migration system:

1. **Automatic Config Backup**: Back up config before migration
2. **Rollback Support**: Built-in rollback to previous version
3. **Migration Verification**: Automated validation after migration
4. **Interactive Migration**: CLI tool to guide users through migrations
5. **Migration Reporting**: Generate reports of what changed
6. **Version Detection**: Auto-detect config version from file metadata
7. **Dry Run Mode**: Preview migration without applying
8. **Migration History**: Track all migrations applied to a config

## Resources

- **Template**: `src/config/migrations/TEMPLATE.ts`
- **Examples**: `src/config/migrations/USAGE_EXAMPLE.ts`
- **Documentation**: `src/config/migrations/README.md`
- **Version Management**: `src/config/version.ts`
- **Environment Variables**: `.env.example`

## Support

For questions or issues with migrations:

1. Check this guide and the README
2. Review example migrations
3. Test migration in isolation
4. Check application logs for errors
5. Create an issue with migration details
