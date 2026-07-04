import { logger } from '../../utils/logger.js';
import type { ToolResult } from './tool-executor.service.js';
import type { WebSearchToolResult } from './web-search.tool.js';

/**
 * Validation Result Interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: unknown;
}

/**
 * Tool Result Validator
 *
 * Validates tool results against expected schemas and provides
 * fallback handling for partial or malformed results.
 *
 * Key responsibilities:
 * - Validate result structure against expected schema
 * - Sanitize results (remove unsafe content, truncate large results)
 * - Provide fallback values for partial results
 * - Log validation errors for debugging
 */
export class ToolResultValidator {
  private maxResultLength: number;
  private maxSnippetLength: number;

  constructor(options?: { maxResultLength?: number; maxSnippetLength?: number }) {
    this.maxResultLength = options?.maxResultLength ?? 10000;
    this.maxSnippetLength = options?.maxSnippetLength ?? 500;
  }

  /**
   * Validate a generic ToolResult
   *
   * @param result - The tool result to validate
   * @returns ValidationResult with sanitized data if valid
   */
  validateToolResult(result: unknown): ValidationResult {
    const errors: string[] = [];

    if (!result || typeof result !== 'object') {
      return {
        valid: false,
        errors: ['Result must be an object'],
      };
    }

    const toolResult = result as Partial<ToolResult>;

    // Check required fields
    if (typeof toolResult.success !== 'boolean') {
      errors.push('Missing or invalid success field');
    }

    if (typeof toolResult.toolName !== 'string' || !toolResult.toolName) {
      errors.push('Missing or invalid toolName field');
    }

    if (typeof toolResult.result !== 'string') {
      errors.push('Missing or invalid result field');
    }

    if (typeof toolResult.durationMs !== 'number') {
      errors.push('Missing or invalid durationMs field');
    }

    if (errors.length > 0) {
      logger.warn('[ToolResultValidator] Validation failed', {
        errors,
        toolName: toolResult.toolName,
      });
      return { valid: false, errors };
    }

    // Sanitize the result
    const sanitized: ToolResult = {
      success: toolResult.success!,
      toolName: toolResult.toolName!,
      result: this.sanitizeString(toolResult.result!, this.maxResultLength),
      rawResult: toolResult.rawResult,
      error: toolResult.error,
      durationMs: toolResult.durationMs!,
    };

    return { valid: true, errors: [], sanitized };
  }

  /**
   * Validate a WebSearchToolResult specifically
   *
   * @param result - The web search result to validate
   * @returns ValidationResult with sanitized data if valid
   */
  validateWebSearchResult(result: unknown): ValidationResult {
    const errors: string[] = [];

    if (!result || typeof result !== 'object') {
      return {
        valid: false,
        errors: ['Result must be an object'],
      };
    }

    const searchResult = result as Partial<WebSearchToolResult>;

    // Check required fields
    if (typeof searchResult.success !== 'boolean') {
      errors.push('Missing or invalid success field');
    }

    if (typeof searchResult.query !== 'string') {
      errors.push('Missing or invalid query field');
    }

    if (!Array.isArray(searchResult.results)) {
      errors.push('Missing or invalid results array');
    }

    if (typeof searchResult.durationMs !== 'number') {
      errors.push('Missing or invalid durationMs field');
    }

    if (errors.length > 0) {
      logger.warn('[ToolResultValidator] Web search validation failed', {
        errors,
        query: searchResult.query,
      });
      return { valid: false, errors };
    }

    // Sanitize the result
    const sanitizedResults = (searchResult.results || []).map((r) => ({
      title: this.sanitizeString(r?.title || 'No title', 200),
      url: this.sanitizeUrl(r?.url || ''),
      snippet: this.sanitizeString(r?.snippet || '', this.maxSnippetLength),
    }));

    const sanitized: WebSearchToolResult = {
      success: searchResult.success!,
      results: sanitizedResults,
      query: this.sanitizeString(searchResult.query!, 500),
      error: searchResult.error,
      durationMs: searchResult.durationMs!,
    };

    return { valid: true, errors: [], sanitized };
  }

  /**
   * Provide fallback for a failed or malformed tool result
   *
   * @param toolName - The name of the tool that failed
   * @param error - The error that occurred
   * @returns A safe fallback ToolResult
   */
  createFallbackResult(toolName: string, error: string): ToolResult {
    logger.info('[ToolResultValidator] Creating fallback result', {
      toolName,
      error: error.substring(0, 100),
    });

    return {
      success: false,
      toolName,
      result: `The ${toolName} tool encountered an error and could not complete the request. Error: ${error}`,
      error,
      durationMs: 0,
    };
  }

  /**
   * Sanitize a string by truncating and removing unsafe content
   */
  private sanitizeString(str: string, maxLength: number): string {
    if (typeof str !== 'string') {
      return '';
    }

    // Remove control characters except newlines and tabs
    let sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '... [truncated]';
    }

    return sanitized;
  }

  /**
   * Sanitize a URL
   */
  private sanitizeUrl(url: string): string {
    if (typeof url !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return parsed.href;
    } catch {
      return '';
    }
  }

  /**
   * Check if a result appears to contain sensitive information
   *
   * @param result - The result string to check
   * @returns True if potentially sensitive content detected
   */
  containsSensitiveContent(result: string): boolean {
    const sensitivePatterns = [
      /api[_-]?key\s*[=:]/i,
      /password\s*[=:]/i,
      /secret\s*[=:]/i,
      /private[_-]?key/i,
      /access[_-]?token/i,
      /\b[A-Za-z0-9+/]{40,}\b/, // Long base64-like strings (potential secrets)
    ];

    return sensitivePatterns.some((pattern) => pattern.test(result));
  }
}

// Export singleton instance
export const toolResultValidator = new ToolResultValidator();
