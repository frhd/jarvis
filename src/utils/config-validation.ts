/**
 * Configuration validation utilities
 *
 * Provides bounds-checking parsers for configuration values to prevent
 * invalid or dangerous configuration from being applied at runtime.
 */

import { createLogger } from './logger.js';
import {
  TIMEOUT_LIMITS,
  RETRY_LIMITS,
  QUEUE_LIMITS,
  TOKEN_LIMITS,
  PORT_LIMITS,
} from '../constants/limits.js';

const logger = createLogger('ConfigValidation');

/**
 * Parse integer with bounds validation
 */
export function parseIntWithBounds(
  value: string | undefined,
  defaultValue: number,
  options: {
    min?: number;
    max?: number;
    name?: string;
  } = {}
): number {
  const parsed = parseInt(value || String(defaultValue), 10);

  if (isNaN(parsed)) {
    logger.warn(
      `Invalid integer for ${options.name || 'value'}, using default: ${defaultValue}`
    );
    return defaultValue;
  }

  if (options.min !== undefined && parsed < options.min) {
    logger.warn(
      `${options.name || 'Value'} ${parsed} below minimum ${options.min}, clamping`
    );
    return options.min;
  }

  if (options.max !== undefined && parsed > options.max) {
    logger.warn(
      `${options.name || 'Value'} ${parsed} above maximum ${options.max}, clamping`
    );
    return options.max;
  }

  return parsed;
}

/**
 * Parse float with bounds validation
 */
export function parseFloatWithBounds(
  value: string | undefined,
  defaultValue: number,
  options: {
    min?: number;
    max?: number;
    name?: string;
  } = {}
): number {
  const parsed = parseFloat(value || String(defaultValue));

  if (isNaN(parsed)) {
    logger.warn(
      `Invalid float for ${options.name || 'value'}, using default: ${defaultValue}`
    );
    return defaultValue;
  }

  if (options.min !== undefined && parsed < options.min) {
    logger.warn(
      `${options.name || 'Value'} ${parsed} below minimum ${options.min}, clamping`
    );
    return options.min;
  }

  if (options.max !== undefined && parsed > options.max) {
    logger.warn(
      `${options.name || 'Value'} ${parsed} above maximum ${options.max}, clamping`
    );
    return options.max;
  }

  return parsed;
}

/**
 * Validated config parsers for common configuration types
 */
export const ConfigParsers = {
  /**
   * Parse timeout value with bounds checking (1s - 10min)
   */
  timeout: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: TIMEOUT_LIMITS.MIN_MS,
      max: TIMEOUT_LIMITS.MAX_MS,
      name: 'timeout',
    }),

  /**
   * Parse retry attempts with bounds checking (1 - 10)
   */
  retryAttempts: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: RETRY_LIMITS.MIN_ATTEMPTS,
      max: RETRY_LIMITS.MAX_ATTEMPTS,
      name: 'retryAttempts',
    }),

  /**
   * Parse retention days with bounds checking (1 - 365)
   */
  retentionDays: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 1,
      max: QUEUE_LIMITS.MAX_RETENTION_DAYS,
      name: 'retentionDays',
    }),

  /**
   * Parse max tokens with bounds checking (1 - 100000)
   */
  maxTokens: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: TOKEN_LIMITS.MIN_MAX_TOKENS,
      max: TOKEN_LIMITS.MAX_MAX_TOKENS,
      name: 'maxTokens',
    }),

  /**
   * Parse temperature with bounds checking (0 - 2)
   */
  temperature: (value: string | undefined, defaultValue: number) =>
    parseFloatWithBounds(value, defaultValue, {
      min: 0,
      max: 2,
      name: 'temperature',
    }),

  /**
   * Parse port with bounds checking (1 - 65535)
   */
  port: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: PORT_LIMITS.MIN,
      max: PORT_LIMITS.MAX,
      name: 'port',
    }),

  /**
   * Parse percentage with bounds checking (0 - 100)
   */
  percentage: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 0,
      max: 100,
      name: 'percentage',
    }),

  /**
   * Parse positive integer with optional max
   */
  positiveInt: (value: string | undefined, defaultValue: number, max?: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 1,
      max,
      name: 'positiveInt',
    }),

  /**
   * Parse non-negative integer with optional max
   */
  nonNegativeInt: (value: string | undefined, defaultValue: number, max?: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 0,
      max,
      name: 'nonNegativeInt',
    }),

  /**
   * Parse similarity threshold (0 - 1)
   */
  similarityThreshold: (value: string | undefined, defaultValue: number) =>
    parseFloatWithBounds(value, defaultValue, {
      min: 0,
      max: 1,
      name: 'similarityThreshold',
    }),

  /**
   * Parse backoff multiplier (1 - 10)
   */
  backoffMultiplier: (value: string | undefined, defaultValue: number) =>
    parseFloatWithBounds(value, defaultValue, {
      min: 1,
      max: 10,
      name: 'backoffMultiplier',
    }),

  /**
   * Parse jitter factor (0 - 1)
   */
  jitterFactor: (value: string | undefined, defaultValue: number) =>
    parseFloatWithBounds(value, defaultValue, {
      min: 0,
      max: 1,
      name: 'jitterFactor',
    }),

  // PM2 monitoring configuration parsers
  pm2RestartWarningThreshold: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 1,
      max: 50,
      name: 'restartWarningThreshold',
    }),
  pm2RestartCriticalThreshold: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 1,
      max: 50,
      name: 'restartCriticalThreshold',
    }),
  pm2CheckIntervalMs: (value: string | undefined, defaultValue: number) =>
    parseIntWithBounds(value, defaultValue, {
      min: 60000,
      max: 600000,
      name: 'checkIntervalMs',
    }),
};
