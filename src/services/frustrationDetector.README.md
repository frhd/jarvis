# FrustrationDetectorService

A production-ready service for detecting user frustration in conversational AI systems. Part of the Jarvis project's effort to create a more empathetic and responsive assistant.

## Overview

The FrustrationDetectorService analyzes conversation patterns to detect when users are becoming frustrated. It uses multiple signals to calculate a frustration level from 0-10 and can trigger special handling when frustration exceeds configurable thresholds.

## Features

- **Multi-Signal Detection**: Analyzes 5 different frustration indicators
  - Message repetition (user repeating the same request)
  - Message length decline (getting terse)
  - Caps usage (excessive capitalization)
  - Punctuation density (excessive !!! or ???)
  - Time compression (rapid-fire messages)

- **Configurable Thresholds**: Adjust sensitivity for different use cases
- **Action Threshold**: Automatic flag when intervention is needed (default: 5/10)
- **Sender Filtering**: Analyze specific users in multi-user chats
- **Production Ready**: Full TypeScript support, comprehensive tests, logging

## Installation

The service is already integrated into the Jarvis project and exported from `src/services/index.ts`:

```typescript
import { frustrationDetectorService } from './services/index.js';
```

## Basic Usage

```typescript
import { frustrationDetectorService } from './services/index.js';

// Analyze recent conversation messages (most recent first)
const result = await frustrationDetectorService.analyze(messages);

console.log(result.level);        // 0-10
console.log(result.needsAction);  // true if level >= threshold
console.log(result.indicators);   // Breakdown of signals
console.log(result.reasoning);    // Human-readable explanation
```

## API Reference

### Main Methods

#### `analyze(messages: Message[], senderId?: string): Promise<FrustrationMetrics>`

Analyzes a conversation for frustration signals.

**Parameters:**
- `messages`: Array of Message objects (most recent first)
- `senderId`: Optional - filter to specific user's messages

**Returns:** `FrustrationMetrics` object with:
- `level`: Frustration score (0-10)
- `indicators`: Breakdown of specific signals detected
- `threshold`: Action threshold (default: 5)
- `needsAction`: Boolean indicating if level >= threshold
- `reasoning`: Array of human-readable explanations

**Example:**
```typescript
const metrics = await frustrationDetectorService.analyze(messages, 'user123');

if (metrics.needsAction) {
  // User is frustrated - adjust behavior
  console.log('Frustration detected:', metrics.reasoning);
}
```

#### `isFrustrated(messages: Message[], senderId?: string): Promise<boolean>`

Quick check if user is frustrated (level >= action threshold).

**Example:**
```typescript
if (await frustrationDetectorService.isFrustrated(messages)) {
  // Execute pending actions immediately
  // Skip confirmations
  // Be more decisive
}
```

#### `getFrustrationLevel(messages: Message[], senderId?: string): Promise<number>`

Get just the frustration level (0-10).

**Example:**
```typescript
const level = await frustrationDetectorService.getFrustrationLevel(messages);
console.log(`Frustration: ${level}/10`);
```

### Configuration Methods

#### `getConfig(): FrustrationDetectorConfig`

Get current configuration.

#### `updateConfig(updates: Partial<FrustrationDetectorConfig>): void`

Update configuration dynamically.

**Example:**
```typescript
// Make detector more sensitive
frustrationDetectorService.updateConfig({
  actionThreshold: 3,  // Lower threshold (default: 5)
  capsUsageThreshold: 0.2  // More sensitive to caps (default: 0.3)
});
```

## Configuration Options

```typescript
interface FrustrationDetectorConfig {
  timeCompressionWindowMs: number;      // Time window for rapid messages (default: 60000)
  messageCompressionThreshold: number;  // Min messages in window (default: 3)
  repetitionSimilarityThreshold: number; // Similarity threshold 0-1 (default: 0.7)
  messageLengthDeclineThreshold: number; // % decline to trigger (default: 0.4)
  capsUsageThreshold: number;           // Caps ratio to score (default: 0.3)
  punctuationDensityThreshold: number;  // Punctuation ratio (default: 0.15)
  actionThreshold: number;              // Score for action (default: 5)
  analysisWindowSize: number;           // Recent messages to analyze (default: 10)
}
```

## Frustration Indicators

### 1. Repeated Messages
Detects when user repeats similar requests. Uses Jaccard similarity to identify semantically similar messages.

**Example:**
```
User: "Can you do this?"
Bot:  "Sure!"
User: "Can you do this please?"  ← Detected as repetition
```

**Score Impact:** +2 per repetition

