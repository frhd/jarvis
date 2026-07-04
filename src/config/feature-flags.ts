/**
 * Centralized Feature Flag System
 *
 * This module provides a type-safe, centralized way to manage feature flags
 * across the Jarvis application. It supports runtime updates (in-memory only)
 * and maintains backward compatibility with the existing appConfig.
 *
 * Usage:
 *   import { featureFlags } from './config/feature-flags';
 *
 *   if (featureFlags.isEnabled('llm.enabled')) {
 *     // Feature is enabled
 *   }
 *
 *   // Get all flags
 *   const allFlags = featureFlags.getAllFlags();
 *
 *   // Update a flag at runtime (in-memory only)
 *   featureFlags.setFlag('llm.enabled', false);
 */

/**
 * Feature flag names - type-safe enum of all available flags
 */
export const FeatureFlagNames = {
  // LLM flags
  LLM_ENABLED: 'llm.enabled',
  LLM_SKIP_ON_UNHEALTHY: 'llm.skipOnUnhealthy',

  // AI Response flags
  AI_RESPONSE_ENABLED: 'aiResponse.enabled',
  AI_RESPONSE_TYPING_INDICATOR: 'aiResponse.typingIndicator',

  // Web Search flags
  WEB_SEARCH_ENABLED: 'webSearch.enabled',

  // Tools flags
  TOOLS_ENABLED: 'tools.enabled',

  // Claude flags
  CLAUDE_ENABLED: 'claude.enabled',

  // Intent Classification flags
  INTENT_ENABLED: 'intent.enabled',

  // Embedding flags
  EMBEDDING_ENABLED: 'embedding.enabled',

  // Memory flags
  MEMORY_ENABLED: 'memory.enabled',

  // RAG flags
  RAG_ENABLED: 'rag.enabled',

  // Cache flags
  CACHE_ENABLED: 'cache.enabled',

  // Metrics flags
  METRICS_ENABLED: 'metrics.enabled',

  // Alerting flags
  ALERTING_ENABLED: 'alerting.enabled',

  // Priority Escalation flags
  PRIORITY_ESCALATION_ENABLED: 'priorityEscalation.enabled',

  // Transcription flags
  TRANSCRIPTION_ENABLED: 'transcription.enabled',

  // Security flags
  SECURITY_ENABLED: 'security.enabled',
  ENCRYPTION_ENABLED: 'security.encryption',
  PII_DETECTION_ENABLED: 'security.piiDetection',
  PII_REDACTION_ENABLED: 'security.piiRedaction',
  AUDIT_ENABLED: 'security.audit',
  GDPR_ENABLED: 'security.gdpr',

  // Therapist/Listener Mode flags
  THERAPIST_ENABLED: 'therapist.enabled',
  THERAPIST_AUTO_DETECT: 'therapist.autoDetect',
  THERAPIST_REQUIRES_CONSENT: 'therapist.requiresConsent',
  THERAPIST_EMOTIONAL_ANALYSIS: 'therapist.emotionalAnalysis',

  // Browser flags
  BROWSER_ENABLED: 'browser.enabled',
  BROWSER_MCP_ENABLED: 'browser.mcpEnabled',
} as const;

/**
 * Type for feature flag names
 */
export type FeatureFlagName = (typeof FeatureFlagNames)[keyof typeof FeatureFlagNames];

/**
 * Feature flag configuration
 */
export interface FeatureFlagConfig {
  name: FeatureFlagName;
  defaultValue: boolean;
  description: string;
  category: string;
}

/**
 * All feature flag configurations with metadata
 * Reads default values directly from environment variables to avoid circular dependencies
 */
