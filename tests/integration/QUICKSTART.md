# Integration Tests Quick Start

## Running the Tests

### Message Flow Integration Tests
```bash
npx tsx tests/integration/message-flow.test.ts
```

Expected output:
```
=== Message Flow Integration Tests ===

--- Message Ingestion to Queue Tests ---
✓ ingests message and creates queue item
✓ prevents duplicate message ingestion
✓ creates sender and chat records on ingestion

--- Queue Processing with LLM Tests ---
✓ processes queue item and analyzes message
✓ processes private chat message and generates response
✓ handles LLM failure gracefully

--- Memory Extraction Tests ---
✓ extracts memories from user message
✓ skips memory extraction when sender is null

--- Semantic Cache Integration Tests ---
✓ cache miss generates new response
✓ typing indicator shown before response

--- Error Handling Tests ---
✓ handles response generation failure
✓ handles missing message in queue processing
✓ handles concurrent queue item processing

--- End-to-End Message Flow Test ---
✓ complete message flow from ingestion to response

=== Results: 14 passed, 0 failed ===
```

## What's Being Tested

### Message Ingestion (3 tests)
Tests the complete ingestion pipeline from Telegram message to queue item creation.

### Queue Processing (3 tests)
Tests message processing including LLM analysis and response generation.

### Memory Extraction (2 tests)
Tests memory extraction coordination during message processing.

### Semantic Cache (2 tests)
Tests cache lookup and response generation integration.

### Error Handling (3 tests)
Tests graceful error handling for various failure scenarios.

### End-to-End (1 test)
Tests the complete flow from message ingestion to bot response.

## Test Architecture

The tests use **mock services** to simulate:
- Telegram client events
- Database repositories
- LLM services
- Cache services
- Memory extraction
- Response generation

This allows testing the **integration between services** without requiring:
- Running database
- Live Telegram connection
- External LLM APIs
- Real file system operations

## Test Characteristics

- **Isolated**: Each test clears state before running
- **Fast**: All operations are in-memory (completes in ~1 second)
- **Deterministic**: No external dependencies mean consistent results
- **Comprehensive**: Tests both success paths and error scenarios

## Common Use Cases

### Verify Message Flow Works
```bash
npx tsx tests/integration/message-flow.test.ts
```

### Debug a Specific Flow
Edit the test file and add console.log statements:
```typescript
await test('test name', async () => {
  console.log('Message created:', messageRepo.createdMessages);
  console.log('Queue items:', queueRepo.enqueuedItems);
  // ... rest of test
});
```

### Add New Test Scenario
Copy an existing test and modify:
```typescript
await test('your new test name', async () => {
  clearAll(); // Always clear mocks first

  const mockEvent = {
    message: {
      id: 99999,
      chatId: '123456',
      text: 'Your test message',
      getSender: async () => ({ firstName: 'Test' }),
      getChat: async () => ({ type: 'private' as ChatType }),
    },
  };

  await ingestionService.ingestMessage(mockEvent);

  // Add your assertions
  assertEqual(someValue, expectedValue);
});
```

## Troubleshooting

### All Tests Fail
- Check that you're running from the project root directory
- Verify Node.js version is 18 or higher
- Run `npm install` to ensure dependencies are installed

### Specific Test Fails
- Read the error message - it shows expected vs actual values
- Check if `clearAll()` is called at the start of the test
- Verify the test isn't depending on state from previous tests

### Tests Hang
- Check for missing `await` keywords on async operations
- Verify all promises resolve (no infinite loops)
- Add a timeout if needed (already set to 60 seconds)

## Next Steps

After running these tests successfully:

1. **Read the detailed README**: `tests/integration/README.md`
2. **Explore the test code**: `tests/integration/message-flow.test.ts`
3. **Compare with other tests**: Look at `tests/cache/*.test.ts` and `src/services/*.test.ts`
4. **Add your own tests**: Follow the patterns shown in the examples

## Related Commands

```bash
# Run all project tests (vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific service test
npx tsx src/services/memory.service.test.ts

# Run E2E tests
npx tsx tests/e2e/two-tier-llm.test.ts
```

## Key Files

- `tests/integration/message-flow.test.ts` - The test file
- `tests/integration/README.md` - Detailed documentation
- `src/services/ingestion.service.ts` - Production ingestion service
- `src/services/processor.service.ts` - Production processor service
- `src/handlers/message.handler.ts` - Telegram message handler

## Quick Tips

1. **Always call `clearAll()`** at the start of each test
2. **Use helper functions** like `assertEqual`, `assertTrue` for better error messages
3. **Mock external dependencies** to keep tests fast and isolated
4. **Test both success and failure** scenarios for robustness
5. **Name tests descriptively** so failures are easy to understand
