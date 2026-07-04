# Intent Classification Test Dataset

This directory contains comprehensive test fixtures for validating the enhanced intent classification system (Phase 2.4).

## Files

### `intent-test-dataset.ts`

A comprehensive test dataset covering all 25 child intents with 157 test cases.

**Structure:**
- Each test case includes:
  - `input`: The message text to classify
  - `expectedParentIntent`: The expected parent intent category
  - `expectedChildIntent`: The expected child intent category
  - `notes`: Optional notes about edge cases or special handling

**Coverage:**

| Parent Intent | Child Intents | Test Cases |
|--------------|---------------|------------|
| **greeting** (4 intents) | simple_greeting, time_greeting, farewell, gratitude | 30 cases |
| **question** (6 intents) | factual_question, how_to_question, opinion_question, clarification, web_search_question, personal_question | 38 cases |
| **command** (7 intents) | task_request, search_request, reminder_request, calculation, translation, summarization, correction | 39 cases |
| **feedback** (4 intents) | positive_feedback, negative_feedback, acknowledgment, opinion_statement | 26 cases |
| **continuation** (4 intents) | follow_up, elaboration_request, topic_change, reference_previous | 17 cases |
| **Edge cases** | Various ambiguous and special cases | 7 cases |

**Total: 25 child intents, 157 test cases**

## Intent Categories

### Greeting Intents
- `simple_greeting`: Basic greetings like "hi", "hello", "hey"
- `time_greeting`: Time-specific greetings like "good morning", "good evening"
- `farewell`: Goodbyes like "bye", "see you", "talk later"
- `gratitude`: Thanks expressions like "thanks", "thank you"

### Question Intents
- `factual_question`: Factual information requests like "What is X?"
- `how_to_question`: Process/instruction questions like "How do I..."
- `opinion_question`: Subjective questions like "What do you think..."
- `clarification`: Asking for explanation like "what do you mean?"
- `web_search_question`: Requires real-time data (weather, news, prices)
- `personal_question`: Questions about the assistant like "Who are you?"

### Command Intents
- `task_request`: Action requests like "Write code", "Create X"
- `search_request`: Search commands like "search for...", "find..."
- `reminder_request`: Reminder/alarm requests like "remind me to..."
- `calculation`: Math operations like "what is 5 + 5"
- `translation`: Translation requests like "translate X to Y"
- `summarization`: Summarize requests like "summarize this", "tldr"
- `correction`: Corrections like "no, I meant...", "fix that..."

### Feedback Intents
- `positive_feedback`: Positive reactions like "great!", "perfect"
- `negative_feedback`: Negative reactions like "wrong", "not what I wanted"
- `acknowledgment`: Confirmations like "ok", "got it", "understood"
- `opinion_statement`: Expressing opinions without asking

### Continuation Intents
- `follow_up`: Continuing previous topic with markers like "and", "also"
- `elaboration_request`: Asking for more details like "tell me more"
- `topic_change`: Explicitly changing subject like "anyway..."
- `reference_previous`: Referencing earlier conversation like "as you mentioned"

## Edge Cases

The dataset includes challenging cases to test robustness:

1. **Empty messages**: Testing fallback behavior
2. **Only punctuation**: "???" - confusion signals
3. **Ambiguous messages**: Could fit multiple categories
4. **Mixed case**: "HELLO", "HeLLo" - case sensitivity
5. **Compound messages**: Multiple intents in one message
6. **Context-dependent**: Messages requiring conversation history

## Usage

```typescript
import { intentTestDataset, testCasesByParentIntent, testCasesByChildIntent } from './fixtures/intent-test-dataset';

// Test all cases
for (const testCase of intentTestDataset) {
  const result = await classifier.classifyIntent(testCase.input);
  console.log(`Expected: ${testCase.expectedChildIntent}, Got: ${result.childIntent}`);
}

// Test specific parent intent
const greetingTests = testCasesByParentIntent.greeting;

// Test specific child intent
const calculationTests = testCasesByChildIntent.calculation;
```

## Dataset Statistics

Run the tests to see detailed statistics:

```bash
npx tsx tests/intent-classification.test.ts
```

This will show:
- Overall accuracy across all intents
- Per-parent-intent accuracy breakdown
- Per-child-intent accuracy breakdown
- Pattern-matching vs LLM classification breakdown
- Sample classification failures for analysis

## Extending the Dataset

To add more test cases:

1. Add cases to the appropriate section in `intent-test-dataset.ts`
2. Ensure each child intent has at least 3 test cases (preferably 5+)
3. Include edge cases and variations (capitalization, punctuation, etc.)
4. Add notes for cases that require special handling
5. Run tests to verify: `npx tsx tests/intent-classification.test.ts`

## Pattern vs LLM Classification

The dataset helps evaluate two classification methods:

- **Pattern-based**: Fast regex matching for simple, unambiguous intents
  - Expected accuracy: >90%
  - Target intents: greetings, gratitude, calculations, acknowledgments

- **LLM-based**: AI classification for complex, ambiguous intents
  - Expected accuracy: 70-90% (depends on model quality)
  - Target intents: task requests, how-to questions, opinion questions, etc.

## Notes

- Test cases marked with `notes: 'Requires conversation context'` should be tested with conversation history provided
- The mock LLM in tests always returns `factual_question`, so accuracy metrics reflect pattern-matching performance
- For real accuracy measurement, use the actual LLM service
- Some intents are inherently ambiguous - 100% accuracy is not expected
