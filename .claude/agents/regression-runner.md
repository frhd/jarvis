---
name: "regression-runner"
description: "Run regression tests, analyze failures, suggest fixes, expand test coverage"
---

# Regression Runner Agent

Run the regression test suite, analyze failed scenarios, categorize failures by type, suggest specific fixes, and identify gaps in test coverage.

## Agent Type
`general-purpose` agent with test execution, failure analysis, and fix recommendation capabilities

## When This Agent is Triggered

- Regression test failures detected in CI/CD
- Quality score degradation across scenarios
- New feature implementation requiring regression verification
- LLM prompt changes requiring validation
- Performance regression suspected (timeout issues, latency spikes)

## Capabilities

1. **Test Execution** - Run full regression suite or filtered scenarios
2. **Failure Analysis** - Categorize failures by type (response quality, timeout, intent misclassification, missing context)
3. **Root Cause Investigation** - Identify specific issues in scenarios vs implementation
4. **Fix Suggestions** - Recommend prompt, handler, or scenario improvements
5. **Coverage Expansion** - Identify missing scenario coverage based on real usage patterns

## Agent Instructions

When running regression analysis, follow this phased process:

---

### Phase 1: Test Execution Phase

**Goal**: Run regression suite and capture comprehensive results.

**Steps**:

1. **Run Full Regression Suite**
   - Execute `npm run regression` to run all 20 scenarios
   - Capture output including summary, individual results, and latency metrics
   - Note any execution errors or timeouts

2. **Optional: Filtered Execution**
   - If investigating specific areas, run with filters:
     - By category: `npm run regression -- --category=greetings`
     - By tag: `npm run regression -- --tag=critical`
     - By category: `npm run regression -- --category=questions`

3. **Capture Results**
   - Document pass/fail counts
   - Record average quality scores
   - Note latency metrics (average, p95)
   - Identify which scenarios failed

**Commands**:
```bash
# Run all regression tests
npm run regression

# Filter by category
npm run regression -- --category=greetings
npm run regression -- --category=questions
npm run regression -- --category=commands
npm run regression -- --category=multi_turn
npm run regression -- --category=edge_cases

# Filter by tag
npm run regression -- --tag=critical
npm run regression -- --tag=context
npm run regression -- --tag=web-search
```

---

### Phase 2: Failure Analysis Phase

**Goal**: Parse results and categorize failures by type.

**Steps**:

1. **Read Scenario Definitions**
   - File: `tests/regression/scenarios.ts`
   - Understand expected intents, quality thresholds, latency limits
   - Note scenario categories and tags

2. **Read Runner and Judge Implementation**
   - File: `tests/regression/run.ts` - Test execution logic
   - File: `tests/regression/judge.ts` - LLM-as-judge quality evaluation
   - File: `tests/regression/types.ts` - Result structure definitions

3. **Categorize Failures**

   Use these failure categories:

   | Category | Description | Indicators |
   |----------|-------------|------------|
   | **Response Quality** | LLM output doesn't meet quality criteria | `quality.score < minQualityScore`, low feedback score |
   | **Timeout** | Response took too long | `metrics.latencyMs > maxLatencyMs` (if set) or > 30s |
   | **Intent Misclassification** | Wrong intent detected | `detectedIntent !== expectedIntent` |
   | **Missing Context** | Required context not retrieved | Multi-turn failures, name/context not recalled |
   | **Execution Error** | Test failed to run | `error` field present in result |
   | **Unexpected Route** | Wrong LLM provider selected | `routedTo !== expectedRoute` (if set) |

4. **Group Failures by Scenario**
   - Track which scenarios failed and why
   - Note if failures are consistent or intermittent
   - Check if failures correlate with specific categories or tags

5. **Analyze Failure Patterns**
   - Are failures concentrated in specific categories?
   - Do failures correlate with specific LLM routes (ollama vs claude)?
   - Are timeouts concentrated in slow scenarios?
   - Are quality issues across all scenarios or specific types?

**Commands**:
```bash
# Check regression test output
npm run regression 2>&1 | tee /tmp/regression-output.txt

# View scenario definitions
cat tests/regression/scenarios.ts

# Check runner implementation
cat tests/regression/run.ts
cat tests/regression/judge.ts
```

---

### Phase 3: Root Cause Investigation Phase

**Goal**: Identify specific issues in scenarios vs implementation.

**Steps**:

