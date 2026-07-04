/**
 * Model Router - Intelligent routing between LLM providers
 */

import {
  IModelRouter,
  IUnifiedLLMProvider,
  LLMProviderType,
  ModelConfig,
  ModelSelectionCriteria,
  ModelSelectionResult,
  ComplexityAnalysis,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  ProviderHealthStatus,
  ProviderError,
  FallbackConfig,
} from '../types/llm.types';
import { ModelRegistry } from './model-registry';
import { CHARS_PER_TOKEN } from '../constants/index.js';
import { createLogger } from '../utils/logger';

const logger = createLogger('ModelRouter');

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  primary: { provider: 'ollama', model: 'mistral' },
  fallbacks: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
    { provider: 'gemini', model: 'gemini-2.0-flash' },
  ],
  maxAttempts: 3,
};

const COMPLEXITY_WEIGHTS = {
  tokenCount: 0.2,
  multipleTurns: 0.15,
  reasoning: 0.25,
  codeGeneration: 0.2,
  webSearch: 0.1,
  images: 0.1,
};

const REASONING_KEYWORDS = [
  'explain', 'analyze', 'compare', 'evaluate', 'why', 'how does', 'what if',
  'consider', 'think through', 'step by step', 'reason', 'logic', 'argument',
  'proof', 'derive', 'deduce', 'infer',
];

const CODE_KEYWORDS = [
  'code', 'function', 'class', 'implement', 'programming', 'script', 'algorithm',
  'debug', 'fix the bug', 'refactor', 'write a', 'create a', 'build', 'develop',
  'typescript', 'javascript', 'python', 'rust', 'golang',
];

const WEB_SEARCH_KEYWORDS = [
  'latest', 'current', 'recent', 'news', 'today', 'update', 'search for',
  'look up', 'find information', 'what is happening', "what's happening",
  "what's going on", 'whats going on', 'whats happening', 'headlines',
  'breaking', '2024', '2025', '2026',
];

export class ModelRouter implements IModelRouter {
  private registry: ModelRegistry;
  private fallbackConfig: FallbackConfig;
  private providerStatus = new Map<LLMProviderType, ProviderHealthStatus>();

  constructor(registry: ModelRegistry, fallbackConfig?: FallbackConfig) {
    this.registry = registry;
    this.fallbackConfig = fallbackConfig || DEFAULT_FALLBACK_CONFIG;
  }

  async selectModel(
    request: UnifiedChatRequest,
    criteria?: ModelSelectionCriteria
  ): Promise<ModelSelectionResult> {
    const complexity = this.analyzeComplexity(request.messages);
    const effectiveCriteria = this.buildEffectiveCriteria(criteria, complexity);

    const candidates = this.registry.findModels(effectiveCriteria);

    if (candidates.length === 0) {
      const allModels = this.registry.getAllModels();
      if (allModels.length === 0) {
        throw new Error('No models available');
      }
      return {
        model: allModels[0],
        provider: allModels[0].provider,
        score: 0,
        reasoning: ['No models matched criteria, using fallback'],
        alternatives: [],
      };
    }

    const scored = await this.scoreModels(candidates, request, effectiveCriteria, complexity);
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const alternatives = scored.slice(1, 4);

    logger.debug(`Selected model: ${best.model.id} (score: ${best.score.toFixed(2)})`);

    return {
      model: best.model,
      provider: best.model.provider,
      score: best.score,
      reasoning: best.reasoning,
      alternatives: alternatives.map((a) => ({
        model: a.model,
        provider: a.model.provider,
        score: a.score,
      })),
    };
  }

