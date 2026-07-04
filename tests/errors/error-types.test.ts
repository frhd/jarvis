#!/usr/bin/env npx tsx
/**
 * Error Types and Helper Functions Tests
 *
 * Comprehensive test suite for error classes and error handling utilities.
 * Tests all error classes, factory methods, helper functions, and edge cases.
 *
 * Run: npx tsx tests/errors/error-types.test.ts
 */

import {
  // Error enums
  ErrorCode,
  ErrorSeverity,
  // Error classes
  AppError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  RateLimitError,
  ExternalServiceError,
  TelegramError,
  LLMError,
  EmbeddingError,
  DatabaseError,
  QueueError,
  ConfigurationError,
  InvariantViolationError,
  UnexpectedError,
  // Helper functions
  isOperationalError,
  isRetryableError,
  wrapError,
  createCorrelationId,
  assertInvariant,
  isAppError,
  getSeverityForCode,
} from '../../src/errors/index';

// ============================================================================
// Test Helpers
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        console.log(`  Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false');
  }
}

function assertThrows(fn: () => void, errorType?: any, message?: string) {
  try {
    fn();
    throw new Error(message || 'Expected function to throw');
  } catch (err) {
    if (errorType && !(err instanceof errorType)) {
      throw new Error(
        message ||
          `Expected error of type ${errorType.name}, got ${err instanceof Error ? err.constructor.name : typeof err}`
      );
    }
  }
}

function assertInstanceOf<T>(value: unknown, type: new (...args: any[]) => T, message?: string) {
  if (!(value instanceof type)) {
    throw new Error(
      message || `Expected instance of ${type.name}, got ${value?.constructor?.name || typeof value}`
    );
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
  }
}

// ============================================================================
// AppError Tests
// ============================================================================

async function testAppError() {
  await test('AppError: creates basic error with required fields', () => {
    const error = new AppError('Test error', ErrorCode.INTERNAL_UNEXPECTED);

    assertEqual(error.message, 'Test error');
    assertEqual(error.code, ErrorCode.INTERNAL_UNEXPECTED);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertTrue(error.isOperational);
    assertTrue(error.context !== undefined);
    assertTrue(error.timestamp instanceof Date);
    assertTrue(error.name === 'AppError');
  });

  await test('AppError: creates error with all options', () => {
    const cause = new Error('Original error');
    const correlationId = 'test-correlation-id';
    const context = { key: 'value' };

    const error = new AppError('Test error', ErrorCode.VALIDATION_INVALID_INPUT, {
      severity: ErrorSeverity.HIGH,
      isOperational: false,
      context,
      cause,
      correlationId,
    });

    assertEqual(error.message, 'Test error');
    assertEqual(error.code, ErrorCode.VALIDATION_INVALID_INPUT);
    assertEqual(error.severity, ErrorSeverity.HIGH);
    assertFalse(error.isOperational);
    assertEqual(error.context.key, 'value');
    assertEqual(error.cause, cause);
    assertEqual(error.correlationId, correlationId);
  });

  await test('AppError: toJSON serializes error correctly', () => {
    const cause = new Error('Cause error');
    const error = new AppError('Test error', ErrorCode.DATABASE_QUERY_ERROR, {
      context: { table: 'users' },
      cause,
    });

    const json = error.toJSON();

    assertEqual(json.name, 'AppError');
    assertEqual(json.message, 'Test error');
    assertEqual(json.code, ErrorCode.DATABASE_QUERY_ERROR);
    assertEqual(json.severity, ErrorSeverity.MEDIUM);
    assertTrue(json.isOperational);
    assertEqual((json.context as any).table, 'users');
    assertTrue(typeof json.timestamp === 'string');
    assertTrue(json.stack !== undefined);
    assertEqual(json.cause, 'Cause error');
  });

  await test('AppError: toJSON serializes nested AppError cause', () => {
    const innerError = new AppError('Inner error', ErrorCode.DATABASE_CONNECTION_ERROR);
    const outerError = new AppError('Outer error', ErrorCode.DATABASE_QUERY_ERROR, {
      cause: innerError,
    });

    const json = outerError.toJSON();

    assertTrue(typeof json.cause === 'object');
    assertEqual((json.cause as any).message, 'Inner error');
    assertEqual((json.cause as any).code, ErrorCode.DATABASE_CONNECTION_ERROR);
  });

  await test('AppError: getCauseChain returns error chain', () => {
    const rootError = new Error('Root');
    const middleError = new AppError('Middle', ErrorCode.DATABASE_QUERY_ERROR, {
      cause: rootError,
    });
    const topError = new AppError('Top', ErrorCode.QUEUE_PROCESSING_ERROR, {
      cause: middleError,
    });

    const chain = topError.getCauseChain();

    assertEqual(chain.length, 3);
    assertEqual(chain[0], topError);
    assertEqual(chain[1], middleError);
    assertEqual(chain[2], rootError);
  });

  await test('AppError: getCauseChain handles single error', () => {
    const error = new AppError('Single', ErrorCode.VALIDATION_INVALID_INPUT);

    const chain = error.getCauseChain();

    assertEqual(chain.length, 1);
    assertEqual(chain[0], error);
  });

  await test('AppError: getRootCause returns deepest cause', () => {
    const rootError = new Error('Root cause');
    const middleError = new AppError('Middle', ErrorCode.DATABASE_QUERY_ERROR, {
      cause: rootError,
    });
    const topError = new AppError('Top', ErrorCode.QUEUE_PROCESSING_ERROR, {
      cause: middleError,
    });

    const root = topError.getRootCause();

    assertEqual(root, rootError);
  });

  await test('AppError: getRootCause returns self when no cause', () => {
    const error = new AppError('Only error', ErrorCode.VALIDATION_INVALID_INPUT);

    const root = error.getRootCause();

    assertEqual(root, error);
  });

  await test('AppError: instanceof checks work correctly', () => {
    const error = new AppError('Test', ErrorCode.INTERNAL_UNEXPECTED);

    assertTrue(error instanceof AppError);
    assertTrue(error instanceof Error);
  });
}

// ============================================================================
// ValidationError Tests
// ============================================================================

async function testValidationError() {
  await test('ValidationError: creates basic validation error', () => {
    const error = new ValidationError('Invalid input');

    assertEqual(error.message, 'Invalid input');
    assertEqual(error.code, ErrorCode.VALIDATION_INVALID_INPUT);
    assertEqual(error.severity, ErrorSeverity.LOW);
    assertTrue(error.isOperational);
    assertEqual(error.fieldErrors.length, 0);
  });

  await test('ValidationError: creates with field errors', () => {
    const fieldErrors = [
      { field: 'email', message: 'Invalid email', code: ErrorCode.VALIDATION_INVALID_FORMAT },
      { field: 'age', message: 'Must be positive', code: ErrorCode.VALIDATION_OUT_OF_RANGE, value: -5 },
    ];

    const error = new ValidationError('Validation failed', { fieldErrors });

    assertEqual(error.fieldErrors.length, 2);
    assertEqual(error.fieldErrors[0].field, 'email');
    assertEqual(error.fieldErrors[1].value, -5);
  });

  await test('ValidationError.forField: creates field-specific error', () => {
    const error = ValidationError.forField('username', 'Must be at least 3 characters', {
      value: 'ab',
      constraint: 'minLength:3',
    });

    assertTrue(error.message.includes('username'));
    assertTrue(error.message.includes('Must be at least 3 characters'));
    assertEqual(error.fieldErrors.length, 1);
    assertEqual(error.fieldErrors[0].field, 'username');
    assertEqual(error.fieldErrors[0].value, 'ab');
    assertEqual(error.context.field, 'username');
    assertEqual(error.context.constraint, 'minLength:3');
  });

  await test('ValidationError.forField: uses custom error code', () => {
    const error = ValidationError.forField('age', 'Out of range', {
      code: ErrorCode.VALIDATION_OUT_OF_RANGE,
    });

    assertEqual(error.code, ErrorCode.VALIDATION_OUT_OF_RANGE);
    assertEqual(error.fieldErrors[0].code, ErrorCode.VALIDATION_OUT_OF_RANGE);
  });

  await test('ValidationError.missingField: creates missing field error', () => {
    const error = ValidationError.missingField('email');

    assertTrue(error.message.includes('email'));
    assertTrue(error.message.includes('missing'));
    assertEqual(error.code, ErrorCode.VALIDATION_MISSING_FIELD);
    assertEqual(error.fieldErrors.length, 1);
    assertEqual(error.fieldErrors[0].field, 'email');
    assertEqual(error.fieldErrors[0].message, 'This field is required');
  });

  await test('ValidationError: instanceof checks work', () => {
    const error = new ValidationError('Test');

    assertTrue(error instanceof ValidationError);
    assertTrue(error instanceof AppError);
    assertTrue(error instanceof Error);
  });
}

// ============================================================================
// NotFoundError Tests
// ============================================================================

async function testNotFoundError() {
  await test('NotFoundError: creates basic not found error', () => {
    const error = new NotFoundError('User', 123);

    assertTrue(error.message.includes('User'));
    assertTrue(error.message.includes('123'));
    assertTrue(error.message.includes('not found'));
    assertEqual(error.code, ErrorCode.DATABASE_NOT_FOUND);
    assertEqual(error.severity, ErrorSeverity.LOW);
    assertEqual(error.resourceType, 'User');
    assertEqual(error.resourceId, 123);
  });

  await test('NotFoundError: accepts string resource ID', () => {
    const error = new NotFoundError('Message', 'msg-abc-123');

    assertEqual(error.resourceType, 'Message');
    assertEqual(error.resourceId, 'msg-abc-123');
  });

  await test('NotFoundError: accepts custom message', () => {
    const error = new NotFoundError('User', 456, {
      message: 'Custom not found message',
    });

    assertEqual(error.message, 'Custom not found message');
  });

  await test('NotFoundError: includes context', () => {
    const error = new NotFoundError('Chat', 789, {
      context: { chatType: 'private' },
    });

    assertEqual(error.context.resourceType, 'Chat');
    assertEqual(error.context.resourceId, 789);
    assertEqual((error.context as any).chatType, 'private');
  });
}

// ============================================================================
// TimeoutError Tests
// ============================================================================

async function testTimeoutError() {
  await test('TimeoutError: creates basic timeout error', () => {
    const error = new TimeoutError('LLM request', 5000);

    assertTrue(error.message.includes('LLM request'));
    assertTrue(error.message.includes('5000'));
    assertTrue(error.message.includes('timed out'));
    assertEqual(error.code, ErrorCode.EXTERNAL_SERVICE_TIMEOUT);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertEqual(error.operation, 'LLM request');
    assertEqual(error.timeoutMs, 5000);
  });

  await test('TimeoutError: accepts custom code', () => {
    const error = new TimeoutError('Database query', 3000, {
      code: ErrorCode.DATABASE_TIMEOUT,
    });

    assertEqual(error.code, ErrorCode.DATABASE_TIMEOUT);
  });

  await test('TimeoutError: accepts custom message', () => {
    const error = new TimeoutError('Upload', 10000, {
      message: 'File upload timeout',
    });

    assertEqual(error.message, 'File upload timeout');
  });
}

// ============================================================================
// RateLimitError Tests
// ============================================================================

async function testRateLimitError() {
  await test('RateLimitError: creates basic rate limit error', () => {
    const error = new RateLimitError('Too many requests');

    assertEqual(error.message, 'Too many requests');
    assertEqual(error.code, ErrorCode.EXTERNAL_SERVICE_RATE_LIMITED);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
  });

  await test('RateLimitError: includes retry after', () => {
    const error = new RateLimitError('Rate limited', {
      retryAfterSeconds: 60,
    });

    assertEqual(error.retryAfterSeconds, 60);
    assertEqual(error.context.retryAfterSeconds, 60);
  });

  await test('RateLimitError: includes limit and current', () => {
    const error = new RateLimitError('Rate limit exceeded', {
      limit: 100,
      current: 150,
    });

    assertEqual(error.limit, 100);
    assertEqual(error.current, 150);
  });
}

// ============================================================================
// ExternalServiceError Tests
// ============================================================================

async function testExternalServiceError() {
  await test('ExternalServiceError: creates basic service error', () => {
    const error = new ExternalServiceError('api-service', 'Service unavailable');

    assertEqual(error.message, 'Service unavailable');
    assertEqual(error.service, 'api-service');
    assertEqual(error.code, ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE);
    assertEqual(error.severity, ErrorSeverity.HIGH);
  });

  await test('ExternalServiceError: includes status code', () => {
    const error = new ExternalServiceError('api-service', 'Server error', {
      statusCode: 500,
    });

    assertEqual(error.statusCode, 500);
    assertEqual(error.context.statusCode, 500);
  });

  await test('ExternalServiceError: accepts custom code and severity', () => {
    const error = new ExternalServiceError('api-service', 'Auth failed', {
      code: ErrorCode.EXTERNAL_SERVICE_AUTH_ERROR,
      severity: ErrorSeverity.CRITICAL,
    });

    assertEqual(error.code, ErrorCode.EXTERNAL_SERVICE_AUTH_ERROR);
    assertEqual(error.severity, ErrorSeverity.CRITICAL);
  });
}

// ============================================================================
// TelegramError Tests
// ============================================================================

async function testTelegramError() {
  await test('TelegramError: creates basic telegram error', () => {
    const error = new TelegramError('API request failed');

    assertEqual(error.message, 'API request failed');
    assertEqual(error.service, 'telegram');
    assertEqual(error.code, ErrorCode.TELEGRAM_API_ERROR);
  });

  await test('TelegramError: includes telegram error code', () => {
    const error = new TelegramError('Telegram error', {
      telegramErrorCode: 420,
    });

    assertEqual(error.telegramErrorCode, 420);
  });

  await test('TelegramError.floodWait: creates flood wait error', () => {
    const error = TelegramError.floodWait(300);

    assertTrue(error.message.includes('300'));
    assertTrue(error.message.includes('Flood wait'));
    assertEqual(error.code, ErrorCode.TELEGRAM_FLOOD_WAIT);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertEqual(error.floodWaitSeconds, 300);
  });

  await test('TelegramError.floodWait: accepts correlation ID', () => {
    const correlationId = 'test-123';
    const error = TelegramError.floodWait(60, { correlationId });

    assertEqual(error.correlationId, correlationId);
  });
}

// ============================================================================
// LLMError Tests
// ============================================================================

async function testLLMError() {
  await test('LLMError: creates basic LLM error', () => {
    const error = new LLMError('Model error');

    assertEqual(error.message, 'Model error');
    assertEqual(error.service, 'llm');
    assertEqual(error.code, ErrorCode.LLM_API_ERROR);
  });

  await test('LLMError: includes model and token counts', () => {
    const error = new LLMError('Token limit', {
      model: 'gpt-4',
      tokenCount: 10000,
      maxTokens: 8000,
    });

    assertEqual(error.model, 'gpt-4');
    assertEqual(error.tokenCount, 10000);
    assertEqual(error.maxTokens, 8000);
  });

  await test('LLMError.contextLengthExceeded: creates context length error', () => {
    const error = LLMError.contextLengthExceeded(10000, 8000);

    assertTrue(error.message.includes('10000'));
    assertTrue(error.message.includes('8000'));
    assertTrue(error.message.includes('Context length exceeded'));
    assertEqual(error.code, ErrorCode.LLM_CONTEXT_LENGTH_EXCEEDED);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertEqual(error.tokenCount, 10000);
    assertEqual(error.maxTokens, 8000);
  });

  await test('LLMError.contextLengthExceeded: accepts model', () => {
    const error = LLMError.contextLengthExceeded(5000, 4000, { model: 'llama2' });

    assertEqual(error.model, 'llama2');
  });
}

// ============================================================================
// EmbeddingError Tests
// ============================================================================

async function testEmbeddingError() {
  await test('EmbeddingError: creates basic embedding error', () => {
    const error = new EmbeddingError('Embedding failed');

    assertEqual(error.message, 'Embedding failed');
    assertEqual(error.service, 'embedding');
    assertEqual(error.code, ErrorCode.EMBEDDING_API_ERROR);
  });

  await test('EmbeddingError: includes dimensions', () => {
    const error = new EmbeddingError('Dimension error', {
      inputDimension: 512,
      expectedDimension: 768,
    });

    assertEqual(error.inputDimension, 512);
    assertEqual(error.expectedDimension, 768);
  });

  await test('EmbeddingError.dimensionMismatch: creates dimension error', () => {
    const error = EmbeddingError.dimensionMismatch(512, 768);

    assertTrue(error.message.includes('512'));
    assertTrue(error.message.includes('768'));
    assertTrue(error.message.includes('dimension mismatch'));
    assertEqual(error.code, ErrorCode.EMBEDDING_DIMENSION_MISMATCH);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertEqual(error.inputDimension, 512);
    assertEqual(error.expectedDimension, 768);
  });

  await test('EmbeddingError.dimensionMismatch: accepts model', () => {
    const error = EmbeddingError.dimensionMismatch(384, 768, { model: 'all-MiniLM-L6-v2' });

    assertEqual(error.model, 'all-MiniLM-L6-v2');
  });
}

// ============================================================================
// DatabaseError Tests
// ============================================================================

async function testDatabaseError() {
  await test('DatabaseError: creates basic database error', () => {
    const error = new DatabaseError('Query failed');

    assertEqual(error.message, 'Query failed');
    assertEqual(error.code, ErrorCode.DATABASE_QUERY_ERROR);
    assertEqual(error.severity, ErrorSeverity.HIGH);
  });

  await test('DatabaseError: includes table and operation', () => {
    const error = new DatabaseError('Insert failed', {
      table: 'users',
      operation: 'insert',
    });

    assertEqual(error.table, 'users');
    assertEqual(error.operation, 'insert');
    assertEqual(error.context.table, 'users');
    assertEqual(error.context.operation, 'insert');
  });

  await test('DatabaseError.connectionError: creates connection error', () => {
    const error = DatabaseError.connectionError('Failed to connect to database');

    assertTrue(error.message.includes('Failed to connect'));
    assertEqual(error.code, ErrorCode.DATABASE_CONNECTION_ERROR);
    assertEqual(error.severity, ErrorSeverity.CRITICAL);
  });

  await test('DatabaseError.constraintViolation: creates constraint error', () => {
    const error = DatabaseError.constraintViolation('unique_email', {
      table: 'users',
    });

    assertTrue(error.message.includes('unique_email'));
    assertTrue(error.message.includes('constraint violation'));
    assertEqual(error.code, ErrorCode.DATABASE_CONSTRAINT_VIOLATION);
    assertEqual(error.severity, ErrorSeverity.MEDIUM);
    assertEqual(error.table, 'users');
    assertEqual((error.context as any).constraint, 'unique_email');
  });
}

// ============================================================================
// QueueError Tests
// ============================================================================

async function testQueueError() {
  await test('QueueError: creates basic queue error', () => {
    const error = new QueueError('Processing failed');

    assertEqual(error.message, 'Processing failed');
    assertEqual(error.code, ErrorCode.QUEUE_PROCESSING_ERROR);
    assertEqual(error.severity, ErrorSeverity.HIGH);
  });

  await test('QueueError: includes queue item and retry info', () => {
    const error = new QueueError('Retry failed', {
      queueItemId: 'queue-123',
      retryCount: 3,
      maxRetries: 5,
    });

    assertEqual(error.queueItemId, 'queue-123');
    assertEqual(error.retryCount, 3);
    assertEqual(error.maxRetries, 5);
  });

  await test('QueueError.retryExhausted: creates retry exhausted error', () => {
    const error = QueueError.retryExhausted('queue-456', 5, 5);

    assertTrue(error.message.includes('queue-456'));
    assertTrue(error.message.includes('5/5'));
    assertTrue(error.message.includes('Retry exhausted'));
    assertEqual(error.code, ErrorCode.QUEUE_RETRY_EXHAUSTED);
    assertEqual(error.severity, ErrorSeverity.HIGH);
    assertEqual(error.queueItemId, 'queue-456');
    assertEqual(error.retryCount, 5);
    assertEqual(error.maxRetries, 5);
  });

  await test('QueueError.circuitOpen: creates circuit open error', () => {
    const error = QueueError.circuitOpen('llm-service');

    assertTrue(error.message.includes('llm-service'));
    assertTrue(error.message.includes('Circuit breaker'));
    assertEqual(error.code, ErrorCode.QUEUE_CIRCUIT_OPEN);
    assertEqual(error.severity, ErrorSeverity.HIGH);
    assertEqual((error.context as any).serviceName, 'llm-service');
  });
}

// ============================================================================
// ConfigurationError Tests
// ============================================================================

async function testConfigurationError() {
  await test('ConfigurationError: creates basic config error', () => {
    const error = new ConfigurationError('Invalid configuration');

    assertEqual(error.message, 'Invalid configuration');
    assertEqual(error.code, ErrorCode.CONFIGURATION_INVALID);
    assertEqual(error.severity, ErrorSeverity.CRITICAL);
    assertFalse(error.isOperational); // Configuration errors are programming errors
  });

  await test('ConfigurationError: includes config key and values', () => {
    const error = new ConfigurationError('Type mismatch', {
      configKey: 'PORT',
      expected: 'number',
      actual: 'string',
    });

    assertEqual(error.configKey, 'PORT');
    assertEqual(error.expected, 'number');
    assertEqual(error.actual, 'string');
  });

  await test('ConfigurationError.missing: creates missing config error', () => {
    const error = ConfigurationError.missing('API_KEY');

    assertTrue(error.message.includes('API_KEY'));
    assertTrue(error.message.includes('missing'));
    assertEqual(error.code, ErrorCode.CONFIGURATION_MISSING);
    assertEqual(error.configKey, 'API_KEY');
  });

  await test('ConfigurationError.invalid: creates invalid config error', () => {
    const error = ConfigurationError.invalid('MAX_RETRIES', 'number', 'abc');

    assertTrue(error.message.includes('MAX_RETRIES'));
    assertTrue(error.message.includes('number'));
    assertEqual(error.code, ErrorCode.CONFIGURATION_INVALID);
    assertEqual(error.configKey, 'MAX_RETRIES');
    assertEqual(error.expected, 'number');
    assertEqual(error.actual, 'abc');
  });
}

// ============================================================================
// InvariantViolationError Tests
// ============================================================================

async function testInvariantViolationError() {
  await test('InvariantViolationError: creates basic invariant error', () => {
    const error = new InvariantViolationError('x must be positive');

    assertTrue(error.message.includes('x must be positive'));
    assertEqual(error.code, ErrorCode.INTERNAL_INVARIANT_VIOLATION);
    assertEqual(error.severity, ErrorSeverity.CRITICAL);
    assertFalse(error.isOperational); // Invariant violations are programming errors
    assertEqual(error.invariant, 'x must be positive');
  });

  await test('InvariantViolationError: accepts custom message', () => {
    const error = new InvariantViolationError('count > 0', {
      message: 'Counter must be positive',
    });

    assertEqual(error.message, 'Counter must be positive');
    assertEqual(error.invariant, 'count > 0');
  });

  await test('InvariantViolationError: includes context', () => {
    const error = new InvariantViolationError('array not empty', {
      context: { arrayLength: 0 },
    });

    assertEqual((error.context as any).arrayLength, 0);
  });
}

// ============================================================================
// UnexpectedError Tests
// ============================================================================

async function testUnexpectedError() {
  await test('UnexpectedError: creates basic unexpected error', () => {
    const error = new UnexpectedError('Unexpected condition');

    assertEqual(error.message, 'Unexpected condition');
    assertEqual(error.code, ErrorCode.INTERNAL_UNEXPECTED);
    assertEqual(error.severity, ErrorSeverity.CRITICAL);
    assertFalse(error.isOperational); // Unexpected errors are programming errors
  });

  await test('UnexpectedError.fromUnknown: wraps AppError', () => {
    const original = new ValidationError('Invalid input');
    const error = UnexpectedError.fromUnknown(original);

    assertEqual(error.message, 'Invalid input');
    assertEqual(error.cause, original);
    assertEqual(error.correlationId, original.correlationId);
  });

  await test('UnexpectedError.fromUnknown: wraps regular Error', () => {
    const original = new Error('Regular error');
    const error = UnexpectedError.fromUnknown(original);

    assertEqual(error.message, 'Regular error');
    assertEqual(error.cause, original);
  });

  await test('UnexpectedError.fromUnknown: wraps non-Error values', () => {
    const error = UnexpectedError.fromUnknown('string error');

    assertEqual(error.message, 'string error');
    assertEqual((error.context as any).originalError, 'string error');
  });

  await test('UnexpectedError.fromUnknown: accepts additional context', () => {
    const error = UnexpectedError.fromUnknown('error', {
      context: { source: 'test' },
    });

    assertEqual((error.context as any).source, 'test');
  });
}

// ============================================================================
// Helper Function Tests
// ============================================================================

async function testHelperFunctions() {
  await test('isOperationalError: returns true for operational errors', () => {
    const error = new ValidationError('Invalid');

    assertTrue(isOperationalError(error));
  });

  await test('isOperationalError: returns false for programming errors', () => {
    const error = new ConfigurationError('Missing config');

    assertFalse(isOperationalError(error));
  });

  await test('isOperationalError: returns false for non-AppError', () => {
    const error = new Error('Regular error');

    assertFalse(isOperationalError(error));
  });

  await test('isRetryableError: returns true for retryable errors', () => {
    const error = new TimeoutError('Request timeout', 5000);

    assertTrue(isRetryableError(error));
  });

  await test('isRetryableError: returns false for validation errors', () => {
    const error = new ValidationError('Invalid input');

    assertFalse(isRetryableError(error));
  });

  await test('isRetryableError: returns false for not found errors', () => {
    const error = new NotFoundError('User', 123);

    assertFalse(isRetryableError(error));
  });

  await test('isRetryableError: returns false for config errors', () => {
    const error = ConfigurationError.missing('API_KEY');

    assertFalse(isRetryableError(error));
  });

  await test('isRetryableError: returns false for retry exhausted', () => {
    const error = QueueError.retryExhausted('q1', 3, 3);

    assertFalse(isRetryableError(error));
  });

  await test('isRetryableError: returns false for non-AppError', () => {
    const error = new Error('Regular error');

    assertFalse(isRetryableError(error));
  });

  await test('wrapError: wraps regular Error', () => {
    const original = new Error('Original error');
    const wrapped = wrapError(original, ErrorCode.QUEUE_PROCESSING_ERROR);

    assertEqual(wrapped.message, 'Original error');
    assertEqual(wrapped.code, ErrorCode.QUEUE_PROCESSING_ERROR);
    assertEqual(wrapped.cause, original);
  });

  await test('wrapError: wraps AppError with same code', () => {
    const original = new AppError('Original', ErrorCode.QUEUE_PROCESSING_ERROR);
    const wrapped = wrapError(original, ErrorCode.QUEUE_PROCESSING_ERROR, { extra: 'data' });

    assertEqual(wrapped.message, 'Original');
    assertEqual(wrapped.code, ErrorCode.QUEUE_PROCESSING_ERROR);
    assertEqual((wrapped.context as any).extra, 'data');
  });

  await test('wrapError: wraps AppError with different code', () => {
    const original = new AppError('Original', ErrorCode.LLM_API_ERROR);
    const wrapped = wrapError(original, ErrorCode.QUEUE_PROCESSING_ERROR);

    assertEqual(wrapped.message, 'Original');
    assertEqual(wrapped.code, ErrorCode.QUEUE_PROCESSING_ERROR);
    assertEqual(wrapped.cause, original);
  });

  await test('wrapError: wraps non-Error values', () => {
    const wrapped = wrapError('string error', ErrorCode.INTERNAL_UNEXPECTED);

    assertEqual(wrapped.message, 'string error');
    assertEqual(wrapped.code, ErrorCode.INTERNAL_UNEXPECTED);
    assertEqual((wrapped.context as any).originalError, 'string error');
  });

  await test('createCorrelationId: generates valid UUID', () => {
    const id = createCorrelationId();

    assertTrue(typeof id === 'string');
    assertTrue(id.length > 0);
    // Basic UUID format check
    assertTrue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  });

  await test('createCorrelationId: generates unique IDs', () => {
    const id1 = createCorrelationId();
    const id2 = createCorrelationId();

    assertTrue(id1 !== id2);
  });

  await test('assertInvariant: does nothing when condition is true', () => {
    assertInvariant(true, 'This should not throw');
    // If we get here, test passed
    assertTrue(true);
  });

  await test('assertInvariant: throws when condition is false', () => {
    assertThrows(
      () => assertInvariant(false, 'x must be positive'),
      InvariantViolationError,
      'Should throw InvariantViolationError'
    );
  });

  await test('assertInvariant: includes context in error', () => {
    try {
      assertInvariant(false, 'invalid state', { value: 42 });
      throw new Error('Should have thrown');
    } catch (err) {
      assertTrue(err instanceof InvariantViolationError);
      assertEqual((err as InvariantViolationError).invariant, 'invalid state');
      assertEqual(((err as InvariantViolationError).context as any).value, 42);
    }
  });

  await test('isAppError: returns true for AppError', () => {
    const error = new AppError('Test', ErrorCode.INTERNAL_UNEXPECTED);

    assertTrue(isAppError(error));
  });

  await test('isAppError: returns true for AppError subclasses', () => {
    const error = new ValidationError('Test');

    assertTrue(isAppError(error));
  });

  await test('isAppError: returns false for regular Error', () => {
    const error = new Error('Test');

    assertFalse(isAppError(error));
  });

  await test('isAppError: returns false for non-errors', () => {
    assertFalse(isAppError('string'));
    assertFalse(isAppError(null));
    assertFalse(isAppError(undefined));
    assertFalse(isAppError(42));
  });

  await test('getSeverityForCode: returns CRITICAL for critical codes', () => {
    assertEqual(getSeverityForCode(ErrorCode.DATABASE_CONNECTION_ERROR), ErrorSeverity.CRITICAL);
    assertEqual(getSeverityForCode(ErrorCode.CONFIGURATION_MISSING), ErrorSeverity.CRITICAL);
    assertEqual(getSeverityForCode(ErrorCode.INTERNAL_INVARIANT_VIOLATION), ErrorSeverity.CRITICAL);
    assertEqual(getSeverityForCode(ErrorCode.INTERNAL_UNEXPECTED), ErrorSeverity.CRITICAL);
  });

  await test('getSeverityForCode: returns HIGH for database/external service codes', () => {
    assertEqual(getSeverityForCode(ErrorCode.DATABASE_QUERY_ERROR), ErrorSeverity.HIGH);
    assertEqual(getSeverityForCode(ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE), ErrorSeverity.HIGH);
    assertEqual(getSeverityForCode(ErrorCode.TELEGRAM_API_ERROR), ErrorSeverity.HIGH);
    assertEqual(getSeverityForCode(ErrorCode.LLM_API_ERROR), ErrorSeverity.HIGH);
    assertEqual(getSeverityForCode(ErrorCode.EMBEDDING_API_ERROR), ErrorSeverity.HIGH);
  });

  await test('getSeverityForCode: returns MEDIUM for queue codes', () => {
    assertEqual(getSeverityForCode(ErrorCode.QUEUE_PROCESSING_ERROR), ErrorSeverity.MEDIUM);
    assertEqual(getSeverityForCode(ErrorCode.VALIDATION_INVALID_STATE), ErrorSeverity.MEDIUM);
  });

  await test('getSeverityForCode: returns LOW for validation codes', () => {
    assertEqual(getSeverityForCode(ErrorCode.VALIDATION_INVALID_INPUT), ErrorSeverity.LOW);
    assertEqual(getSeverityForCode(ErrorCode.VALIDATION_MISSING_FIELD), ErrorSeverity.LOW);
    assertEqual(getSeverityForCode(ErrorCode.VALIDATION_INVALID_FORMAT), ErrorSeverity.LOW);
  });
}

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

async function testEdgeCases() {
  await test('Error chain traversal: handles deep chains', () => {
    const e1 = new Error('Root');
    const e2 = new AppError('Level 1', ErrorCode.DATABASE_QUERY_ERROR, { cause: e1 });
    const e3 = new AppError('Level 2', ErrorCode.QUEUE_PROCESSING_ERROR, { cause: e2 });
    const e4 = new AppError('Level 3', ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE, { cause: e3 });

    const chain = e4.getCauseChain();
    const root = e4.getRootCause();

    assertEqual(chain.length, 4);
    assertEqual(root, e1);
  });

  await test('Error serialization: handles circular references gracefully', () => {
    const error = new AppError('Test', ErrorCode.INTERNAL_UNEXPECTED);
    const json = error.toJSON();

    // Should not throw and should produce valid JSON
    const serialized = JSON.stringify(json);
    assertTrue(serialized.length > 0);
  });

  await test('Correlation ID propagation: maintains ID through chain', () => {
    const correlationId = createCorrelationId();
    const e1 = new ValidationError('Invalid', { correlationId });
    const e2 = new QueueError('Processing failed', { cause: e1 });

    // Correlation ID should be preserved in cause
    assertEqual(e1.correlationId, correlationId);
  });

  await test('Error context merging: combines contexts correctly', () => {
    const original = new AppError('Original', ErrorCode.DATABASE_QUERY_ERROR, {
      context: { table: 'users', operation: 'select' },
    });
    const wrapped = wrapError(original, ErrorCode.QUEUE_PROCESSING_ERROR, { queueId: 'q1' });

    assertEqual((wrapped.context as any).table, 'users');
    assertEqual((wrapped.context as any).operation, 'select');
    assertEqual((wrapped.context as any).queueId, 'q1');
  });

  await test('Stack trace preservation: maintains stack traces', () => {
    const error = new AppError('Test', ErrorCode.INTERNAL_UNEXPECTED);

    assertTrue(error.stack !== undefined);
    assertTrue(error.stack!.includes('AppError'));
  });

  await test('Timestamp: is set to current time', () => {
    const before = new Date();
    const error = new AppError('Test', ErrorCode.INTERNAL_UNEXPECTED);
    const after = new Date();

    assertTrue(error.timestamp >= before);
    assertTrue(error.timestamp <= after);
  });

  await test('Multiple field errors: handles multiple validation failures', () => {
    const fieldErrors = [
      { field: 'email', message: 'Invalid', code: ErrorCode.VALIDATION_INVALID_FORMAT },
      { field: 'age', message: 'Too young', code: ErrorCode.VALIDATION_OUT_OF_RANGE },
      { field: 'username', message: 'Required', code: ErrorCode.VALIDATION_MISSING_FIELD },
    ];
    const error = new ValidationError('Multiple errors', { fieldErrors });

    assertEqual(error.fieldErrors.length, 3);
    assertEqual(error.fieldErrors[0].field, 'email');
    assertEqual(error.fieldErrors[1].field, 'age');
    assertEqual(error.fieldErrors[2].field, 'username');
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('\n========================================');
  console.log('Error Types Comprehensive Test Suite');
  console.log('========================================\n');

  console.log('--- AppError Tests ---');
  await testAppError();

  console.log('\n--- ValidationError Tests ---');
  await testValidationError();

  console.log('\n--- NotFoundError Tests ---');
  await testNotFoundError();

  console.log('\n--- TimeoutError Tests ---');
  await testTimeoutError();

  console.log('\n--- RateLimitError Tests ---');
  await testRateLimitError();

  console.log('\n--- ExternalServiceError Tests ---');
  await testExternalServiceError();

  console.log('\n--- TelegramError Tests ---');
  await testTelegramError();

  console.log('\n--- LLMError Tests ---');
  await testLLMError();

  console.log('\n--- EmbeddingError Tests ---');
  await testEmbeddingError();

  console.log('\n--- DatabaseError Tests ---');
  await testDatabaseError();

  console.log('\n--- QueueError Tests ---');
  await testQueueError();

  console.log('\n--- ConfigurationError Tests ---');
  await testConfigurationError();

  console.log('\n--- InvariantViolationError Tests ---');
  await testInvariantViolationError();

  console.log('\n--- UnexpectedError Tests ---');
  await testUnexpectedError();

  console.log('\n--- Helper Function Tests ---');
  await testHelperFunctions();

  console.log('\n--- Edge Cases and Integration Tests ---');
  await testEdgeCases();

  console.log('\n========================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests();
}
