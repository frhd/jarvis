# /add-provider - Add LLM Provider

Add a new LLM provider following the unified interface.

## When to Use

- Adding support for a new LLM service (Mistral, DeepSeek, Cohere, etc.)
- Integrating self-hosted models
- Adding API-compatible services

## Provider Architecture

```
src/llm/
├── base-provider.ts           # Abstract base class
├── model-registry.ts          # Provider registration
├── model-router.ts            # Complexity-based routing
├── complexity-scorer.ts       # Request analysis
├── types/llm.types.ts         # Shared interfaces
└── providers/
    ├── ollama.provider.ts     # Local Ollama
    ├── openai.provider.ts     # OpenAI API
    ├── anthropic.provider.ts  # Anthropic Claude
    ├── gemini.provider.ts     # Google Gemini
    ├── lmstudio.provider.ts   # LM Studio
    └── <new>.provider.ts      # Your new provider
```

## Provider Interface

All providers implement `IUnifiedLLMProvider`:

```typescript
interface IUnifiedLLMProvider {
  readonly providerType: LLMProviderType;
  readonly name: string;

  // Core methods
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  chatStream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk>;

  // Health and configuration
  checkHealth(): Promise<ProviderHealthStatus>;
  getAvailableModels(): Promise<string[]>;
  getDefaultModel(): string;

  // Capabilities
  supportsStreaming(): boolean;
  supportsToolCalling(): boolean;
}
```

## Provider Template

```typescript
// src/llm/providers/<name>.provider.ts

import { BaseLLMProvider } from '../base-provider.js';
import {
  LLMProviderType,
  ProviderConfig,
  ProviderHealthStatus,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
} from '../../types/llm.types.js';
import { logger } from '../../utils/logger.js';

// Provider-specific types
interface <Name>Config {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
}

interface <Name>ChatResponse {
  // Map provider's response format
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

const DEFAULT_CONFIG: <Name>Config = {
  baseUrl: 'https://api.<provider>.com',
  defaultModel: '<model-name>',
  timeoutMs: 30000,
  maxRetries: 3,
};

export class <Name>Provider extends BaseLLMProvider {
  readonly providerType = LLMProviderType.<NAME>;
  readonly name = '<name>';

  private config: <Name>Config;

  constructor(config?: Partial<<Name>Config>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[<Name>Provider] Initialized', {
      baseUrl: this.config.baseUrl,
      model: this.config.defaultModel,
    });
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const startTime = Date.now();

    try {
      // Convert unified request to provider format
      const providerRequest = this.convertRequest(request);

      // Make API call
      const response = await this.callAPI(providerRequest);

      // Convert response to unified format
      return this.convertResponse(response, Date.now() - startTime);
    } catch (error) {
      logger.error('[<Name>Provider] Chat failed', { error });
      throw error;
    }
  }

  async *chatStream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    // Implement streaming if supported
    throw new Error('Streaming not implemented');
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    try {
      const models = await this.getAvailableModels();
      return {
        healthy: true,
        latencyMs: 0,
        availableModels: models,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Return list of available models
    return [this.config.defaultModel];
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  supportsStreaming(): boolean {
    return false; // Set to true if provider supports streaming
  }

  supportsToolCalling(): boolean {
    return false; // Set to true if provider supports tool calling
  }

  private convertRequest(request: UnifiedChatRequest): unknown {
    // Convert unified format to provider's format
    return {
      model: request.model || this.config.defaultModel,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      // Add provider-specific options
    };
  }

  private convertResponse(response: <Name>ChatResponse, durationMs: number): UnifiedChatResponse {
    return {
      content: response.content,
      model: response.model,
      provider: this.providerType,
      metadata: {
        durationMs,
        tokenUsage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.prompt_tokens + response.usage.completion_tokens,
        } : undefined,
      },
    };
  }

  private async callAPI(request: unknown): Promise<<Name>ChatResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }
}
```

## Step 2: Add Provider Type

Edit `src/types/llm.types.ts`:

```typescript
export enum LLMProviderType {
  OLLAMA = 'ollama',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  LMSTUDIO = 'lmstudio',
  <NAME> = '<name>',  // Add new provider
}
```

## Step 3: Register Provider

Edit `src/llm/providers/index.ts`:

```typescript
export { <Name>Provider } from './<name>.provider.js';
```

Add to model registry initialization:

```typescript
// In model-registry.ts or where providers are registered
import { <Name>Provider } from './providers/<name>.provider.js';

// Register provider
registry.registerProvider(new <Name>Provider({
  baseUrl: process.env.<NAME>_BASE_URL,
  apiKey: process.env.<NAME>_API_KEY,
}));
```

## Step 4: Add Configuration

Add to `.env.example`:

```bash
# <Name> Provider
<NAME>_ENABLED=false
<NAME>_BASE_URL=https://api.<provider>.com
<NAME>_API_KEY=
<NAME>_MODEL=<default-model>
<NAME>_TIMEOUT_MS=30000
```

Add to `src/config/index.ts`:

```typescript
<name>: {
  enabled: process.env.<NAME>_ENABLED === 'true',
  baseUrl: process.env.<NAME>_BASE_URL || 'https://api.<provider>.com',
  apiKey: process.env.<NAME>_API_KEY,
  model: process.env.<NAME>_MODEL || '<default-model>',
  timeoutMs: parseInt(process.env.<NAME>_TIMEOUT_MS || '30000', 10),
},
```

## Step 5: Add to Model Router (Optional)

If this provider should be auto-selected for certain complexity levels:

```typescript
// In model-router.ts
private selectProvider(complexity: ComplexityScore): IUnifiedLLMProvider {
  if (complexity.score < 0.3) {
    return this.getProvider(LLMProviderType.OLLAMA);
  } else if (complexity.score < 0.6) {
    return this.getProvider(LLMProviderType.<NAME>);  // Medium complexity
  } else {
    return this.getProvider(LLMProviderType.ANTHROPIC);
  }
}
```

## Checklist

- [ ] Create provider file: `src/llm/providers/<name>.provider.ts`
- [ ] Implement `IUnifiedLLMProvider` interface
- [ ] Add provider type to enum
- [ ] Export from `src/llm/providers/index.ts`
- [ ] Register in model registry
- [ ] Add configuration to `.env.example` and `src/config/`
- [ ] Add health check implementation
- [ ] Test the provider
- [ ] Update routing rules if needed

## Troubleshooting

### Provider Not Being Selected
- Verify provider is registered in model registry
- Check `checkHealth()` returns `healthy: true`
- Review routing rules in `model-router.ts`

### API Authentication Failing
- Verify API key in environment variables
- Check `Authorization` header format matches provider spec
- Test API endpoint manually with curl

### Streaming Not Working
- Ensure `supportsStreaming()` returns `true`
- Implement `chatStream()` with proper async generator
- Handle SSE/chunked response format correctly

### Response Format Errors
- Verify `convertResponse()` maps all required fields
- Check provider's response schema matches expectations
- Add error handling for missing/null fields

## Reference

- Base provider: `src/llm/base-provider.ts`
- Example providers: `src/llm/providers/ollama.provider.ts`
- Types: `src/types/llm.types.ts`
- Model registry: `src/llm/model-registry.ts`
