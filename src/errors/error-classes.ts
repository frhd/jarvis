/**
 * Error class definitions
 */

import { ErrorCode, ErrorSeverity, getSeverityForCode } from './error-codes.js';
import {
  ErrorContext,
  ValidationErrorContext,
  FieldError,
  DatabaseErrorContext,
  ExternalServiceErrorContext,
  QueueErrorContext,
  SecurityErrorContext,
} from './error-context.js';

/**
 * Base application error class that extends the native Error.
 *
 * Features:
 * - Error code categorization
 * - Severity levels for alerting
 * - Operational vs programming error distinction
 * - Rich context metadata
 * - Cause chain preservation
 * - Correlation ID for tracing
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;

  /**
   * Whether this is an operational error (expected) or programming error (bug).
   * - true: Expected errors like validation failures, timeouts, etc.
   * - false: Unexpected errors that indicate bugs in the code
   */
  public readonly isOperational: boolean;
  public readonly context: ErrorContext;
  public readonly cause?: Error;
  public readonly timestamp: Date;
  public readonly correlationId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    options: {
      severity?: ErrorSeverity;
      isOperational?: boolean;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message);

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.code = code;
    this.severity = options.severity ?? ErrorSeverity.MEDIUM;
    this.isOperational = options.isOperational ?? true;
    this.context = options.context ?? {};
    this.cause = options.cause;
    this.timestamp = new Date();
    this.correlationId = options.correlationId;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      isOperational: this.isOperational,
      context: this.context,
      correlationId: this.correlationId,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause instanceof AppError ? this.cause.toJSON() : this.cause?.message,
    };
  }

  public getCauseChain(): Error[] {
    const chain: Error[] = [this];
    let current: Error | undefined = this.cause;

    while (current) {
      chain.push(current);
      current = current instanceof AppError ? current.cause : undefined;
    }

    return chain;
  }

  public getRootCause(): Error {
    const chain = this.getCauseChain();
    return chain[chain.length - 1];
  }
}

/**
 * Validation error for input validation failures.
 */
export class ValidationError extends AppError {
  public readonly fieldErrors: FieldError[];

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      fieldErrors?: FieldError[];
      context?: ValidationErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.VALIDATION_INVALID_INPUT, {
      severity: ErrorSeverity.LOW,
      isOperational: true,
      context: options.context ?? {},
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.fieldErrors = options.fieldErrors ?? [];
  }

  public static forField(
    field: string,
    message: string,
    options: {
      code?: ErrorCode;
      value?: unknown;
      constraint?: string;
      correlationId?: string;
    } = {}
  ): ValidationError {
    return new ValidationError(`Validation failed for field '${field}': ${message}`, {
      code: options.code ?? ErrorCode.VALIDATION_INVALID_INPUT,
      fieldErrors: [
        {
          field,
          message,
          code: options.code ?? ErrorCode.VALIDATION_INVALID_INPUT,
          value: options.value,
        },
      ],
      context: {
        field,
        value: options.value,
        constraint: options.constraint,
      },
      correlationId: options.correlationId,
    });
  }

