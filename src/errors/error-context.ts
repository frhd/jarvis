/**
 * Error context type definitions
 */

/**
 * Base error context with metadata
 */
export interface ErrorContext {
  [key: string]: unknown;
}

/**
 * Validation-specific error context
 */
export interface ValidationErrorContext extends ErrorContext {
  field?: string;
  value?: unknown;
  constraint?: string;
  expected?: unknown;
}

/**
 * Field validation error details
 */
export interface FieldError {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

/**
 * Database-specific error context
 */
export interface DatabaseErrorContext extends ErrorContext {
  table?: string;
  operation?: string;
  query?: string;
  params?: unknown[];
}

/**
 * External service error context
 */
export interface ExternalServiceErrorContext extends ErrorContext {
  service?: string;
  endpoint?: string;
  statusCode?: number;
  response?: unknown;
  requestId?: string;
}

/**
 * Queue-specific error context
 */
export interface QueueErrorContext extends ErrorContext {
  queueItemId?: string;
  messageId?: string;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Security-specific error context
 */
export interface SecurityErrorContext extends ErrorContext {
  userId?: string;
  telegramId?: string;
  action?: string;
  reason?: string;
  piiType?: string;
  metadata?: Record<string, unknown>;
}
