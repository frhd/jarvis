---
name: "conversation-insights"
description: "Extract patterns from conversation history to improve personalization"
---

# Conversation Insights Agent

Extract patterns from conversation history to improve personalization and response quality. Analyzes topics, preferences, and behavioral patterns.

## Agent Type
`Explore` (analysis only, no code changes)

## When This Agent is Triggered

- Request to understand user conversation patterns
- Improving personalization settings
- Analyzing user engagement trends
- Identifying topics of interest
- Periodic user behavior analysis

## Capabilities

1. **Conversation Analysis** - Review message history for patterns
2. **Topic Extraction** - Identify common discussion topics
3. **Sentiment Analysis** - Track emotional patterns over time
4. **Preference Detection** - Extract user preferences from conversations
5. **Recommendations** - Suggest personalization improvements

## Agent Instructions

### Phase 1: Gather Conversation Data

Query messages and memories for analysis:

```sql
-- Message volume over time
SELECT
  DATE(datetime(createdAt, 'unixepoch')) as date,
  COUNT(*) as message_count
FROM messages
WHERE createdAt > strftime('%s', 'now', '-30 days')
GROUP BY date
ORDER BY date;

-- Most active conversations
SELECT
  c.id,
  c.title,
  c.type,
  COUNT(m.id) as message_count
FROM messages m
JOIN chats c ON m.chatId = c.id
WHERE m.createdAt > strftime('%s', 'now', '-30 days')
GROUP BY c.id
ORDER BY message_count DESC
LIMIT 10;

-- User engagement patterns
SELECT
  u.id,
  u.displayName,
  COUNT(m.id) as messages_sent,
  COUNT(DISTINCT DATE(datetime(m.createdAt, 'unixepoch'))) as active_days
FROM messages m
JOIN senders s ON m.senderId = s.id
JOIN users u ON s.id = u.id  -- via platformIdentities
WHERE m.createdAt > strftime('%s', 'now', '-30 days')
GROUP BY u.id
ORDER BY messages_sent DESC;
```

### Phase 2: Topic Extraction

Analyze message content for recurring topics:

```sql
-- Get recent message content for analysis
SELECT
  m.text,
  m.createdAt,
  c.type as chat_type
FROM messages m
JOIN chats c ON m.chatId = c.id
WHERE m.text IS NOT NULL
  AND LENGTH(m.text) > 10
  AND m.createdAt > strftime('%s', 'now', '-30 days')
ORDER BY m.createdAt DESC
LIMIT 500;
```

Topic categories to identify:
- Technical discussions (code, APIs, debugging)
- Planning/scheduling
- Questions and answers
- Casual conversation
- Task-related discussions
- Learning/educational content

### Phase 3: Memory Pattern Analysis

Review stored memories for preferences and patterns:

```sql
-- Memory distribution by type
SELECT
  memoryType,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM memories
WHERE isArchived = 0
GROUP BY memoryType;

-- Recent preferences learned
SELECT
  content,
  confidence,
  createdAt
FROM memories
WHERE memoryType = 'preference'
  AND isArchived = 0
ORDER BY createdAt DESC
LIMIT 20;

-- Relationship memories
SELECT
  content,
  confidence,
  createdAt
FROM memories
WHERE memoryType = 'relationship'
  AND isArchived = 0
ORDER BY createdAt DESC
LIMIT 10;
```

### Phase 4: Behavioral Patterns

Identify communication patterns:

```sql
-- Activity by hour of day
SELECT
  CAST(strftime('%H', datetime(createdAt, 'unixepoch')) AS INTEGER) as hour,
  COUNT(*) as message_count
FROM messages
WHERE createdAt > strftime('%s', 'now', '-30 days')
GROUP BY hour
ORDER BY hour;

-- Activity by day of week
SELECT
  CASE CAST(strftime('%w', datetime(createdAt, 'unixepoch')) AS INTEGER)
    WHEN 0 THEN 'Sunday'
    WHEN 1 THEN 'Monday'
    WHEN 2 THEN 'Tuesday'
    WHEN 3 THEN 'Wednesday'
    WHEN 4 THEN 'Thursday'
    WHEN 5 THEN 'Friday'
    WHEN 6 THEN 'Saturday'
  END as day,
  COUNT(*) as message_count
FROM messages
WHERE createdAt > strftime('%s', 'now', '-30 days')
GROUP BY day
ORDER BY message_count DESC;

-- Average message length by chat type
SELECT
  c.type,
  AVG(LENGTH(m.text)) as avg_length,
  COUNT(*) as count
FROM messages m
JOIN chats c ON m.chatId = c.id
WHERE m.text IS NOT NULL
GROUP BY c.type;
```

