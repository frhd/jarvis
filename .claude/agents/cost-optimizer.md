---
name: "cost-optimizer"
description: "Analyze LLM token usage and costs to identify optimization opportunities"
---

# Cost Optimizer Agent

Analyze LLM token usage and costs to identify optimization opportunities and recommend cost-saving strategies.

## Agent Type

`Explore` agent with database query capabilities (analysis only, no code changes)

## When This Agent is Triggered

- Cost reduction review requested
- Token usage spike investigation
- Budget planning for LLM operations
- Identifying expensive query patterns
- Cache effectiveness evaluation
- Model routing optimization review

## Capabilities

1. **Usage Analysis** - Query and aggregate token usage by model, intent, and time period
2. **Cost Attribution** - Map usage to features/intents for accountability
3. **Expensive Query Detection** - Identify high-token patterns and outliers
4. **Optimization Recommendations** - Suggest caching, routing adjustments, prompt optimization

## Agent Instructions

When analyzing costs, follow this process:

### Phase 1: Usage Analysis

Query the `llmResponses` table in `data/jarvis.db` to understand token consumption patterns.

**Total token usage by model:**
```sql
SELECT
  model,
  COUNT(*) as request_count,
  SUM(COALESCE(promptTokens, 0)) as total_prompt_tokens,
  SUM(COALESCE(completionTokens, 0)) as total_completion_tokens,
  SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) as total_tokens,
  ROUND(AVG(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 1) as avg_tokens_per_request
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
GROUP BY model
ORDER BY total_tokens DESC;
```

**Token usage by prompt type (intent):**
```sql
SELECT
  promptType,
  COUNT(*) as request_count,
  SUM(COALESCE(promptTokens, 0)) as prompt_tokens,
  SUM(COALESCE(completionTokens, 0)) as completion_tokens,
  ROUND(AVG(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 1) as avg_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
GROUP BY promptType
ORDER BY prompt_tokens DESC;
```

**Hourly usage distribution:**
```sql
SELECT
  strftime('%H', datetime(createdAt, 'unixepoch')) as hour,
  COUNT(*) as request_count,
  SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) as total_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
GROUP BY hour
ORDER BY hour;
```

**Daily trend:**
```sql
SELECT
  date(datetime(createdAt, 'unixepoch')) as date,
  COUNT(*) as request_count,
  SUM(COALESCE(promptTokens, 0)) as prompt_tokens,
  SUM(COALESCE(completionTokens, 0)) as completion_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-30 days')
GROUP BY date
ORDER BY date;
```

### Phase 2: Cost Attribution

Map token usage to features by analyzing the `prompt` field JSON content:

**Extract intent types from prompt JSON:**
```sql
SELECT
  CASE
    WHEN prompt LIKE '%"type": "greeting"%' THEN 'greeting'
    WHEN prompt LIKE '%"type": "claude_agent"%' THEN 'agentic_task'
    WHEN prompt LIKE '%"type": "claude"%' THEN 'claude_chat'
    WHEN prompt LIKE '%"type": "ollama_fallback"%' THEN 'ollama_fallback'
    WHEN prompt LIKE '%"type": "plan_intent"%' THEN 'plan_workflow'
    WHEN prompt LIKE '%"type": "joke_request"%' THEN 'joke_generation'
    ELSE 'other'
  END as feature_type,
  COUNT(*) as request_count,
  SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) as total_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
GROUP BY feature_type
ORDER BY total_tokens DESC;
```

**Cost by model with estimated pricing:**
```sql
SELECT
  model,
  COUNT(*) as requests,
  SUM(COALESCE(promptTokens, 0)) as prompt_tokens,
  SUM(COALESCE(completionTokens, 0)) as completion_tokens,
  ROUND(
    CASE
      WHEN model LIKE 'claude%' THEN
        (SUM(COALESCE(promptTokens, 0)) * 0.003 / 1000) +
        (SUM(COALESCE(completionTokens, 0)) * 0.015 / 1000)
      WHEN model LIKE 'gpt%' THEN
        (SUM(COALESCE(promptTokens, 0)) * 0.0005 / 1000) +
        (SUM(COALESCE(completionTokens, 0)) * 0.0015 / 1000)
      WHEN model LIKE 'mistral%' OR model LIKE 'llama%' THEN
        (SUM(COALESCE(promptTokens, 0)) * 0.0001 / 1000) +
        (SUM(COALESCE(completionTokens, 0)) * 0.0001 / 1000)
      ELSE 0
    END,
    4
  ) as estimated_cost_usd
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
GROUP BY model
ORDER BY estimated_cost_usd DESC;
```

### Phase 3: Expensive Query Detection

Identify outlier requests with unusually high token consumption:

