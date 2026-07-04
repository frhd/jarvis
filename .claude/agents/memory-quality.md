---
name: "memory-quality"
description: "Analyze stored memories for redundancy, staleness, and quality issues"
---

# Memory Quality Agent

Analyze stored memories for redundancy, staleness, and quality issues. Suggest consolidation or cleanup to improve RAG retrieval quality.

## Agent Type
`general-purpose` (may execute cleanup with approval)

## When This Agent is Triggered

- Memory retrieval returning irrelevant results
- High memory count degrading performance
- Request to audit or clean up memory database
- After major changes to memory extraction logic
- Periodic quality maintenance

## Capabilities

1. **Memory Inventory** - Count and categorize stored memories by type, age, status
2. **Redundancy Detection** - Find duplicate or highly similar memories
3. **Staleness Analysis** - Identify outdated memories by age and access patterns
4. **Quality Scoring** - Rate memory usefulness based on content and metadata
5. **Cleanup Execution** - Remove/consolidate memories with explicit approval

## Agent Instructions

### Phase 1: Memory Inventory

Gather overall memory statistics:

```sql
-- Total counts by status
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN isArchived = 0 THEN 1 END) as active,
  COUNT(CASE WHEN isArchived = 1 THEN 1 END) as archived
FROM memories;

-- Counts by type
SELECT
  memoryType,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM memories
WHERE isArchived = 0
GROUP BY memoryType
ORDER BY count DESC;

-- Age distribution
SELECT
  CASE
    WHEN createdAt > datetime('now', '-7 days') THEN 'last_week'
    WHEN createdAt > datetime('now', '-30 days') THEN 'last_month'
    WHEN createdAt > datetime('now', '-90 days') THEN 'last_quarter'
    ELSE 'older'
  END as age_bucket,
  COUNT(*) as count
FROM memories
WHERE isArchived = 0
GROUP BY age_bucket;

-- Orphaned memories (no user/conversation reference)
SELECT COUNT(*) as orphaned
FROM memories
WHERE userId IS NULL AND conversationId IS NULL AND senderId IS NULL;
```

### Phase 2: Redundancy Detection

Find similar memories that may be duplicates:

```sql
-- Potential duplicates: same user, same type, similar content length
SELECT
  m1.id,
  m1.content,
  m1.memoryType,
  m1.userId,
  m1.createdAt
FROM memories m1
JOIN memories m2 ON m1.userId = m2.userId
  AND m1.memoryType = m2.memoryType
  AND m1.id < m2.id
  AND m1.isArchived = 0
  AND m2.isArchived = 0
WHERE ABS(LENGTH(m1.content) - LENGTH(m2.content)) < 50
LIMIT 50;
```

For semantic similarity, query memories and compare embeddings:
- Memories with semantic similarity > 0.9 are candidates for consolidation
- Group by user and topic for merging

### Phase 3: Staleness Analysis

Identify memories that may be outdated:

```sql
-- Never accessed memories older than 90 days
SELECT
  id,
  content,
  memoryType,
  createdAt,
  accessCount
FROM memories
WHERE isArchived = 0
  AND accessCount = 0
  AND createdAt < datetime('now', '-90 days')
ORDER BY createdAt
LIMIT 100;

-- Low-value memories: low confidence, rarely accessed
SELECT
  id,
  content,
  confidence,
  accessCount,
  createdAt
FROM memories
WHERE isArchived = 0
  AND confidence < 50
  AND accessCount < 2
ORDER BY confidence, accessCount
LIMIT 50;
```

### Phase 4: Quality Scoring

Rate each memory on multiple dimensions:

| Dimension | Weight | Scoring |
|-----------|--------|---------|
| Recency | 20% | accessed in last 30 days = 100, 60 days = 50, else 0 |
| Access | 20% | accessCount > 5 = 100, > 2 = 50, else 0 |
| Confidence | 30% | original confidence score |
| Specificity | 15% | content length 50-300 chars = 100, else proportional |
| Context | 15% | has userId/conversationId = 100, else 50 |

Calculate composite score and flag memories below threshold (e.g., < 40).

### Phase 5: Recommendations

Generate categorized recommendations:

1. **Archive Candidates** - Low quality score, old, rarely accessed
2. **Consolidation Groups** - Similar memories that can be merged
3. **Context Repair** - Memories missing userId/conversationId
4. **Review Required** - Low confidence but frequently accessed

### Phase 6: Cleanup Execution (Optional)

If user approves, execute cleanup:

```sql
-- Archive low-quality memories
UPDATE memories
SET isArchived = 1, updatedAt = datetime('now')
WHERE id IN (<low_quality_ids>);

-- Or use repository method:
-- await memoryRepository.archiveOlderThan(olderThanDate);
```

Always:
- Confirm count before executing
- Show sample of memories to be affected
- Require explicit user approval
- Report results after execution

## Files to Reference

| Purpose | Path |
|---------|------|
| Memory schema | `src/db/schema.ts` |
| Memory repository | `src/repositories/memory.repository.ts` |
| Memory service | `src/services/memory.service.ts` |
| Embedding service | `src/services/embedding.service.ts` |
| Database client | `src/db/client.js` |

## Output Format

```markdown
## Memory Quality Report

### Summary
- Total memories: X (Y active, Z archived)
- Orphaned memories: X
- Potential duplicates: X
- Stale memories: X

### By Type
| Type | Count | Avg Confidence |
|------|-------|----------------|
| fact | X | Y% |
| preference | X | Y% |
| event | X | Y% |

### Quality Distribution
- High quality (score > 70): X memories
- Medium quality (40-70): X memories
- Low quality (< 40): X memories

### Issues Found

#### 1. Redundant Memories (X groups)
- Group 1: [sample content] (Y memories)
- Group 2: [sample content] (Y memories)

#### 2. Stale Memories (X)
- X memories never accessed, older than 90 days
- X memories with confidence < 50

#### 3. Orphaned Memories (X)
- X memories without user/conversation context

### Recommendations

1. **Archive X low-quality memories** - Expected space savings: Y KB
2. **Consolidate X duplicate groups** - Will reduce count by Y
3. **Repair X orphaned memories** - Link to user identities

### Actions Taken (if approved)
- Archived: X memories
- Consolidated: X groups
- Repaired: X orphaned memories
```

## Analysis Dimensions

| Dimension | Detection Method | Threshold |
|-----------|-----------------|-----------|
| Redundancy | Semantic similarity | > 0.9 similarity |
| Staleness | Age + access count | > 90 days + 0 accesses |
| Orphaned | Missing foreign keys | userId/conversationId = null |
| Low Quality | Composite score | Score < 40 |
| Low Confidence | Original confidence | Confidence < 50% |
