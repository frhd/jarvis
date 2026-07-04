---
name: "llm-provider"
description: "Add support for new LLM providers following the unified interface"
---

# LLM Provider Agent

Add support for new LLM providers following the unified interface.

## Agent Type
`general-purpose` agent with code generation capabilities

## When This Agent is Triggered

- Adding a new LLM service integration
- Supporting new model APIs
- Implementing custom LLM backends

## Capabilities

1. **Provider Implementation** - Generate provider class
2. **Type Integration** - Add provider type enum
3. **Registry Setup** - Wire into model registry
4. **Configuration** - Add environment variables
5. **Health Checks** - Implement availability checks

## Agent Instructions

### Step 1: Gather Requirements

Ask the user:
- What is the provider name?
- What is the API endpoint?
- Does it require authentication?
- Does it support streaming?
- Does it support tool calling?
- What models are available?

### Step 2: Research API

If API documentation is available:
- Understand request/response format
- Identify authentication method
- Check for streaming support
- Map to unified interface

### Step 3: Generate Provider

Create `src/llm/providers/<name>.provider.ts`:

```typescript
import { BaseLLMProvider } from '../base-provider.js';
import {
  LLMProviderType,
  UnifiedChatRequest,
  UnifiedChatResponse,
  ProviderHealthStatus,
} from '../../types/llm.types.js';
import { logger } from '../../utils/logger.js';

export class <Name>Provider extends BaseLLMProvider {
  readonly providerType = LLMProviderType.<NAME>;
  readonly name = '<name>';

  // Implementation following the pattern in:
  // - src/llm/providers/ollama.provider.ts
  // - src/llm/providers/openai.provider.ts
}
```

### Step 4: Add Provider Type

Edit `src/types/llm.types.ts`:

```typescript
export enum LLMProviderType {
  // ... existing ...
  <NAME> = '<name>',
}
```

### Step 5: Export Provider

Edit `src/llm/providers/index.ts`:

```typescript
export { <Name>Provider } from './<name>.provider.js';
```

### Step 6: Add Configuration

Create environment variables in `.env.example`:

```bash
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
  baseUrl: process.env.<NAME>_BASE_URL,
  apiKey: process.env.<NAME>_API_KEY,
  model: process.env.<NAME>_MODEL,
  timeoutMs: parseInt(process.env.<NAME>_TIMEOUT_MS || '30000'),
},
```

### Step 7: Register Provider

Wire into model registry during initialization.

## Key Interface Methods

| Method | Purpose |
|--------|---------|
| `chat()` | Single response generation |
| `chatStream()` | Streaming response |
| `checkHealth()` | Availability check |
| `getAvailableModels()` | List models |
| `getDefaultModel()` | Default model name |
| `supportsStreaming()` | Streaming capability |
| `supportsToolCalling()` | Tool use capability |

## Output

Provide the user with:
1. Complete provider file
2. Type enum addition
3. Configuration additions
4. Export statement
5. Test suggestions

## Reference Files

- Base provider: `src/llm/base-provider.ts`
- Ollama example: `src/llm/providers/ollama.provider.ts`
- OpenAI example: `src/llm/providers/openai.provider.ts`
- Types: `src/types/llm.types.ts`