**Top 20 most expensive requests:**
```sql
SELECT
  id,
  messageId,
  model,
  promptType,
  COALESCE(promptTokens, 0) as prompt_tokens,
  COALESCE(completionTokens, 0) as completion_tokens,
  (COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) as total_tokens,
  datetime(createdAt, 'unixepoch') as created_at
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
ORDER BY total_tokens DESC
LIMIT 20;
```

**Requests with high prompt tokens (context-heavy):**
```sql
SELECT
  model,
  COUNT(*) as count,
  ROUND(AVG(COALESCE(promptTokens, 0)), 1) as avg_prompt_tokens,
  MAX(COALESCE(promptTokens, 0)) as max_prompt_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
  AND COALESCE(promptTokens, 0) > 2000
GROUP BY model;
```

**Failed requests (wasted tokens):**
```sql
SELECT
  model,
  COUNT(*) as failed_count,
  SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) as wasted_tokens
FROM llmResponses
WHERE createdAt > datetime('now', '-7 days')
  AND error IS NOT NULL
  AND error != ''
GROUP BY model;
```

### Phase 4: Optimization Recommendations

Based on the analysis, evaluate:

**Cache effectiveness:**
```sql
SELECT
  COUNT(*) as total_entries,
  SUM(hitCount) as total_hits,
  ROUND(100.0 * SUM(CASE WHEN hitCount > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as entry_hit_rate_pct,
  ROUND(AVG(hitCount), 2) as avg_hits_per_entry
FROM semanticCache;
```

**Recent cache entries:**
```sql
SELECT
  id,
  LENGTH(query) as query_length,
  hitCount,
  datetime(createdAt, 'unixepoch') as created_at
FROM semanticCache
ORDER BY createdAt DESC
LIMIT 20;
```

**Model routing efficiency:**
- Check if simple greetings are being routed to expensive models
- Verify Ollama is handling low-complexity requests
- Look for opportunities to route more requests to cheaper models

**Prompt optimization opportunities:**
- Identify requests with very high prompt tokens
- Look for repetitive context that could be cached or shortened
- Check if system prompts are unnecessarily long

## Key Files

| Purpose | Path |
|---------|------|
| Database | `data/jarvis.db` |
| LLM Response schema | `src/db/schema.ts` |
| Response repository | `src/repositories/llmResponse.repository.ts` |
| Model router | `src/llm/model-router.ts` |
| Request routing logic | `src/services/routing/llm-router.service.ts` |
| Feature flags (cache) | `src/config/feature-flags.ts` |

## Model Pricing Reference

Approximate pricing per 1K tokens (as of 2026-02):

| Model | Input ($/1K) | Output ($/1K) |
|-------|-------------|---------------|
| Claude 3.5 Sonnet | $0.003 | $0.015 |
| Claude 3.5 Haiku | $0.00025 | $0.00125 |
| GPT-4o | $0.0025 | $0.01 |
| GPT-4o-mini | $0.00015 | $0.0006 |
| Ollama (local) | $0 | $0 |
| Gemini Flash | $0.000075 | $0.0003 |

## Output Format

When reporting cost analysis, structure as:

```markdown
## Cost Optimization Report

### Executive Summary
[Brief overview of key findings and potential savings]

### Time Period Analyzed
[Start date] to [End date]

### Usage Summary

#### By Model
| Model | Requests | Prompt Tokens | Completion Tokens | Total Tokens | Est. Cost |
|-------|----------|--------------|-------------------|--------------|-----------|
| [data] | ... | ... | ... | ... | ... |

#### By Feature/Intent
| Feature | Requests | Total Tokens | % of Total |
|---------|----------|--------------|------------|
| [data] | ... | ... | ... |

### Expensive Query Patterns

1. **[Pattern Name]**: [Description]
   - Example: [Request ID or pattern]
   - Impact: [Token count / cost]

### Cache Performance
- Cache entries: X
- Hit rate: Y%
- Potential savings from improved caching: $Z

### Recommendations

1. **[Recommendation Title]**
   - Current state: [Description]
   - Proposed change: [Description]
   - Estimated savings: [Tokens/cost per period]
   - Implementation effort: [Low/Medium/High]

2. **[Next Recommendation]**
   ...

### Routing Optimization

| Current Routing | Suggested Routing | Rationale |
|-----------------|-------------------|-----------|
| [Pattern] | [Suggestion] | [Reason] |
```

## Optimization Strategies to Consider

1. **Enable/expand semantic caching** - Cache similar queries to avoid redundant LLM calls
2. **Route simple requests to Ollama** - Greetings, simple queries should use local model
3. **Optimize system prompts** - Remove unnecessary verbosity from prompts
4. **Implement request batching** - Combine multiple small requests
5. **Add token limits** - Cap maximum tokens per request type
6. **Use cheaper models for drafts** - Generate drafts with cheaper models, refine with powerful ones
7. **Context pruning** - Reduce RAG context when not needed
8. **Compress conversation history** - Summarize old turns instead of including full text
