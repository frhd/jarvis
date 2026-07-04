/**
 * Message Validation Service
 *
 * Validates LLM responses for common hallucination patterns.
 * Detects false claims about message sending and other capabilities.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('MessageValidationService');

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  sanitizedContent?: string;
}

export interface ValidationIssue {
  type: 'hallucination' | 'misleading' | 'unsupported_capability';
  severity: 'low' | 'medium' | 'high';
  message: string;
  pattern: string;
}

/**
 * MessageValidationService
 *
 * Validates LLM responses for common issues.
 * - Detects hallucinations about sending messages to phone numbers
 * - Detects unsupported capability claims
 * - Provides sanitized content when issues are found
 */
export class MessageValidationService {
  private readonly PHONE_SENDING_PATTERNS = [
    // German patterns
    /ich\s+habe\s+(die|eine)?\s+nachricht\s+an\s+(\+\d+[\d\s\-\(\)]+)/i,
    /ich\s+habe\s+geschickt\s+(\+\d+[\d\s\-\(\)]+)/i,
    /nachricht\s+an\s+(\+\d+[\d\s\-\(\)]+)\s+gesendet/i,
    /gesendet\s+an\s+(\+\d+[\d\s\-\(\)]+)/i,
    // English patterns
    /i\s+(have|sent)\s+(a\s+)?message\s+(to|at)\s+(\+\d+[\d\s\-\(\)]+)/i,
    /i\s+(have|sent)\s+message\s+to\s+(\+\d+[\d\s\-\(\)]+)/i,
    /sent\s+(a\s+)?message\s+to\s+(\+\d+[\d\s\-\(\)]+)/i,
    /message\s+sent\s+to\s+(\+\d+[\d\s\-\(\)]+)/i,
    // Generic patterns
    /gesendet.*\+(\d+)/i,
    /sent.*\+(\d+)/i,
  ];

  private readonly CONTACT_SEARCH_FAILURE_PATTERNS = [
    /ich\s+kann\s+.+\s+nicht\s+finden/i,
    /i\s+can'?t\s+find\s+.+/i,
    /contact\s+.+\s+not\s+found/i,
  ];

  /**
   * Validate LLM response for common issues
   */
  validateResponse(content: string): ValidationResult {
    const issues: ValidationIssue[] = [];
    let sanitizedContent = content;

    // Check for phone number sending hallucinations
    for (const pattern of this.PHONE_SENDING_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        issues.push({
          type: 'hallucination',
          severity: 'high',
          message: 'Response falsely claims to have sent a message to a phone number. Jarvis cannot send messages to phone numbers.',
          pattern: pattern.source,
        });

        logger.warn('[MessageValidation] Phone sending hallucination detected', {
          pattern: pattern.source,
          match: match[0],
          contentPreview: content.substring(0, 100),
        });

        // Sanitize the content - replace the hallucinated claim
        sanitizedContent = sanitizedContent.replace(pattern, '[Action not available: Jarvis cannot send messages to phone numbers]');
      }
    }

    // Check for contact search failure (helpful suggestion)
    if (this.CONTACT_SEARCH_FAILURE_PATTERNS.some(p => p.test(content))) {
      issues.push({
        type: 'misleading',
        severity: 'low',
        message: 'Response mentions not finding a contact. Consider suggesting contact creation.',
        pattern: 'contact_not_found',
      });
    }

    return {
      isValid: issues.filter(i => i.severity === 'high').length === 0,
      issues,
      sanitizedContent,
    };
  }

  /**
   * Check if content contains claims of sending messages to phone numbers
   */
  containsPhoneSendingClaim(content: string): boolean {
    return this.PHONE_SENDING_PATTERNS.some(pattern => pattern.test(content));
  }

  /**
   * Log validation issues for monitoring
   */
  logValidationIssues(issues: ValidationIssue[], messageId: string): void {
    if (issues.length === 0) {
      return;
    }

    const highSeverityIssues = issues.filter(i => i.severity === 'high');
    const mediumSeverityIssues = issues.filter(i => i.severity === 'medium');
    const lowSeverityIssues = issues.filter(i => i.severity === 'low');

    if (highSeverityIssues.length > 0) {
      logger.warn('[MessageValidation] High severity validation issues', {
        messageId,
        issues: highSeverityIssues.map(i => ({ type: i.type, pattern: i.pattern })),
      });
    }

    if (mediumSeverityIssues.length > 0) {
      logger.info('[MessageValidation] Medium severity validation issues', {
        messageId,
        issues: mediumSeverityIssues.map(i => ({ type: i.type, pattern: i.pattern })),
      });
    }

    if (lowSeverityIssues.length > 0) {
      logger.debug('[MessageValidation] Low severity validation issues', {
        messageId,
        issues: lowSeverityIssues.map(i => ({ type: i.type, pattern: i.pattern })),
      });
    }
  }

  /**
   * Get statistics for validation issues
   */
  getIssueStatistics(): {
    totalValidations: number;
    highSeverityIssues: number;
    mediumSeverityIssues: number;
    lowSeverityIssues: number;
    phoneSendingHallucinations: number;
  } {
    // This would require tracking, for now return zeros
    return {
      totalValidations: 0,
      highSeverityIssues: 0,
      mediumSeverityIssues: 0,
      lowSeverityIssues: 0,
      phoneSendingHallucinations: 0,
    };
  }
}

// Export singleton instance
export const messageValidationService = new MessageValidationService();