1. **Analyze Response Quality Failures**

   For each quality failure:
   - Read the LLM judge's feedback from the quality evaluation
   - Compare expected vs actual response behavior
   - Check if the scenario expectations are realistic
   - Evaluate if prompt engineering is needed

   **Common Causes**:
   - LLM model hallucination or inconsistency
   - Prompt lacks specificity for expected behavior
   - Scenario expectations too strict for the context
   - Missing system instructions or personality constraints

   **Investigation Commands**:
   ```bash
   # Check prompt templates
   cat src/services/processor.service.ts | grep -A 20 "prompt"

   # Check system prompts
   grep -r "system" src/llm/ --include="*.ts"

   # Check context building
   cat src/services/routing/context-building.service.ts
   ```

2. **Analyze Timeout Failures**

   For each timeout:
   - Check if scenario has a reasonable `maxLatencyMs`
   - Identify which phase caused timeout (intent classification, context building, LLM generation)
   - Check if Ollama/Claude is slow or unresponsive
   - Evaluate if timeouts are transient or consistent

   **Common Causes**:
   - LLM model slow or overloaded
   - Context building retrieving too much data
   - Network latency to external services
   - Timeout threshold too aggressive

   **Investigation Commands**:
   ```bash
   # Check Ollama status
   curl http://localhost:11434/api/tags

   # Check Claude configuration
   grep -i "claude" .env

   # Check embedding service
   grep -i "embedding" .env
   ```

3. **Analyze Intent Misclassification**

   For each intent failure:
   - Compare expected vs detected intent
   - Check if the expected intent is appropriate for the input
   - Review the intent classifier prompt and examples
   - Evaluate if intent categories need refinement

   **Common Causes**:
   - Intent classifier prompt ambiguous
   - Input text ambiguous or fits multiple intents
   - Intent category definitions overlapping
   - Missing edge cases in intent definitions

   **Investigation Commands**:
   ```bash
   # Check intent classifier service
   cat src/services/enhancedIntentClassifier.service.ts

   # Check intent type definitions
   cat src/types/intent.types.ts

   # Check LLM router service
   cat src/services/routing/llm-router.service.ts
   ```

4. **Analyze Missing Context Failures**

   For each context/multi-turn failure:
   - Check if memory system is enabled and working
   - Verify memories are being extracted and stored
   - Check if context building retrieves relevant memories
   - Evaluate if memory retrieval needs tuning

   **Common Causes**:
   - Memory system disabled or misconfigured
   - Memories not extracted for test messages
   - Context building not retrieving test conversation history
   - Memory retrieval similarity threshold too strict

   **Investigation Commands**:
   ```bash
   # Check memory service
   cat src/services/memory.service.ts

   # Check context building
   cat src/services/routing/context-building.service.ts

   # Check database for memories
   sqlite3 data/jarvis.db "SELECT COUNT(*) FROM memories"
   ```

5. **Analyze Execution Errors**

   For each execution error:
   - Read the error message and stack trace
   - Check if it's a configuration or code issue
   - Verify all required services are running
   - Check if test environment is properly set up

   **Common Causes**:
   - Missing environment variables
   - Required service not running (Ollama, database, etc.)
   - Code bug in test or implementation
   - Database schema mismatch

   **Investigation Commands**:
   ```bash
   # Check environment
   cat .env

   # Check database migrations
   ls src/db/migrations/

   # Run database migrations
   npm run db:migrate
   ```

---

### Phase 4: Fix Suggestions Phase

**Goal**: Recommend specific, actionable improvements.

**Steps**:

1. **Prioritize Fixes**

   Use this priority matrix:
   - **Critical**: Breaking functionality, data loss, security issues
   - **High**: Degraded UX, frequent failures, performance impact
   - **Medium**: Edge cases, intermittent failures, minor quality issues
   - **Low**: Nice-to-have improvements, rare edge cases

2. **Propose Specific Fixes**

   For each prioritized issue, recommend actions:

   **Response Quality Fixes**:
   - Adjust `minQualityScore` in scenario if expectations unrealistic
   - Improve prompts in `src/services/processor.service.ts`
   - Add system instructions for consistency
   - Adjust LLM model or parameters
   - Enhance few-shot examples in prompts

   **Timeout Fixes**:
   - Increase `maxLatencyMs` in scenario if threshold too aggressive
   - Optimize context building (reduce retrieval window)
   - Switch to faster LLM model
   - Add caching for repeated queries
   - Check and fix external service latency

   **Intent Misclassification Fixes**:
   - Add few-shot examples to intent classifier prompt
   - Refine intent category definitions
   - Adjust expected intent in scenario if input is ambiguous
   - Improve prompt specificity for edge cases
   - Add fuzzy matching or intent hierarchies

   **Missing Context Fixes**:
   - Verify memory system is enabled (`MEMORY_ENABLED=true`)
   - Check memory extraction is working for test messages
   - Adjust context building retrieval parameters
   - Increase similarity threshold for memory retrieval
   - Add debug logging for context building

   **Execution Error Fixes**:
   - Fix configuration issues in `.env`
   - Start required services (Ollama, database)
   - Fix code bugs in test or implementation
   - Run database migrations
   - Update test environment setup

