/**
 * Model Registry - Central registry for all LLM providers and models
 */

import {
  IModelRegistry,
  IUnifiedLLMProvider,
  LLMProviderType,
  ModelConfig,
  ProviderCapabilities,
  ProviderHealthStatus,
  ModelSelectionCriteria,
} from '../types/llm.types';
import { createLogger } from '../utils/logger';
import { HEALTH_CACHE_TTL_MS, AVG_INPUT_TOKENS, AVG_OUTPUT_TOKENS } from '../config/constants.js';

const logger = createLogger('ModelRegistry');

/**
 * Central registry for managing LLM providers and models
 */
export class ModelRegistry implements IModelRegistry {
  private providers = new Map<LLMProviderType, IUnifiedLLMProvider>();
  private healthCache = new Map<LLMProviderType, { status: ProviderHealthStatus; timestamp: number }>();
  private healthCacheTtlMs = HEALTH_CACHE_TTL_MS;

  /**
   * Register a provider
   */
  register(provider: IUnifiedLLMProvider): void {
    if (this.providers.has(provider.type)) {
      logger.warn(`Provider ${provider.type} already registered, replacing`);
    }
    this.providers.set(provider.type, provider);
    logger.info(`Registered provider: ${provider.type}`);
  }

  /**
   * Unregister a provider
   */
  unregister(type: LLMProviderType): void {
    const provider = this.providers.get(type);
    if (provider) {
      this.providers.delete(type);
      this.healthCache.delete(type);
      logger.info(`Unregistered provider: ${type}`);
    }
  }

  /**
   * Get all registered providers
   */
  getProviders(): IUnifiedLLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get a specific provider
   */
  getProvider(type: LLMProviderType): IUnifiedLLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get all available models across providers
   */
  getAllModels(): ModelConfig[] {
    const models: ModelConfig[] = [];
    for (const provider of this.providers.values()) {
      if (provider.config.enabled) {
        models.push(...provider.config.models);
      }
    }
    return models;
  }

  /**
   * Get models by capability
   */
  getModelsByCapability(capability: keyof ProviderCapabilities): ModelConfig[] {
    return this.getAllModels().filter((model) => model.capabilities[capability]);
  }

  /**
   * Get models by tag
   */
  getModelsByTag(tag: string): ModelConfig[] {
    return this.getAllModels().filter((model) => model.tags?.includes(tag));
  }

  /**
   * Get cheapest model for given criteria
   */
  getCheapestModel(criteria?: Partial<ModelSelectionCriteria>): ModelConfig | undefined {
    let models = this.getAllModels();

    // Apply filters
    if (criteria?.requiredCapabilities) {
      models = models.filter((model) =>
        criteria.requiredCapabilities!.every((cap) => model.capabilities[cap])
      );
    }

    if (criteria?.preferredProviders?.length) {
      const preferred = models.filter((model) => criteria.preferredProviders!.includes(model.provider));
      if (preferred.length > 0) {
        models = preferred;
      }
    }

    if (criteria?.excludeProviders?.length) {
      models = models.filter((model) => !criteria.excludeProviders!.includes(model.provider));
    }

    if (criteria?.minContextWindow) {
      models = models.filter((model) => model.contextWindow >= criteria.minContextWindow!);
    }

    // Sort by average cost (input + output)
    models.sort((a, b) => {
      const avgCostA = (a.costPer1kInput + a.costPer1kOutput) / 2;
      const avgCostB = (b.costPer1kInput + b.costPer1kOutput) / 2;
      return avgCostA - avgCostB;
    });

    return models[0];
  }