  analyzeComplexity(messages: UnifiedMessage[]): ComplexityAnalysis {
    let totalTokens = 0;
    let hasImages = false;
    let requiresReasoning = false;
    let requiresCodeGeneration = false;
    let requiresWebSearch = false;

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalTokens += this.estimateTokens(msg.content);
        const lowerContent = msg.content.toLowerCase();

        if (REASONING_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
          requiresReasoning = true;
        }

        if (CODE_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
          requiresCodeGeneration = true;
        }

        if (WEB_SEARCH_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
          requiresWebSearch = true;
        }
      } else {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            totalTokens += this.estimateTokens(part.text);
          } else if (part.type === 'image_url') {
            hasImages = true;
            totalTokens += 1000;
          }
        }
      }
    }

    const hasMultipleTurns = messages.length > 2;

    let score = 0;

    const tokenFactor = Math.min(totalTokens / 4000, 1);
    score += tokenFactor * COMPLEXITY_WEIGHTS.tokenCount;

    if (hasMultipleTurns) {
      score += COMPLEXITY_WEIGHTS.multipleTurns;
    }

    if (requiresReasoning) {
      score += COMPLEXITY_WEIGHTS.reasoning;
    }

    if (requiresCodeGeneration) {
      score += COMPLEXITY_WEIGHTS.codeGeneration;
    }

    if (requiresWebSearch) {
      score += COMPLEXITY_WEIGHTS.webSearch;
    }

    if (hasImages) {
      score += COMPLEXITY_WEIGHTS.images;
    }

    const estimatedOutputTokens = requiresCodeGeneration
      ? 2000
      : requiresReasoning
        ? 1500
        : hasMultipleTurns
          ? 1000
          : 500;

    let level: 'low' | 'medium' | 'high';
    if (score < 0.3) {
      level = 'low';
    } else if (score < 0.6) {
      level = 'medium';
    } else {
      level = 'high';
    }

    return {
      score,
      level,
      factors: {
        tokenCount: totalTokens,
        hasMultipleTurns,
        requiresReasoning,
        requiresCodeGeneration,
        requiresWebSearch,
        hasImages,
        estimatedOutputTokens,
      },
    };
  }

  async route(
    request: UnifiedChatRequest,
    criteria?: ModelSelectionCriteria
  ): Promise<UnifiedChatResponse> {
    const selection = await this.selectModel(request, criteria);
    const attempts: Array<{ provider: LLMProviderType; model: string; error: ProviderError }> = [];

    try {
      const response = await this.executeRequest(selection.provider, selection.model.id, request);
      return response;
    } catch (error) {
      const providerError = this.toProviderError(selection.provider, selection.model.id, error);
      attempts.push({ provider: selection.provider, model: selection.model.id, error: providerError });
      logger.warn(`Primary model failed: ${selection.model.id}`, { error: providerError.message });
    }

    for (const alt of selection.alternatives) {
      if (attempts.length >= this.fallbackConfig.maxAttempts) {
        break;
      }

      try {
        const response = await this.executeRequest(alt.provider, alt.model.id, request);
        logger.info(`Fallback succeeded: ${alt.model.id}`);
        return response;
      } catch (error) {
        const providerError = this.toProviderError(alt.provider, alt.model.id, error);
        attempts.push({ provider: alt.provider, model: alt.model.id, error: providerError });
        logger.warn(`Fallback model failed: ${alt.model.id}`, { error: providerError.message });
      }
    }

    for (const fallback of this.fallbackConfig.fallbacks) {
      if (attempts.length >= this.fallbackConfig.maxAttempts) {
        break;
      }

      if (attempts.some((a) => a.provider === fallback.provider && a.model === fallback.model)) {
        continue;
      }

      try {
        const response = await this.executeRequest(fallback.provider, fallback.model, request);
        logger.info(`Configured fallback succeeded: ${fallback.model}`);
        return response;
      } catch (error) {
        const providerError = this.toProviderError(fallback.provider, fallback.model, error);
        attempts.push({ provider: fallback.provider, model: fallback.model, error: providerError });
        logger.warn(`Configured fallback failed: ${fallback.model}`, { error: providerError.message });
      }
    }

    const errorMessages = attempts.map((a) => `${a.provider}/${a.model}: ${a.error.message}`);
    throw new Error(`All ${attempts.length} model attempts failed:\n${errorMessages.join('\n')}`);
  }

  async getProviderStatus(): Promise<Record<LLMProviderType, ProviderHealthStatus>> {
    const health = await this.registry.healthCheckAll();
    for (const [type, status] of Object.entries(health)) {
      this.providerStatus.set(type as LLMProviderType, status);
    }
    return health;
  }

  registerProvider(provider: IUnifiedLLMProvider): void {
    this.registry.register(provider);
  }

  unregisterProvider(type: LLMProviderType): void {
    this.registry.unregister(type);
    this.providerStatus.delete(type);
  }

  setFallbackConfig(config: FallbackConfig): void {
    this.fallbackConfig = config;
  }

  getFallbackConfig(): FallbackConfig {
    return this.fallbackConfig;
  }

  private buildEffectiveCriteria(
    criteria: ModelSelectionCriteria | undefined,
    complexity: ComplexityAnalysis
  ): ModelSelectionCriteria {
    const effective: ModelSelectionCriteria = {
      taskComplexity: complexity.level,
      ...criteria,
    };

    const requiredCapabilities: (keyof import('../types/llm.types').ProviderCapabilities)[] = [];

    if (complexity.factors.hasImages) {
      requiredCapabilities.push('vision');
    }

    if (effective.requiredCapabilities) {
      effective.requiredCapabilities = [...requiredCapabilities, ...effective.requiredCapabilities];
    } else if (requiredCapabilities.length > 0) {
      effective.requiredCapabilities = requiredCapabilities;
    }

    const preferredTags: string[] = [];

    if (complexity.level === 'high') {
      preferredTags.push('reasoning', 'powerful');
    } else if (complexity.level === 'low') {
      preferredTags.push('fast', 'cheap');
    }

    if (complexity.factors.requiresCodeGeneration) {
      preferredTags.push('coding');
    }

    if (effective.preferredTags) {
      effective.preferredTags = [...preferredTags, ...effective.preferredTags];
    } else if (preferredTags.length > 0) {
      effective.preferredTags = preferredTags;
    }

    if (!effective.minContextWindow) {
      const requiredContext =
        complexity.factors.tokenCount + complexity.factors.estimatedOutputTokens;
      effective.minContextWindow = Math.ceil(requiredContext * 1.5);
    }

    return effective;
  }

  private async scoreModels(
    models: ModelConfig[],
    request: UnifiedChatRequest,
    criteria: ModelSelectionCriteria,
    complexity: ComplexityAnalysis
  ): Promise<Array<{ model: ModelConfig; score: number; reasoning: string[] }>> {
    const healthStatus = await this.getProviderStatus();

    return models.map((model) => {
      let score = 0;
      const reasoning: string[] = [];

      const health = healthStatus[model.provider];
      if (health?.healthy) {
        score += 0.3;
        reasoning.push('Provider healthy');
      } else {
        score -= 0.5;
        reasoning.push('Provider unhealthy');
      }

      if (criteria.requiredCapabilities) {
        const matches = criteria.requiredCapabilities.filter((cap) => model.capabilities[cap]);
        const matchRatio = matches.length / criteria.requiredCapabilities.length;
        score += matchRatio * 0.2;
        if (matchRatio === 1) {
          reasoning.push('All capabilities matched');
        }
      }

      if (criteria.preferredTags && model.tags) {
        const matches = criteria.preferredTags.filter((tag) => model.tags!.includes(tag));
        score += matches.length * 0.1;
        if (matches.length > 0) {
          reasoning.push(`Matched tags: ${matches.join(', ')}`);
        }
      }

      if (complexity.level === 'low') {
        const avgCost = (model.costPer1kInput + model.costPer1kOutput) / 2;
        const costScore = Math.max(-0.2, Math.min(0.2, (0.01 - avgCost) * 10));
        score += costScore;
        if (costScore > 0) {
          reasoning.push('Cost-effective for simple task');
        }
      }

      const requiredContext =
        complexity.factors.tokenCount + complexity.factors.estimatedOutputTokens;
      if (model.contextWindow >= requiredContext * 2) {
        score += 0.1;
        reasoning.push('Ample context window');
      } else if (model.contextWindow < requiredContext * 1.2) {
        score -= 0.2;
        reasoning.push('Context window may be tight');
      }

      if (criteria.preferredProviders?.includes(model.provider)) {
        score += 0.15;
        reasoning.push('Preferred provider');
      }

      return { model, score, reasoning };
    });
  }

  private async executeRequest(
    providerType: LLMProviderType,
    modelId: string,
    request: UnifiedChatRequest
  ): Promise<UnifiedChatResponse> {
    const provider = this.registry.getProvider(providerType);
    if (!provider) {
      throw new Error(`Provider ${providerType} not registered`);
    }

    const requestWithModel: UnifiedChatRequest = {
      ...request,
      model: modelId,
    };

    return provider.chat(requestWithModel);
  }

  private toProviderError(
    provider: LLMProviderType,
    model: string,
    error: unknown
  ): ProviderError {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isRetryable = this.isRetryableError(error);

    return {
      provider,
      model,
      code: 'PROVIDER_ERROR',
      message,
      retryable: isRetryable,
    };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('rate limit') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('429') ||
        message.includes('connection')
      );
    }
    return false;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
