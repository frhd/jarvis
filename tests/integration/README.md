# Integration Tests

This directory contains integration tests that verify the complete message processing pipeline and interactions between multiple services.

## Message Flow Integration Tests

**File:** `message-flow.test.ts`

Tests the complete message processing pipeline from ingestion through to response generation.

### Test Coverage

#### 1. Message Ingestion to Queue (3 tests)
- **Ingests message and creates queue item**: Verifies end-to-end ingestion flow creates message record, queue item, and processes immediately
- **Prevents duplicate message ingestion**: Tests deduplication logic prevents duplicate messages from being processed
- **Creates sender and chat records on ingestion**: Validates that sender and chat entities are properly upserted during ingestion

#### 2. Queue Processing with LLM (3 tests)
- **Processes queue item and analyzes message**: Verifies queue processing invokes LLM analysis and handles result correctly
- **Processes private chat message and generates response**: Tests response generation for private chats including typing indicator
- **Handles LLM failure gracefully**: Validates error handling when LLM service is unavailable

#### 3. Memory Extraction (2 tests)
- **Extracts memories from user message**: Confirms memory extraction coordinator is invoked for messages with senders
- **Skips memory extraction when sender is null**: Validates extraction is skipped for anonymous messages

#### 4. Semantic Cache Integration (2 tests)
- **Cache miss generates new response**: Tests response generation when no cached response exists
- **Typing indicator shown before response**: Verifies typing indicator is sent before response in private chats

#### 5. Error Handling (3 tests)
- **Handles response generation failure**: Tests graceful handling of response router failures
- **Handles missing message in queue processing**: Validates error handling for missing message records
- **Handles concurrent queue item processing**: Tests optimistic locking prevents duplicate processing

#### 6. End-to-End Flow (1 test)
- **Complete message flow from ingestion to response**: Comprehensive test verifying entire pipeline from Telegram message to bot response

### Architecture

The tests use mock implementations of all repositories and services to:
- Isolate the integration points between services
- Verify service interactions without external dependencies
- Test both success and failure scenarios
- Validate the complete message processing pipeline

### Mock Services

- **MockSenderRepository**: In-memory sender storage with upsert logic
- **MockChatRepository**: In-memory chat storage with upsert logic
- **MockMessageRepository**: Message storage with deduplication support
- **MockQueueRepository**: Queue operations with optimistic locking
- **MockFilterService**: Filter checks (always allows messages)
- **MockMediaService**: Media download stub (always returns null)
- **MockMemoryService**: Memory extraction tracking
- **MockSemanticCacheService**: In-memory cache with hit/miss simulation
- **MockLLMService**: LLM analysis with configurable failure mode
- **MockResponseRouterService**: Response generation with configurable responses
- **MockTelegramService**: Telegram operations (send, typing, read receipts)
- **MockExtractionCoordinator**: Memory extraction tracking
- **MockRetryCoordinator**: Retry logic and result handling
- **MockTranscriptionCoordinator**: Voice transcription stub

### Service Implementations

- **TestIngestionService**: Mirrors production IngestionService logic
- **TestProcessorService**: Mirrors production ProcessorService logic

These implementations use the same business logic as production but work with mock dependencies.

## Running Tests

### Run All Integration Tests
```bash
npx tsx tests/integration/message-flow.test.ts
```

### Run Specific Test File
```bash
npx tsx tests/integration/message-flow.test.ts
```

### Test Output Format
```
=== Message Flow Integration Tests ===

--- Message Ingestion to Queue Tests ---

✓ ingests message and creates queue item
✓ prevents duplicate message ingestion
✓ creates sender and chat records on ingestion

--- Queue Processing with LLM Tests ---

✓ processes queue item and analyzes message
...

=== Results: 14 passed, 0 failed ===
```

## Test Patterns

### Custom Test Runner
These tests use a custom test runner (not vitest) for:
- Standalone execution with `npx tsx`
- Simple pass/fail tracking
- Inline test helpers
- No external test framework dependencies

### Test Helper Functions
```typescript
async function test(name: string, fn: () => void | Promise<void>)
function assertEqual<T>(actual: T, expected: T, message?: string)
function assertTrue(condition: boolean, message?: string)
function assertFalse(condition: boolean, message?: string)
function assertGreaterThan(actual: number, threshold: number, message?: string)
function assertNotNull<T>(value: T | null | undefined, message?: string)
function assertContains(text: string, substring: string, message?: string)
```

### Test Structure
```typescript
await test('test name', async () => {
  clearAll(); // Clear all mocks

  // Arrange
  const mockEvent = { ... };

  // Act
  await ingestionService.ingestMessage(mockEvent);

  // Assert
  assertEqual(messageRepo.createdMessages.length, 1);
  assertTrue(result.success);
});
```

## Related Tests

- **Unit Tests**: `src/services/*.test.ts` - Individual service tests
- **E2E Tests**: `tests/e2e/*.test.ts` - Full system tests with real dependencies
- **RAG Pipeline Tests**: `tests/integration/rag-pipeline.test.ts` - Context assembly tests
- **Cache Tests**: `tests/cache/*.test.ts` - Semantic cache tests

## Adding New Tests

To add new integration tests:

1. Create mock services for new dependencies
2. Implement test service that mirrors production logic
3. Write test cases covering success and failure scenarios
4. Use the same test helper functions for consistency
5. Group tests by functional area
6. Add clear descriptions of what each test validates

### Example Test Template
```typescript
await test('descriptive test name', async () => {
  clearAll();

  // Setup test data
  const mockEvent = {
    message: {
      id: 12345,
      chatId: '999888777',
      text: 'Test message',
      getSender: async () => ({ firstName: 'Test' }),
      getChat: async () => ({ type: 'private' as ChatType }),
    },
  };

  // Execute the flow
  await ingestionService.ingestMessage(mockEvent);

  // Verify expectations
  assertEqual(messageRepo.createdMessages.length, 1);
  assertTrue(queueRepo.enqueuedItems.length > 0);
});
```

## Debugging Tests

### Enable Detailed Logging
The tests use a simple console-based output. To debug:

1. Add `console.log` statements in test code
2. Check mock service state after operations
3. Verify mock method call counts and arguments
4. Use the custom test helpers for clearer error messages

### Common Issues

**Test fails with "Expected X, got Y"**
- Check that `clearAll()` is called at the start of the test
- Verify mock state is not leaking between tests
- Ensure async operations complete before assertions

**Test hangs or times out**
- Check for missing `await` on async operations
- Verify all promises resolve or reject
- Look for circular dependencies in mocks

**Assertion errors**
- Use helper functions for better error messages
- Add contextual messages to assertions
- Break complex assertions into multiple checks

## Design Principles

1. **Isolation**: Tests use mocks to isolate integration points
2. **Realism**: Mock implementations mirror production behavior
3. **Coverage**: Test both happy path and error scenarios
4. **Clarity**: Clear test names describe what is validated
5. **Independence**: Tests don't depend on each other or external state
6. **Speed**: In-memory mocks make tests fast and repeatable

## Future Enhancements

Potential areas for expansion:

- [ ] Test retry logic with multiple failure scenarios
- [ ] Test circuit breaker state transitions
- [ ] Test dead letter queue behavior
- [ ] Test priority escalation over time
- [ ] Test conversation context assembly
- [ ] Test response validation and length limits
- [ ] Test webhook/API gateway interactions
- [ ] Test authentication flows
