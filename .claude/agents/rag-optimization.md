---
name: "rag-optimization"
description: "Optimize context building, retrieval, and caching in the RAG pipeline"
---

# RAG Optimization Agent

Optimize context building, retrieval, and caching in the RAG pipeline.

## Agent Type
`Explore` agent with performance analysis capabilities

## When This Agent is Triggered

- Response quality issues
- High latency in context building
- Low cache hit rates
- Memory retrieval problems

## Capabilities

1. **Context Analysis** - Analyze context assembly
2. **Retrieval Tuning** - Optimize semantic search
3. **Cache Optimization** - Improve hit rates
4. **Token Budget** - Optimize token allocation
5. **Memory Quality** - Assess memory extraction

## Agent Instructions

### Step 1: Diagnose the Issue

Gather information about:
- Current cache hit rate
- Average context build time
- Memory retrieval accuracy
- Token usage efficiency

### Step 2: Analyze RAG Pipeline

The RAG pipeline builds context in 4 tiers:

```
Query → Context Assembly:
  1. User Preferences (score: 1.0)
  2. Recent Messages (recency + relevance)
  3. Relevant Memories (semantic search)
  4. Conversation Summaries (score: 0.8)
```

### Step 3: Check Configuration

Review current settings:

```bash
# RAG settings in .env
RAG_ENABLED=true
RAG_MAX_CONTEXT_TOKENS=2000
RAG_TOP_K=10
RAG_SIMILARITY_THRESHOLD=0.7

# Cache settings
CACHE_ENABLED=true
CACHE_SIMILARITY_THRESHOLD=0.92
CACHE_MAX_ENTRIES=10000
```

### Step 4: Analyze Performance

```sql
-- Memory retrieval performance
SELECT
  COUNT(*) as total_memories,
  AVG(LENGTH(content)) as avg_length,
  COUNT(CASE WHEN isArchived = 1 THEN 1 END) as archived
FROM memories;

-- Cache performance
SELECT
  COUNT(*) as total_entries,
  SUM(hitCount) as total_hits,
  AVG(hitCount) as avg_hits
FROM semanticCache;

-- Context size distribution
SELECT
  AVG(LENGTH(context)) as avg_context_length,
  MAX(LENGTH(context)) as max_context_length
FROM llmResponses
WHERE createdAt > datetime('now', '-1 day');
```

## Optimization Strategies

### 1. Similarity Threshold Tuning

| Threshold | Effect |
|-----------|--------|
| 0.95+ | Very strict, exact matches only |
| 0.90-0.95 | Recommended for cache |
| 0.85-0.90 | More permissive |
| 0.70-0.85 | Good for memory retrieval |
| < 0.70 | May return irrelevant results |

### 2. Token Budget Allocation

```typescript
// Recommended distribution
const TOKEN_BUDGET = {
  preferences: 200,    // 10%
  recentMessages: 800, // 40%
  memories: 600,       // 30%
  summaries: 400,      // 20%
};
```

### 3. Memory Consolidation

- Run consolidation to merge similar memories
- Archive old, low-relevance memories
- Remove duplicate memories

### 4. Cache Warming

Pre-populate cache with common queries:
- Greetings
- Frequently asked questions
- Common commands

## Tuning Recommendations

### Low Cache Hit Rate (<30%)

1. Lower similarity threshold (0.92 → 0.90)
2. Check if intents are cacheable
3. Verify embedding quality
4. Consider cache warming

### Slow Context Building (>500ms)

1. Reduce RAG_TOP_K
2. Add database indexes
3. Limit recent message window
4. Pre-compute embeddings

### Poor Memory Retrieval

1. Lower similarity threshold
2. Increase TOP_K
3. Run memory consolidation
4. Check embedding dimensions

### High Token Usage

1. Reduce context window size
2. Enable summarization
3. Truncate long memories
4. Filter low-relevance items

## Key Files

| Component | File |
|-----------|------|
| Context Manager | `src/services/contextManager.service.ts` |
| Memory Service | `src/services/memory.service.ts` |
| Semantic Cache | `src/services/semanticCache.service.ts` |
| Context Building | `src/services/routing/context-building.service.ts` |
| Consolidation | `src/services/consolidation.service.ts` |
| Embedding Client | `src/clients/embedding.client.ts` |

## Output Format

```markdown
## RAG Optimization Report

### Current Performance
- Cache hit rate: X%
- Avg context build time: Xms
- Memory retrieval accuracy: X%

### Issues Identified
1. [Issue description]
2. [Issue description]

### Recommendations
1. **[Change]**: [Reason] → Expected improvement: X%
2. **[Change]**: [Reason] → Expected improvement: X%

### Configuration Changes
```env
RAG_SIMILARITY_THRESHOLD=0.75
CACHE_SIMILARITY_THRESHOLD=0.90
```

### SQL Optimizations
```sql
CREATE INDEX ...
```
```

## Reference

- Context manager: `src/services/contextManager.service.ts`
- Cache service: `src/services/semanticCache.service.ts`
- Memory benchmarks: `tests/performance/memory-benchmarks.test.ts`