### 2. Message Length Decline
Detects when messages get progressively shorter (user getting terse).

**Example:**
```
User: "I would like you to help me..."  (86 chars)
User: "Can you do it now?"              (19 chars)
User: "Now?"                            (4 chars)
User: "???"                             (3 chars) ← Declining length
```

**Score Impact:** +2 if detected

### 3. Caps Usage
Detects excessive use of capital letters.

**Example:**
```
User: "PLEASE DO THIS NOW"  ← High caps usage
```

**Score Impact:** +2 if ratio > 0.3

### 4. Punctuation Density
Detects excessive use of exclamation marks and question marks.

**Example:**
```
User: "Are you there???"
User: "Do it!!!"  ← High punctuation density
```

**Score Impact:** +1 if ratio > 0.15

### 5. Time Compression
Detects rapid-fire messages (multiple messages in short time window).

**Example:**
```
User: "Do this"   (0:00)
User: "Please"    (0:02)
User: "Hurry"     (0:05)  ← Time compression detected
```

**Score Impact:** +2 if detected

## Integration Patterns

### Pattern 1: Message Processing Pipeline

```typescript
async function processMessage(message: Message, history: Message[]) {
  // Detect frustration
  const frustration = await frustrationDetectorService.analyze(
    [message, ...history],
    message.senderId || undefined
  );

  // Adjust processing strategy
  const strategy = {
    skipConfirmation: frustration.level >= 5,
    prioritize: frustration.level >= 5,
    useSimpleResponses: frustration.level >= 5,
    escalateToPowerfulModel: frustration.level >= 7,
  };

  // Process with adjusted strategy
  return await processWithStrategy(message, strategy);
}
```

### Pattern 2: Loop Prevention

```typescript
async function detectAndHandleLoop(messages: Message[]) {
  const frustration = await frustrationDetectorService.analyze(messages);

  if (frustration.indicators.repeatedMessages >= 2 && frustration.level >= 5) {
    // User is repeating themselves AND frustrated
    // EXECUTE IMMEDIATELY - they've confirmed enough
    return await executeWithoutConfirmation();
  }
}
```

### Pattern 3: Adaptive Response Style

```typescript
async function generateResponse(message: Message, history: Message[]) {
  const level = await frustrationDetectorService.getFrustrationLevel([message, ...history]);

  if (level >= 8) {
    // Critical frustration - emergency mode
    return generateBriefDirectResponse();
  } else if (level >= 5) {
    // Moderate frustration - streamlined mode
    return generateConciseResponse();
  } else {
    // Normal mode - detailed and helpful
    return generateDetailedResponse();
  }
}
```

## Testing

Run the comprehensive test suite:

```bash
npx tsx src/services/frustrationDetector.service.test.ts
```

The test suite includes 14 tests covering:
- Normal conversation (no frustration)
- Message repetition detection
- Length decline detection
- Caps usage detection
- Punctuation density detection
- Time compression detection
- High frustration scenarios
- Configuration customization
- Helper methods
- Edge cases

## Performance Considerations

- **Fast Analysis**: Runs in < 10ms for typical conversations
- **Memory Efficient**: Analyzes only recent messages (configurable window)
- **No External Dependencies**: Pure TypeScript, no API calls
- **Synchronous Detection**: Pattern-based analysis is instant

## Best Practices

1. **Update Threshold Based on User**: Some users naturally use caps more
2. **Combine with Intent Classification**: Frustration + imperative = execute now
3. **Log Frustration Events**: Track patterns to improve service
4. **Don't Over-React**: Level 3-4 is normal variability, not true frustration
5. **Consider Context**: A single "???" might just be curiosity, not frustration

## Related Services

- `ImperativeDetectionService`: Detects imperative commands
- `LoopPreventionService`: Prevents conversation loops
- `ResponseRouterService`: Routes to appropriate LLM based on complexity

## Future Enhancements

Potential improvements based on IMPL.md spec:

1. **Sentiment Analysis**: Integrate with LLM for emotion detection
2. **User-Specific Baselines**: Learn each user's normal communication style
3. **Temporal Patterns**: Track frustration over time, not just current state
4. **Multi-Language Support**: Adjust thresholds for different languages
5. **Integration with LoopPrevention**: Automatic escalation when loop + frustration

## License

Part of the Jarvis project.

## Contributing

When modifying frustration detection:

1. Update tests to cover new scenarios
2. Run full test suite
3. Update this README
4. Consider backwards compatibility

## Support

For issues or questions, see the main Jarvis documentation or create an issue in the repository.
