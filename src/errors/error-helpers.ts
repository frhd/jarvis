/**
 * Error helper functions and utilities
 */

import { randomUUID } from 'crypto';
import { ErrorCode, ErrorSeverity, getSeverityForCode } from './error-codes.js';
import { ErrorContext } from './error-context.js';
import {
  AppError,
  InvariantViolationError,
} from './error-classes.js';

// Re-export getSeverityForCode for backwards compatibility
export { getSeverityForCode };

/**
 * Check if an error is an operational error (expected) vs programming error (bug).
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Check if an error is retryable.
 *
 * Retryable errors include:
 * - Timeouts
 * - Rate limits (after waiting)
 * - Temporary connection issues
 * - Circuit breaker half-open state
 *
 * Non-retryable errors include:
 * - Validation errors
 * - Not found errors
 * - Configuration errors
 * - Invariant violations
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }

  const nonRetryableCodes: ErrorCode[] = [
    // Validation errors are not retryable
    ErrorCode.VALIDATION_INVALID_INPUT,
    ErrorCode.VALIDATION_MISSING_FIELD,
    ErrorCode.VALIDATION_INVALID_FORMAT,
    ErrorCode.VALIDATION_OUT_OF_RANGE,
    ErrorCode.VALIDATION_CONSTRAINT_VIOLATION,
    ErrorCode.VALIDATION_TYPE_MISMATCH,
    ErrorCode.VALIDATION_INVALID_STATE,

    // Not found errors are not retryable
    ErrorCode.DATABASE_NOT_FOUND,

    // Configuration errors are not retryable
    ErrorCode.CONFIGURATION_MISSING,
    ErrorCode.CONFIGURATION_INVALID,
    ErrorCode.CONFIGURATION_TYPE_ERROR,
    ErrorCode.CONFIGURATION_VALIDATION_ERROR,
    ErrorCode.CONFIGURATION_SCHEMA_ERROR,
    ErrorCode.CONFIGURATION_ENVIRONMENT_ERROR,

    // Security errors are not retryable
    ErrorCode.SECURITY_AUTH_FAILED,
    ErrorCode.SECURITY_VALIDATION_FAILED,
    ErrorCode.SECURITY_RATE_LIMITED,
    ErrorCode.SECURITY_UNAUTHORIZED,
    ErrorCode.SECURITY_FORBIDDEN,
    ErrorCode.SECURITY_ENCRYPTION_FAILED,
    ErrorCode.SECURITY_DECRYPTION_FAILED,
    ErrorCode.SECURITY_KEY_DERIVATION_FAILED,
    ErrorCode.SECURITY_PII_DETECTED,
    ErrorCode.SECURITY_POLICY_VIOLATION,
    ErrorCode.SECURITY_DATA_EXPORT_FAILED,
    ErrorCode.SECURITY_DATA_DELETION_FAILED,

    // Internal errors are not retryable
    ErrorCode.INTERNAL_INVARIANT_VIOLATION,
    ErrorCode.INTERNAL_NOT_IMPLEMENTED,
    ErrorCode.INTERNAL_ASSERTION_FAILED,
    ErrorCode.INTERNAL_STATE_CORRUPTION,

    // Exhausted retries are not retryable
    ErrorCode.QUEUE_RETRY_EXHAUSTED,

    // Content filtered is not retryable
    ErrorCode.LLM_CONTENT_FILTERED,

    // Duplicate entry is not retryable
    ErrorCode.DATABASE_DUPLICATE_ENTRY,

    // Auth errors typically need human intervention
    ErrorCode.EXTERNAL_SERVICE_AUTH_ERROR,
    ErrorCode.TELEGRAM_AUTH_ERROR,
    ErrorCode.TELEGRAM_SESSION_EXPIRED,

    // Constraint violations are not retryable
    ErrorCode.DATABASE_CONSTRAINT_VIOLATION,
  ];

  return !nonRetryableCodes.includes(error.code);
}

/**
 * Wrap an unknown error in an AppError with additional context.
 */
export function wrapError(
  error: unknown,
  code: ErrorCode,
  context: ErrorContext = {}
): AppError {
  // If already an AppError with the same code, just add context
  if (error instanceof AppError && error.code === code) {
    return new AppError(error.message, code, {
      severity: error.severity,
      isOperational: error.isOperational,
      context: { ...error.context, ...context },
      cause: error.cause,
      correlationId: error.correlationId,
    });
  }

  // If an AppError with different code, wrap it
  if (error instanceof AppError) {
    return new AppError(error.message, code, {
      severity: error.severity,
      isOperational: error.isOperational,
      context: { ...error.context, ...context },
      cause: error,
      correlationId: error.correlationId,
    });
  }

  // If a regular Error, wrap it
  if (error instanceof Error) {
    return new AppError(error.message, code, {
      context,
      cause: error,
    });
  }

  // For unknown types, convert to string
  return new AppError(String(error), code, {
    context: { originalError: error, ...context },
  });
}

/**
 * Create a unique correlation ID for distributed tracing.
 */
export function createCorrelationId(): string {
  return randomUUID();
}

/**
 * Assert a condition and throw InvariantViolationError if false.
 */
export function assertInvariant(
  condition: boolean,
  invariant: string,
  context?: ErrorContext
): asserts condition {
  if (!condition) {
    throw new InvariantViolationError(invariant, { context });
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
