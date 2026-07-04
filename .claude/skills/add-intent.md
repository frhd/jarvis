# /add-intent - Extend Intent Taxonomy

Extend the intent classification taxonomy with new categories.

## When to Use

- Adding new conversational capabilities
- Improving classification granularity
- Supporting new use cases

## Intent Taxonomy Structure

```
Parent Intent (5 total)
├── greeting
│   ├── simple_greeting
│   ├── time_greeting
│   ├── farewell
│   └── gratitude
├── question
│   ├── factual_question
│   ├── how_to_question
│   ├── opinion_question
│   ├── clarification
│   ├── web_search_question
│   └── personal_question
├── command
│   ├── task_request
│   ├── search_request
│   ├── reminder_request
│   ├── calculation
│   ├── translation
│   ├── summarization
│   └── correction
├── feedback
│   ├── positive_feedback
│   ├── negative_feedback
│   ├── acknowledgment
│   ├── opinion_statement
│   └── personal_sharing
└── continuation
    ├── follow_up
    ├── elaboration_request
    ├── topic_change
    └── reference_previous
```

## Files to Modify

1. **Types**: `src/types/intent.types.ts` - Type definitions
2. **Classifier**: `src/services/enhancedIntentClassifier.service.ts` - Classification logic
3. **Patterns**: `src/types/intent.types.ts` - Pattern matching rules

## Step 1: Add Type Definitions

Edit `src/types/intent.types.ts`:

```typescript
// Add to ParentIntent type (if new parent)
export type ParentIntent =
  | 'greeting'
  | 'question'
  | 'command'
  | 'feedback'
  | 'continuation'
  | '<new_parent>';  // Add new parent

// Add to ChildIntent type
export type ChildIntent =
  // ... existing child intents ...
  | '<new_child_intent>'  // Add new child
  | '<another_new_child>';

// Update CHILD_TO_PARENT mapping
export const CHILD_TO_PARENT: Record<ChildIntent, ParentIntent> = {
  // ... existing mappings ...
  '<new_child_intent>': '<parent>',
  '<another_new_child>': '<parent>',
};
```

## Step 2: Add Pattern Matching (Tier 1)

Add to `INTENT_PATTERNS` in `src/types/intent.types.ts`:

```typescript
export const INTENT_PATTERNS: IntentPattern[] = [
  // ... existing patterns ...

  // New intent patterns
  {
    pattern: /\b(keyword1|keyword2|keyword3)\b/i,
    parentIntent: '<parent>',
    childIntent: '<new_child_intent>',
    confidence: 0.85,
  },
  {
    pattern: /^(trigger phrase|another phrase)/i,
    parentIntent: '<parent>',
    childIntent: '<another_new_child>',
    confidence: 0.90,
  },
];
```

## Step 3: Update Classification Prompt (Tier 2)

Edit `ENHANCED_CLASSIFICATION_PROMPT` in `enhancedIntentClassifier.service.ts`:

```typescript
const ENHANCED_CLASSIFICATION_PROMPT = `You are an intent classifier...

## Child Categories by Parent:

### <parent>:
- <new_child_intent>: "<example phrases>"
- <another_new_child>: "<example phrases>"

// ... rest of prompt ...
`;
```

## Step 4: Update Valid Intents Array

Edit `enhancedIntentClassifier.service.ts`:

```typescript
const VALID_CHILD_INTENTS: ChildIntent[] = [
  // ... existing intents ...
  '<new_child_intent>',
  '<another_new_child>',
];
```

## Step 5: Configure Cacheability (Optional)

If responses to this intent should be cached, update semantic cache config:

```typescript
// In semanticCache.service.ts or config
const CACHEABLE_INTENTS = [
  'simple_greeting',
  'time_greeting',
  // ...
  '<new_child_intent>',  // Add if cacheable
];
```

## Step 6: Configure Routing (Optional)

If this intent needs special handling:

```typescript
// In responseRouter.service.ts or routing config
const COMPLEX_INTENTS = [
  'task_request',
  'web_search_question',
  '<new_child_intent>',  // Add if needs Claude
];
```

## Example: Adding Code Review Intent

```typescript
// 1. In intent.types.ts - Add child intent
export type ChildIntent =
  // ...existing...
  | 'code_review_request';

// 2. Update CHILD_TO_PARENT
export const CHILD_TO_PARENT = {
  // ...existing...
  'code_review_request': 'command',
};

// 3. Add pattern
export const INTENT_PATTERNS: IntentPattern[] = [
  // ...existing...
  {
    pattern: /\b(review|check|audit)\b.*\b(code|function|class|implementation)\b/i,
    parentIntent: 'command',
    childIntent: 'code_review_request',
    confidence: 0.85,
  },
  {
    pattern: /\bcode review\b/i,
    parentIntent: 'command',
    childIntent: 'code_review_request',
    confidence: 0.95,
  },
];

// 4. Update classifier prompt
### command:
- code_review_request: "review my code", "check this function", "audit this implementation"

// 5. Update valid intents
const VALID_CHILD_INTENTS = [
  // ...existing...
  'code_review_request',
];
```

## Checklist

- [ ] Add to `ParentIntent` type (if new parent)
- [ ] Add to `ChildIntent` type
- [ ] Update `CHILD_TO_PARENT` mapping
- [ ] Add pattern matching rules
- [ ] Update classification prompt
- [ ] Update `VALID_CHILD_INTENTS` array
- [ ] Configure cacheability (if needed)
- [ ] Configure routing (if needs special handling)
- [ ] Test classification accuracy

## Testing New Intents

Run intent classification tests:

```bash
# Test specific messages
npx tsx src/services/enhancedIntentClassifier.service.test.ts

# Run regression tests
npm run regression -- --category=<category>
```

## Reference

- Intent types: `src/types/intent.types.ts`
- Classifier: `src/services/enhancedIntentClassifier.service.ts`
- Cache config: `src/services/semanticCache.service.ts`
- Routing: `src/services/responseRouter.service.ts`
