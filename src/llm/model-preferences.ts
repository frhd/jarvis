/**
 * Model Preferences - User preference integration for model selection
 */

import {
  LLMProviderType,
  ModelConfig,
  ModelSelectionCriteria,
} from '../types/llm.types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ModelPreferences');

/**
 * User model preferences
 */
export interface UserModelPreferences {
  userId: string;

  // Provider preferences
  preferredProviders?: LLMProviderType[];
  excludedProviders?: LLMProviderType[];

  // Model preferences
  preferredModels?: string[];
  excludedModels?: string[];

  // Cost preferences
  maxCostPerRequest?: number;
  preferCheap?: boolean;

  // Quality preferences
  preferQuality?: boolean;
  preferSpeed?: boolean;

  // Feature requirements
  requireVision?: boolean;
  requireToolCalling?: boolean;
  requireStreaming?: boolean;

  // Custom tags
  preferredTags?: string[];
}

/**
 * System-level model configuration
 */
export interface SystemModelConfig {
  // Default provider for different task types
  defaultProviderByTask?: Record<string, LLMProviderType>;

  // Global cost limits
  globalMaxCostPerRequest?: number;
  dailyCostBudget?: number;

  // Fallback order
  fallbackOrder?: LLMProviderType[];

  // Rate limiting
  rateLimitByProvider?: Record<LLMProviderType, number>;
}

/**
 * Model preference manager
 */
export class ModelPreferenceManager {
  private userPreferences = new Map<string, UserModelPreferences>();
  private systemConfig: SystemModelConfig = {};
  private costTracking = new Map<string, { cost: number; date: string }>();

  /**
   * Set user preferences
   */
  setUserPreferences(userId: string, preferences: Partial<UserModelPreferences>): void {
    const existing = this.userPreferences.get(userId) || { userId };
    this.userPreferences.set(userId, { ...existing, ...preferences });
    logger.info(`Updated preferences for user ${userId}`);
  }

  /**
   * Get user preferences
   */
  getUserPreferences(userId: string): UserModelPreferences | undefined {
    return this.userPreferences.get(userId);
  }

  /**
   * Clear user preferences
   */
  clearUserPreferences(userId: string): void {
    this.userPreferences.delete(userId);
    logger.info(`Cleared preferences for user ${userId}`);
  }

  /**
   * Set system configuration
   */
  setSystemConfig(config: SystemModelConfig): void {
    this.systemConfig = { ...this.systemConfig, ...config };
    logger.info('Updated system model configuration');
  }

  /**
   * Get system configuration
   */
  getSystemConfig(): SystemModelConfig {
    return { ...this.systemConfig };
  }

  /**
   * Build selection criteria from user preferences
   */
  buildCriteria(
    userId: string,
    baseCriteria?: Partial<ModelSelectionCriteria>
  ): ModelSelectionCriteria {
    const userPrefs = this.userPreferences.get(userId);

    const criteria: ModelSelectionCriteria = {
      taskComplexity: baseCriteria?.taskComplexity || 'medium',
    };

    // Apply user preferences
    if (userPrefs) {
      // Provider preferences
      if (userPrefs.preferredProviders?.length) {
        criteria.preferredProviders = userPrefs.preferredProviders;
      }
      if (userPrefs.excludedProviders?.length) {
        criteria.excludeProviders = userPrefs.excludedProviders;
      }

      // Cost preferences
      if (userPrefs.maxCostPerRequest) {
        criteria.maxCostPerRequest = userPrefs.maxCostPerRequest;
      } else if (this.systemConfig.globalMaxCostPerRequest) {
        criteria.maxCostPerRequest = this.systemConfig.globalMaxCostPerRequest;
      }

      // Feature requirements
      const requiredCapabilities: (keyof import('../types/llm.types').ProviderCapabilities)[] = [];
      if (userPrefs.requireVision) requiredCapabilities.push('vision');
      if (userPrefs.requireToolCalling) requiredCapabilities.push('toolCalling');
      if (userPrefs.requireStreaming) requiredCapabilities.push('streaming');
      if (requiredCapabilities.length > 0) {
        criteria.requiredCapabilities = requiredCapabilities;
      }

      // Tags
      const tags: string[] = [];
      if (userPrefs.preferCheap) tags.push('cheap');
      if (userPrefs.preferQuality) tags.push('reasoning', 'powerful');
      if (userPrefs.preferSpeed) tags.push('fast');
      if (userPrefs.preferredTags?.length) tags.push(...userPrefs.preferredTags);
      if (tags.length > 0) {
        criteria.preferredTags = [...new Set(tags)];
      }
    }

    // Apply base criteria (overrides user preferences for explicit settings)
    if (baseCriteria) {
      if (baseCriteria.preferredProviders) {
        criteria.preferredProviders = baseCriteria.preferredProviders;
      }
      if (baseCriteria.excludeProviders) {
        criteria.excludeProviders = baseCriteria.excludeProviders;
      }
      if (baseCriteria.maxCostPerRequest !== undefined) {
        criteria.maxCostPerRequest = baseCriteria.maxCostPerRequest;
      }
      if (baseCriteria.maxLatencyMs !== undefined) {
        criteria.maxLatencyMs = baseCriteria.maxLatencyMs;
      }
      if (baseCriteria.requiredCapabilities?.length) {
        criteria.requiredCapabilities = [
          ...(criteria.requiredCapabilities || []),
          ...baseCriteria.requiredCapabilities,
        ];
      }
      if (baseCriteria.preferredTags?.length) {
        criteria.preferredTags = [
          ...(criteria.preferredTags || []),
          ...baseCriteria.preferredTags,
        ];
      }
      if (baseCriteria.minContextWindow) {
        criteria.minContextWindow = baseCriteria.minContextWindow;
      }
    }

    return criteria;
  }

