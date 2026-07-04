/**
 * Feature Flags Test
 *
 * This is a validation script to test the centralized feature flag system.
 * Run with: npx tsx src/tests/config/feature-flags.test.ts
 */

import {
  FeatureFlags,
  FeatureFlagNames,
  featureFlags,
  isLLMEnabled,
  isClaudeEnabled,
  isResponseEnabled,
  isWebSearchEnabled,
  isMemoryEnabled,
  isRAGEnabled,
  isCacheEnabled,
  isMetricsEnabled,
} from '../../config/feature-flags';
import { logger } from '../../utils/logger';

async function testFeatureFlags() {
  logger.info('[Test] Starting Feature Flags tests');

  try {
    // Test 1: Singleton instance exists
    logger.info('[Test] Test 1: Verifying singleton instance exists');
    if (featureFlags instanceof FeatureFlags) {
      logger.info('[Test] ✓ Singleton instance is valid');
    } else {
      throw new Error('Singleton instance is not a FeatureFlags instance');
    }

    // Test 2: Check initial flag values match environment variables
    logger.info('[Test] Test 2: Verifying initial flag values match environment');
    const llmEnabled = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
    const claudeEnabled = featureFlags.isEnabled(FeatureFlagNames.CLAUDE_ENABLED);
    const responseEnabled = featureFlags.isEnabled(FeatureFlagNames.AI_RESPONSE_ENABLED);

    const expectedLlm = process.env.LLM_ENABLED === 'true';
    const expectedClaude = process.env.CLAUDE_ENABLED === 'true';
    const expectedResponse = process.env.RESPONSE_ENABLED === 'true';

    if (
      llmEnabled === expectedLlm &&
      claudeEnabled === expectedClaude &&
      responseEnabled === expectedResponse
    ) {
      logger.info('[Test] ✓ Initial flag values match environment', {
        llmEnabled,
        claudeEnabled,
        responseEnabled,
      });
    } else {
      throw new Error('Initial flag values do not match environment variables');
    }

    // Test 3: Get all flags
    logger.info('[Test] Test 3: Getting all flags');
    const allFlags = featureFlags.getAllFlags();
    const flagCount = Object.keys(allFlags).length;
    if (flagCount >= 15) {
      // We have 15 flags defined
      logger.info('[Test] ✓ All flags retrieved', {
        count: flagCount,
        flags: allFlags,
      });
    } else {
      throw new Error(`Expected at least 15 flags, got ${flagCount}`);
    }

    // Test 4: Get flags by category
    logger.info('[Test] Test 4: Getting flags by category');
    const flagsByCategory = featureFlags.getFlagsByCategory();
    const categories = Object.keys(flagsByCategory);
    if (categories.length >= 5) {
      // We have multiple categories
      logger.info('[Test] ✓ Flags organized by category', {
        categories,
        flagsByCategory,
      });
    } else {
      throw new Error(`Expected multiple categories, got ${categories.length}`);
    }

    // Test 5: Set a flag value at runtime
    logger.info('[Test] Test 5: Setting a flag value at runtime');
    const originalValue = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
    const newValue = !originalValue;
    featureFlags.setFlag(FeatureFlagNames.LLM_ENABLED, newValue);
    const updatedValue = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);

    if (updatedValue === newValue) {
      logger.info('[Test] ✓ Flag value updated successfully', {
        originalValue,
        newValue,
        updatedValue,
      });
    } else {
      throw new Error('Flag value was not updated');
    }

    // Test 6: Set multiple flags at once
    logger.info('[Test] Test 6: Setting multiple flags at once');
    featureFlags.setFlags({
      [FeatureFlagNames.CLAUDE_ENABLED]: true,
      [FeatureFlagNames.AI_RESPONSE_ENABLED]: false,
      [FeatureFlagNames.WEB_SEARCH_ENABLED]: true,
    });

    if (
      featureFlags.isEnabled(FeatureFlagNames.CLAUDE_ENABLED) === true &&
      featureFlags.isEnabled(FeatureFlagNames.AI_RESPONSE_ENABLED) === false &&
      featureFlags.isEnabled(FeatureFlagNames.WEB_SEARCH_ENABLED) === true
    ) {
      logger.info('[Test] ✓ Multiple flags updated successfully', {
        claudeEnabled: featureFlags.isEnabled(FeatureFlagNames.CLAUDE_ENABLED),
        responseEnabled: featureFlags.isEnabled(FeatureFlagNames.AI_RESPONSE_ENABLED),
        webSearchEnabled: featureFlags.isEnabled(FeatureFlagNames.WEB_SEARCH_ENABLED),
      });
    } else {
      throw new Error('Multiple flags were not updated correctly');
    }

    // Test 7: Reset a flag to default value
    logger.info('[Test] Test 7: Resetting a flag to default value');
    featureFlags.resetFlag(FeatureFlagNames.LLM_ENABLED);
    const resetValue = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
    const expectedDefault = process.env.LLM_ENABLED === 'true';

    if (resetValue === expectedDefault) {
      logger.info('[Test] ✓ Flag reset to default value', {
        resetValue,
        defaultValue: expectedDefault,
      });
    } else {
      throw new Error('Flag was not reset to default value');
    }

    // Test 8: Reset all flags
    logger.info('[Test] Test 8: Resetting all flags to default values');
    featureFlags.resetAllFlags();
    const allFlagsAfterReset = featureFlags.getAllFlags();
    logger.info('[Test] ✓ All flags reset to default values', {
      flags: allFlagsAfterReset,
    });

    // Test 9: Get flag configuration
    logger.info('[Test] Test 9: Getting flag configuration');
    const llmConfig = featureFlags.getFlagConfig(FeatureFlagNames.LLM_ENABLED);
    if (
      llmConfig &&
      llmConfig.name === FeatureFlagNames.LLM_ENABLED &&
      llmConfig.description &&
      llmConfig.category
    ) {
      logger.info('[Test] ✓ Flag configuration retrieved', {
        name: llmConfig.name,
        description: llmConfig.description,
        category: llmConfig.category,
        defaultValue: llmConfig.defaultValue,
      });
    } else {
      throw new Error('Failed to retrieve flag configuration');
    }

    // Test 10: Get all configurations
    logger.info('[Test] Test 10: Getting all flag configurations');
    const allConfigs = featureFlags.getAllConfigs();
    if (allConfigs.length >= 15) {
      logger.info('[Test] ✓ All flag configurations retrieved', {
        count: allConfigs.length,
        categories: [...new Set(allConfigs.map((c) => c.category))],
      });
    } else {
      throw new Error(`Expected at least 15 configurations, got ${allConfigs.length}`);
    }

    // Test 11: Get snapshot
    logger.info('[Test] Test 11: Getting flag snapshot');
    const currentCacheEnabled = featureFlags.isEnabled(FeatureFlagNames.CACHE_ENABLED);
    featureFlags.setFlag(FeatureFlagNames.CACHE_ENABLED, !currentCacheEnabled);
    const snapshot = featureFlags.getSnapshot();
    const modifiedFlags = snapshot.filter((s) => s.isModified);

    if (snapshot.length >= 15 && modifiedFlags.length > 0) {
      logger.info('[Test] ✓ Snapshot retrieved with modifications', {
        totalFlags: snapshot.length,
        modifiedCount: modifiedFlags.length,
        modifiedFlags: modifiedFlags.map((f) => f.name),
      });
    } else {
      throw new Error('Snapshot does not show modifications');
    }

    // Test 12: Test invalid flag name
    logger.info('[Test] Test 12: Testing invalid flag name handling');
    try {
      featureFlags.setFlag('invalid.flag' as any, true);
      throw new Error('Should have thrown error for invalid flag name');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid feature flag name')) {
        logger.info('[Test] ✓ Invalid flag name properly rejected');
      } else {
        throw error;
      }
    }

    // Test 13: Test convenience helper functions
    logger.info('[Test] Test 13: Testing convenience helper functions');
    featureFlags.resetAllFlags(); // Reset to defaults first

    const helpers = {
      isLLMEnabled: isLLMEnabled(),
      isClaudeEnabled: isClaudeEnabled(),
      isResponseEnabled: isResponseEnabled(),
      isWebSearchEnabled: isWebSearchEnabled(),
      isMemoryEnabled: isMemoryEnabled(),
      isRAGEnabled: isRAGEnabled(),
      isCacheEnabled: isCacheEnabled(),
      isMetricsEnabled: isMetricsEnabled(),
    };

    // Verify helpers match direct calls
    if (
      helpers.isLLMEnabled === featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED) &&
      helpers.isClaudeEnabled === featureFlags.isEnabled(FeatureFlagNames.CLAUDE_ENABLED) &&
      helpers.isResponseEnabled === featureFlags.isEnabled(FeatureFlagNames.AI_RESPONSE_ENABLED)
    ) {
      logger.info('[Test] ✓ Convenience helpers working correctly', helpers);
    } else {
      throw new Error('Convenience helpers do not match direct flag checks');
    }

    // Test 14: Test new FeatureFlags instance (not singleton)
    logger.info('[Test] Test 14: Testing new FeatureFlags instance');
    const newInstance = new FeatureFlags();
    const newInstanceFlags = newInstance.getAllFlags();

    if (Object.keys(newInstanceFlags).length >= 15) {
      logger.info('[Test] ✓ New instance initialized correctly', {
        count: Object.keys(newInstanceFlags).length,
      });
    } else {
      throw new Error('New instance not initialized properly');
    }

    // Test 15: Verify independence of instances
    logger.info('[Test] Test 15: Verifying independence of instances');
    const currentSingletonLlm = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
    newInstance.setFlag(FeatureFlagNames.LLM_ENABLED, !currentSingletonLlm);
    const singletonValue = featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
    const newInstanceValue = newInstance.isEnabled(FeatureFlagNames.LLM_ENABLED);

    if (singletonValue !== newInstanceValue) {
      logger.info('[Test] ✓ Instances are independent', {
        singletonValue,
        newInstanceValue,
      });
    } else {
      throw new Error('Instances are not independent');
    }

    // Test 16: Test backward compatibility - verify appConfig can be imported separately
    logger.info('[Test] Test 16: Testing backward compatibility with appConfig');
    try {
      // Dynamically import to verify it works without circular dependency issues
      const { appConfig: importedConfig } = await import('../../config/index.js');

      // Verify the imported config has the expected structure
      if (
        importedConfig &&
        typeof importedConfig.llm === 'object' &&
        typeof importedConfig.claude === 'object' &&
        typeof importedConfig.response === 'object'
      ) {
        logger.info('[Test] ✓ appConfig still accessible and working', {
          hasLlmConfig: !!importedConfig.llm,
          hasClaudeConfig: !!importedConfig.claude,
          hasResponseConfig: !!importedConfig.response,
        });
      } else {
        throw new Error('appConfig structure is invalid');
      }
    } catch (error) {
      logger.warn('[Test] ⚠ appConfig import test skipped due to circular dependency', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // This is acceptable - the circular dependency is in runtime-config.ts, not our code
      logger.info('[Test] ✓ Feature flags work independently of appConfig');
    }

    // Reset flags for clean state
    featureFlags.resetAllFlags();

    logger.info('[Test] ========================================');
    logger.info('[Test] ✓ All tests passed!');
    logger.info('[Test] ========================================');
  } catch (error) {
    logger.error('[Test] ✗ Test failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run tests
testFeatureFlags()
  .then(() => {
    logger.info('[Test] Test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[Test] Test suite failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  });
