/**
 * Configuration Migration Usage Examples
 *
 * This file demonstrates how to use the configuration versioning and migration system.
 * It is NOT meant to be imported or executed - it's purely for documentation purposes.
 */

import { configMigrator, CONFIG_VERSION } from '../version';
import { registerAllMigrations } from './index';

// ==============================================================================
// EXAMPLE 1: Basic Migration Setup (Application Startup)
// ==============================================================================

export function exampleSetup() {
  // Register all available migrations at application startup
  registerAllMigrations(configMigrator);

  console.log(`Current config version: ${CONFIG_VERSION}`);
  console.log('All migrations registered successfully');
}

// ==============================================================================
// EXAMPLE 2: Migrating a Configuration Object
// ==============================================================================

export function exampleMigration() {
  // Suppose we have an old config from version 1.0.0
  const oldConfig = {
    database: {
      path: '/data/jarvis.db',
    },
    llm: {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
    },
    // ... other fields
  };

  // Migrate from 1.0.0 to current version
  const result = configMigrator.migrate(oldConfig, '1.0.0', CONFIG_VERSION);

  if (result.success) {
    console.log('Migration successful!');
    console.log('Applied migrations:', result.appliedMigrations);
    // Use the migrated config
    // const migratedConfig = result.config;
  } else {
    console.error('Migration failed!');
    console.error('Errors:', result.errors);
  }
}

// ==============================================================================
// EXAMPLE 3: Checking Migration Path Availability
// ==============================================================================

export function exampleCheckPath() {
  const fromVersion = '1.0.0';
  const toVersion = '2.0.0';

  if (configMigrator.hasMigrationPath(fromVersion, toVersion)) {
    console.log(`Migration path exists from ${fromVersion} to ${toVersion}`);
  } else {
    console.log(`No migration path available from ${fromVersion} to ${toVersion}`);
    console.log('Manual migration may be required');
  }
}

// ==============================================================================
// EXAMPLE 4: Validating Configuration Structure
// ==============================================================================

export function exampleValidation() {
  const config = {
    database: { path: '/data/jarvis.db' },
    media: { basePath: '/data/media' },
    retry: { maxAttempts: 5 },
    circuitBreaker: { failureThreshold: 5 },
    telegram: { apiId: 12345, apiHash: 'hash' },
  };

  const validation = configMigrator.validateConfig(config, CONFIG_VERSION);

  if (validation.valid) {
    console.log('Configuration is valid');
  } else {
    console.error('Configuration validation failed:');
    validation.errors.forEach((error) => console.error(`  - ${error}`));
  }
}

// ==============================================================================
// EXAMPLE 5: Creating and Registering a Custom Migration
// ==============================================================================

export function exampleCustomMigration() {
  // Define a custom migration inline
  configMigrator.registerMigration(
    '1.0.0',
    '1.1.0',
    (config) => {
      // Add a new feature section with defaults
      return {
        ...config,
        analytics: {
          enabled: false,
          trackingId: '',
          sampleRate: 0.1,
        },
      };
    },
    'Added analytics configuration section'
  );

  console.log('Custom migration registered');
}

// ==============================================================================
// EXAMPLE 6: Handling Migration Errors Gracefully
// ==============================================================================

export function exampleErrorHandling() {
  const oldConfig = {
    /* some config */
  };

  try {
    const result = configMigrator.migrate(oldConfig, '1.0.0', '2.0.0');

    if (!result.success) {
      // Log errors and potentially fallback to safe defaults
      console.error('Migration errors:', result.errors);

      // Option 1: Use current config as-is (risky)
      // return oldConfig;

      // Option 2: Use default config
      // return getDefaultConfig();

      // Option 3: Prompt user for manual migration
      throw new Error('Manual configuration migration required');
    }

    return result;
  } catch (error) {
    console.error('Critical migration error:', error);
    throw error;
  }
}

// ==============================================================================
// EXAMPLE 7: Listing All Available Migrations
// ==============================================================================

export function exampleListMigrations() {
  const allMigrations = configMigrator.getAllMigrations();

  console.log('Available migrations:');
  for (const [fromVersion, migrations] of allMigrations) {
    migrations.forEach((migration) => {
      console.log(
        `  ${migration.fromVersion} -> ${migration.toVersion}: ${migration.description}`
      );
    });
  }
}

// ==============================================================================
// EXAMPLE 8: Environment-Based Configuration Loading with Migration
// ==============================================================================

