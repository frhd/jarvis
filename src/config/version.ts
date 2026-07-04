/**
 * Configuration Versioning System
 *
 * This module provides version tracking and migration capabilities for application configuration.
 * Use this to handle breaking changes in configuration structure across versions.
 */

export const CONFIG_VERSION = '1.0.0';

/**
 * Base configuration object type for type-safe migrations.
 * Configurations should extend this type.
 */
export type ConfigObject = Record<string, unknown>;

/**
 * Function type for configuration migration
 * @param config - The configuration object to migrate
 * @returns The migrated configuration object
 */
export type MigrationFunction<TIn extends ConfigObject = ConfigObject, TOut extends ConfigObject = ConfigObject> = (config: TIn) => TOut;

/**
 * Represents a single migration step
 */
export interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: MigrationFunction<ConfigObject, ConfigObject>;
}

/**
 * Result of a migration operation
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  appliedMigrations: string[];
  errors?: string[];
}

/**
 * Manages configuration migrations across versions
 *
 * @example
 * const migrator = new ConfigMigrator();
 * migrator.registerMigration('1.0.0', '1.1.0', (config) => {
 *   // Add new field with default value
 *   return {
 *     ...config,
 *     newFeature: { enabled: false }
 *   };
 * }, 'Added newFeature configuration');
 *
 * const result = migrator.migrate(oldConfig, '1.0.0', '1.1.0');
 */
export class ConfigMigrator {
  private migrations: Map<string, Migration[]> = new Map();

  /**
   * Register a migration from one version to another
   *
   * @param fromVersion - The version to migrate from (e.g., '1.0.0')
   * @param toVersion - The version to migrate to (e.g., '1.1.0')
   * @param migrationFn - The function that performs the migration
   * @param description - Human-readable description of what this migration does
   */
  registerMigration(
    fromVersion: string,
    toVersion: string,
    migrationFn: MigrationFunction<ConfigObject, ConfigObject>,
    description: string = ''
  ): void {
    const key = fromVersion;
    const migrations = this.migrations.get(key) || [];

    migrations.push({
      fromVersion,
      toVersion,
      description,
      migrate: migrationFn,
    });

    this.migrations.set(key, migrations);
  }

  /**
   * Migrate a configuration object from one version to another
   *
   * This method will apply all necessary migrations in sequence to get from
   * the source version to the target version.
   *
   * @param config - The configuration object to migrate
   * @param fromVersion - The current version of the config
   * @param toVersion - The target version to migrate to
   * @returns MigrationResult with the migrated config and operation details
   */
  migrate(config: ConfigObject, fromVersion: string, toVersion: string): MigrationResult {
    const appliedMigrations: string[] = [];
    const errors: string[] = [];

    if (fromVersion === toVersion) {
      return {
        success: true,
        fromVersion,
        toVersion,
        appliedMigrations,
      };
    }

    let currentVersion = fromVersion;
    let currentConfig = { ...config };

    // Attempt to find and apply migrations
    while (currentVersion !== toVersion) {
      const migrations = this.migrations.get(currentVersion);

      if (!migrations || migrations.length === 0) {
        errors.push(
          `No migration found from version ${currentVersion} to ${toVersion}`
        );
        return {
          success: false,
          fromVersion,
          toVersion,
          appliedMigrations,
          errors,
        };
      }

      // Find the migration that gets us closer to the target
      const migration = migrations.find((m) => {
        // For now, use direct match. In future, could implement version comparison
        return m.toVersion === toVersion || this.migrations.has(m.toVersion);
      });

      if (!migration) {
        errors.push(
          `No migration path found from ${currentVersion} to ${toVersion}`
        );
        return {
          success: false,
          fromVersion,
          toVersion,
          appliedMigrations,
          errors,
        };
      }

      // Apply the migration
      try {
        currentConfig = migration.migrate(currentConfig);
        appliedMigrations.push(
          `${migration.fromVersion} -> ${migration.toVersion}: ${migration.description}`
        );
        currentVersion = migration.toVersion;
      } catch (error) {
        errors.push(
          `Migration failed at ${migration.fromVersion} -> ${migration.toVersion}: ${error}`
        );
        return {
          success: false,
          fromVersion,
          toVersion,
          appliedMigrations,
          errors,
        };
      }
    }

    return {
      success: true,
      fromVersion,
      toVersion,
      appliedMigrations,
    };
  }

  /**
   * Get the current configuration version
   *
   * @returns The current CONFIG_VERSION constant
   */
  getCurrentVersion(): string {
    return CONFIG_VERSION;
  }

  /**
   * Get all registered migrations
   *
   * @returns Map of all registered migrations
   */
  getAllMigrations(): Map<string, Migration[]> {
    return new Map(this.migrations);
  }

  /**
   * Check if a migration path exists between two versions
   *
   * @param fromVersion - Starting version
   * @param toVersion - Target version
   * @returns true if a migration path exists
   */
  hasMigrationPath(fromVersion: string, toVersion: string): boolean {
    if (fromVersion === toVersion) return true;

    const migrations = this.migrations.get(fromVersion);
    if (!migrations || migrations.length === 0) return false;

    // Check if any migration can lead to target version
    return migrations.some((m) => {
      if (m.toVersion === toVersion) return true;
      // Recursively check if migration destination has a path
      return this.hasMigrationPath(m.toVersion, toVersion);
    });
  }

  /**
   * Validate that a config object has the expected structure for a version
   *
   * @param config - Configuration object to validate
   * @param version - Version to validate against
   * @returns Validation result with any errors
   */
  validateConfig(
    config: unknown,
    version: string
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation
    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be an object');
      return { valid: false, errors };
    }

    // Version-specific validation could be added here
    // For now, just basic structure checks
    if (version === CONFIG_VERSION) {
      const requiredSections = [
        'database',
        'media',
        'retry',
        'circuitBreaker',
        'telegram',
      ];

      for (const section of requiredSections) {
        if (!(section in config)) {
          errors.push(`Missing required configuration section: ${section}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Singleton instance of ConfigMigrator
 */
export const configMigrator = new ConfigMigrator();
