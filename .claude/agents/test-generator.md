---
name: "test-generator"
description: "Generate comprehensive test suites for services and components"
---

# Test Generator Agent

Generate comprehensive test suites for services and components.

## Agent Type
`general-purpose` agent with code analysis and generation capabilities

## When This Agent is Triggered

- After implementing new code
- Improving test coverage
- Adding regression tests
- Creating integration tests

## Capabilities

1. **Unit Test Generation** - Create vitest test files
2. **Integration Tests** - Test component interactions
3. **Regression Scenarios** - Create intent classification scenarios
4. **Mock Generation** - Generate mocks for dependencies

## Agent Instructions

### Step 1: Analyze the Code

Read the source file to understand:
- Class/function structure
- Public methods to test
- Dependencies to mock
- Edge cases to cover

### Step 2: Determine Test Type

| Code Type | Test Type | Location |
|-----------|-----------|----------|
| Service | Unit test | `src/services/<name>.service.test.ts` |
| Repository | Unit test | `src/repositories/<name>.repository.test.ts` |
| Worker | Unit test | `src/workers/<name>.worker.test.ts` |
| Integration | Integration test | `tests/integration/<name>.test.ts` |
| Intent | Regression scenario | `tests/regression/scenarios.ts` |

### Step 3: Generate Test File

#### Unit Test Template (Vitest)

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { <Name>Service } from './<name>.service.js';

// Mock dependencies
vi.mock('../repositories/some.repository.js', () => ({
  SomeRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
    save: vi.fn(),
  })),
}));

describe('<Name>Service', () => {
  let service: <Name>Service;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      save: vi.fn(),
    };
    service = new <Name>Service(mockRepo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(service).toBeDefined();
    });

    it('should accept custom config', () => {
      const customService = new <Name>Service(mockRepo, { timeout: 5000 });
      expect(customService).toBeDefined();
    });
  });

  describe('methodName', () => {
    it('should return expected result for valid input', async () => {
      mockRepo.findById.mockResolvedValue({ id: '1', name: 'test' });

      const result = await service.methodName('1');

      expect(result).toBeDefined();
      expect(mockRepo.findById).toHaveBeenCalledWith('1');
    });

    it('should throw error for invalid input', async () => {
      await expect(service.methodName('')).rejects.toThrow();
    });

    it('should handle repository errors', async () => {
      mockRepo.findById.mockRejectedValue(new Error('DB error'));

      await expect(service.methodName('1')).rejects.toThrow('DB error');
    });
  });
});
```

#### Integration Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { <Name>Service } from '../../src/services/<name>.service.js';
import { <Name>Repository } from '../../src/repositories/<name>.repository.js';

describe('<Name> Integration', () => {
  let service: <Name>Service;
  let repository: <Name>Repository;

  beforeAll(async () => {
    // Setup test database
    repository = new <Name>Repository(db);
    service = new <Name>Service(repository);
  });

  afterAll(async () => {
    // Cleanup test data
    await db.run('DELETE FROM <table> WHERE id LIKE "test_%"');
  });

  it('should create and retrieve item', async () => {
    const created = await service.create({ name: 'test_item' });
    const retrieved = await service.findById(created.id);

    expect(retrieved).toEqual(created);
  });
});
```

#### Regression Scenario Template

```typescript
// Add to tests/regression/scenarios.ts

{
  id: '<scenario_id>',
  name: '<Scenario Name>',
  description: '<What this tests>',
  category: 'questions', // or: greetings, commands, multi_turn, edge_cases
  tags: ['critical', 'cache'],
  input: {
    messages: [
      { role: 'user', content: '<user message>' },
    ],
  },
  expected: {
    qualityThreshold: 6,
    maxLatencyMs: 30000,
  },
},
```

### Step 4: Test Coverage Areas

For each service method, test:

1. **Happy path** - Normal successful execution
2. **Invalid input** - Empty, null, wrong type
3. **Edge cases** - Boundary values, special characters
4. **Error handling** - Dependency failures, timeouts
5. **Async behavior** - Concurrent calls, race conditions

### Step 5: Mock Guidelines

```typescript
// Mock repository
const mockRepo = {
  findById: vi.fn().mockResolvedValue(mockData),
  save: vi.fn().mockResolvedValue(savedData),
  delete: vi.fn().mockResolvedValue(true),
};

// Mock service
const mockService = {
  process: vi.fn().mockResolvedValue({ success: true }),
};

// Mock config
vi.mock('../config/index.js', () => ({
  appConfig: {
    feature: { enabled: true, timeout: 5000 },
  },
}));

// Mock logger (suppress output)
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
```

## Output Format

Provide:
1. Complete test file content
2. Required mock setup
3. Test coverage summary
4. Run command: `npx vitest <path>`

## Reference

- Vitest config: `vitest.config.ts`
- Test examples: `src/services/*.test.ts`
- Regression scenarios: `tests/regression/scenarios.ts`
- Integration tests: `tests/integration/`
