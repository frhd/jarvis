# Examples

This directory contains example files demonstrating usage patterns for various Jarvis components.

## Config Examples

- **feature-flags.example.ts** - Feature flag configuration and usage
- **runtime-config.example.ts** - Runtime configuration management
- **runtime-config-integration.example.ts** - Integration patterns for runtime config

## LLM Examples

- **openai.provider.example.ts** - OpenAI provider implementation example

## Service Examples

- **circuitBreaker.example.ts** - Circuit breaker pattern usage
- **escalation.example.ts** - Escalation service configuration
- **frustrationDetector.service.example.ts** - Frustration detection implementation
- **metrics-exporter.example.ts** - Metrics export functionality
- **retryStrategy.service.example.ts** - Retry strategy patterns
- **conversationHistoryAnalysis.example.ts** - Conversation history analysis
- **loopPrevention.example.ts** - Loop prevention mechanisms

## Running Examples

These files are standalone examples and may require adjustment to run:

```bash
# Examples are not part of the main build
# To check syntax:
npx tsc --noEmit examples/**/*.ts 2>/dev/null || echo "Examples are standalone"
```