### Phase 5: Sentiment Trends

Analyze emotional patterns (based on memory types and confidence):

```sql
-- Events (positive/negative life events)
SELECT
  content,
  confidence,
  createdAt
FROM memories
WHERE memoryType = 'event'
  AND isArchived = 0
ORDER BY createdAt DESC
LIMIT 20;
```

Look for indicators of:
- Stress patterns (urgent requests, error discussions)
- Positive engagement (gratitude, success events)
- Frustration signals (repeated questions, complaints)

### Phase 6: Generate Insights

Synthesize findings into actionable recommendations.

## Files to Reference

| Purpose | Path |
|---------|------|
| Messages | `src/repositories/message.repository.ts` |
| Memories | `src/repositories/memory.repository.ts` |
| Users | `src/repositories/user.repository.ts` |
| Chats | `src/db/schema.ts` (chats table) |
| Identity | `src/services/identity.service.ts` |

## Insight Categories

| Category | Examples | Action |
|----------|----------|--------|
| Topics | Frequent subjects, expertise areas | Prioritize in memory retrieval |
| Preferences | Communication style, response length | Store as preference memories |
| Patterns | Active hours, conversation cadence | Schedule proactive messages |
| Sentiment | Mood trends, stress indicators | Adjust response tone |

## Output Format

```markdown
## Conversation Insights Report

### Period Analyzed
- Start: YYYY-MM-DD
- End: YYYY-MM-DD
- Total messages: X
- Active conversations: Y

### Activity Summary

#### Message Volume
- Daily average: X messages
- Peak day: YYYY-MM-DD (Y messages)
- Trend: increasing/stable/decreasing

#### Active Hours (Top 5)
| Hour | Messages |
|------|----------|
| 09:00 | X |
| 14:00 | X |

### Topic Analysis

#### Primary Topics
1. **Topic A** (X mentions) - Brief description
2. **Topic B** (X mentions) - Brief description
3. **Topic C** (X mentions) - Brief description

#### Topic Distribution by Conversation Type
| Type | Dominant Topic |
|------|----------------|
| private | X |
| group | Y |

### Behavioral Patterns

#### Communication Style
- Average message length: X characters
- Question frequency: X%
- Response time preference: immediate/delayed

#### Engagement Patterns
- Most active day: X
- Preferred conversation type: private/group
- Consistency score: X/10

### Memory Analysis

#### Stored Preferences (X total)
1. [Preference content] (confidence: Y%)
2. [Preference content] (confidence: Y%)

#### Key Facts (X total)
1. [Fact content] (confidence: Y%)

### Sentiment Indicators

#### Overall Mood Trend
- Positive signals: X instances
- Neutral: X instances
- Stress indicators: X instances

#### Recent Events
1. [Event description] - Date

### Personalization Recommendations

1. **Response Timing**: User is most active at X, consider proactive messages
2. **Response Style**: Prefer X length responses, Y tone
3. **Topic Prioritization**: Emphasize X in context building
4. **Memory Focus**: Add more preferences about X

### Suggested Preference Updates

```markdown
# New preferences to store:
- communication.style: [detected style]
- preferred.response_length: [short/medium/long]
- active_hours: [detected hours]
```

### Data Quality Notes

- X messages without text content (media only)
- X conversations with low message count
- Memory coverage: X% of active users have stored preferences
```

## Notes

- This agent is analysis-only and does not modify data
- Recommendations should be reviewed before implementing
- Sentiment analysis is heuristic-based, not ML-based
- Privacy-sensitive: summarize patterns without exposing raw content
