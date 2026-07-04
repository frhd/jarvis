# /circular-check - Check Circular Dependencies

Check and fix circular dependencies in the codebase.

## When to Use

- After refactoring
- Before releases
- When experiencing import errors
- Code quality audits

## Running the Check

```bash
# Run circular dependency check
npm run check:circular

# With graph output
npx tsx scripts/check-circular-deps.ts --graph
```

## What It Checks

The script uses `madge` to analyze the import graph and detect:

1. **Circular dependencies** - A imports B, B imports A
2. **Dependency chains** - A → B → C → A
3. **Service layer violations** - Handlers importing from repositories directly

## Output Format

```
Checking for circular dependencies...

Found 2 circular dependencies:

1. src/services/a.service.ts
   → src/services/b.service.ts
   → src/services/a.service.ts

2. src/services/processor.service.ts
   → src/services/responseRouter.service.ts
   → src/services/processor.service.ts

Severity Analysis:
- Critical (services): 2
- Medium (other): 0

Refactoring suggestions:
1. Extract shared logic to a new service
2. Use dependency injection instead of direct imports
3. Consider using interfaces/types from a shared file
```

## Common Circular Patterns

### Pattern 1: Mutual Service Dependency

```
ServiceA ←→ ServiceB
```

**Solution:** Extract shared logic to ServiceC

```
ServiceA → ServiceC
ServiceB → ServiceC
```

### Pattern 2: Handler-Service Loop

```
Handler → Service → Handler
```

**Solution:** Services should never import handlers

### Pattern 3: Type Import Cycle

```
types.ts ←→ service.ts
```

**Solution:** Move types to separate file without implementation imports

## Fixing Circular Dependencies

### 1. Extract Shared Logic

Before:
```typescript
// a.service.ts
import { BService } from './b.service.js';

// b.service.ts
import { AService } from './a.service.js';
```

After:
```typescript
// shared.service.ts - no imports from a or b

// a.service.ts
import { SharedService } from './shared.service.js';

// b.service.ts
import { SharedService } from './shared.service.js';
```

### 2. Use Dependency Injection

Before:
```typescript
// processor.service.ts
import { RouterService } from './router.service.js';

export class ProcessorService {
  private router = new RouterService();
}
```

After:
```typescript
// processor.service.ts
export class ProcessorService {
  constructor(private router: IRouterService) {}
}

// Factory wires it up
const processor = new ProcessorService(routerService);
```

### 3. Use Interfaces

Before:
```typescript
// a.service.ts
import { BService } from './b.service.js';

export class AService {
  constructor(private b: BService) {}
}
```

After:
```typescript
// interfaces/index.ts
export interface IBService {
  doSomething(): Promise<void>;
}

// a.service.ts
import type { IBService } from '../interfaces/index.js';

export class AService {
  constructor(private b: IBService) {}
}
```

### 4. Lazy Loading

```typescript
// Instead of top-level import
// import { BService } from './b.service.js';

export class AService {
  private getB(): BService {
    // Dynamic import when needed
    const { BService } = require('./b.service.js');
    return new BService();
  }
}
```

## Graph Visualization

Generate a dependency graph:

```bash
# Generate SVG
npx tsx scripts/check-circular-deps.ts --graph

# Output: dependency-graph.svg
```

## Severity Levels

| Severity | Location | Impact |
|----------|----------|--------|
| Critical | Services | Can cause runtime errors |
| High | Repositories | May affect data access |
| Medium | Utils/Helpers | Usually manageable |
| Low | Types only | Often false positives |

## Prevention

### Import Order Convention

```typescript
// 1. External packages
import { something } from 'external-package';

// 2. Types/Interfaces (use 'import type')
import type { SomeType } from '../types/index.js';

// 3. Utils/Helpers
import { logger } from '../utils/logger.js';

// 4. Same-layer dependencies
import { RelatedService } from './related.service.js';
```

### Architecture Rules

1. **Handlers** → Services only
2. **Services** → Repositories, other Services
3. **Repositories** → Database only
4. **Utils** → No application imports

## Reference

- Check script: `scripts/check-circular-deps.ts`
- Madge docs: https://github.com/pahen/madge
- Architecture: `CLAUDE.md`
