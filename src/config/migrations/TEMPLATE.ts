/**
 * Migration Template: X.X.X to Y.Y.Y
 *
 * INSTRUCTIONS:
 * 1. Copy this template file
 * 2. Rename to: [from-version]-to-[to-version].ts (e.g., 1.0.0-to-1.1.0.ts)
 * 3. Update the version numbers and description below
 * 4. Implement the migration logic in the migrate function
 * 5. Export the registration function
 * 6. Import and call the registration function in index.ts
 *
 * EXAMPLE FILENAME: 1.0.0-to-1.1.0.ts
 */

import { ConfigMigrator } from '../version';

/**
 * Migration from X.X.X to Y.Y.Y
 *
 * DESCRIPTION:
 * Describe what this migration does:
 * - What fields are being added?
 * - What fields are being removed?
 * - What fields are being renamed or restructured?
 * - What are the default values for new fields?
 *
 * BREAKING CHANGES:
 * List any breaking changes or important notes here
 */

const FROM_VERSION = 'X.X.X'; // Replace with actual version (e.g., '1.0.0')
const TO_VERSION = 'Y.Y.Y'; // Replace with actual version (e.g., '1.1.0')
const DESCRIPTION = 'Brief description of this migration';

/**
 * Register this migration with the ConfigMigrator
 *
 * @param migrator - The ConfigMigrator instance
 */
export function migration_X_X_X_to_Y_Y_Y(migrator: ConfigMigrator): void {
  migrator.registerMigration(
    FROM_VERSION,
    TO_VERSION,
    (config) => {
      // Create a copy to avoid mutating the original
      const newConfig = { ...config };

      // Example: Add a new configuration section
      // newConfig.newSection = {
      //   enabled: false,
      //   setting: 'default',
      // };

      // Example: Rename a field
      // if (newConfig.oldFieldName) {
      //   newConfig.newFieldName = newConfig.oldFieldName;
      //   delete newConfig.oldFieldName;
      // }

      // Example: Restructure nested configuration
      // if (newConfig.section && newConfig.section.oldNested) {
      //   newConfig.section.newStructure = {
      //     data: newConfig.section.oldNested,
      //     metadata: { migrated: true }
      //   };
      //   delete newConfig.section.oldNested;
      // }

      // Example: Add default values for new optional fields
      // newConfig.feature = {
      //   ...newConfig.feature,
      //   newOption: newConfig.feature?.newOption ?? true,
      // };

      // Example: Transform data format
      // if (Array.isArray(newConfig.items)) {
      //   newConfig.items = newConfig.items.map(item => ({
      //     ...item,
      //     version: TO_VERSION,
      //   }));
      // }

      return newConfig;
    },
    DESCRIPTION
  );
}

/**
 * Rollback function (optional, for documentation purposes)
 *
 * If you need to rollback this migration, implement the reverse logic here.
 * Note: ConfigMigrator doesn't automatically support rollbacks, but this
 * can serve as documentation for manual rollback procedures.
 */
export function rollback_Y_Y_Y_to_X_X_X(config: any): any {
  const rolledBackConfig = { ...config };

  // Implement reverse of the migration logic
  // Example: Remove added fields
  // delete rolledBackConfig.newSection;

  // Example: Restore renamed fields
  // if (rolledBackConfig.newFieldName) {
  //   rolledBackConfig.oldFieldName = rolledBackConfig.newFieldName;
  //   delete rolledBackConfig.newFieldName;
  // }

  return rolledBackConfig;
}

/**
 * TESTING CHECKLIST:
 *
 * Before deploying this migration:
 * [ ] Test with a config object from version X.X.X
 * [ ] Verify all new fields have appropriate defaults
 * [ ] Check that no data is lost during transformation
 * [ ] Test with edge cases (missing fields, null values, etc.)
 * [ ] Verify the migrated config works with the new application code
 * [ ] Document any manual steps required alongside this migration
 * [ ] Test rollback procedure if needed
 */
