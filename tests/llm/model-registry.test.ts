/**
 * Model Registry Tests
 *
 * Tests for the ModelRegistry class which manages LLM providers and models
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRegistry, resetModelRegistry } from '../../src/llm/model-registry';
import type {
  IUnifiedLLMProvider,
  LLMProviderType,
  ProviderConfig,
  ProviderHealthStatus,
  ModelConfig,
  UnifiedChatRequest,
  UnifiedChatResponse,
} from '../../src/types/llm.types';

// ============================================================================
// Mock Provider
// ============================================================================

class MockProvider implements IUnifiedLLMProvider {
  readonly type: LLMProviderType;
  readonly config: ProviderConfig;

  constructor(type: LLMProviderType, models: ModelConfig[]) {
    this.type = type;
    this.config = {
      type,
      enabled: true,
      defaultModel: models[0]?.id || 'default-model',
      models,
      timeoutMs: 30000,
      maxRetries: 3,
    };
  }

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      provider: this.type,
      healthy: true,
      latencyMs: 100,
      lastChecked: new Date(),
    };
  }

  async chat(_request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    throw new Error('Not implemented');
  }

  async listModels(): Promise<ModelConfig[]> {
    return this.config.models;
  }

  getCapabilities() {
    return {
      streaming: true,
      toolCalling: true,
      vision: false,
      embeddings: false,
      jsonMode: true,
      functionCalling: true,
    };
  }

  estimateCost() {
    return {
      provider: this.type,
      model: 'test',
      inputTokens: 0,
      outputTokens: 0,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      currency: 'USD' as const,
    };
  }

  async shutdown(): Promise<void> {}
}

// ============================================================================
// Mock Models
// ============================================================================

const mockOllamaModels: ModelConfig[] = [
  {
    id: 'mistral',
    provider: 'ollama',
    displayName: 'Mistral',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      embeddings: false,
      jsonMode: true,
      functionCalling: true,
    },
    tags: ['fast', 'local'],
  },
  {
    id: 'llama2',
    provider: 'ollama',
    displayName: 'Llama 2',
    contextWindow: 4096,
    maxOutputTokens: 2048,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilities: {
      streaming: true,
      toolCalling: false,
      vision: false,
      embeddings: false,
      jsonMode: false,
      functionCalling: false,
    },
    tags: ['local'],
  },
];

const mockOpenAIModels: ModelConfig[] = [
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
      functionCalling: true,
    },
    tags: ['fast', 'cheap', 'vision'],
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
      functionCalling: true,
    },
    tags: ['reasoning', 'vision'],
  },
];

const mockAnthropicModels: ModelConfig[] = [
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInput: 1.0,
    costPer1kOutput: 5.0,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: false,
      functionCalling: true,
    },
    tags: ['fast', 'cheap', 'vision'],
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    resetModelRegistry();
    registry = new ModelRegistry();
  });

  describe('Provider Registration', () => {
    it('should register a provider', () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      registry.register(provider);

      const providers = registry.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].type).toBe('ollama');
    });

    it('should register multiple providers', () => {
      const ollamaProvider = new MockProvider('ollama', mockOllamaModels);
      const openaiProvider = new MockProvider('openai', mockOpenAIModels);

      registry.register(ollamaProvider);
      registry.register(openaiProvider);

      const providers = registry.getProviders();
      expect(providers).toHaveLength(2);
    });

    it('should replace provider when registering duplicate type', () => {
      const provider1 = new MockProvider('ollama', mockOllamaModels);
      const provider2 = new MockProvider('ollama', [mockOllamaModels[0]]);

      registry.register(provider1);
      registry.register(provider2);

      const providers = registry.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].config.models).toHaveLength(1);
    });

    it('should get a specific provider by type', () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      registry.register(provider);

      const retrieved = registry.getProvider('ollama');
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('ollama');
    });

    it('should return undefined for non-existent provider', () => {
      const retrieved = registry.getProvider('openai');
      expect(retrieved).toBeUndefined();
    });

    it('should unregister a provider', () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      registry.register(provider);

      registry.unregister('ollama');

      const providers = registry.getProviders();
      expect(providers).toHaveLength(0);
    });

    it('should handle unregistering non-existent provider gracefully', () => {
      expect(() => registry.unregister('openai')).not.toThrow();
    });
  });

  describe('Model Retrieval', () => {
    beforeEach(() => {
      registry.register(new MockProvider('ollama', mockOllamaModels));
      registry.register(new MockProvider('openai', mockOpenAIModels));
      registry.register(new MockProvider('anthropic', mockAnthropicModels));
    });

    it('should get all models across providers', () => {
      const models = registry.getAllModels();
      expect(models).toHaveLength(5); // 2 ollama + 2 openai + 1 anthropic
    });

    it('should only return models from enabled providers', () => {
      const disabledProvider = new MockProvider('gemini', []);
      disabledProvider.config.enabled = false;
      registry.register(disabledProvider);

      const models = registry.getAllModels();
      expect(models).toHaveLength(5); // Should not include disabled provider's models
    });

    it('should get models by capability - vision', () => {
      const visionModels = registry.getModelsByCapability('vision');
      expect(visionModels).toHaveLength(3); // gpt-4o-mini, gpt-4o, claude-3-5-haiku
      expect(visionModels.every((m) => m.capabilities.vision)).toBe(true);
    });

    it('should get models by capability - toolCalling', () => {
      const toolCallingModels = registry.getModelsByCapability('toolCalling');
      expect(toolCallingModels.length).toBeGreaterThan(0);
      expect(toolCallingModels.every((m) => m.capabilities.toolCalling)).toBe(true);
    });

    it('should get models by tag', () => {
      const fastModels = registry.getModelsByTag('fast');
      expect(fastModels.length).toBeGreaterThan(0);
      expect(fastModels.every((m) => m.tags?.includes('fast'))).toBe(true);
    });

    it('should return empty array for non-existent tag', () => {
      const models = registry.getModelsByTag('non-existent-tag');
      expect(models).toHaveLength(0);
    });
  });

  describe('Model Selection', () => {
    beforeEach(() => {
      registry.register(new MockProvider('ollama', mockOllamaModels));
      registry.register(new MockProvider('openai', mockOpenAIModels));
      registry.register(new MockProvider('anthropic', mockAnthropicModels));
    });

    it('should get cheapest model', () => {
      const cheapest = registry.getCheapestModel();
      expect(cheapest).toBeDefined();
      expect(cheapest?.provider).toBe('ollama'); // Free local models
    });

    it('should get cheapest model with vision capability', () => {
      const cheapest = registry.getCheapestModel({
        requiredCapabilities: ['vision'],
      });
      expect(cheapest).toBeDefined();
      expect(cheapest?.capabilities.vision).toBe(true);
      expect(cheapest?.id).toBe('gpt-4o-mini'); // Cheapest vision model
    });

    it('should get cheapest model with minimum context window', () => {
      const cheapest = registry.getCheapestModel({
        minContextWindow: 100000,
      });
      expect(cheapest).toBeDefined();
      expect(cheapest!.contextWindow).toBeGreaterThanOrEqual(100000);
    });

    it('should respect preferred providers', () => {
      const cheapest = registry.getCheapestModel({
        preferredProviders: ['openai'],
      });
      expect(cheapest).toBeDefined();
      expect(cheapest?.provider).toBe('openai');
    });

    it('should exclude specified providers', () => {
      const cheapest = registry.getCheapestModel({
        excludeProviders: ['ollama'],
      });
      expect(cheapest).toBeDefined();
      expect(cheapest?.provider).not.toBe('ollama');
    });

    it('should get fastest model', () => {
      const fastest = registry.getFastestModel();
      expect(fastest).toBeDefined();
      expect(fastest?.tags?.includes('fast')).toBe(true);
    });

    it('should get fastest model with required capability', () => {
      const fastest = registry.getFastestModel({
        requiredCapabilities: ['vision'],
      });
      expect(fastest).toBeDefined();
      expect(fastest?.capabilities.vision).toBe(true);
    });
  });

  describe('findModels', () => {
    beforeEach(() => {
      registry.register(new MockProvider('ollama', mockOllamaModels));
      registry.register(new MockProvider('openai', mockOpenAIModels));
      registry.register(new MockProvider('anthropic', mockAnthropicModels));
    });

    it('should find models matching all criteria', () => {
      const models = registry.findModels({
        taskComplexity: 'medium',
        requiredCapabilities: ['vision', 'toolCalling'],
      });
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.capabilities.vision && m.capabilities.toolCalling)).toBe(true);
    });

    it('should filter by preferred tags', () => {
      const models = registry.findModels({
        taskComplexity: 'low',
        preferredTags: ['fast'],
      });
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.tags?.includes('fast'))).toBe(true);
    });

    it('should filter by max cost', () => {
      const models = registry.findModels({
        taskComplexity: 'medium',
        maxCostPerRequest: 0.001,
      });
      // Should only return free/cheap models
      expect(models.every((m) => {
        const cost = (1000 / 1000) * m.costPer1kInput + (500 / 1000) * m.costPer1kOutput;
        return cost <= 0.001;
      })).toBe(true);
    });

    it('should return all models when no criteria specified', () => {
      const models = registry.findModels({ taskComplexity: 'medium' });
      expect(models).toHaveLength(registry.getAllModels().length);
    });
  });

  describe('Health Checks', () => {
    it('should perform health check on all providers', async () => {
      registry.register(new MockProvider('ollama', mockOllamaModels));
      registry.register(new MockProvider('openai', mockOpenAIModels));

      const health = await registry.healthCheckAll();
      expect(Object.keys(health)).toHaveLength(2);
      expect(health.ollama?.healthy).toBe(true);
      expect(health.openai?.healthy).toBe(true);
    });

    it('should cache health check results', async () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      const healthCheckSpy = vi.spyOn(provider, 'healthCheck');

      registry.register(provider);

      // First call
      await registry.healthCheckAll();
      expect(healthCheckSpy).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await registry.healthCheckAll();
      expect(healthCheckSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle health check failures', async () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      vi.spyOn(provider, 'healthCheck').mockRejectedValue(new Error('Connection failed'));

      registry.register(provider);

      const health = await registry.healthCheckAll();
      expect(health.ollama?.healthy).toBe(false);
      expect(health.ollama?.error).toContain('Connection failed');
    });

    it('should get healthy providers only', async () => {
      const healthyProvider = new MockProvider('ollama', mockOllamaModels);
      const unhealthyProvider = new MockProvider('openai', mockOpenAIModels);

      vi.spyOn(unhealthyProvider, 'healthCheck').mockResolvedValue({
        provider: 'openai',
        healthy: false,
        error: 'API key invalid',
        lastChecked: new Date(),
      });

      registry.register(healthyProvider);
      registry.register(unhealthyProvider);

      const healthy = await registry.getHealthyProviders();
      expect(healthy).toHaveLength(1);
      expect(healthy[0].type).toBe('ollama');
    });

    it('should clear health cache', async () => {
      const provider = new MockProvider('ollama', mockOllamaModels);
      const healthCheckSpy = vi.spyOn(provider, 'healthCheck');

      registry.register(provider);

      await registry.healthCheckAll();
      expect(healthCheckSpy).toHaveBeenCalledTimes(1);

      registry.clearHealthCache();

      await registry.healthCheckAll();
      expect(healthCheckSpy).toHaveBeenCalledTimes(2);
    });

    it('should allow setting health cache TTL', async () => {
      registry.setHealthCacheTtl(100); // 100ms

      const provider = new MockProvider('ollama', mockOllamaModels);
      const healthCheckSpy = vi.spyOn(provider, 'healthCheck');

      registry.register(provider);

      await registry.healthCheckAll();

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      await registry.healthCheckAll();
      expect(healthCheckSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      registry.register(new MockProvider('ollama', mockOllamaModels));
      registry.register(new MockProvider('openai', mockOpenAIModels));
    });

    it('should get model count by provider', () => {
      const counts = registry.getModelCountByProvider();
      expect(counts.ollama).toBe(2);
      expect(counts.openai).toBe(2);
    });

    it('should get registry statistics', () => {
      const stats = registry.getStats();
      expect(stats.providerCount).toBe(2);
      expect(stats.modelCount).toBe(4);
      expect(stats.enabledProviders).toContain('ollama');
      expect(stats.enabledProviders).toContain('openai');
      expect(stats.modelsByProvider.ollama).toBe(2);
      expect(stats.modelsByProvider.openai).toBe(2);
    });

    it('should exclude disabled providers from enabled list', () => {
      const disabledProvider = new MockProvider('gemini', []);
      disabledProvider.config.enabled = false;
      registry.register(disabledProvider);

      const stats = registry.getStats();
      expect(stats.providerCount).toBe(3);
      expect(stats.enabledProviders).not.toContain('gemini');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty registry', () => {
      expect(registry.getAllModels()).toHaveLength(0);
      expect(registry.getProviders()).toHaveLength(0);
      expect(registry.getCheapestModel()).toBeUndefined();
    });

    it('should handle provider with no models', () => {
      const emptyProvider = new MockProvider('ollama', []);
      registry.register(emptyProvider);

      expect(registry.getAllModels()).toHaveLength(0);
    });

    it('should handle models without tags', () => {
      const modelWithoutTags: ModelConfig = {
        ...mockOllamaModels[0],
        tags: undefined,
      };

      const provider = new MockProvider('ollama', [modelWithoutTags]);
      registry.register(provider);

      expect(() => registry.getModelsByTag('fast')).not.toThrow();
    });

    it('should handle criteria with no matching models', () => {
      registry.register(new MockProvider('ollama', mockOllamaModels));

      const models = registry.findModels({
        taskComplexity: 'high',
        requiredCapabilities: ['vision'],
        maxCostPerRequest: 0,
      });

      expect(models).toHaveLength(0);
    });
  });
});