  /**
   * Filter models by user preferences
   */
  filterModels(models: ModelConfig[], userId: string): ModelConfig[] {
    const userPrefs = this.userPreferences.get(userId);
    if (!userPrefs) return models;

    return models.filter((model) => {
      // Check excluded providers
      if (userPrefs.excludedProviders?.includes(model.provider)) {
        return false;
      }

      // Check excluded models
      if (userPrefs.excludedModels?.includes(model.id)) {
        return false;
      }

      // Check feature requirements
      if (userPrefs.requireVision && !model.capabilities.vision) {
        return false;
      }
      if (userPrefs.requireToolCalling && !model.capabilities.toolCalling) {
        return false;
      }
      if (userPrefs.requireStreaming && !model.capabilities.streaming) {
        return false;
      }

      // Check cost limit
      if (userPrefs.maxCostPerRequest) {
        const estimatedCost = (1000 * model.costPer1kInput + 500 * model.costPer1kOutput) / 1000;
        if (estimatedCost > userPrefs.maxCostPerRequest) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Score model based on user preferences
   */
  scoreModel(model: ModelConfig, userId: string): number {
    const userPrefs = this.userPreferences.get(userId);
    let score = 0.5; // Base score

    if (!userPrefs) return score;

    // Preferred provider bonus
    if (userPrefs.preferredProviders?.includes(model.provider)) {
      score += 0.2;
    }

    // Preferred model bonus
    if (userPrefs.preferredModels?.includes(model.id)) {
      score += 0.3;
    }

    // Tag bonuses
    if (model.tags && userPrefs.preferredTags) {
      const matchingTags = model.tags.filter((t) => userPrefs.preferredTags!.includes(t));
      score += matchingTags.length * 0.05;
    }

    // Cost preference
    if (userPrefs.preferCheap) {
      const avgCost = (model.costPer1kInput + model.costPer1kOutput) / 2;
      // Lower cost = higher score
      score += Math.max(0, 0.1 - avgCost);
    }

    // Quality preference
    if (userPrefs.preferQuality && model.tags?.includes('reasoning')) {
      score += 0.15;
    }

    // Speed preference
    if (userPrefs.preferSpeed && model.tags?.includes('fast')) {
      score += 0.15;
    }

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Track cost for daily budget enforcement
   */
  trackCost(userId: string, cost: number): void {
    const today = new Date().toISOString().split('T')[0];
    const existing = this.costTracking.get(userId);

    if (existing && existing.date === today) {
      existing.cost += cost;
    } else {
      this.costTracking.set(userId, { cost, date: today });
    }
  }

  /**
   * Get remaining daily budget
   */
  getRemainingBudget(userId: string): number | null {
    if (!this.systemConfig.dailyCostBudget) return null;

    const today = new Date().toISOString().split('T')[0];
    const tracking = this.costTracking.get(userId);

    if (!tracking || tracking.date !== today) {
      return this.systemConfig.dailyCostBudget;
    }

    return Math.max(0, this.systemConfig.dailyCostBudget - tracking.cost);
  }

  /**
   * Check if user is within budget
   */
  isWithinBudget(userId: string, estimatedCost: number): boolean {
    const remaining = this.getRemainingBudget(userId);
    if (remaining === null) return true;
    return estimatedCost <= remaining;
  }

  /**
   * Get recommended model for user based on preferences
   */
  getRecommendedModel(
    models: ModelConfig[],
    userId: string,
    taskComplexity: 'low' | 'medium' | 'high' = 'medium'
  ): ModelConfig | null {
    // Filter by preferences
    const filtered = this.filterModels(models, userId);
    if (filtered.length === 0) return null;

    // Score each model
    const scored = filtered.map((model) => ({
      model,
      score: this.scoreModel(model, userId),
    }));

    // Adjust score by complexity match
    for (const item of scored) {
      const tags = item.model.tags || [];

      if (taskComplexity === 'high') {
        if (tags.includes('reasoning') || tags.includes('powerful')) {
          item.score += 0.2;
        }
      } else if (taskComplexity === 'low') {
        if (tags.includes('fast') || tags.includes('cheap')) {
          item.score += 0.2;
        }
      }
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.model || null;
  }

  /**
   * Export preferences for backup/debugging
   */
  exportPreferences(): {
    users: Record<string, UserModelPreferences>;
    system: SystemModelConfig;
    costTracking: Record<string, { cost: number; date: string }>;
  } {
    const users: Record<string, UserModelPreferences> = {};
    this.userPreferences.forEach((prefs, userId) => {
      users[userId] = prefs;
    });

    const costTracking: Record<string, { cost: number; date: string }> = {};
    this.costTracking.forEach((tracking, userId) => {
      costTracking[userId] = tracking;
    });

    return {
      users,
      system: this.systemConfig,
      costTracking,
    };
  }

  /**
   * Import preferences from backup
   */
  importPreferences(data: {
    users?: Record<string, UserModelPreferences>;
    system?: SystemModelConfig;
  }): void {
    if (data.users) {
      for (const [userId, prefs] of Object.entries(data.users)) {
        this.userPreferences.set(userId, prefs);
      }
    }
    if (data.system) {
      this.systemConfig = data.system;
    }
    logger.info('Imported model preferences');
  }
}

// Singleton instance
let preferenceManager: ModelPreferenceManager | null = null;

export function getModelPreferenceManager(): ModelPreferenceManager {
  if (!preferenceManager) {
    preferenceManager = new ModelPreferenceManager();
  }
  return preferenceManager;
}

export function resetModelPreferenceManager(): void {
  preferenceManager = null;
}