const featureFlagConfigs: FeatureFlagConfig[] = [
  // LLM flags
  {
    name: FeatureFlagNames.LLM_ENABLED,
    defaultValue: process.env.LLM_ENABLED === 'true',
    description: 'Enable/disable LLM integration (Ollama)',
    category: 'LLM',
  },
  {
    name: FeatureFlagNames.LLM_SKIP_ON_UNHEALTHY,
    defaultValue: process.env.LLM_SKIP_ON_UNHEALTHY !== 'false',
    description: 'Skip LLM processing when service is unhealthy',
    category: 'LLM',
  },

  // AI Response flags
  {
    name: FeatureFlagNames.AI_RESPONSE_ENABLED,
    defaultValue: process.env.RESPONSE_ENABLED === 'true',
    description: 'Enable/disable AI auto-responses in private chats',
    category: 'AI Response',
  },
  {
    name: FeatureFlagNames.AI_RESPONSE_TYPING_INDICATOR,
    defaultValue: process.env.RESPONSE_TYPING_INDICATOR !== 'false',
    description: 'Show typing indicator while generating response',
    category: 'AI Response',
  },

  // Web Search flags
  {
    name: FeatureFlagNames.WEB_SEARCH_ENABLED,
    defaultValue: process.env.SEARCH_ENABLED !== 'false',
    description: 'Enable/disable web search capability',
    category: 'Tools',
  },

  // Tools flags
  {
    name: FeatureFlagNames.TOOLS_ENABLED,
    defaultValue: process.env.TOOLS_ENABLED !== 'false',
    description: 'Enable/disable tool usage',
    category: 'Tools',
  },

  // Claude flags
  {
    name: FeatureFlagNames.CLAUDE_ENABLED,
    defaultValue: process.env.CLAUDE_ENABLED === 'true',
    description: 'Enable/disable Claude Code CLI integration',
    category: 'LLM',
  },

  // Intent Classification flags
  {
    name: FeatureFlagNames.INTENT_ENABLED,
    defaultValue: process.env.INTENT_CLASSIFICATION_ENABLED !== 'false',
    description: 'Enable/disable intent classification',
    category: 'LLM',
  },

  // Embedding flags
  {
    name: FeatureFlagNames.EMBEDDING_ENABLED,
    defaultValue: process.env.EMBEDDING_ENABLED === 'true',
    description: 'Enable/disable semantic embeddings',
    category: 'Memory',
  },

  // Memory flags
  {
    name: FeatureFlagNames.MEMORY_ENABLED,
    defaultValue: process.env.MEMORY_ENABLED === 'true',
    description: 'Enable/disable long-term memory system',
    category: 'Memory',
  },

  // RAG flags
  {
    name: FeatureFlagNames.RAG_ENABLED,
    defaultValue: process.env.RAG_ENABLED === 'true',
    description: 'Enable/disable Retrieval-Augmented Generation',
    category: 'Memory',
  },

  // Cache flags
  {
    name: FeatureFlagNames.CACHE_ENABLED,
    defaultValue: process.env.CACHE_ENABLED === 'true',
    description: 'Enable/disable semantic caching',
    category: 'Performance',
  },

  // Metrics flags
  {
    name: FeatureFlagNames.METRICS_ENABLED,
    defaultValue: process.env.METRICS_ENABLED !== 'false',
    description: 'Enable/disable metrics collection',
    category: 'Monitoring',
  },

  // Alerting flags
  {
    name: FeatureFlagNames.ALERTING_ENABLED,
    defaultValue: process.env.ALERTING_ENABLED !== 'false',
    description: 'Enable/disable alerting system',
    category: 'Monitoring',
  },

  // Priority Escalation flags
  {
    name: FeatureFlagNames.PRIORITY_ESCALATION_ENABLED,
    defaultValue: process.env.PRIORITY_ESCALATION_ENABLED !== 'false',
    description: 'Enable/disable priority escalation for aged messages',
    category: 'Queue',
  },

  // Transcription flags
  {
    name: FeatureFlagNames.TRANSCRIPTION_ENABLED,
    defaultValue: process.env.WHISPER_ENABLED === 'true',
    description: 'Enable/disable voice message transcription',
    category: 'Voice',
  },

  // Security flags
  {
    name: FeatureFlagNames.SECURITY_ENABLED,
    defaultValue: process.env.SECURITY_ENABLED !== 'false',
    description: 'Enable/disable security features',
    category: 'Security',
  },
  {
    name: FeatureFlagNames.ENCRYPTION_ENABLED,
    defaultValue: process.env.ENCRYPTION_ENABLED === 'true',
    description: 'Enable/disable data encryption at rest',
    category: 'Security',
  },
  {
    name: FeatureFlagNames.PII_DETECTION_ENABLED,
    defaultValue: process.env.PII_DETECTION_ENABLED !== 'false',
    description: 'Enable/disable PII (Personally Identifiable Information) detection',
    category: 'Security',
  },
  {
    name: FeatureFlagNames.PII_REDACTION_ENABLED,
    defaultValue: process.env.PII_REDACTION_ENABLED !== 'false',
    description: 'Enable/disable PII redaction in logs and storage',
    category: 'Security',
  },
  {
    name: FeatureFlagNames.AUDIT_ENABLED,
    defaultValue: process.env.SECURITY_AUDIT_ENABLED !== 'false',
    description: 'Enable/disable security audit logging',
    category: 'Security',
  },
  {
    name: FeatureFlagNames.GDPR_ENABLED,
    defaultValue: process.env.GDPR_ENABLED !== 'false',
    description: 'Enable/disable GDPR compliance features (data export, deletion)',
    category: 'Security',
  },

  // Therapist/Listener Mode flags
  {
    name: FeatureFlagNames.THERAPIST_ENABLED,
    defaultValue: process.env.THERAPIST_ENABLED === 'true',
    description: 'Enable/disable therapist/listener mode for 2-person group chats',
    category: 'Therapist',
  },
  {
    name: FeatureFlagNames.THERAPIST_AUTO_DETECT,
    defaultValue: process.env.THERAPIST_AUTO_DETECT !== 'false',
    description: 'Automatically detect 2-person groups (dyads)',
    category: 'Therapist',
  },
  {
    name: FeatureFlagNames.THERAPIST_REQUIRES_CONSENT,
    defaultValue: process.env.THERAPIST_REQUIRES_CONSENT !== 'false',
    description: 'Require opt-in consent from both participants',
    category: 'Therapist',
  },
  {
    name: FeatureFlagNames.THERAPIST_EMOTIONAL_ANALYSIS,
    defaultValue: process.env.THERAPIST_EMOTIONAL_ANALYSIS !== 'false',
    description: 'Enable emotional pattern tracking for participants',
    category: 'Therapist',
  },

  // Browser flags
  {
    name: FeatureFlagNames.BROWSER_ENABLED,
    defaultValue: process.env.BROWSER_ENABLED === 'true',
    description: 'Enable/disable Playwright browser for content extraction',
    category: 'Tools',
  },
  {
    name: FeatureFlagNames.BROWSER_MCP_ENABLED,
    defaultValue: process.env.BROWSER_MCP_ENABLED === 'true',
    description: 'Enable/disable Playwright MCP server for agentic browser tools',
    category: 'Tools',
  },
];

