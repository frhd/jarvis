import { EventEmitter } from 'events';
import type { AppConfig } from './schema.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RuntimeConfig');

type ConfigValue = string | number | boolean | null | string[] | ConfigObject;
type ConfigObject = { [key: string]: ConfigValue };
type ConfigListener = (newValue: ConfigValue, oldValue: ConfigValue, path: string) => void;

export interface ConfigChange {
  path: string;
  originalValue: ConfigValue;
  currentValue: ConfigValue;
  timestamp: Date;
}

/**
 * RuntimeConfigManager provides runtime configuration updates without restart.
 *
 * Features:
 * - Get/set config values using dot notation paths (e.g., 'llm.timeout')
 * - Track modifications and reset to original values
 * - Subscribe to config changes with event notifications
 * - Get snapshot of current config
 * - Get diff of changes from original
 *
 * Usage:
 * ```ts
 * import { runtimeConfig } from '@/config/runtime-config';
 *
 * // Get value
 * const timeout = runtimeConfig.get('llm.timeoutMs');
 *
 * // Set value
 * runtimeConfig.set('llm.timeoutMs', 60000);
 *
 * // Subscribe to changes
 * runtimeConfig.subscribe('llm.timeoutMs', (newVal, oldVal) => {
 *   console.log(`Timeout changed from ${oldVal} to ${newVal}`);
 * });
 *
 * // Reset to original
 * runtimeConfig.reset('llm.timeoutMs');
 *
 * // Get diff
 * const changes = runtimeConfig.getDiff();
 * ```
 */
export class RuntimeConfigManager extends EventEmitter {
  private originalConfig: ConfigObject;
  private currentConfig: ConfigObject;
  private changes: Map<string, ConfigChange>;
  private configListeners: Map<string, Set<ConfigListener>>;

  constructor(config: AppConfig) {
    super();
    // Deep clone the original config
    this.originalConfig = this.deepClone(config);
    this.currentConfig = this.deepClone(config);
    this.changes = new Map();
    this.configListeners = new Map();
  }

  /**
   * Get a config value by dot notation path.
   * @param path - Dot notation path (e.g., 'llm.timeoutMs', 'retry.maxAttempts')
   * @returns The config value or undefined if not found
   */
  get(path: string): ConfigValue | undefined {
    return this.getNestedValue(this.currentConfig, path);
  }

  /**
   * Set a config value at runtime.
   * @param path - Dot notation path (e.g., 'llm.timeoutMs')
   * @param value - New value to set
   * @throws Error if path is invalid or value type doesn't match original
   */
  set(path: string, value: ConfigValue): void {
    const oldValue = this.getNestedValue(this.currentConfig, path);

    if (oldValue === undefined) {
      throw new Error(`Invalid config path: ${path}`);
    }

    // Type validation - ensure new value matches original type
    const originalValue = this.getNestedValue(this.originalConfig, path);
    if (originalValue !== undefined && typeof value !== typeof originalValue) {
      // Special case: allow arrays if original was array
      if (!Array.isArray(originalValue) || !Array.isArray(value)) {
        throw new Error(
          `Type mismatch for ${path}: expected ${typeof originalValue}, got ${typeof value}`
        );
      }
    }

    // Set the new value
    this.setNestedValue(this.currentConfig, path, value);

    // Track the change
    if (!this.changes.has(path)) {
      // originalValue is guaranteed to be defined here because we validated it above
      if (originalValue === undefined) {
        throw new Error(`Cannot track change for undefined original value at ${path}`);
      }
      this.changes.set(path, {
        path,
        originalValue: this.deepClone(originalValue),
        currentValue: this.deepClone(value),
        timestamp: new Date(),
      });
    } else {
      // Update existing change
      const change = this.changes.get(path)!;
      change.currentValue = this.deepClone(value);
      change.timestamp = new Date();
    }

    // Emit global change event
    this.emit('change', path, value, oldValue);

    // Notify path-specific listeners
    this.notifyListeners(path, value, oldValue);
  }

