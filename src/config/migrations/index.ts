/**
 * Configuration Migrations Index
 *
 * This file exports all configuration migrations.
 * Import and register migrations in your application startup.
 *
 * @example
 * import { registerAllMigrations } from './config/migrations';
 * import { configMigrator } from './config/version';
 *
 * // Register all migrations
 * registerAllMigrations(configMigrator);
 *
 * // Use migrator
 * const result = configMigrator.migrate(oldConfig, '1.0.0', '2.0.0');
 */

import { ConfigMigrator } from '../version';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ConfigMigrations');

// Import future migration modules here
// import { migration_1_0_0_to_1_1_0 } from './1.0.0-to-1.1.0';
// import { migration_1_1_0_to_1_2_0 } from './1.1.0-to-1.2.0';

/**
 * Register all available migrations with the provided ConfigMigrator instance
 *
 * @param migrator - The ConfigMigrator instance to register migrations with
 */
export function registerAllMigrations(migrator: ConfigMigrator): void {
  // Register migrations here as they are created
  // Example:
  // migration_1_0_0_to_1_1_0(migrator);
  // migration_1_1_0_to_1_2_0(migrator);

  logger.info('No migrations registered yet. Current version: 1.0.0');
}

/**
 * Get a list of all available migration versions
 *
 * @returns Array of version pairs [from, to]
 */
export function getAvailableMigrations(): Array<[string, string]> {
  return [
    // Add version pairs here as migrations are created
    // ['1.0.0', '1.1.0'],
    // ['1.1.0', '1.2.0'],
  ];
}