export function exampleEnvironmentConfig() {
  // Load config version from environment or file
  const storedVersion = process.env.CONFIG_VERSION || '1.0.0';
  const currentVersion = CONFIG_VERSION;

  // Load the stored configuration (from file, database, etc.)
  const storedConfig = loadConfigFromStorage(); // Hypothetical function

  if (storedVersion !== currentVersion) {
    console.log(`Migrating config from ${storedVersion} to ${currentVersion}`);

    const result = configMigrator.migrate(
      storedConfig,
      storedVersion,
      currentVersion
    );

    if (result.success) {
      // Save migrated config back to storage
      saveConfigToStorage(result, currentVersion); // Hypothetical function
      console.log('Configuration migrated and saved');
    } else {
      console.error('Failed to migrate configuration:', result.errors);
      throw new Error('Configuration migration failed');
    }
  }

  return storedConfig;
}

// ==============================================================================
// EXAMPLE 9: Testing a Migration Before Deployment
// ==============================================================================

export function exampleTestMigration() {
  // Create test data representing old config format
  const testConfig = {
    database: { path: '/data/test.db' },
    llm: {
      enabled: true,
      url: 'http://localhost:11434', // Old field name
    },
  };

  // Test migration
  const result = configMigrator.migrate(testConfig, '1.0.0', '1.1.0');

  // Assertions
  console.assert(result.success, 'Migration should succeed');
  console.assert(
    result.appliedMigrations.length > 0,
    'Should have applied migrations'
  );

  console.log('Migration test passed');
}

// ==============================================================================
// EXAMPLE 10: Conditional Migration Based on Features
// ==============================================================================

export function exampleConditionalMigration() {
  // Define types for this specific migration
  interface OldLLMConfig {
    url?: string;
    baseUrl?: string;
    [key: string]: unknown;
  }

  interface MigrationConfig {
    embedding?: {
      enabled: boolean;
      model: string;
      dimensions: number;
    };
    llm?: OldLLMConfig;
    [key: string]: unknown;
  }

  configMigrator.registerMigration(
    '1.5.0',
    '1.6.0',
    (config) => {
      const newConfig = { ...config } as MigrationConfig;

      // Only add feature if it doesn't exist
      if (!newConfig.embedding) {
        newConfig.embedding = {
          enabled: false,
          model: 'nomic-embed-text',
          dimensions: 768,
        };
      }

      // Transform existing feature if present
      if (newConfig.llm?.url) {
        // Rename 'url' to 'baseUrl'
        newConfig.llm.baseUrl = newConfig.llm.url;
        delete newConfig.llm.url;
      }

      return newConfig;
    },
    'Added embedding support and renamed LLM URL field'
  );
}

// ==============================================================================
// Hypothetical Helper Functions (for demonstration)
// ==============================================================================

function loadConfigFromStorage(): any {
  // In reality, this would load from a file, database, etc.
  return {
    database: { path: '/data/jarvis.db' },
    // ... other config
  };
}

function saveConfigToStorage(config: any, version: string): void {
  // In reality, this would save to a file, database, etc.
  console.log(`Saving config version ${version}`);
  // fs.writeFileSync('config.json', JSON.stringify({ version, config }));
}

// ==============================================================================
// USAGE IN APPLICATION STARTUP (main.ts or index.ts)
// ==============================================================================

/*
import { configMigrator, CONFIG_VERSION } from './config/version';
import { registerAllMigrations } from './config/migrations';
import { appConfig } from './config';

async function initializeApp() {
  // 1. Register all migrations
  registerAllMigrations(configMigrator);

  // 2. Load stored config version (if any)
  const storedVersion = loadStoredConfigVersion();

  // 3. Check if migration is needed
  if (storedVersion && storedVersion !== CONFIG_VERSION) {
    console.log(`Migrating from ${storedVersion} to ${CONFIG_VERSION}`);

    const storedConfig = loadStoredConfig();
    const result = configMigrator.migrate(storedConfig, storedVersion, CONFIG_VERSION);

    if (result.success) {
      // Apply migrated config
      Object.assign(appConfig, result.config);
      saveConfigVersion(CONFIG_VERSION);
      console.log('Migration completed successfully');
    } else {
      console.error('Migration failed:', result.errors);
      process.exit(1);
    }
  }

  // 4. Validate current configuration
  const validation = configMigrator.validateConfig(appConfig, CONFIG_VERSION);
  if (!validation.valid) {
    console.error('Invalid configuration:', validation.errors);
    process.exit(1);
  }

  // 5. Continue with app startup
  console.log('Configuration validated, starting application...');
}

initializeApp().catch(console.error);
*/