/**
 * FeatureFlags class - centralized feature flag management
 */
export class FeatureFlags {
  private flags: Map<FeatureFlagName, boolean>;
  private configs: Map<FeatureFlagName, FeatureFlagConfig>;

  constructor() {
    this.flags = new Map();
    this.configs = new Map();

    // Initialize flags with default values from appConfig
    for (const config of featureFlagConfigs) {
      this.flags.set(config.name, config.defaultValue);
      this.configs.set(config.name, config);
    }
  }

  /**
   * Check if a feature flag is enabled
   *
   * @param flagName - The name of the feature flag
   * @returns true if the flag is enabled, false otherwise
   */
  isEnabled(flagName: FeatureFlagName): boolean {
    return this.flags.get(flagName) ?? false;
  }

  /**
   * Get all feature flags and their current values
   *
   * @returns Object mapping flag names to their values
   */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    const entries = Array.from(this.flags.entries());
    for (const [name, value] of entries) {
      result[name] = value;
    }
    return result;
  }

  /**
   * Get all feature flags organized by category
   *
   * @returns Object mapping categories to their flags
   */
  getFlagsByCategory(): Record<string, Record<string, boolean>> {
    const result: Record<string, Record<string, boolean>> = {};
    const entries = Array.from(this.flags.entries());

    for (const [name, value] of entries) {
      const config = this.configs.get(name);
      if (config) {
        if (!result[config.category]) {
          result[config.category] = {};
        }
        result[config.category][name] = value;
      }
    }

    return result;
  }

  /**
   * Get metadata for a specific flag
   *
   * @param flagName - The name of the feature flag
   * @returns Configuration object or undefined if not found
   */
  getFlagConfig(flagName: FeatureFlagName): FeatureFlagConfig | undefined {
    return this.configs.get(flagName);
  }

  /**
   * Get all flag configurations
   *
   * @returns Array of all feature flag configurations
   */
  getAllConfigs(): FeatureFlagConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Set a feature flag value at runtime (in-memory only, not persisted)
   *
   * @param flagName - The name of the feature flag
   * @param value - The new value for the flag
   * @throws Error if the flag name is invalid
   */
  setFlag(flagName: FeatureFlagName, value: boolean): void {
    if (!this.flags.has(flagName)) {
      throw new Error(`Invalid feature flag name: ${flagName}`);
    }
    this.flags.set(flagName, value);
  }

  /**
   * Set multiple feature flags at once
   *
   * @param flags - Object mapping flag names to their new values
   * @throws Error if any flag name is invalid
   */
  setFlags(flags: Partial<Record<FeatureFlagName, boolean>>): void {
    for (const [name, value] of Object.entries(flags)) {
      if (value !== undefined) {
        this.setFlag(name as FeatureFlagName, value);
      }
    }
  }

  /**
   * Reset a flag to its default value from appConfig
   *
   * @param flagName - The name of the feature flag
   * @throws Error if the flag name is invalid
   */
  resetFlag(flagName: FeatureFlagName): void {
    const config = this.configs.get(flagName);
    if (!config) {
      throw new Error(`Invalid feature flag name: ${flagName}`);
    }
    this.flags.set(flagName, config.defaultValue);
  }

  /**
   * Reset all flags to their default values from appConfig
   */
  resetAllFlags(): void {
    const configs = Array.from(this.configs.values());
    for (const config of configs) {
      this.flags.set(config.name, config.defaultValue);
    }
  }

  /**
   * Get the current state of all flags as a snapshot
   * Useful for debugging or logging
   *
   * @returns Object with flag names, values, and metadata
   */
  getSnapshot(): Array<{
    name: string;
    value: boolean;
    defaultValue: boolean;
    description: string;
    category: string;
    isModified: boolean;
  }> {
    const snapshot: Array<{
      name: string;
      value: boolean;
      defaultValue: boolean;
      description: string;
      category: string;
      isModified: boolean;
    }> = [];

    const entries = Array.from(this.flags.entries());
    for (const [name, value] of entries) {
      const config = this.configs.get(name);
      if (config) {
        snapshot.push({
          name,
          value,
          defaultValue: config.defaultValue,
          description: config.description,
          category: config.category,
          isModified: value !== config.defaultValue,
        });
      }
    }

    return snapshot;
  }
}

