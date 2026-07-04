# Loop Prevention Service

## Overview

The Loop Prevention Service detects and prevents conversation loops between the user and Jarvis. It identifies recurring patterns where conversations get stuck in repetitive cycles, learns from these patterns, and suggests strategies to break them.

## Features

### 1. Loop Detection
- **Frustration Detection**: Monitors user messages for frustration signals (repetition, shorter messages, caps usage, punctuation density, time compression)
- **Pattern Matching**: Compares conversations against a library of known loop patterns
- **LLM Analysis**: Uses LLM to detect novel loop patterns not in the database
- **Imperative Loop Detection**: Specifically detects when users repeat commands like "yes do it", "just do it", etc.

### 2. Pattern Learning
- Automatically learns new loop patterns from detected conversations
- Stores patterns with metadata (frequency, average duration, message count)
- Updates pattern statistics when loops recur
- Maintains confidence scores for each pattern

### 3. Loop Types

The service recognizes six types of conversation loops:

- **imperative_repeat**: User repeatedly gives commands/confirmations
- **clarification_loop**: User and bot stuck in clarification cycle
- **execution_hesitation**: Bot repeatedly asking for confirmation before acting
- **misunderstanding**: Repeated misunderstandings of user intent
- **context_lost**: Conversation loses track of previous context
- **custom**: Learned patterns that don't fit predefined categories

### 4. Breakpoint Strategies

For each loop type, the service suggests appropriate breakpoint strategies:

- `execute_pending_action`: Execute immediately without further confirmation
- `provide_detailed_explanation`: Give concrete examples or step-by-step breakdown
- `execute_with_confidence`: Act decisively with current information
- `rewind_and_clarify`: Acknowledge misunderstanding and start fresh
- `restore_context`: Summarize previous context and resume
- `manual_intervention`: Flag for human review

## Database Schema

### Loop Patterns Table
Stores learned conversation loop patterns:

```typescript
{
  id: string;                    // Unique identifier
  patternHash: string;           // SHA-256 hash of pattern (for deduplication)
  pattern: string;               // JSON array of message patterns
  loopType: LoopType;           // Type of loop (see above)
  frequency: number;             // How many times detected
  avgDurationMs: number;         // Average loop duration
  avgMessageCount: number;       // Average messages in loop
  resolutionStrategy: string;    // How to break the loop
  confidence: number;            // 0-1, pattern accuracy
  metadata: string;              // JSON: additional context
  lastOccurredAt: Date;         // When last detected
  isActive: boolean;             // Can be disabled
  createdAt: Date;
  updatedAt: Date;
}
```

### Loop Detections Table
Tracks actual loop occurrences:

```typescript
{
  id: string;                    // Unique identifier
  patternId: string;             // Reference to loopPatterns
  chatId: string;                // Which chat
  senderId: string;              // Which user
  messageIds: string;            // JSON array of message IDs
  messageCount: number;          // Number of messages
  durationMs: number;            // Loop duration
  wasResolved: boolean;          // Was it successfully broken
  resolutionAction: string;      // What action was taken
  userFeedback: number;          // -1, 0, 1 (negative, neutral, positive)
  detectedAt: Date;
}
```

## API

### Core Methods

#### `detectLoop(recentMessages, chatId, senderId?)`
Analyzes recent messages to detect if conversation is in a loop.

```typescript
const detection = await loopPreventionService.detectLoop(
  recentMessages,
  chatId,
  senderId
);

if (detection.detected) {
  console.log('Loop detected:', detection.loopType);
  console.log('Suggestion:', detection.suggestedBreakpoint);
}
```

**Returns:**
```typescript
{
  detected: boolean;
  loopType?: LoopType;
  patternId?: string;
  confidence: number;           // 0-1
  suggestedBreakpoint?: string;
  metadata?: {
    repetitionCount?: number;
    timeCompression?: boolean;
    frustrationLevel?: number;
    patternMatch?: string;
  };
}
```

#### `learnPattern(conversationPattern, loopType, resolutionStrategy, durationMs)`
Learn a new loop pattern from a conversation.

```typescript
await loopPreventionService.learnPattern(
  conversationPattern,
  'imperative_repeat',
  'execute_pending_action',
  15000 // 15 seconds
);
```

#### `markResolved(detectionId, resolutionAction, userFeedback?)`
Mark a detection as resolved with feedback.

```typescript
await loopPreventionService.markResolved(
  detectionId,
  'executed_action',
  1 // positive feedback
);
```

#### `getStats()`
Get overall loop prevention statistics.

```typescript
const stats = await loopPreventionService.getStats();
// {
//   totalPatterns: 15,
//   activePatterns: 12,
//   totalDetections: 47,
//   resolvedDetections: 42,
//   topLoopTypes: [
//     { type: 'imperative_repeat', count: 23 },
//     { type: 'clarification_loop', count: 12 }
//   ]
// }
```

#### `getPatternLibrary()`
Get all known loop patterns.

```typescript
const library = await loopPreventionService.getPatternLibrary();
// [
//   {
//     pattern: ['yes do it', 'just do it', 'execute'],
//     frequency: 23,
//     avgDuration: 12500,
//     resolutionStrategy: 'execute_pending_action'
//   },
//   ...
// ]
```

#### `suggestBreakpoint(detection)`
Get suggested breakpoint strategy for a detection.

```typescript
const strategy = loopPreventionService.suggestBreakpoint(detection);
// "Execute the pending action immediately without further confirmation"
```

## Frustration Detection

The service includes sophisticated frustration detection:

