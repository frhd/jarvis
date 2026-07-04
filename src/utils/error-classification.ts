/**
 * Error classification utilities for determining error severity and recovery strategies.
 * Used by bootstrap and global error handlers to decide whether to recover or shutdown.
 */

/**
 * Determines if an error is a recoverable Telegram connection error.
 * These errors trigger reconnection attempts rather than shutdown.
 */
export function isTelegramConnectionError(error: unknown): boolean {
  if (!error) return false;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack || '' : '';

  // Known Telegram connection error patterns
  const CONNECTION_ERROR_PATTERNS = [
    'TIMEOUT',
    'Not connected',
    'CONNECTION_NOT_INITED',
    'NETWORK_MIGRATE',
    'Connection closed',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
  ];

  const isConnectionError = CONNECTION_ERROR_PATTERNS.some(pattern =>
    message.includes(pattern)
  );

  // Check if error originates from Telegram library
  const TELEGRAM_STACK_PATTERNS = [
    'telegram/',
    'MTProtoSender',
    'Connection.js',
    'updates.js',
  ];

  const isTelegramError = TELEGRAM_STACK_PATTERNS.some(pattern =>
    stack.includes(pattern)
  );

  return isConnectionError || isTelegramError;
}

/**
 * Determines if an error is non-critical and shouldn't cause shutdown.
 * These errors are logged but operation continues.
 */
export function isNonCriticalError(error: unknown): boolean {
  if (!error) return false;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack || '' : '';

  // Non-critical error patterns in message
  const NON_CRITICAL_MESSAGE_PATTERNS = [
    'intent classification timed out',
    'Enhanced intent classification timed out',
    'LLM',
    'Claude CLI',
    'AntiLoop',
    'Frustration analysis',
    'Imperative detection',
    'Loop detection',
    'SQLITE_ERROR',
    'ProgressReporter',
    'Network error',
  ];

  // Check message patterns with context
  if (message.includes('intent classification timed out')) return true;
  if (message.includes('Enhanced intent classification timed out')) return true;
  // LLM timeout errors - "timeout" or "timed out"
  if (message.includes('LLM') && (message.includes('timeout') || message.includes('timed out'))) return true;
  if (message.includes('Claude CLI') && message.includes('timed out')) return true;
  if (message.includes('SQLITE_ERROR')) return true;
  if (message.includes('ProgressReporter') && message.includes('Network error')) return true;
  // Network/timeout errors are non-critical (service degradation, not crash)
  if (message.includes('request timed out')) return true;
  if (message.includes('ETIMEDOUT')) return true;
  if (message.includes('ECONNREFUSED')) return true;
  // Ollama/Embedding service errors are non-critical
  if (message.includes('Ollama') || message.includes('Embedding')) return true;
  // SQLite contention errors are transient and non-critical
  if (message.includes('SQLITE_BUSY') || message.includes('SQLITE_LOCKED')) return true;
  // Network errors are recoverable
  if (message.includes('ECONNRESET') || message.includes('fetch failed')) return true;

  // Non-critical error patterns in stack trace
  const NON_CRITICAL_STACK_PATTERNS = [
    'antiLoop',
    'frustrationDetector',
    'imperativeDetection',
    'loopDetection',
    'enhancedIntentClassifier',
    'IntentClassifier',
    'llm.client',      // LLM client timeouts/failures
    'embedding',       // Embedding service failures
    'ollama',          // Ollama provider failures
  ];

  const hasNonCriticalStack = NON_CRITICAL_STACK_PATTERNS.some(pattern =>
    stack.includes(pattern)
  );

  if (hasNonCriticalStack) return true;

  // Check for AntiLoop, Frustration, Imperative, Loop detection in message
  if (message.includes('AntiLoop')) return true;
  if (message.includes('Frustration analysis')) return true;
  if (message.includes('Imperative detection')) return true;
  if (message.includes('Loop detection')) return true;

  return false;
}

/**
 * Formats an error for logging with message and stack trace.
 */
export function formatErrorForLog(error: unknown): string {
  if (!error) return 'Unknown error';
  if (error instanceof Error) {
    return `${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}
