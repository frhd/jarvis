# /regression - Run Regression Tests

Run LLM-as-judge regression tests and analyze results.

## When to Use

- After making changes to LLM processing
- Before releases
- Validating response quality
- Testing new intent types

## Regression System Architecture

```
tests/regression/
├── index.ts              # CLI entry point
├── runner.ts             # Test orchestrator
├── quality-evaluator.ts  # LLM-as-judge scoring
├── test-pipeline.service.ts  # Message injection
├── report-generator.ts   # Report creation
├── scenarios.ts          # Test scenarios
└── config.ts             # Configuration
```

## Running Tests

### All Scenarios
```bash
npm run regression
```

### By Category
```bash
npm run regression -- --category=greetings
npm run regression -- --category=questions
npm run regression -- --category=commands
npm run regression -- --category=multi_turn
npm run regression -- --category=edge_cases
```

### By Tag
```bash
npm run regression -- --tag=critical
npm run regression -- --tag=fast
npm run regression -- --tag=cache
npm run regression -- --tag=memory
```

### Options
```bash
npm run regression -- --verbose    # Detailed output
npm run regression -- --keep       # Keep test data
npm run regression -- --help       # Show help
```

## Scenario Structure

```typescript
{
  id: 'greeting_simple_001',
  name: 'Simple Hello Greeting',
  description: 'Basic greeting should get friendly response',
  category: 'greetings',
  tags: ['critical', 'fast', 'cacheable'],
  input: {
    messages: [
      { role: 'user', content: 'Hello!' },
    ],
  },
  expected: {
    qualityThreshold: 6,    // Min score out of 10
    maxLatencyMs: 30000,    // Max response time
  },
}
```

## Quality Scoring

The LLM judge (configured Ollama model) scores responses on:

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Relevance | 20% | Does response address the query? |
| Coherence | 20% | Is response well-structured? |
| Correctness | 20% | Is information accurate? |
| Appropriateness | 20% | Is tone/style appropriate? |
| Context Awareness | 20% | Does it use context well? |

**Score Interpretation:**
- 8-10: Excellent
- 6-7: Good (passing)
- 4-5: Needs improvement
- 0-3: Poor (failing)

## Test Categories

### Greetings (4 scenarios)
- Simple greeting
- Time-based greeting
- Farewell
- Gratitude

### Questions (5 scenarios)
- Factual question
- How-to question
- Opinion question
- Web search question
- Personal question

### Commands (4 scenarios)
- Task request
- Translation
- Summarization
- Calculation

### Multi-turn (4 scenarios)
- Name recall
- Context continuity
- Follow-up
- Topic reference

### Edge Cases (3 scenarios)
- Empty input
- Ambiguous query
- Unclear intent

## Report Output

Reports are saved to `data/regression/`:

```
data/regression/
├── regression-report-YYYYMMDD-HHMMSS.md   # Markdown report
└── regression-report-YYYYMMDD-HHMMSS.json # JSON data
```

### Report Structure
```markdown
# Regression Test Report

## Summary
- Total: 20 scenarios
- Passed: 18 (90%)
- Failed: 2 (10%)
- Average Quality: 7.5/10
- Average Latency: 2.3s

## Results by Category
| Category | Passed | Failed | Avg Quality |
|----------|--------|--------|-------------|
| greetings | 4/4 | 0 | 8.2 |
| questions | 4/5 | 1 | 7.1 |
...

## Failed Scenarios
### question_factual_002
- Score: 4.5 (threshold: 6)
- Issue: Incomplete answer
- Response: "..."
```

## Adding New Scenarios

Edit `tests/regression/scenarios.ts`:

```typescript
export const scenarios: RegressionScenario[] = [
  // ... existing scenarios ...

  {
    id: '<category>_<type>_<number>',
    name: '<Descriptive Name>',
    description: '<What this tests>',
    category: '<greetings|questions|commands|multi_turn|edge_cases>',
    tags: ['<relevant>', '<tags>'],
    input: {
      messages: [
        { role: 'user', content: '<user message>' },
        // Add more for multi-turn
      ],
    },
    expected: {
      qualityThreshold: 6,
      maxLatencyMs: 30000,
    },
  },
];
```

## Interpreting Results

### Common Failure Patterns

| Pattern | Likely Cause |
|---------|--------------|
| Low relevance | Intent misclassification |
| Low coherence | Context assembly issue |
| Timeout | LLM service issue |
| Inconsistent | Non-deterministic prompts |

### Debugging Failed Tests

1. Check the specific response in the JSON report
2. Review intent classification for that scenario
3. Check if caching affected the response
4. Verify LLM service is healthy

## Reference

- Runner: `tests/regression/runner.ts`
- Evaluator: `tests/regression/quality-evaluator.ts`
- Scenarios: `tests/regression/scenarios.ts`
- Config: `tests/regression/config.ts`