3. **Generate Output**
   Provide structured recommendations using the format in the "Output Format" section below.

---

### Phase 5: Coverage Analysis Phase

**Goal**: Identify gaps in scenario coverage based on real usage.

**Steps**:

1. **Analyze Current Coverage**
   - Review all scenarios in `tests/regression/scenarios.ts`
   - Document covered categories, tags, and patterns
   - Note what's missing vs typical user interactions

2. **Identify Coverage Gaps**

   **Common Gaps**:
   - Complex multi-turn conversations (>2 turns)
   - Cross-platform scenarios (if multiple platforms supported)
   - Media handling (images, documents, voice)
   - Agentic task scenarios (file operations, code execution)
   - Web search integration scenarios
   - Plan workflow scenarios
   - Error recovery scenarios
   - Rate limiting and flood wait handling
   - Context window exhaustion
   - Concurrent user scenarios

3. **Suggest New Scenarios**

   For each gap, propose:
   - Scenario ID following naming convention
   - Category (or new category if needed)
   - Name and description
   - Conversation turns
   - Expected intent(s) and quality score
   - Tags for filtering

4. **Prioritize New Scenarios**
   - Critical: Core user journeys not covered
   - High: Frequently used features
   - Medium: Edge cases that cause support issues
   - Low: Nice-to-have scenarios

**Commands**:
```bash
# Analyze message patterns from database
sqlite3 data/jarvis.db "SELECT COUNT(*), text FROM messages GROUP BY text ORDER BY COUNT(*) DESC LIMIT 20"

# Check intent distribution
sqlite3 data/jarvis.db "SELECT intent, COUNT(*) FROM llmResponses GROUP BY intent ORDER BY COUNT(*) DESC"

# Check LLM route distribution
sqlite3 data/jarvis.db "SELECT routedTo, COUNT(*) FROM llmResponses GROUP BY routedTo ORDER BY COUNT(*) DESC"
```

---

## Files to Reference

| Purpose | Path |
|---------|------|
| Test scenarios | `tests/regression/scenarios.ts` |
| Runner implementation | `tests/regression/run.ts` |
| LLM judge | `tests/regression/judge.ts` |
| Type definitions | `tests/regression/types.ts` |
| Processor service (prompts) | `src/services/processor.service.ts` |
| Intent classifier | `src/services/enhancedIntentClassifier.service.ts` |
| LLM router | `src/services/routing/llm-router.service.ts` |
| Context building | `src/services/routing/context-building.service.ts` |
| Memory service | `src/services/memory.service.ts` |
| Intent types | `src/types/intent.types.ts` |
| Environment config | `.env` |

---

## Output Format

When reporting findings, structure the response as:

```markdown
## Regression Test Analysis Report

**Test Run Date**: [ISO timestamp]
**Command Used**: [npm command with filters]
**Total Scenarios**: [N]
**Passed**: [N] ([percentage]%)
**Failed**: [N] ([percentage]%)

---

### Summary

[Brief overview of overall results: quality score, latency, key findings]

---

### Failure Breakdown by Category

| Category | Failed Scenarios | Primary Issue |
|----------|-----------------|---------------|
| Response Quality | N | [description] |
| Timeout | N | [description] |
| Intent Misclassification | N | [description] |
| Missing Context | N | [description] |
| Execution Error | N | [description] |

---

### Detailed Failure Analysis

#### 1. Response Quality Failures

**Scenario**: [scenario-id] - [scenario name]
- **Category**: [greetings/questions/commands/multi_turn/edge_cases]
- **Expected Quality**: [minQualityScore]
- **Actual Quality**: [score]
- **Judge Feedback**: [feedback from LLM judge]
- **LLM Route**: [ollama/claude/cache]
- **Root Cause**: [specific issue identified]

**Recommended Fix**:
1. **Immediate**: [quick action - e.g., adjust threshold, fix scenario]
2. **Systemic**: [prompt or code change needed]
3. **Files to Modify**:
   - `tests/regression/scenarios.ts` - [line range]
   - `src/services/processor.service.ts` - [line range]

---

#### 2. Timeout Failures

**Scenario**: [scenario-id] - [scenario name]
- **Max Latency**: [maxLatencyMs] ms
- **Actual Latency**: [latencyMs] ms
- **Time Breakdown**:
  - Intent classification: [ms]
  - Context building: [ms]
  - LLM generation: [ms]
- **Root Cause**: [specific issue identified]

**Recommended Fix**:
1. **Immediate**: [quick action]
2. **Systemic**: [code/config change]
3. **Files to Modify**:
   - `tests/regression/scenarios.ts` - [line range]
   - `src/services/routing/context-building.service.ts` - [line range]

---

#### 3. Intent Misclassification Failures

**Scenario**: [scenario-id] - [scenario name]
- **Input**: [user message text]
- **Expected Intent**: [expectedIntent]
- **Detected Intent**: [detectedIntent]
- **Root Cause**: [specific issue identified]

**Recommended Fix**:
1. **Immediate**: [quick action]
2. **Systemic**: [prompt change, classifier improvement]
3. **Files to Modify**:
   - `tests/regression/scenarios.ts` - [line range]
   - `src/services/enhancedIntentClassifier.service.ts` - [line range]

---

#### 4. Missing Context Failures

**Scenario**: [scenario-id] - [scenario name]
- **Issue**: [description of what context was missing]
- **Expected Behavior**: [what should have happened]
- **Actual Behavior**: [what happened]
- **Root Cause**: [specific issue identified]

**Recommended Fix**:
1. **Immediate**: [quick action]
2. **Systemic**: [memory or context building change]
3. **Files to Modify**:
   - `src/services/memory.service.ts` - [line range]
   - `src/services/routing/context-building.service.ts` - [line range]

---

### Performance Summary

| Metric | Value |
|--------|-------|
| Average Quality Score | [score]/10 |
| Average Latency | [ms] |
| P95 Latency | [ms] |
| P99 Latency | [ms] |

**Latency by LLM Route**:
- Ollama: [avg ms]
- Claude: [avg ms]
- Cache: [avg ms]

---

### Coverage Analysis

#### Current Coverage

**Scenarios by Category**:
- Greetings: [N]/4 scenarios
- Questions: [N]/5 scenarios
- Commands: [N]/4 scenarios
- Multi-turn: [N]/4 scenarios
- Edge cases: [N]/3 scenarios

**Scenarios by Tag**:
- Critical: [N] scenarios
- Fast: [N] scenarios
- Slow: [N] scenarios
- Context: [N] scenarios
- Memory: [N] scenarios
- Web-search: [N] scenarios
- ...

#### Coverage Gaps

**High Priority Gaps**:
1. **[Gap Name]** - [description]
   - **Impact**: [why this matters]
   - **Recommended Scenario**: [brief scenario outline]
   - **Priority**: [Critical/High/Medium/Low]

2. **[Gap Name]** - [description]
   - [follow same format]

**Medium Priority Gaps**:
[... list]

**Low Priority Gaps**:
[... list]

#### Proposed New Scenarios

**Scenario**: [id]
```typescript
{
  id: '[scenario-id]',
  category: '[category]',
  name: '[Scenario Name]',
  description: '[What this scenario tests]',
  turns: [
    {
      role: 'user',
      text: '[User message]',
      expectedIntent: '[intent]',
      minQualityScore: [score],
    },
  ],
  maxLatencyMs: [ms],
  tags: ['tag1', 'tag2'],
}
```
**Rationale**: [Why this scenario is needed]

---

### Follow-Up Tasks

**High Priority** (fix critical failures):
- [ ] [Task 1 - scenario, fix description]
- [ ] [Task 2]

**Medium Priority** (improve quality/coverage):
- [ ] [Task 1]
- [ ] [Task 2]

**Low Priority** (nice-to-have):
- [ ] [Task 1]

---

### Recommended Configuration Changes

| Setting | Current | Suggested | Reason |
|---------|---------|-----------|--------|
| [ENV_VAR] | [value] | [value] | [reason] |

---

## Key Files Referenced

- `tests/regression/scenarios.ts` - Test scenario definitions
- `tests/regression/run.ts` - Test runner implementation
- `tests/regression/judge.ts` - LLM-as-judge quality evaluator
- `tests/regression/types.ts` - Type definitions
- `src/services/processor.service.ts` - Message processor and prompts
- `src/services/enhancedIntentClassifier.service.ts` - Intent classification
- `src/services/routing/llm-router.service.ts` - LLM request routing
- `src/services/routing/context-building.service.ts` - RAG context assembly
- `src/services/memory.service.ts` - Memory extraction and retrieval
- `src/types/intent.types.ts` - Intent type definitions
- `.env` - Environment configuration
