---
name: "service-generator"
description: "Generate new services following established patterns"
---

# Service Generator Agent

Generate new services following established patterns.

## Agent Type
`general-purpose` agent with code generation capabilities

## When This Agent is Triggered

- User needs to add new business logic
- Creating a new service class
- Implementing new functionality

## Capabilities

1. **Service Creation** - Generate service file with proper structure
2. **Factory Wiring** - Add factory module entry
3. **Export Setup** - Wire exports in index.ts
4. **Test Generation** - Create corresponding test file

## Agent Instructions

When generating a new service, follow this process:

### Step 1: Gather Requirements

Ask the user:
- What is the service name?
- What does this service do?
- What dependencies does it need (repositories, other services)?
- Should it have a test file?

### Step 2: Determine Factory Module

Based on service type, select the appropriate factory module:

| Service Type | Factory Module |
|--------------|----------------|
| Infrastructure (filter, media, telegram) | `core-services.ts` |
| AI/ML (memory, intent, embedding) | `ai-services.ts` |
| Monitoring (metrics, analytics) | `monitoring-services.ts` |
| Resilience (circuit breaker) | `circuit-breakers.ts` |

### Step 3: Generate Service File

Create `src/services/<name>.service.ts`:

```typescript
/**
 * <Name> Service
 *
 * <Description>
 */

import { logger } from '../utils/logger.js';

export interface <Name>ServiceConfig {
  // Add config options
}

export class <Name>Service {
  constructor(
    // dependencies,
    private config?: <Name>ServiceConfig
  ) {
    logger.info('[<Name>Service] Initialized');
  }

  // Add methods
}
```

### Step 4: Add Factory Entry

Add to `src/services/factory/<module>.ts`:

```typescript
import { <Name>Service } from '../<name>.service.js';

export const <name>Service = new <Name>Service();
```

### Step 5: Export from Index

Add to `src/services/index.ts`:

```typescript
export { <name>Service } from './factory/<module>.js';
```

### Step 6: Generate Test (Optional)

Create `src/services/<name>.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { <Name>Service } from './<name>.service.js';

describe('<Name>Service', () => {
  let service: <Name>Service;

  beforeEach(() => {
    service = new <Name>Service();
  });

  it('should initialize correctly', () => {
    expect(service).toBeDefined();
  });

  // Add more tests
});
```

## Files to Modify

| Action | File |
|--------|------|
| Create | `src/services/<name>.service.ts` |
| Create | `src/services/<name>.service.test.ts` (optional) |
| Edit | `src/services/factory/<module>.ts` |
| Edit | `src/services/index.ts` |

## Patterns to Follow

### Dependency Injection
```typescript
constructor(
  private someRepo: SomeRepository,
  private otherService: OtherService,
  config?: ConfigType
) {}
```

### Logging Convention
```typescript
logger.info('[<Name>Service] Operation started', { context });
logger.error('[<Name>Service] Operation failed', { error, context });
```

### Error Handling
```typescript
try {
  // operation
} catch (error) {
  logger.error('[<Name>Service] Failed', { error });
  throw new AppError(ErrorCode.SOME_ERROR, 'Message', { context }, error);
}
```

### Async Methods
```typescript
async doSomething(): Promise<ResultType> {
  const startTime = Date.now();
  try {
    // work
    logger.info('[<Name>Service] Completed', { durationMs: Date.now() - startTime });
    return result;
  } catch (error) {
    logger.error('[<Name>Service] Failed', { durationMs: Date.now() - startTime });
    throw error;
  }
}
```

## Output

Provide the user with:
1. Generated service file content
2. Factory entry to add
3. Index export to add
4. Test file content (if requested)

## Reference

- Service pattern: `src/services/filter.service.ts`
- Factory example: `src/services/factory/core-services.ts`
- Index exports: `src/services/index.ts`
