import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Type-safe log argument that supports common serializable values.
 * Replaces `any` with explicit types for better type safety.
 * Includes `unknown` to allow passing caught errors which are typed as `unknown`.
 */
export type LogArg =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | Record<string, unknown>
  | unknown[]
  | unknown;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const LOG_DIR = join(PROJECT_ROOT, 'logs');
const LOG_FILE = join(LOG_DIR, 'jarvis.log');
const ERROR_LOG_FILE = join(LOG_DIR, 'jarvis-error.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;
const FILE_LOGGING_ENABLED = process.env.LOG_TO_FILE !== 'false';
const MAX_ROTATION_ERRORS = 3;
const MAX_WRITE_ERRORS = 5;

/**
 * Error tracking for file logging operations.
 * Used to implement circuit breaker pattern for file logging.
 */
interface FileLoggingState {
  rotationErrorCount: number;
  writeErrorCount: number;
  fileLoggingDisabled: boolean;
  lastRotationError: string | null;
  lastWriteError: string | null;
}

const fileLoggingState: FileLoggingState = {
  rotationErrorCount: 0,
  writeErrorCount: 0,
  fileLoggingDisabled: false,
  lastRotationError: null,
  lastWriteError: null,
};

const DEFAULT_LOG_LEVEL: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || DEFAULT_LOG_LEVEL;
const MIN_LOG_PRIORITY = LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL] || 0;

if (FILE_LOGGING_ENABLED && !existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function rotateLogIfNeeded(logFile: string): void {
  try {
    if (!existsSync(logFile)) return;

    const stats = statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldFile = `${logFile}.${i}`;
      const newFile = `${logFile}.${i + 1}`;
      if (existsSync(oldFile)) {
        if (i === MAX_LOG_FILES - 1) {
          unlinkSync(oldFile);
        } else {
          renameSync(oldFile, newFile);
        }
      }
    }

    renameSync(logFile, `${logFile}.1`);
    // Reset error count on successful rotation
    fileLoggingState.rotationErrorCount = 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown rotation error';
    fileLoggingState.lastRotationError = errorMessage;
    fileLoggingState.rotationErrorCount++;

    // Log to stderr to avoid infinite recursion
    console.error(`[Logger] Log rotation error: ${errorMessage}`);

    if (fileLoggingState.rotationErrorCount >= MAX_ROTATION_ERRORS) {
      fileLoggingState.fileLoggingDisabled = true;
      console.error(`[Logger] File logging disabled after ${MAX_ROTATION_ERRORS} rotation failures`);
    }
  }
}

function writeToFile(logFile: string, line: string): void {
  if (!FILE_LOGGING_ENABLED || fileLoggingState.fileLoggingDisabled) return;

  try {
    rotateLogIfNeeded(logFile);
    appendFileSync(logFile, line);
    // Reset error count on successful write
    fileLoggingState.writeErrorCount = 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown write error';
    fileLoggingState.lastWriteError = errorMessage;
    fileLoggingState.writeErrorCount++;

    // Log to stderr to avoid infinite recursion
    console.error(`[Logger] File write error: ${errorMessage}`);

    if (fileLoggingState.writeErrorCount >= MAX_WRITE_ERRORS) {
      fileLoggingState.fileLoggingDisabled = true;
      console.error(`[Logger] File logging disabled after ${MAX_WRITE_ERRORS} write failures`);
    }
  }
}

function log(level: LogLevel, context: string, message: string, ...args: LogArg[]): void {
  const levelPriority = LOG_LEVEL_PRIORITY[level];
  if (levelPriority < MIN_LOG_PRIORITY) {
    return; // Skip logs below minimum level
  }

  const timestamp = formatTimestamp();
  const argsStr = args.length > 0 ? ' ' + args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ') : '';
  const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${argsStr}`;
  const fileLine = formattedMessage + '\n';

  switch (level) {
    case 'error':
      console.error(formattedMessage);
      break;
    case 'warn':
      console.warn(formattedMessage);
      break;
    case 'debug':
    case 'info':
    default:
      console.log(formattedMessage);
      break;
  }

  writeToFile(LOG_FILE, fileLine);
  if (level === 'error') {
    writeToFile(ERROR_LOG_FILE, fileLine);
  }
}

/**
 * Logger interface with typed methods
 */
export interface Logger {
  debug: (message: string, ...args: LogArg[]) => void;
  info: (message: string, ...args: LogArg[]) => void;
  warn: (message: string, ...args: LogArg[]) => void;
  error: (message: string, ...args: LogArg[]) => void;
}

/**
 * Create a logger with a context prefix
 */
export function createLogger(context: string): Logger {
  return {
    debug: (message: string, ...args: LogArg[]) => log('debug', context, message, ...args),
    info: (message: string, ...args: LogArg[]) => log('info', context, message, ...args),
    warn: (message: string, ...args: LogArg[]) => log('warn', context, message, ...args),
    error: (message: string, ...args: LogArg[]) => log('error', context, message, ...args),
  };
}

export const logger: Logger = {
  debug: (message: string, ...args: LogArg[]) => log('debug', 'App', message, ...args),
  info: (message: string, ...args: LogArg[]) => log('info', 'App', message, ...args),
  warn: (message: string, ...args: LogArg[]) => log('warn', 'App', message, ...args),
  error: (message: string, ...args: LogArg[]) => log('error', 'App', message, ...args),
};

/**
 * Metrics for file logging errors.
 * Useful for monitoring and health checks.
 */
export interface FileLoggingMetrics {
  rotationErrorCount: number;
  writeErrorCount: number;
  fileLoggingDisabled: boolean;
  lastRotationError: string | null;
  lastWriteError: string | null;
}

/**
 * Get current file logging error metrics.
 * Can be used by health checks to monitor logger health.
 */
export function getFileLoggingMetrics(): FileLoggingMetrics {
  return { ...fileLoggingState };
}

/**
 * Reset file logging state, re-enabling file logging if it was disabled.
 * Use this to recover from transient file system errors.
 */
export function resetFileLogging(): void {
  fileLoggingState.rotationErrorCount = 0;
  fileLoggingState.writeErrorCount = 0;
  fileLoggingState.fileLoggingDisabled = false;
  fileLoggingState.lastRotationError = null;
  fileLoggingState.lastWriteError = null;
  console.info('[Logger] File logging state reset');
}