/**
 * Singleton instance of FeatureFlags
 * Import and use this throughout the codebase
 */
export const featureFlags = new FeatureFlags();

/**
 * Convenience helper functions for common feature checks
 */
export const isLLMEnabled = (): boolean => featureFlags.isEnabled(FeatureFlagNames.LLM_ENABLED);
export const isClaudeEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.CLAUDE_ENABLED);
export const isResponseEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.AI_RESPONSE_ENABLED);
export const isWebSearchEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.WEB_SEARCH_ENABLED);
export const isMemoryEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.MEMORY_ENABLED);
export const isRAGEnabled = (): boolean => featureFlags.isEnabled(FeatureFlagNames.RAG_ENABLED);
export const isCacheEnabled = (): boolean => featureFlags.isEnabled(FeatureFlagNames.CACHE_ENABLED);
export const isMetricsEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.METRICS_ENABLED);
export const isSecurityEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.SECURITY_ENABLED);
export const isEncryptionEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.ENCRYPTION_ENABLED);
export const isPiiDetectionEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.PII_DETECTION_ENABLED);
export const isPiiRedactionEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.PII_REDACTION_ENABLED);
export const isAuditEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.AUDIT_ENABLED);
export const isGdprEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.GDPR_ENABLED);
export const isTranscriptionEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.TRANSCRIPTION_ENABLED);
export const isTherapistEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.THERAPIST_ENABLED);
export const isTherapistAutoDetectEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.THERAPIST_AUTO_DETECT);
export const isTherapistConsentRequired = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.THERAPIST_REQUIRES_CONSENT);
export const isTherapistEmotionalAnalysisEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.THERAPIST_EMOTIONAL_ANALYSIS);
export const isBrowserEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.BROWSER_ENABLED);
export const isBrowserMCPEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.BROWSER_MCP_ENABLED);
