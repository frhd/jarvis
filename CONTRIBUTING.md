# Contributing to Jarvis

Thank you for your interest in contributing to Jarvis! This document provides guidelines to ensure code quality and consistency.

## Clean Code Guidelines

### Avoid Magic Numbers

**Magic numbers** are hardcoded numeric values without clear meaning. They make code harder to understand and maintain.

#### Bad Example

```typescript
const recentMessages = messages.slice(-5); // What is 5? Why 5?
await sleep(7200000); // What is 7200000? Milliseconds? Hours?
```

#### Good Example

```typescript
// Define constants with descriptive names
const MAX_CONTEXT_MESSAGES = 5;
const AGENTIC_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

const recentMessages = messages.slice(0, MAX_CONTEXT_MESSAGES);
await sleep(AGENTIC_TASK_TIMEOUT_MS);
```

#### Guidelines

1. **Extract to constants**: Any numeric value that isn't immediately obvious should be extracted to a named constant.

2. **Use descriptive names**: The constant name should explain the purpose and unit.
   - `MAX_RETRY_ATTEMPTS` instead of `3`
   - `TIMEOUT_SECONDS` instead of `30`
   - `CACHE_TTL_HOURS` instead of `24`

3. **Include units in the name**: When dealing with time or measurements, include the unit.
   - `MAX_AGE_MS` (milliseconds)
   - `TIMEOUT_SECONDS`
   - `RATE_LIMIT_PER_MINUTE`

4. **Document the "why"**: If the value has a specific reason, add a comment explaining it.

5. **Group related constants**: Place related constants together, typically at the top of the file or in a dedicated config file.

### Example: Message Context Constants

```typescript
// Default max messages to include in context
const DEFAULT_MAX_MESSAGES = 10;

// Default max age: 2 hours (enough for a typical conversation session)
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Get recent messages from descending-ordered history with time filtering.
 */
export function getRecentMessages(
  messages: Message[],
  maxMessages: number = DEFAULT_MAX_MESSAGES,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Message[] {
  // Implementation
}
```

### Additional Clean Code Practices

- **Single Responsibility**: Each function should do one thing well
- **Meaningful Names**: Use descriptive variable and function names
- **Small Functions**: Keep functions focused and under 20-30 lines when possible
- **DRY (Don't Repeat Yourself)**: Extract common logic into reusable functions
- **Comments for "Why", Code for "What"**: Code should be self-documenting; comments should explain reasoning

## Code Style

- Follow existing TypeScript patterns in the codebase
- Use ES modules (`import`/`export`)
- Use path aliases (`@/*`, `@services/*`, etc.) as configured
- Run `npm run build` to ensure TypeScript compiles
- Run `npm test` to verify tests pass

## Testing

- Write tests for new functionality
- Place test files next to source files (`*.test.ts`)
- Use Vitest with `globals: true` (no need to import `describe`, `it`, `expect`)
- See `CLAUDE.md` for detailed testing conventions
