/**
 * Feature Flags Usage Examples
 *
 * This file demonstrates how to use the centralized feature flag system
 * alongside the existing appConfig for backward compatibility.
 */

import {
  featureFlags,
  FeatureFlagNames,
  isLLMEnabled,
  isClaudeEnabled,
  isResponseEnabled,
} from '../../src/config/feature-flags.js';
import { appConfig } from '../../src/config/index.js';

// Example 1: Using the feature flags directly
function checkLLMWithNewSystem() {
  if (featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED)) {
    console.log('LLM is enabled via feature flags');
  }
}

// Example 2: Using convenience helpers
function checkResponseWithHelper() {
  if (isResponseEnabled()) {
    console.log('Response system is enabled');
  }
}

// Example 3: Using the old appConfig (still works)
function checkLLMWithOldSystem() {
  if (appConfig.llm.enabled) {
    console.log('LLM is enabled via appConfig');
  }
}

// Example 4: Getting all flags for debugging/admin panel
function getFeatureFlagStatus() {
  const allFlags = featureFlags.getAllFlags();
  console.log('Current feature flags:', allFlags);

  // Get organized by category
  const byCategory = featureFlags.getFlagsByCategory();
  console.log('Flags by category:', byCategory);

  // Get detailed snapshot
  const snapshot = featureFlags.getSnapshot();
  const modified = snapshot.filter((s) => s.isModified);
  console.log('Modified flags:', modified);
}

// Example 5: Runtime flag updates (for admin controls, A/B testing, etc.)
function toggleFeatureForTesting() {
  // Temporarily disable LLM for testing
  const originalValue = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
  featureFlags.setFlag(FeatureFlagNames.LLM_ENABLED, false);

  // Run some tests...

  // Reset to original value
  featureFlags.setFlag(FeatureFlagNames.LLM_ENABLED, originalValue);

  // Or reset to default from appConfig
  featureFlags.resetFlag(FeatureFlagNames.LLM_ENABLED);
}

// Example 6: Bulk flag updates
function configureForDevelopment() {
  featureFlags.setFlags({
    [FeatureFlagNames.METRICS_ENABLED]: false,
    [FeatureFlagNames.ALERTING_ENABLED]: false,
    [FeatureFlagNames.CACHE_ENABLED]: false,
  });
}

// Example 7: Checking flag metadata
function inspectFlagConfig() {
  const config = featureFlags.getFlagConfig(FeatureFlagNames.LLM_ENABLED);
  if (config) {
    console.log('Flag:', config.name);
    console.log('Description:', config.description);
    console.log('Category:', config.category);
    console.log('Default:', config.defaultValue);
  }
}

// Example 8: Migration path from appConfig to feature flags
class ExampleService {
  private checkLLM(): boolean {
    // Option A: Still using appConfig (backward compatible)
    return appConfig.llm.enabled;

    // Option B: Migrated to feature flags
    // return featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);

    // Option C: Using convenience helper (recommended)
    // return isLLMEnabled();
  }

  private checkResponse(): boolean {
    // Both work - choose based on your preference
    return appConfig.response.enabled && isResponseEnabled();
  }
}

// Example 9: Feature flag gating for gradual rollout
function processMessage(messageId: string) {
  // Use RAG only if enabled
  if (featureFlags.isEnabled(FeatureFlagNames.RAG_ENABLED)) {
    console.log('Using RAG for message:', messageId);
    // RAG processing...
  } else {
    console.log('RAG disabled, using simple processing for:', messageId);
    // Simple processing...
  }

  // Use cache if enabled
  if (featureFlags.isEnabled(FeatureFlagNames.CACHE_ENABLED)) {
    // Check cache first...
  }
}

// Example 10: Admin API endpoint (hypothetical)
function handleAdminRequest(request: {
  action: 'get' | 'set' | 'reset';
  flagName?: string;
  value?: boolean;
}) {
  switch (request.action) {
    case 'get':
      if (request.flagName) {
        const config = featureFlags.getFlagConfig(request.flagName as any);
        const value = featureFlags.isEnabled(request.flagName as any);
        return { config, value };
      }
      return featureFlags.getSnapshot();

    case 'set':
      if (request.flagName && request.value !== undefined) {
        featureFlags.setFlag(request.flagName as any, request.value);
        return { success: true };
      }
      return { error: 'Missing flagName or value' };

    case 'reset':
      if (request.flagName) {
        featureFlags.resetFlag(request.flagName as any);
      } else {
        featureFlags.resetAllFlags();
      }
      return { success: true };

    default:
      return { error: 'Invalid action' };
  }
}

export {
  checkLLMWithNewSystem,
  checkResponseWithHelper,
  checkLLMWithOldSystem,
  getFeatureFlagStatus,
  toggleFeatureForTesting,
  configureForDevelopment,
  inspectFlagConfig,
  ExampleService,
  processMessage,
  handleAdminRequest,
};
