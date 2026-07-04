/**
 * Runtime Config Manager - Usage Examples
 *
 * This file demonstrates how to use the RuntimeConfigManager for updating
 * configuration values at runtime without restarting the service.
 */

import { runtimeConfig } from '../../src/config/index.js';

// Example 1: Get configuration values
console.log('=== Example 1: Get Config Values ===');
console.log('LLM Timeout:', runtimeConfig.get('llm.timeoutMs'));
console.log('LLM Enabled:', runtimeConfig.get('llm.enabled'));
console.log('Priority Chat IDs:', runtimeConfig.get('priority.chatIds'));
console.log('Cache Enabled:', runtimeConfig.get('cache.enabled'));
console.log();

// Example 2: Update configuration values at runtime
console.log('=== Example 2: Update Config Values ===');
console.log('Before - LLM Timeout:', runtimeConfig.get('llm.timeoutMs'));
runtimeConfig.set('llm.timeoutMs', 60000);
console.log('After - LLM Timeout:', runtimeConfig.get('llm.timeoutMs'));
console.log();

// Example 3: Subscribe to configuration changes
console.log('=== Example 3: Subscribe to Changes ===');
const unsubscribe = runtimeConfig.subscribe('llm.maxRetries', (newValue: any, oldValue: any, path: string) => {
  console.log(`Config changed: ${path}`);
  console.log(`  Old value: ${oldValue}`);
  console.log(`  New value: ${newValue}`);
});

runtimeConfig.set('llm.maxRetries', 5);
console.log();

// Example 4: Track changes and get diff
console.log('=== Example 4: Track Changes ===');
runtimeConfig.set('llm.enabled', false);
runtimeConfig.set('cache.enabled', true);
runtimeConfig.set('retry.maxAttempts', 10);

console.log('Has changes:', runtimeConfig.hasChanges());
console.log('Change count:', runtimeConfig.getChangeCount());
console.log('Is llm.enabled modified:', runtimeConfig.isModified('llm.enabled'));
console.log('Is llm.model modified:', runtimeConfig.isModified('llm.model'));
console.log();

console.log('Changes diff:');
const diff = runtimeConfig.getDiff();
diff.forEach((change: any) => {
  console.log(`  ${change.path}:`);
  console.log(`    Original: ${JSON.stringify(change.originalValue)}`);
  console.log(`    Current: ${JSON.stringify(change.currentValue)}`);
  console.log(`    Changed at: ${change.timestamp.toISOString()}`);
});
console.log();

// Example 5: Reset specific values
console.log('=== Example 5: Reset Values ===');
console.log('Before reset - LLM Timeout:', runtimeConfig.get('llm.timeoutMs'));
runtimeConfig.reset('llm.timeoutMs');
console.log('After reset - LLM Timeout:', runtimeConfig.get('llm.timeoutMs'));
console.log();

// Example 6: Reset all changes
console.log('=== Example 6: Reset All ===');
console.log('Change count before reset:', runtimeConfig.getChangeCount());
runtimeConfig.resetAll();
console.log('Change count after reset:', runtimeConfig.getChangeCount());
console.log('Has changes:', runtimeConfig.hasChanges());
console.log();

// Example 7: Get snapshots
console.log('=== Example 7: Get Snapshots ===');
runtimeConfig.set('llm.temperature', 0.9);

const currentSnapshot = runtimeConfig.getSnapshot();
const originalSnapshot = runtimeConfig.getOriginal();

console.log('Current temperature:', currentSnapshot.llm.temperature);
console.log('Original temperature:', originalSnapshot.llm.temperature);
console.log();

// Example 8: Multiple subscribers
console.log('=== Example 8: Multiple Subscribers ===');
const subscriber1 = (newVal: any, oldVal: any) => {
  console.log(`Subscriber 1: value changed from ${oldVal} to ${newVal}`);
};
const subscriber2 = (newVal: any, oldVal: any) => {
  console.log(`Subscriber 2: detected change to ${newVal}`);
};

runtimeConfig.subscribe('retry.baseDelayMs', subscriber1);
runtimeConfig.subscribe('retry.baseDelayMs', subscriber2);

runtimeConfig.set('retry.baseDelayMs', 5000);
console.log();

// Clean up
unsubscribe();

/**
 * Real-world Use Cases:
 *
 * 1. Dynamic Rate Limiting:
 *    - Adjust LLM timeout based on current load
 *    - Update retry attempts during high traffic
 *
 * 2. Feature Flags:
 *    - Enable/disable features without restart
 *    - Toggle cache, memory, RAG features
 *
 * 3. Performance Tuning:
 *    - Adjust temperature for different scenarios
 *    - Update max tokens based on response quality
 *
 * 4. Emergency Response:
 *    - Disable expensive features during outages
 *    - Reduce timeouts to fail faster
 *
 * 5. A/B Testing:
 *    - Switch between different configurations
 *    - Test impact of different settings
 *
 * 6. Monitoring & Alerting:
 *    - Subscribe to critical config changes
 *    - Log configuration changes for audit
 */

// Example 9: Service integration pattern
class ExampleService {
  private timeoutMs: number;
  private unsubscribe: () => void;

  constructor() {
    // Get initial value
    this.timeoutMs = runtimeConfig.get('llm.timeoutMs') as number;

    // Subscribe to runtime changes
    this.unsubscribe = runtimeConfig.subscribe('llm.timeoutMs', (newValue: any) => {
      console.log(`Service: updating timeout from ${this.timeoutMs} to ${newValue}`);
      this.timeoutMs = newValue as number;
    });
  }

  async doWork() {
    console.log(`Working with timeout: ${this.timeoutMs}ms`);
    // Use this.timeoutMs in your service logic
  }

  cleanup() {
    this.unsubscribe();
  }
}

console.log('=== Example 9: Service Integration ===');
const service = new ExampleService();
await service.doWork();

// Update config - service will automatically react
runtimeConfig.set('llm.timeoutMs', 45000);
await service.doWork();

service.cleanup();