### Indicators
1. **Repeated Messages**: Same or similar messages sent multiple times
2. **Shorter Messages**: Message length decreasing (frustration → brevity)
3. **Caps Usage**: High ratio of capital letters (yelling)
4. **Punctuation Density**: Excessive use of !!! or ???
5. **Time Compression**: Messages coming faster (impatience)

### Frustration Level
Calculated on a 0-10 scale:
- 0-2: Normal conversation
- 3-4: Mild frustration
- 5-6: Moderate frustration (trigger action)
- 7-8: High frustration
- 9-10: Extreme frustration

When frustration level ≥ 5 AND imperative commands detected → Execute immediately

## Default Patterns

The service initializes with these default patterns:

1. **Imperative Repeat**
   - Keywords: "yes do it", "just do it", "execute", "go ahead", "proceed", "run it"
   - Strategy: `execute_pending_action`

2. **Clarification Loop**
   - Keywords: "what do you mean", "i dont understand", "can you explain", "clarify"
   - Strategy: `provide_detailed_explanation`

3. **Execution Hesitation**
   - Keywords: "should i", "do you want me to", "would you like", "shall i"
   - Strategy: `execute_with_confidence`

4. **Misunderstanding**
   - Keywords: "no that is not", "you misunderstood", "i meant", "actually"
   - Strategy: `rewind_and_clarify`

5. **Context Lost**
   - Keywords: "we were talking about", "going back to", "as i mentioned", "earlier"
   - Strategy: `restore_context`

## Integration Example

```typescript
import { loopPreventionService } from './services';
import { Message } from './types';

async function processMessage(message: Message, chatId: string, senderId: string) {
  // Get recent conversation history
  const recentMessages = await getRecentMessages(chatId, 10);

  // Check for loops
  const loopDetection = await loopPreventionService.detectLoop(
    recentMessages,
    chatId,
    senderId
  );

  if (loopDetection.detected && loopDetection.confidence > 0.7) {
    console.log(`Loop detected: ${loopDetection.loopType}`);
    console.log(`Frustration level: ${loopDetection.metadata?.frustrationLevel}`);

    // Get breakpoint strategy
    const strategy = loopPreventionService.suggestBreakpoint(loopDetection);
    console.log(`Suggested action: ${strategy}`);

    // Handle based on loop type
    if (loopDetection.loopType === 'imperative_repeat') {
      // User is frustrated and repeating commands - execute immediately
      await executePendingAction();

      // Mark as resolved with positive feedback
      if (loopDetection.patternId) {
        const detection = await findDetectionByPattern(loopDetection.patternId);
        if (detection) {
          await loopPreventionService.markResolved(
            detection.id,
            'executed_immediately',
            1 // positive
          );
        }
      }
    } else if (loopDetection.loopType === 'clarification_loop') {
      // Provide detailed explanation with examples
      await sendDetailedExplanation(message);
    }
  }

  // Continue with normal processing...
}
```

## Performance Considerations

### Caching
- Pattern library cached in memory for 5 minutes
- Reduces database queries for frequently accessed patterns
- Automatic cache refresh on pattern updates

### Efficiency
- Fast pattern matching using hash-based lookups
- LLM analysis only triggered when simple patterns don't match
- Frustration detection uses lightweight text analysis

### Scalability
- Indexed database queries for fast pattern lookups
- Optimized for high-frequency detection checks
- Batch operations for statistics gathering

## Monitoring & Analytics

### Key Metrics
- Total patterns learned
- Detection accuracy (based on user feedback)
- Average resolution time
- Most common loop types
- Patterns with highest frequency

### Feedback Loop
The service learns from user feedback:
- Positive feedback (1): Increases pattern confidence
- Neutral feedback (0): No change
- Negative feedback (-1): Decreases pattern confidence, may deactivate pattern

### Statistics Query
```typescript
const stats = await loopPreventionService.getStats();
console.log(`Active patterns: ${stats.activePatterns}`);
console.log(`Total detections: ${stats.totalDetections}`);
console.log(`Success rate: ${stats.resolvedDetections / stats.totalDetections * 100}%`);
console.log(`Top loop types:`, stats.topLoopTypes);
```

## Best Practices

1. **Check Regularly**: Run loop detection after every 3-5 messages in a conversation
2. **Respect Confidence**: Only take action on detections with confidence > 0.7
3. **Collect Feedback**: Always request user feedback after breaking a loop
4. **Update Patterns**: Periodically review and update pattern effectiveness
5. **Monitor Stats**: Track detection accuracy and adjust thresholds accordingly

## Future Enhancements

Potential improvements:
- Multi-language loop detection
- User-specific loop patterns (personalization)
- Proactive loop prevention (predict before it happens)
- Integration with sentiment analysis
- Real-time loop detection alerts
- Pattern clustering for better categorization
- A/B testing different breakpoint strategies

## Configuration

No explicit configuration required. The service auto-initializes with default patterns and adapts based on usage.

Optional environment variables (if added):
```env
LOOP_DETECTION_ENABLED=true
LOOP_CONFIDENCE_THRESHOLD=0.7
LOOP_MIN_MESSAGES=3
LOOP_FRUSTRATION_THRESHOLD=5
LOOP_CACHE_TTL_MS=300000  # 5 minutes
```

## Troubleshooting

### Issue: Too many false positives
**Solution**: Increase confidence threshold or adjust frustration detection sensitivity

### Issue: Loops not being detected
**Solution**:
- Verify LLM service is healthy
- Check if pattern library is populated
- Review recent messages count (need at least 3)

### Issue: Patterns not learning
**Solution**:
- Check database connectivity
- Verify loopPatternRepository is initialized
- Review error logs for pattern creation failures

## License

Part of Jarvis project. See main LICENSE file.
