# Loop Prevention Service - Quick Start Guide

## Installation

The service is already integrated into Jarvis. Just run the database migration:

```bash
npm run db:migrate
```

This creates the `loopPatterns` and `loopDetections` tables.

## Basic Usage

### 1. Import the Service

```typescript
import { loopPreventionService } from './services';
```

### 2. Detect Loops in Conversation

```typescript
// Get recent messages from the conversation
const recentMessages: Message[] = await messageRepository.findByChatId(chatId, 10);

// Detect if there's a loop
const detection = await loopPreventionService.detectLoop(
  recentMessages,
  chatId,
  senderId
);

if (detection.detected) {
  console.log('Loop detected!');
  console.log('Type:', detection.loopType);
  console.log('Confidence:', detection.confidence);
  console.log('Suggested action:', detection.suggestedBreakpoint);
}
```

### 3. Act on Loop Detection

```typescript
if (detection.detected && detection.confidence > 0.7) {
  switch (detection.loopType) {
    case 'imperative_repeat':
      // User is frustrated and repeating commands
      console.log('User frustrated - executing immediately');
      await executePendingAction();
      break;

    case 'clarification_loop':
      // Provide detailed explanation
      await sendDetailedResponse(chatId);
      break;

    case 'execution_hesitation':
      // Stop asking, just do it
      await executeWithConfidence();
      break;

    default:
      // Log and handle manually
      console.log('Unknown loop type:', detection.loopType);
      await sendFallbackResponse(chatId);
  }
}
```

### 4. Mark Resolution (Optional)

```typescript
// If you track detection IDs, mark them as resolved
await loopPreventionService.markResolved(
  detectionId,
  'executed_action',
  1 // positive feedback
);
```

## Real-World Integration Example

Here's how to integrate into your message handler:

```typescript
import { loopPreventionService } from './services';
import { Message } from './types';

export async function handleUserMessage(
  message: Message,
  chatId: string,
  senderId: string
) {
  // Get conversation history
  const recentMessages = await messageRepository.findByChatId(chatId, 10);
  recentMessages.push(message);

  // Check for loops
  const loopDetection = await loopPreventionService.detectLoop(
    recentMessages,
    chatId,
    senderId
  );

  // Handle based on detection
  if (loopDetection.detected && loopDetection.confidence > 0.7) {
    logger.warn('[Loop Detected]', {
      type: loopDetection.loopType,
      confidence: loopDetection.confidence,
      frustration: loopDetection.metadata?.frustrationLevel,
    });

    // Get breakpoint strategy
    const strategy = loopPreventionService.suggestBreakpoint(loopDetection);
    logger.info('[Loop Strategy]', { strategy });

    // Execute strategy
    switch (loopDetection.loopType) {
      case 'imperative_repeat':
        // High frustration + repeated imperatives = execute now
        const pendingAction = await getPendingAction(chatId);
        if (pendingAction) {
          await executeAction(pendingAction);
          await sendConfirmation(chatId, 'Done! Executed immediately.');
        }
        break;

      case 'clarification_loop':
        // Break with concrete example
        await sendMessage(chatId, {
          text: 'Let me show you a concrete example...',
          includeExample: true,
        });
        break;

      case 'execution_hesitation':
        // Stop hesitating, act decisively
        await executeWithoutAsking(chatId);
        break;

      case 'misunderstanding':
        // Acknowledge and restart
        await sendMessage(chatId, {
          text: "I think I misunderstood. Let's start fresh. What exactly do you need?",
        });
        break;

      case 'context_lost':
        // Restore context
        const previousContext = await getConversationSummary(chatId);
        await sendMessage(chatId, {
          text: `To recap: ${previousContext}. Where would you like to continue?`,
        });
        break;
    }

    return; // Exit early, don't continue normal processing
  }

  // Normal message processing continues...
  await processNormalMessage(message, chatId, senderId);
}
```

## Monitoring Loop Prevention

### Get Statistics

```typescript
const stats = await loopPreventionService.getStats();

console.log(`
Loop Prevention Statistics:
- Total Patterns: ${stats.totalPatterns}
- Active Patterns: ${stats.activePatterns}
- Total Detections: ${stats.totalDetections}
- Resolved: ${stats.resolvedDetections}
- Success Rate: ${(stats.resolvedDetections / stats.totalDetections * 100).toFixed(1)}%

Top Loop Types:
${stats.topLoopTypes.map(t => `  - ${t.type}: ${t.count}`).join('\n')}
`);
```

### View Pattern Library

```typescript
const library = await loopPreventionService.getPatternLibrary();

console.log('Known Loop Patterns:');
library.forEach((sig, idx) => {
  console.log(`
${idx + 1}. Pattern
   - Keywords: ${sig.pattern.join(', ')}
   - Frequency: ${sig.frequency}
   - Avg Duration: ${sig.avgDuration}ms
   - Resolution: ${sig.resolutionStrategy}
  `);
});
```

## Testing Loop Detection

### Test with Mock Messages

