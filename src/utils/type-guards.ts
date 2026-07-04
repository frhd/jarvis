/**
 * Type guard functions for safe JSON parsing and validation
 */

import { LONG_CONTENT_PREVIEW_LENGTH, RESPONSE_PREVIEW_LENGTH } from '../config/constants.js';

/**
 * Check if a value is a non-null object (not array)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if an object has a specific property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isRecord(obj) && key in obj;
}

/**
 * Check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Check if a value is a number (not NaN)
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Check if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Check if a value is an array of a specific type
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

/**
 * Check if a value is a valid confidence score (0-1)
 */
export function isConfidenceScore(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

/**
 * Result type for safeJsonParse with error details
 */
export type SafeJsonParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; raw: string };

/**
 * Safe JSON parse with optional type guard validation
 */
export function safeJsonParse<T>(
  content: string,
  typeGuard?: (value: unknown) => value is T
): T | null {
  try {
    const parsed = JSON.parse(content);
    if (typeGuard && !typeGuard(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Safe JSON parse with detailed result for error handling
 * Use this when you need to log or handle parse failures
 */
export function safeJsonParseWithResult<T>(
  content: string,
  typeGuard?: (value: unknown) => value is T
): SafeJsonParseResult<T> {
  try {
    const parsed = JSON.parse(content);
    if (typeGuard && !typeGuard(parsed)) {
      return {
        success: false,
        error: 'Type guard validation failed',
        raw: content.length > RESPONSE_PREVIEW_LENGTH
          ? content.slice(0, RESPONSE_PREVIEW_LENGTH) + '...'
          : content,
      };
    }
    return { success: true, data: parsed as T };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown parse error',
      raw: content.length > RESPONSE_PREVIEW_LENGTH
        ? content.slice(0, RESPONSE_PREVIEW_LENGTH) + '...'
        : content,
    };
  }
}

/**
 * Extract JSON from a string that may contain markdown code blocks
 */
export function extractJsonFromContent(content: string): string {
  let jsonStr = content.trim();

  // Try to extract from code block
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  // Try to extract raw JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return jsonStr;
}

/**
 * Parse JSON from content that may contain markdown code blocks
 */
export function parseJsonFromContent<T>(
  content: string,
  typeGuard?: (value: unknown) => value is T
): T | null {
  const jsonStr = extractJsonFromContent(content);
  return safeJsonParse(jsonStr, typeGuard);
}

/**
 * Check if value is one of the specified string literals
 */
export function isOneOf<T extends string>(
  value: unknown,
  validValues: readonly T[]
): value is T {
  return isString(value) && (validValues as readonly string[]).includes(value);
}

/**
 * Create a type guard for a specific set of string literals
 */
export function createStringLiteralGuard<T extends string>(
  validValues: readonly T[]
): (value: unknown) => value is T {
  return (value: unknown): value is T => isOneOf(value, validValues);
}