  /**
   * Reset a config value to its original value.
   * @param path - Dot notation path to reset
   * @throws Error if path is invalid
   */
  reset(path: string): void {
    const originalValue = this.getNestedValue(this.originalConfig, path);

    if (originalValue === undefined) {
      throw new Error(`Invalid config path: ${path}`);
    }

    const oldValue = this.getNestedValue(this.currentConfig, path);

    // Reset to original value (TypeScript now knows originalValue is not undefined)
    const originalValueClone = this.deepClone(originalValue);
    this.setNestedValue(this.currentConfig, path, originalValueClone);

    // Remove from changes tracking
    this.changes.delete(path);

    // Emit events
    this.emit('reset', path, originalValueClone, oldValue);
    this.emit('change', path, originalValueClone, oldValue);

    // Notify listeners
    this.notifyListeners(path, originalValueClone, oldValue ?? originalValueClone);
  }

  /**
   * Reset all config values to original state.
   */
  resetAll(): void {
    const paths = Array.from(this.changes.keys());

    for (const path of paths) {
      this.reset(path);
    }

    this.emit('resetAll');
  }

  /**
   * Subscribe to changes on a specific config path.
   * @param path - Dot notation path to watch
   * @param callback - Function called when value changes
   * @returns Unsubscribe function
   */
  subscribe(path: string, callback: ConfigListener): () => void {
    if (!this.configListeners.has(path)) {
      this.configListeners.set(path, new Set());
    }

    this.configListeners.get(path)!.add(callback);

    // Return unsubscribe function
    return () => this.unsubscribe(path, callback);
  }

  /**
   * Unsubscribe from config path changes.
   * @param path - Dot notation path
   * @param callback - Previously registered callback
   */
  unsubscribe(path: string, callback: ConfigListener): void {
    const pathListeners = this.configListeners.get(path);

    if (pathListeners) {
      pathListeners.delete(callback);

      // Clean up empty listener sets
      if (pathListeners.size === 0) {
        this.configListeners.delete(path);
      }
    }
  }

  /**
   * Get a snapshot of the current full config.
   * @returns Deep clone of current config
   */
  getSnapshot(): ConfigObject {
    return this.deepClone(this.currentConfig) as ConfigObject;
  }

  /**
   * Get the original config before any runtime changes.
   * @returns Deep clone of original config
   */
  getOriginal(): ConfigObject {
    return this.deepClone(this.originalConfig) as ConfigObject;
  }

  /**
   * Get a diff of all changes from the original config.
   * @returns Array of config changes
   */
  getDiff(): ConfigChange[] {
    return Array.from(this.changes.values()).map((change) => ({
      path: change.path,
      originalValue: this.deepClone(change.originalValue),
      currentValue: this.deepClone(change.currentValue),
      timestamp: new Date(change.timestamp),
    }));
  }

  /**
   * Check if any config values have been modified.
   * @returns True if there are changes
   */
  hasChanges(): boolean {
    return this.changes.size > 0;
  }

  /**
   * Get the number of modified config values.
   * @returns Count of changes
   */
  getChangeCount(): number {
    return this.changes.size;
  }

  /**
   * Check if a specific path has been modified.
   * @param path - Dot notation path
   * @returns True if path has been modified
   */
  isModified(path: string): boolean {
    return this.changes.has(path);
  }

  // Private helper methods

  private getNestedValue(obj: ConfigObject, path: string): ConfigValue | undefined {
    const keys = path.split('.');
    let current: ConfigValue = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object' && !Array.isArray(current)) {
        current = current[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private setNestedValue(obj: ConfigObject, path: string, value: ConfigValue): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current: ConfigObject = obj;

    // Navigate to parent object
    for (const key of keys) {
      const next: ConfigValue = current[key];
      if (next === null || next === undefined) {
        throw new Error(`Invalid path: ${path}`);
      }
      if (typeof next !== 'object' || Array.isArray(next)) {
        throw new Error(`Invalid path: ${path}`);
      }
      current = next;
    }

    // Set the value
    current[lastKey] = value;
  }

  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepClone(item)) as T;
    }

    const cloned: ConfigObject = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this.deepClone((obj as ConfigObject)[key]);
      }
    }

    return cloned as T;
  }

  private notifyListeners(path: string, newValue: ConfigValue, oldValue: ConfigValue): void {
    const pathListeners = this.configListeners.get(path);

    if (pathListeners) {
      pathListeners.forEach((callback) => {
        try {
          callback(newValue, oldValue, path);
        } catch (error) {
          logger.error(`Error in config listener for ${path}`, error);
        }
      });
    }
  }
}

// Export the class - singleton will be created in index.ts
export default RuntimeConfigManager;