  /**
   * Get fastest model for given criteria (approximated by context window and cost)
   */
  getFastestModel(criteria?: Partial<ModelSelectionCriteria>): ModelConfig | undefined {
    let models = this.getAllModels();

    // Apply filters
    if (criteria?.requiredCapabilities) {
      models = models.filter((model) =>
        criteria.requiredCapabilities!.every((cap) => model.capabilities[cap])
      );
    }

    if (criteria?.preferredProviders?.length) {
      const preferred = models.filter((model) => criteria.preferredProviders!.includes(model.provider));
      if (preferred.length > 0) {
        models = preferred;
      }
    }

    if (criteria?.excludeProviders?.length) {
      models = models.filter((model) => !criteria.excludeProviders!.includes(model.provider));
    }

    // Prefer models tagged as 'fast'
    const fastModels = models.filter((model) => model.tags?.includes('fast'));
    if (fastModels.length > 0) {
      return fastModels[0];
    }

    // Otherwise return first available
    return models[0];
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<Record<LLMProviderType, ProviderHealthStatus>> {
    const results: Record<string, ProviderHealthStatus> = {};
    const now = Date.now();

    const checks = Array.from(this.providers.entries()).map(async ([type, provider]) => {
      // Check cache first
      const cached = this.healthCache.get(type);
      if (cached && now - cached.timestamp < this.healthCacheTtlMs) {
        results[type] = cached.status;
        return;
      }

      try {
        const status = await provider.healthCheck();
        results[type] = status;
        this.healthCache.set(type, { status, timestamp: now });
      } catch (error) {
        const status: ProviderHealthStatus = {
          provider: type,
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date(),
        };
        results[type] = status;
        this.healthCache.set(type, { status, timestamp: now });
      }
    });

    await Promise.all(checks);
    return results as Record<LLMProviderType, ProviderHealthStatus>;
  }

  /**
   * Get healthy providers only
   */
  async getHealthyProviders(): Promise<IUnifiedLLMProvider[]> {
    const health = await this.healthCheckAll();
    return this.getProviders().filter((p) => health[p.type]?.healthy);
  }

  /**
   * Find models matching criteria
   */
  findModels(criteria: ModelSelectionCriteria): ModelConfig[] {
    let models = this.getAllModels();

    // Filter by capabilities
    if (criteria.requiredCapabilities?.length) {
      models = models.filter((model) =>
        criteria.requiredCapabilities!.every((cap) => model.capabilities[cap])
      );
    }

    // Filter by providers
    if (criteria.preferredProviders?.length) {
      const preferred = models.filter((m) => criteria.preferredProviders!.includes(m.provider));
      if (preferred.length > 0) {
        models = preferred;
      }
    }

    if (criteria.excludeProviders?.length) {
      models = models.filter((m) => !criteria.excludeProviders!.includes(m.provider));
    }

    // Filter by context window
    if (criteria.minContextWindow) {
      models = models.filter((m) => m.contextWindow >= criteria.minContextWindow!);
    }

    // Filter by max cost
    if (criteria.maxCostPerRequest !== undefined) {
      // Estimate cost based on average tokens
      models = models.filter((m) => {
        const cost =
          (AVG_INPUT_TOKENS / 1000) * m.costPer1kInput +
          (AVG_OUTPUT_TOKENS / 1000) * m.costPer1kOutput;
        return cost <= criteria.maxCostPerRequest!;
      });
    }

    // Filter by tags
    if (criteria.preferredTags?.length) {
      const tagged = models.filter((m) => criteria.preferredTags!.some((t) => m.tags?.includes(t)));
      if (tagged.length > 0) {
        models = tagged;
      }
    }

    return models;
  }

  /**
   * Get model count by provider
   */
  getModelCountByProvider(): Record<LLMProviderType, number> {
    const counts: Record<string, number> = {};
    for (const [type, provider] of this.providers) {
      counts[type] = provider.config.models.length;
    }
    return counts as Record<LLMProviderType, number>;
  }

  /**
   * Clear health cache
   */
  clearHealthCache(): void {
    this.healthCache.clear();
    logger.debug('Health cache cleared');
  }

  /**
   * Set health cache TTL
   */
  setHealthCacheTtl(ttlMs: number): void {
    this.healthCacheTtlMs = ttlMs;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    providerCount: number;
    modelCount: number;
    enabledProviders: LLMProviderType[];
    modelsByProvider: Record<LLMProviderType, number>;
  } {
    const enabledProviders: LLMProviderType[] = [];
    const modelsByProvider: Record<string, number> = {};

    for (const [type, provider] of this.providers) {
      if (provider.config.enabled) {
        enabledProviders.push(type);
      }
      modelsByProvider[type] = provider.config.models.length;
    }

    return {
      providerCount: this.providers.size,
      modelCount: this.getAllModels().length,
      enabledProviders,
      modelsByProvider: modelsByProvider as Record<LLMProviderType, number>,
    };
  }
}

// Singleton instance
let registryInstance: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!registryInstance) {
    registryInstance = new ModelRegistry();
  }
  return registryInstance;
}

export function resetModelRegistry(): void {
  registryInstance = null;
}