```typescript
// Create test messages simulating a loop
const testMessages: Message[] = [
  { text: 'Can you do X for me?', isBot: false, createdAt: new Date('2025-12-25T10:00:00') },
  { text: 'Would you like me to do X?', isBot: true, createdAt: new Date('2025-12-25T10:00:02') },
  { text: 'Yes, do it', isBot: false, createdAt: new Date('2025-12-25T10:00:05') },
  { text: 'Should I proceed with X?', isBot: true, createdAt: new Date('2025-12-25T10:00:07') },
  { text: 'YES DO IT', isBot: false, createdAt: new Date('2025-12-25T10:00:09') },
];

const detection = await loopPreventionService.detectLoop(
  testMessages,
  'test-chat',
  'test-user'
);

console.log('Detection result:', detection);
// Expected: detected=true, loopType='imperative_repeat', high confidence
```

## Common Patterns

### 1. High Frustration Override

```typescript
if (
  detection.detected &&
  detection.loopType === 'imperative_repeat' &&
  detection.metadata?.frustrationLevel >= 7
) {
  // CRITICAL: User is very frustrated - bypass all checks
  logger.alert('[High Frustration]', { level: detection.metadata.frustrationLevel });
  await executeImmediately();
  await sendApology('Sorry for the confusion. Done!');
}
```

### 2. Learning from New Patterns

```typescript
// If a loop was detected but no pattern ID, learn it
if (detection.detected && !detection.patternId && detection.loopType) {
  const conversationPattern = extractConversationPattern(recentMessages);
  const durationMs = calculateDuration(recentMessages);

  await loopPreventionService.learnPattern(
    conversationPattern,
    detection.loopType,
    detection.suggestedBreakpoint || 'manual_intervention',
    durationMs
  );

  logger.info('[New Pattern Learned]', { type: detection.loopType });
}
```

### 3. Confidence-Based Actions

```typescript
if (detection.detected) {
  if (detection.confidence >= 0.9) {
    // Very confident - take action immediately
    await executeBreakpoint(detection);
  } else if (detection.confidence >= 0.7) {
    // Moderately confident - ask for confirmation
    await askForConfirmation(chatId, detection);
  } else {
    // Low confidence - just log
    logger.info('[Possible Loop]', { confidence: detection.confidence });
  }
}
```

## Performance Tips

1. **Batch Detection**: Don't check every message, check every 3-5 messages
2. **Cache Patterns**: Service caches patterns for 5 minutes automatically
3. **Limit History**: Pass only last 10-15 messages to detectLoop()
4. **Early Exit**: If confidence < 0.5, skip further processing

## Debugging

### Enable Debug Logging

```typescript
import { logger } from './utils/logger';

// Before calling detectLoop
logger.setLevel('debug');

const detection = await loopPreventionService.detectLoop(
  recentMessages,
  chatId,
  senderId
);

// Check logs for detailed detection steps
```

### Inspect Detection Metadata

```typescript
if (detection.detected) {
  console.log('Detection Metadata:', {
    repetitionCount: detection.metadata?.repetitionCount,
    timeCompression: detection.metadata?.timeCompression,
    frustrationLevel: detection.metadata?.frustrationLevel,
    patternMatch: detection.metadata?.patternMatch,
  });
}
```

## Advanced Usage

### Custom Resolution Strategies

```typescript
// Override default breakpoint suggestions
const customStrategy = (detection: LoopDetectionResult) => {
  if (detection.loopType === 'imperative_repeat') {
    // Custom handling for imperative loops
    return 'execute_with_notification';
  }
  return loopPreventionService.suggestBreakpoint(detection);
};

const strategy = customStrategy(detection);
await executeStrategy(strategy, chatId);
```

### Feedback Collection

```typescript
// After resolving a loop, ask for feedback
await resolveLoop(detection);

// Send feedback prompt
const feedback = await askUserFeedback(chatId, {
  question: 'Did that help break the loop?',
  options: ['Yes', 'No', 'Somewhat'],
});

// Map to numeric feedback
const numericFeedback = {
  'Yes': 1,
  'Somewhat': 0,
  'No': -1,
}[feedback];

// Record feedback
await loopPreventionService.markResolved(
  detectionId,
  'custom_resolution',
  numericFeedback
);
```

## Troubleshooting

### "No patterns detected"
- **Cause**: Pattern library not initialized
- **Fix**: Ensure migration ran successfully, check logs for initialization

### "Low confidence detections"
- **Cause**: Insufficient message history or unclear patterns
- **Fix**: Pass more messages (10-15) to detectLoop()

### "False positives"
- **Cause**: Threshold too low
- **Fix**: Increase confidence threshold to 0.8 or 0.9

### "Missed real loops"
- **Cause**: Threshold too high or pattern not learned
- **Fix**: Lower threshold to 0.6, review pattern library

## Next Steps

1. **Integrate**: Add to your message processing pipeline
2. **Monitor**: Track statistics regularly
3. **Optimize**: Adjust confidence thresholds based on results
4. **Extend**: Add custom loop types if needed
5. **Learn**: Let the system learn patterns over time

For detailed documentation, see `loopPrevention.README.md`.