  public static missingField(
    field: string,
    options: { correlationId?: string } = {}
  ): ValidationError {
    return new ValidationError(`Required field '${field}' is missing`, {
      code: ErrorCode.VALIDATION_MISSING_FIELD,
      fieldErrors: [
        {
          field,
          message: 'This field is required',
          code: ErrorCode.VALIDATION_MISSING_FIELD,
        },
      ],
      context: { field },
      correlationId: options.correlationId,
    });
  }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends AppError {
  public readonly resourceType: string;
  public readonly resourceId: string | number;

  constructor(
    resourceType: string,
    resourceId: string | number,
    options: {
      message?: string;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(
      options.message ?? `${resourceType} with ID '${resourceId}' not found`,
      ErrorCode.DATABASE_NOT_FOUND,
      {
        severity: ErrorSeverity.LOW,
        isOperational: true,
        context: {
          resourceType,
          resourceId,
          ...options.context,
        },
        cause: options.cause,
        correlationId: options.correlationId,
      }
    );

    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Timeout error for operation timeouts.
 */
export class TimeoutError extends AppError {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(
    operation: string,
    timeoutMs: number,
    options: {
      code?: ErrorCode;
      message?: string;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(
      options.message ?? `Operation '${operation}' timed out after ${timeoutMs}ms`,
      options.code ?? ErrorCode.EXTERNAL_SERVICE_TIMEOUT,
      {
        severity: ErrorSeverity.MEDIUM,
        isOperational: true,
        context: {
          operation,
          timeoutMs,
          ...options.context,
        },
        cause: options.cause,
        correlationId: options.correlationId,
      }
    );

    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Rate limit error for too many requests.
 */
export class RateLimitError extends AppError {
  public readonly retryAfterSeconds?: number;
  public readonly limit?: number;
  public readonly current?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      retryAfterSeconds?: number;
      limit?: number;
      current?: number;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.EXTERNAL_SERVICE_RATE_LIMITED, {
      severity: ErrorSeverity.MEDIUM,
      isOperational: true,
      context: {
        retryAfterSeconds: options.retryAfterSeconds,
        limit: options.limit,
        current: options.current,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.retryAfterSeconds = options.retryAfterSeconds;
    this.limit = options.limit;
    this.current = options.current;
  }
}

/**
 * Base external service error.
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly statusCode?: number;

  constructor(
    service: string,
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      statusCode?: number;
      context?: ExternalServiceErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE, {
      severity: options.severity ?? ErrorSeverity.HIGH,
      isOperational: true,
      context: {
        service,
        statusCode: options.statusCode,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.service = service;
    this.statusCode = options.statusCode;
  }
}

/**
 * Telegram-specific error.
 */
export class TelegramError extends ExternalServiceError {
  public readonly telegramErrorCode?: number;
  public readonly floodWaitSeconds?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      statusCode?: number;
      telegramErrorCode?: number;
      floodWaitSeconds?: number;
      context?: ExternalServiceErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super('telegram', message, {
      code: options.code ?? ErrorCode.TELEGRAM_API_ERROR,
      severity: options.severity ?? ErrorSeverity.HIGH,
      statusCode: options.statusCode,
      context: {
        telegramErrorCode: options.telegramErrorCode,
        floodWaitSeconds: options.floodWaitSeconds,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.telegramErrorCode = options.telegramErrorCode;
    this.floodWaitSeconds = options.floodWaitSeconds;
  }

  public static floodWait(seconds: number, options: { correlationId?: string } = {}): TelegramError {
    return new TelegramError(`Flood wait required: ${seconds} seconds`, {
      code: ErrorCode.TELEGRAM_FLOOD_WAIT,
      severity: ErrorSeverity.MEDIUM,
      floodWaitSeconds: seconds,
      correlationId: options.correlationId,
    });
  }
}

/**
 * LLM-specific error.
 */
export class LLMError extends ExternalServiceError {
  public readonly model?: string;
  public readonly tokenCount?: number;
  public readonly maxTokens?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      statusCode?: number;
      model?: string;
      tokenCount?: number;
      maxTokens?: number;
      context?: ExternalServiceErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super('llm', message, {
      code: options.code ?? ErrorCode.LLM_API_ERROR,
      severity: options.severity ?? ErrorSeverity.HIGH,
      statusCode: options.statusCode,
      context: {
        model: options.model,
        tokenCount: options.tokenCount,
        maxTokens: options.maxTokens,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.model = options.model;
    this.tokenCount = options.tokenCount;
    this.maxTokens = options.maxTokens;
  }

  public static contextLengthExceeded(
    tokenCount: number,
    maxTokens: number,
    options: { model?: string; correlationId?: string } = {}
  ): LLMError {
    return new LLMError(
      `Context length exceeded: ${tokenCount} tokens exceeds maximum of ${maxTokens}`,
      {
        code: ErrorCode.LLM_CONTEXT_LENGTH_EXCEEDED,
        severity: ErrorSeverity.MEDIUM,
        model: options.model,
        tokenCount,
        maxTokens,
        correlationId: options.correlationId,
      }
    );
  }

  public static toolArgumentParseError(
    functionName: string,
    rawArgs: string,
    options: { model?: string; correlationId?: string; cause?: Error } = {}
  ): LLMError {
    return new LLMError(
      `Failed to parse tool call arguments for function "${functionName}"`,
      {
        code: ErrorCode.LLM_INVALID_RESPONSE,
        severity: ErrorSeverity.MEDIUM,
        model: options.model,
        context: {
          functionName,
          rawArgs: rawArgs.length > 200 ? rawArgs.substring(0, 200) + '...' : rawArgs,
        },
        cause: options.cause,
        correlationId: options.correlationId,
      }
    );
  }
}

/**
 * Embedding service error.
 */
export class EmbeddingError extends ExternalServiceError {
  public readonly model?: string;
  public readonly inputDimension?: number;
  public readonly expectedDimension?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      statusCode?: number;
      model?: string;
      inputDimension?: number;
      expectedDimension?: number;
      context?: ExternalServiceErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super('embedding', message, {
      code: options.code ?? ErrorCode.EMBEDDING_API_ERROR,
      severity: options.severity ?? ErrorSeverity.HIGH,
      statusCode: options.statusCode,
      context: {
        model: options.model,
        inputDimension: options.inputDimension,
        expectedDimension: options.expectedDimension,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.model = options.model;
    this.inputDimension = options.inputDimension;
    this.expectedDimension = options.expectedDimension;
  }

  public static dimensionMismatch(
    inputDimension: number,
    expectedDimension: number,
    options: { model?: string; correlationId?: string } = {}
  ): EmbeddingError {
    return new EmbeddingError(
      `Embedding dimension mismatch: got ${inputDimension}, expected ${expectedDimension}`,
      {
        code: ErrorCode.EMBEDDING_DIMENSION_MISMATCH,
        severity: ErrorSeverity.MEDIUM,
        model: options.model,
        inputDimension,
        expectedDimension,
        correlationId: options.correlationId,
      }
    );
  }
}

/**
 * Database operation error.
 */
export class DatabaseError extends AppError {
  public readonly table?: string;
  public readonly operation?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      table?: string;
      operation?: string;
      context?: DatabaseErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.DATABASE_QUERY_ERROR, {
      severity: options.severity ?? ErrorSeverity.HIGH,
      isOperational: true,
      context: {
        table: options.table,
        operation: options.operation,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.table = options.table;
    this.operation = options.operation;
  }

  public static connectionError(
    message: string,
    options: { cause?: Error; correlationId?: string } = {}
  ): DatabaseError {
    return new DatabaseError(message, {
      code: ErrorCode.DATABASE_CONNECTION_ERROR,
      severity: ErrorSeverity.CRITICAL,
      cause: options.cause,
      correlationId: options.correlationId,
    });
  }

  public static constraintViolation(
    constraint: string,
    options: { table?: string; cause?: Error; correlationId?: string } = {}
  ): DatabaseError {
    return new DatabaseError(`Database constraint violation: ${constraint}`, {
      code: ErrorCode.DATABASE_CONSTRAINT_VIOLATION,
      severity: ErrorSeverity.MEDIUM,
      table: options.table,
      context: { constraint },
      cause: options.cause,
      correlationId: options.correlationId,
    });
  }
}

/**
 * Queue operation error.
 */
export class QueueError extends AppError {
  public readonly queueItemId?: string;
  public readonly retryCount?: number;
  public readonly maxRetries?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      queueItemId?: string;
      retryCount?: number;
      maxRetries?: number;
      context?: QueueErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.QUEUE_PROCESSING_ERROR, {
      severity: options.severity ?? ErrorSeverity.HIGH,
      isOperational: true,
      context: {
        queueItemId: options.queueItemId,
        retryCount: options.retryCount,
        maxRetries: options.maxRetries,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.queueItemId = options.queueItemId;
    this.retryCount = options.retryCount;
    this.maxRetries = options.maxRetries;
  }

  public static retryExhausted(
    queueItemId: string,
    retryCount: number,
    maxRetries: number,
    options: { cause?: Error; correlationId?: string } = {}
  ): QueueError {
    return new QueueError(
      `Retry exhausted for queue item ${queueItemId}: ${retryCount}/${maxRetries} attempts`,
      {
        code: ErrorCode.QUEUE_RETRY_EXHAUSTED,
        severity: ErrorSeverity.HIGH,
        queueItemId,
        retryCount,
        maxRetries,
        cause: options.cause,
        correlationId: options.correlationId,
      }
    );
  }

  public static circuitOpen(
    serviceName: string,
    options: { correlationId?: string } = {}
  ): QueueError {
    return new QueueError(`Circuit breaker is open for service: ${serviceName}`, {
      code: ErrorCode.QUEUE_CIRCUIT_OPEN,
      severity: ErrorSeverity.HIGH,
      context: { serviceName },
      correlationId: options.correlationId,
    });
  }
}

/**
 * Security error for authentication, authorization, encryption, and privacy violations.
 */
export class SecurityError extends AppError {
  public readonly userId?: string;
  public readonly action?: string;

  constructor(
    message: string,
    code: ErrorCode,
    options: {
      userId?: string;
      action?: string;
      reason?: string;
      context?: SecurityErrorContext;
      cause?: Error;
    } = {}
  ) {
    super(message, code, {
      severity: getSeverityForCode(code),
      isOperational: true,
      context: {
        userId: options.userId,
        action: options.action,
        reason: options.reason,
        ...options.context,
      },
      cause: options.cause,
    });

    this.userId = options.userId;
    this.action = options.action;
  }

  public static authFailed(userId: string, reason: string): SecurityError {
    return new SecurityError(`Authentication failed for user ${userId}: ${reason}`, ErrorCode.SECURITY_AUTH_FAILED, {
      userId,
      action: 'authentication',
      reason,
    });
  }

  public static rateLimited(userId: string, attempts: number, windowMs: number): SecurityError {
    return new SecurityError(
      `Rate limit exceeded for user ${userId}: ${attempts} attempts in ${windowMs}ms`,
      ErrorCode.SECURITY_RATE_LIMITED,
      {
        userId,
        action: 'rate_limit',
        context: {
          attempts,
          windowMs,
        },
      }
    );
  }

  public static encryptionFailed(operation: string, cause?: Error): SecurityError {
    return new SecurityError(`Encryption failed during ${operation}`, ErrorCode.SECURITY_ENCRYPTION_FAILED, {
      action: operation,
      reason: 'encryption_error',
      cause,
    });
  }

  public static piiDetected(piiType: string, action: string): SecurityError {
    return new SecurityError(`PII detected in ${action}: ${piiType}`, ErrorCode.SECURITY_PII_DETECTED, {
      action,
      context: {
        piiType,
      },
    });
  }

  public static dataExportFailed(userId: string, reason: string): SecurityError {
    return new SecurityError(`Data export failed for user ${userId}: ${reason}`, ErrorCode.SECURITY_DATA_EXPORT_FAILED, {
      userId,
      action: 'data_export',
      reason,
    });
  }

  public static dataDeletionFailed(userId: string, reason: string): SecurityError {
    return new SecurityError(`Data deletion failed for user ${userId}: ${reason}`, ErrorCode.SECURITY_DATA_DELETION_FAILED, {
      userId,
      action: 'data_deletion',
      reason,
    });
  }
}

/**
 * Configuration error for missing or invalid configuration.
 */
export class ConfigurationError extends AppError {
  public readonly configKey?: string;
  public readonly expected?: string;
  public readonly actual?: unknown;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      configKey?: string;
      expected?: string;
      actual?: unknown;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.CONFIGURATION_INVALID, {
      severity: ErrorSeverity.CRITICAL,
      isOperational: false, // Configuration errors are programming errors
      context: {
        configKey: options.configKey,
        expected: options.expected,
        actual: options.actual,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.configKey = options.configKey;
    this.expected = options.expected;
    this.actual = options.actual;
  }

  public static missing(
    configKey: string,
    options: { correlationId?: string } = {}
  ): ConfigurationError {
    return new ConfigurationError(`Required configuration '${configKey}' is missing`, {
      code: ErrorCode.CONFIGURATION_MISSING,
      configKey,
      correlationId: options.correlationId,
    });
  }

  public static invalid(
    configKey: string,
    expected: string,
    actual: unknown,
    options: { correlationId?: string } = {}
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid configuration for '${configKey}': expected ${expected}, got ${typeof actual}`,
      {
        code: ErrorCode.CONFIGURATION_INVALID,
        configKey,
        expected,
        actual,
        correlationId: options.correlationId,
      }
    );
  }
}

/**
 * Contact-specific error.
 */
export class ContactError extends AppError {
  public readonly phoneNumber?: string;
  public readonly contactName?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      phoneNumber?: string;
      contactName?: string;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.CONTACT_DATABASE_ERROR, {
      severity: options.severity ?? ErrorSeverity.MEDIUM,
      isOperational: true,
      context: {
        phoneNumber: options.phoneNumber,
        contactName: options.contactName,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.phoneNumber = options.phoneNumber;
    this.contactName = options.contactName;
  }

  public static phoneInvalid(phoneNumber: string, reason: string): ContactError {
    return new ContactError(`Invalid phone number: ${reason}`, {
      code: ErrorCode.CONTACT_PHONE_INVALID,
      phoneNumber,
      severity: ErrorSeverity.LOW,
    });
  }

  public static notFound(phoneNumber: string, contactName?: string): ContactError {
    return new ContactError(
      `Contact not found${contactName ? ` for ${contactName}` : ''}`,
      {
        code: ErrorCode.CONTACT_NOT_FOUND,
        phoneNumber,
        contactName,
        severity: ErrorSeverity.LOW,
      }
    );
  }

  public static alreadyExists(phoneNumber: string, contactName: string): ContactError {
    return new ContactError(`Contact already exists: ${contactName} (${phoneNumber})`, {
      code: ErrorCode.CONTACT_ALREADY_EXISTS,
      phoneNumber,
      contactName,
      severity: ErrorSeverity.LOW,
    });
  }

  public static invalidName(contactName: string, reason: string): ContactError {
    return new ContactError(`Invalid contact name: ${reason}`, {
      code: ErrorCode.CONTACT_INVALID_NAME,
      contactName,
      severity: ErrorSeverity.LOW,
    });
  }
}

/**
 * Identity resolution error.
 */
export class IdentityError extends AppError {
  public readonly platform?: string;
  public readonly platformUserId?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      platform?: string;
      platformUserId?: string;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, options.code ?? ErrorCode.IDENTITY_DATABASE_ERROR, {
      severity: options.severity ?? ErrorSeverity.MEDIUM,
      isOperational: true,
      context: {
        platform: options.platform,
        platformUserId: options.platformUserId,
        ...options.context,
      },
      cause: options.cause,
      correlationId: options.correlationId,
    });

    this.platform = options.platform;
    this.platformUserId = options.platformUserId;
  }

  public static userNotFound(platform: string, platformUserId: string): IdentityError {
    return new IdentityError(
      `User not found for ${platform}:${platformUserId}`,
      {
        code: ErrorCode.IDENTITY_USER_NOT_FOUND,
        platform,
        platformUserId,
        severity: ErrorSeverity.LOW,
      }
    );
  }

  public static duplicatePlatformUser(platform: string, platformUserId: string): IdentityError {
    return new IdentityError(
      `Platform identity ${platform}:${platformUserId} is already linked to another user`,
      {
        code: ErrorCode.IDENTITY_DUPLICATE_PLATFORM_USER,
        platform,
        platformUserId,
      }
    );
  }
}

/**
 * Invariant violation error for programming bugs.
 */
export class InvariantViolationError extends AppError {
  public readonly invariant: string;

  constructor(
    invariant: string,
    options: {
      message?: string;
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(
      options.message ?? `Invariant violation: ${invariant}`,
      ErrorCode.INTERNAL_INVARIANT_VIOLATION,
      {
        severity: ErrorSeverity.CRITICAL,
        isOperational: false, // Invariant violations are programming errors
        context: {
          invariant,
          ...options.context,
        },
        cause: options.cause,
        correlationId: options.correlationId,
      }
    );

    this.invariant = invariant;
  }
}

/**
 * Unexpected error for catch-all scenarios.
 */
export class UnexpectedError extends AppError {
  constructor(
    message: string,
    options: {
      context?: ErrorContext;
      cause?: Error;
      correlationId?: string;
    } = {}
  ) {
    super(message, ErrorCode.INTERNAL_UNEXPECTED, {
      severity: ErrorSeverity.CRITICAL,
      isOperational: false, // Unexpected errors are programming errors
      context: options.context ?? {},
      cause: options.cause,
      correlationId: options.correlationId,
    });
  }

  public static fromUnknown(
    error: unknown,
    options: { context?: ErrorContext; correlationId?: string } = {}
  ): UnexpectedError {
    if (error instanceof AppError) {
      return new UnexpectedError(error.message, {
        cause: error,
        context: options.context,
        correlationId: options.correlationId ?? error.correlationId,
      });
    }

    if (error instanceof Error) {
      return new UnexpectedError(error.message, {
        cause: error,
        context: options.context,
        correlationId: options.correlationId,
      });
    }

    return new UnexpectedError(String(error), {
      context: { originalError: error, ...options.context },
      correlationId: options.correlationId,
    });
  }
}
