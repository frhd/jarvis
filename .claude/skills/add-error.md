# /add-error - Add New Error Type

Add a new error type with code, class, and context.

## When to Use

- Adding a new category of errors
- Creating domain-specific error handling
- Extending error tracking capabilities

## Error System Architecture

```
src/errors/
├── error-codes.ts      # Error code enum and severity mapping
├── error-classes.ts    # Error class hierarchy
├── error-context.ts    # Error context interfaces
├── error-helpers.ts    # Utility functions
└── index.ts            # Re-exports
```

## Step 1: Add Error Code

Edit `src/errors/error-codes.ts`:

```typescript
export enum ErrorCode {
  // ... existing codes ...

  // <Category> Errors
  <CATEGORY>_<SPECIFIC_ERROR> = '<CATEGORY>_<SPECIFIC_ERROR>',
  <CATEGORY>_<ANOTHER_ERROR> = '<CATEGORY>_<ANOTHER_ERROR>',
}
```

### Error Code Conventions

| Prefix | Category | Examples |
|--------|----------|----------|
| `VALIDATION_` | Input validation | `VALIDATION_INVALID_INPUT` |
| `DATABASE_` | Database operations | `DATABASE_QUERY_ERROR` |
| `EXTERNAL_SERVICE_` | External APIs | `EXTERNAL_SERVICE_TIMEOUT` |
| `TELEGRAM_` | Telegram-specific | `TELEGRAM_AUTH_ERROR` |
| `LLM_` | LLM services | `LLM_TIMEOUT` |
| `EMBEDDING_` | Embedding service | `EMBEDDING_DIMENSION_MISMATCH` |
| `QUEUE_` | Message queue | `QUEUE_CIRCUIT_OPEN` |
| `CONFIGURATION_` | Config issues | `CONFIGURATION_MISSING` |
| `SECURITY_` | Security/auth | `SECURITY_AUTH_FAILED` |
| `INTERNAL_` | Programming errors | `INTERNAL_INVARIANT_VIOLATION` |

## Step 2: Map Severity

Update `getSeverityForCode()` in `error-codes.ts`:

```typescript
export function getSeverityForCode(code: ErrorCode): ErrorSeverity {
  // Critical errors
  if (
    code === ErrorCode.DATABASE_CONNECTION_ERROR ||
    code === ErrorCode.<YOUR_CRITICAL_ERROR> ||  // Add here
    // ...
  ) {
    return ErrorSeverity.CRITICAL;
  }

  // High severity errors
  if (
    code.startsWith('DATABASE_') ||
    code.startsWith('<YOUR_CATEGORY>_') ||  // Add category
    // ...
  ) {
    return ErrorSeverity.HIGH;
  }

  // ... etc
}
```

### Severity Guidelines

| Severity | Criteria |
|----------|----------|
| CRITICAL | System unusable, data loss risk, immediate action required |
| HIGH | Major functionality impaired, urgent attention needed |
| MEDIUM | Partial functionality loss, should fix soon |
| LOW | Minor issue, can fix during normal ops |

## Step 3: Create Error Class (Optional)

If you need a specialized error class, add to `error-classes.ts`:

```typescript
/**
 * <Category> Error Context
 */
export interface <Category>ErrorContext extends BaseErrorContext {
  // Add category-specific fields
  resourceId?: string;
  operation?: string;
  details?: Record<string, unknown>;
}

/**
 * <Category> Error
 *
 * Thrown when <description of when this error occurs>
 */
export class <Category>Error extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: <Category>ErrorContext,
    cause?: Error
  ) {
    super(code, message, context, cause);
    this.name = '<Category>Error';
  }

  /**
   * Get category-specific context
   */
  get<Category>Context(): <Category>ErrorContext | undefined {
    return this.context as <Category>ErrorContext;
  }
}
```

## Step 4: Add Context Interface (Optional)

If your error needs rich context, add to `error-context.ts`:

```typescript
/**
 * Context for <Category> errors
 */
export interface <Category>ErrorContext extends BaseErrorContext {
  /** The resource that caused the error */
  resourceId?: string;
  /** The operation being performed */
  operation?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
```

## Step 5: Add Helper Functions (Optional)

Add to `error-helpers.ts`:

```typescript
/**
 * Check if error is a <Category> error
 */
export function is<Category>Error(error: unknown): error is <Category>Error {
  return error instanceof <Category>Error;
}

/**
 * Create a <Category> error with context
 */
export function create<Category>Error(
  code: ErrorCode,
  message: string,
  context?: Partial<<Category>ErrorContext>,
  cause?: Error
): <Category>Error {
  return new <Category>Error(code, message, {
    ...context,
    timestamp: new Date().toISOString(),
  }, cause);
}
```

## Example: Adding Webhook Errors

```typescript
// In error-codes.ts
export enum ErrorCode {
  // ... existing ...

  // Webhook Errors
  WEBHOOK_DELIVERY_FAILED = 'WEBHOOK_DELIVERY_FAILED',
  WEBHOOK_INVALID_SIGNATURE = 'WEBHOOK_INVALID_SIGNATURE',
  WEBHOOK_TIMEOUT = 'WEBHOOK_TIMEOUT',
  WEBHOOK_ENDPOINT_NOT_FOUND = 'WEBHOOK_ENDPOINT_NOT_FOUND',
}

// In getSeverityForCode()
if (code.startsWith('WEBHOOK_')) {
  return ErrorSeverity.HIGH;
}

// In error-classes.ts
export interface WebhookErrorContext extends BaseErrorContext {
  endpointUrl?: string;
  httpStatus?: number;
  retryCount?: number;
}

export class WebhookError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: WebhookErrorContext,
    cause?: Error
  ) {
    super(code, message, context, cause);
    this.name = 'WebhookError';
  }

  getWebhookContext(): WebhookErrorContext | undefined {
    return this.context as WebhookErrorContext;
  }
}

// Usage
throw new WebhookError(
  ErrorCode.WEBHOOK_DELIVERY_FAILED,
  'Failed to deliver webhook after 3 retries',
  {
    endpointUrl: 'https://example.com/webhook',
    httpStatus: 500,
    retryCount: 3,
  }
);
```

## Checklist

- [ ] Add error code(s) to `ErrorCode` enum
- [ ] Map severity in `getSeverityForCode()`
- [ ] Create error class if needed
- [ ] Add context interface if needed
- [ ] Add helper functions if needed
- [ ] Export from `index.ts`
- [ ] Update `docs/TROUBLESHOOTING.md` with new error codes

## Existing Error Classes

| Class | Use For |
|-------|---------|
| `AppError` | Base class for all errors |
| `ValidationError` | Input validation failures |
| `NotFoundError` | Resource not found |
| `TimeoutError` | Operation timeouts |
| `RateLimitError` | Rate limiting |
| `ExternalServiceError` | External API failures |
| `TelegramError` | Telegram-specific errors |
| `LLMError` | LLM service errors |
| `EmbeddingError` | Embedding service errors |
| `DatabaseError` | Database operations |
| `QueueError` | Queue operations |
| `SecurityError` | Security/auth errors |
| `ConfigurationError` | Configuration issues |

## Reference

- Error codes: `src/errors/error-codes.ts`
- Error classes: `src/errors/error-classes.ts`
- Error context: `src/errors/error-context.ts`
- Error helpers: `src/errors/error-helpers.ts`
