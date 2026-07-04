# Configuration Migrations

This directory contains configuration migrations for Jarvis.

## Overview

Configuration migrations allow you to handle breaking changes in configuration structure across versions. When you need to add, remove, rename, or restructure configuration options, create a migration to ensure smooth upgrades.

## Current Version

The current configuration version is defined in `../version.ts` as `CONFIG_VERSION = "1.0.0"`.

## Creating a New Migration

### 1. Copy the Template

```bash
cp TEMPLATE.ts 1.0.0-to-1.1.0.ts
```

Replace `1.0.0-to-1.1.0` with your actual version numbers.

### 2. Implement the Migration

Edit the new file:

```typescript
import { ConfigMigrator } from '../version';

const FROM_VERSION = '1.0.0';
const TO_VERSION = '1.1.0';
const DESCRIPTION = 'Added semantic memory configuration';

export function migration_1_0_0_to_1_1_0(migrator: ConfigMigrator): void {
  migrator.registerMigration(
    FROM_VERSION,
    TO_VERSION,
    (config) => {
      return {
        ...config,
        semanticMemory: {
          enabled: false,
          maxEntries: 1000,
        },
      };
    },
    DESCRIPTION
  );
}
```

### 3. Register the Migration

Add your migration to `index.ts`:

```typescript
import { migration_1_0_0_to_1_1_0 } from './1.0.0-to-1.1.0';

export function registerAllMigrations(migrator: ConfigMigrator): void {
  migration_1_0_0_to_1_1_0(migrator);
  // Add more migrations here...
}

export function getAvailableMigrations(): Array<[string, string]> {
  return [
    ['1.0.0', '1.1.0'],
    // Add more version pairs here...
  ];
}
```

### 4. Update the Version

In `../version.ts`, update the `CONFIG_VERSION`:

```typescript
export const CONFIG_VERSION = '1.1.0';
```

### 5. Update Documentation

Update `.env.example` with any new configuration options added in this migration.

## Using Migrations

### In Application Code

```typescript
import { configMigrator } from './config/version';
import { registerAllMigrations } from './config/migrations';

// Register all migrations at startup
registerAllMigrations(configMigrator);

// Migrate a config object
const result = configMigrator.migrate(oldConfig, '1.0.0', '1.1.0');

if (result.success) {
  console.log('Migration successful!');
  console.log('Applied migrations:', result.appliedMigrations);
} else {
  console.error('Migration failed:', result.errors);
}
```

### Migration Chain

Migrations can be chained. If you have migrations `1.0.0 -> 1.1.0` and `1.1.0 -> 1.2.0`, the migrator will automatically apply both when migrating from `1.0.0` to `1.2.0`.

## Best Practices

### 1. Always Add Defaults

When adding new fields, always provide sensible defaults:

```typescript
// Good
newConfig.newFeature = {
  enabled: false,
  timeout: 5000,
};

// Bad - requires user to configure immediately
newConfig.newFeature = undefined;
```

### 2. Preserve Existing Data

Never delete data without careful consideration:

```typescript
// Good - transform and preserve
if (config.oldFormat) {
  newConfig.newFormat = {
    data: config.oldFormat,
    migrated: true,
  };
}

// Bad - data loss
delete config.oldFormat;
```

### 3. Handle Missing Fields

Always check if fields exist before transforming:

```typescript
// Good
if (config.optional?.nested?.field) {
  // Transform
}

// Bad - will throw if field doesn't exist
const value = config.optional.nested.field;
```

### 4. Document Breaking Changes

Clearly document any breaking changes in the migration file and in release notes:

```typescript
/**
 * BREAKING CHANGES:
 * - Renamed `LLM_URL` to `LLM_BASE_URL`
 * - Changed `RETRY_DELAY` from seconds to milliseconds
 * - Removed deprecated `USE_LEGACY_MODE` option
 */
```

### 5. Test Thoroughly

Test your migration with:
- Valid configs from the previous version
- Configs with missing optional fields
- Configs with edge case values (empty strings, zero, null)
- Configs with extra fields not in the schema

## Migration Patterns

### Adding a New Section

```typescript
migrator.registerMigration('1.0.0', '1.1.0', (config) => ({
  ...config,
  newSection: {
    enabled: false,
    setting: 'default',
  },
}), 'Added newSection configuration');
```

### Renaming a Field

```typescript
migrator.registerMigration('1.0.0', '1.1.0', (config) => {
  const { oldName, ...rest } = config;
  return {
    ...rest,
    newName: oldName,
  };
}, 'Renamed oldName to newName');
```

### Restructuring Nested Config

```typescript
migrator.registerMigration('1.0.0', '1.1.0', (config) => ({
  ...config,
  section: {
    ...config.section,
    nested: {
      newStructure: {
        value: config.section.oldFlat,
        metadata: { version: '1.1.0' },
      },
    },
  },
}), 'Restructured section.oldFlat to section.nested.newStructure');
```

### Changing Data Types

```typescript
migrator.registerMigration('1.0.0', '1.1.0', (config) => ({
  ...config,
  retry: {
    ...config.retry,
    // Convert seconds to milliseconds
    delayMs: config.retry.delaySeconds * 1000,
  },
}), 'Changed retry.delaySeconds (seconds) to retry.delayMs (milliseconds)');
```

### Splitting a Field

```typescript
migrator.registerMigration('1.0.0', '1.1.0', (config) => {
  const [host, port] = config.serverAddress.split(':');
  return {
    ...config,
    server: {
      host,
      port: parseInt(port, 10),
    },
  };
}, 'Split serverAddress into server.host and server.port');
```

## Versioning Strategy

Use [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes that require migration
- **MINOR** (1.X.0): New features, backward-compatible (may add new optional config)
- **PATCH** (1.0.X): Bug fixes, no config changes

## Troubleshooting

### Migration Not Found

If you see "No migration found from version X to Y":
- Ensure the migration is registered in `index.ts`
- Check that the version numbers match exactly
- Verify migrations are registered at application startup

### Migration Chain Broken

If migrations can't chain from old to new version:
- Ensure each migration's `toVersion` matches the next migration's `fromVersion`
- Check the order of migration registration

### Configuration Invalid After Migration

If migrated config fails validation:
- Review the migration logic for missing fields
- Check that defaults are provided for all required fields
- Ensure data type transformations are correct

## Examples

See `TEMPLATE.ts` for a comprehensive template with examples of common migration patterns.
