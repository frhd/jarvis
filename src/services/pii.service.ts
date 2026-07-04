/**
 * PII Detection and Redaction Service
 *
 * Provides comprehensive PII (Personally Identifiable Information) detection and redaction
 * capabilities using pattern-based regex matching with configurable confidence scores.
 *
 * Features:
 * - Pattern-based detection for 7+ PII types
 * - Format-preserving redaction (e.g., ***-***-1234 for phone numbers)
 * - Configurable confidence thresholds
 * - Overlap handling for nested/overlapping patterns
 * - Batch detection and redaction
 *
 * @module services/pii
 */

import { PIIType, PIIDetection, PIIRedactionConfig } from '../types/security.types.js';
import { appConfig } from '../config/index.js';

/**
 * Pattern definition for PII detection
 */
interface PIIPattern {
  /** Regular expression pattern for detection */
  regex: RegExp;
  /** Base confidence score for this pattern (0-1) */
  confidence: number;
  /** Optional validator function for additional checks */
  validator?: (match: string) => boolean;
}

/**
 * PII Service
 *
 * Main service for detecting and redacting personally identifiable information
 * in text content. Uses regex patterns with configurable confidence thresholds.
 *
 * @example
 * ```typescript
 * const service = new PIIService({
 *   types: [PIIType.EMAIL, PIIType.PHONE_NUMBER],
 *   preserveFormat: true,
 *   redactionChar: '*',
 *   minConfidence: 0.8
 * });
 *
 * const result = service.detectAndRedact("Contact me at john@example.com or 555-123-4567");
 * // result.redactedText: "Contact me at ***@example.com or ***-***-4567"
 * ```
 */
export class PIIService {
  private config: PIIRedactionConfig;
  private patterns: Map<PIIType, PIIPattern>;

  constructor(config: PIIRedactionConfig) {
    this.config = config;
    this.patterns = this.initializePatterns();
  }

  /**
   * Initialize regex patterns for each PII type
   *
   * Patterns are optimized for accuracy with some tolerance for false positives.
   * Each pattern includes a confidence score based on specificity.
   *
   * @private
   */
  private initializePatterns(): Map<PIIType, PIIPattern> {
    const patterns = new Map<PIIType, PIIPattern>();

    // Phone Numbers - International format with various separators
    // Matches: +1-555-123-4567, (555) 123-4567, 555.123.4567, +44 20 7123 4567
    patterns.set(PIIType.PHONE_NUMBER, {
      regex: /(\+?\d{1,3}[-.\s]?)?(\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g,
      confidence: 0.85,
      validator: (match) => {
        // Must have at least 7 digits (min valid phone number)
        const digits = match.replace(/\D/g, '');
        return digits.length >= 7 && digits.length <= 15;
      },
    });

    // Email - RFC 5322 simplified pattern
    // Matches: user@example.com, firstname.lastname@company.co.uk
    patterns.set(PIIType.EMAIL, {
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      confidence: 0.95,
    });

    // Credit Card Numbers - Major brands (Visa, MC, Amex, Discover)
    // Matches: 4111-1111-1111-1111, 5500 0000 0000 0004, 378282246310005
    patterns.set(PIIType.CREDIT_CARD, {
      regex: /\b(?:\d{4}[-\s]?){3}\d{4}|\b\d{15,16}\b/g,
      confidence: 0.75,
      validator: (match) => {
        // Luhn algorithm check
        const digits = match.replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19) return false;
        return this.luhnCheck(digits);
      },
    });

    // SSN - US Social Security Number
    // Matches: 123-45-6789, 123456789
    patterns.set(PIIType.SSN, {
      regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
      confidence: 0.9,
      validator: (match) => {
        const digits = match.replace(/\D/g, '');
        // SSN cannot start with 000, 666, or 900-999
        const area = parseInt(digits.substring(0, 3), 10);
        return area > 0 && area !== 666 && area < 900;
      },
    });

    // IPv4 Address
    // Matches: 192.168.1.1, 10.0.0.1
    patterns.set(PIIType.IP_ADDRESS, {
      regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      confidence: 0.85,
    });

    // IPv6 Address - Full and compressed formats
    // Matches: 2001:0db8:85a3:0000:0000:8a2e:0370:7334, ::1, fe80::1
    const ipv6Pattern = new RegExp(
      '(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|' + // Full format
      '(?:[0-9a-fA-F]{1,4}:){1,7}:|' + // Compressed with ::
      '(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|' +
      '(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|' +
      '(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|' +
      '(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|' +
      '(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|' +
      '[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|' +
      ':(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|' + // ::
      'fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|' + // Link-local
      '::(?:ffff(?::0{1,4}){0,1}:){0,1}(?:(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9]))', // IPv4-mapped
      'g'
    );
    patterns.set(PIIType.IP_ADDRESS, {
      regex: new RegExp(
        `(${patterns.get(PIIType.IP_ADDRESS)!.regex.source}|${ipv6Pattern.source})`,
        'g'
      ),
      confidence: 0.85,
    });

    // Names - Heuristic based on capitalization patterns
    // Matches: John Doe, Mary Jane Smith, O'Brien
    // Note: Lower confidence due to potential false positives
    patterns.set(PIIType.NAME, {
      regex: /\b[A-Z][a-z]+(?:[''][A-Z][a-z]+)?\s+(?:[A-Z][a-z]+\s+)?[A-Z][a-z]+\b/g,
      confidence: 0.65,
      validator: (match) => {
        // Filter out common false positives (days, months, etc.)
        const commonWords = new Set([
          'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December',
          'North', 'South', 'East', 'West',
        ]);
        const words = match.split(/\s+/);
        return !words.some(word => commonWords.has(word));
      },
    });

    // Telegram Username
    // Matches: @username, @user_name, @user123
    patterns.set(PIIType.USERNAME, {
      regex: /@[a-zA-Z0-9_]{5,32}\b/g,
      confidence: 0.9,
    });

    return patterns;
  }

  /**
   * Luhn algorithm for credit card validation
   *
   * @private
   * @param digits - Credit card number digits only
   * @returns True if passes Luhn check
   */
  private luhnCheck(digits: string): boolean {
    let sum = 0;
    let isEven = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Detect all PII instances in the given text
   *
   * Scans text for all configured PII types and returns detected instances
   * with their locations and confidence scores. Only returns detections that
   * meet the minimum confidence threshold.
   *
   * @param text - Text to scan for PII
   * @returns Array of PII detections, sorted by start position
   *
   * @example
   * ```typescript
   * const detections = service.detect("Call me at 555-1234 or email john@example.com");
   * // Returns: [
   * //   { type: PIIType.PHONE_NUMBER, value: "555-1234", startIndex: 11, ... },
   * //   { type: PIIType.EMAIL, value: "john@example.com", startIndex: 29, ... }
   * // ]
   * ```
   */
  public detect(text: string): PIIDetection[] {
    const detections: PIIDetection[] = [];

    for (const type of this.config.types) {
      const pattern = this.patterns.get(type);
      if (!pattern) continue;

      // Reset regex state
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const value = match[0];
        const startIndex = match.index;
        const endIndex = startIndex + value.length;

        // Apply validator if present
        if (pattern.validator && !pattern.validator(value)) {
          continue;
        }

        // Check confidence threshold
        if (pattern.confidence < this.config.minConfidence) {
          continue;
        }

        // Create redacted value
        const redactedValue = this.createRedactedValue(value, type, this.config.preserveFormat);

        detections.push({
          type,
          value,
          startIndex,
          endIndex,
          confidence: pattern.confidence,
          redactedValue,
        });
      }
    }

    // Sort by start position and handle overlaps
    return this.resolveOverlaps(detections);
  }

  /**
   * Redact PII from text
   *
   * Replaces all detected PII with redacted values. Can optionally override
   * the service configuration for this specific call.
   *
   * @param text - Text to redact
   * @param config - Optional configuration override
   * @returns Redacted text
   *
   * @example
   * ```typescript
   * const redacted = service.redact(
   *   "My SSN is 123-45-6789",
   *   { preserveFormat: true }
   * );
   * // Returns: "My SSN is ***-**-6789"
   * ```
   */
  public redact(text: string, config?: Partial<PIIRedactionConfig>): string {
    const effectiveConfig = { ...this.config, ...config };
    const tempService = new PIIService(effectiveConfig);
    const detections = tempService.detect(text);

    if (detections.length === 0) {
      return text;
    }

    // Build redacted string from right to left to preserve indices
    let result = text;
    for (let i = detections.length - 1; i >= 0; i--) {
      const detection = detections[i];
      result =
        result.substring(0, detection.startIndex) +
        detection.redactedValue +
        result.substring(detection.endIndex);
    }

    return result;
  }

  /**
   * Detect and redact PII in a single pass
   *
   * Efficiently combines detection and redaction operations, returning both
   * the redacted text and the detections found.
   *
   * @param text - Text to process
   * @returns Object containing redacted text and detections
   *
   * @example
   * ```typescript
   * const result = service.detectAndRedact("Email: user@example.com");
   * console.log(result.redactedText); // "Email: ***@example.com"
   * console.log(result.detections.length); // 1
   * ```
   */
  public detectAndRedact(text: string): { redactedText: string; detections: PIIDetection[] } {
    const detections = this.detect(text);
    const redactedText = this.redact(text);
    return { redactedText, detections };
  }

  /**
   * Check if text contains any PII
   *
   * Fast check to determine if text contains PII without full detection.
   * Optionally filter to specific PII types.
   *
   * @param text - Text to check
   * @param types - Optional array of specific PII types to check for
   * @returns True if PII is found
   *
   * @example
   * ```typescript
   * if (service.containsPII("My email is user@example.com")) {
   *   console.log("PII detected!");
   * }
   *
   * // Check only for emails
   * if (service.containsPII(text, [PIIType.EMAIL])) {
   *   console.log("Email found!");
   * }
   * ```
   */
  public containsPII(text: string, types?: PIIType[]): boolean {
    const typesToCheck = types || this.config.types;

    for (const type of typesToCheck) {
      const pattern = this.patterns.get(type);
      if (!pattern) continue;

      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);

      if (match) {
        // Validate if validator exists
        if (pattern.validator) {
          if (pattern.validator(match[0])) {
            return true;
          }
        } else {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Redact only specific PII types
   *
   * Similar to redact() but only processes the specified PII types,
   * leaving other types intact.
   *
   * @param text - Text to redact
   * @param types - Array of PII types to redact
   * @returns Redacted text
   *
   * @example
   * ```typescript
   * const text = "Email: user@example.com, Phone: 555-1234";
   * const redacted = service.redactTypes(text, [PIIType.EMAIL]);
   * // Returns: "Email: ***@example.com, Phone: 555-1234"
   * ```
   */
  public redactTypes(text: string, types: PIIType[]): string {
    const tempConfig: PIIRedactionConfig = {
      ...this.config,
      types,
    };
    const tempService = new PIIService(tempConfig);
    return tempService.redact(text);
  }

  /**
   * Create a redacted version of a detected value
   *
   * Generates the redacted string, optionally preserving format structure
   * (e.g., dashes, spaces, @-signs) for readability.
   *
   * @private
   * @param value - Original value to redact
   * @param type - Type of PII
   * @param preserveFormat - Whether to preserve formatting characters
   * @returns Redacted string
   *
   * @example
   * ```typescript
   * // With preserveFormat=true:
   * createRedactedValue("555-123-4567", PIIType.PHONE_NUMBER, true)
   * // Returns: "***-***-4567"
   *
   * // With preserveFormat=false:
   * createRedactedValue("555-123-4567", PIIType.PHONE_NUMBER, false)
   * // Returns: "************"
   * ```
   */
  private createRedactedValue(value: string, type: PIIType, preserveFormat: boolean): string {
    const char = this.config.redactionChar;

    if (!preserveFormat) {
      return char.repeat(value.length);
    }

    // Format-preserving redaction based on type
    switch (type) {
      case PIIType.PHONE_NUMBER:
        // Preserve separators, redact digits except last 4
        return value.replace(/\d(?=.*\d{4})/g, char);

      case PIIType.EMAIL:
        // Preserve @ and domain, redact username
        const [username, domain] = value.split('@');
        const redactedUsername = char.repeat(Math.min(username.length, 3));
        return `${redactedUsername}@${domain}`;

      case PIIType.CREDIT_CARD:
        // Show last 4 digits only
        const digits = value.replace(/\D/g, '');
        const lastFour = digits.slice(-4);
        const redactedDigits = char.repeat(digits.length - 4) + lastFour;

        // Preserve original formatting
        let result = '';
        let digitIndex = 0;
        for (const c of value) {
          if (/\d/.test(c)) {
            result += redactedDigits[digitIndex++];
          } else {
            result += c;
          }
        }
        return result;

      case PIIType.SSN:
        // Show last 4 digits only
        return value.replace(/\d(?=.*\d{4})/g, char);

      case PIIType.IP_ADDRESS:
        // Redact last octet for IPv4, or last group for IPv6
        if (value.includes(':')) {
          // IPv6
          const parts = value.split(':');
          parts[parts.length - 1] = char.repeat(parts[parts.length - 1].length);
          return parts.join(':');
        } else {
          // IPv4
          const parts = value.split('.');
          parts[3] = char.repeat(parts[3].length);
          return parts.join('.');
        }

      case PIIType.NAME:
        // Redact all but first letter of each word
        return value.replace(/\b(\w)\w+/g, `$1${char.repeat(3)}`);

      case PIIType.USERNAME:
        // Preserve @ symbol
        return '@' + char.repeat(value.length - 1);

      default:
        return char.repeat(value.length);
    }
  }

  /**
   * Resolve overlapping detections
   *
   * When multiple patterns match overlapping text regions, keeps the detection
   * with the highest confidence score. For equal confidence, prefers the longer match.
   *
   * @private
   * @param detections - Array of detections to resolve
   * @returns Array with overlaps resolved
   */
  private resolveOverlaps(detections: PIIDetection[]): PIIDetection[] {
    if (detections.length <= 1) {
      return detections;
    }

    // Sort by start index
    const sorted = [...detections].sort((a, b) => a.startIndex - b.startIndex);
    const resolved: PIIDetection[] = [];

    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      // Check for overlap
      if (next.startIndex < current.endIndex) {
        // Overlap detected - keep higher confidence, or longer match if tied
        if (
          next.confidence > current.confidence ||
          (next.confidence === current.confidence &&
           (next.endIndex - next.startIndex) > (current.endIndex - current.startIndex))
        ) {
          current = next;
        }
        // Skip the overlapping detection
      } else {
        // No overlap - add current and move to next
        resolved.push(current);
        current = next;
      }
    }

    // Add the last detection
    resolved.push(current);

    return resolved;
  }
}

/**
 * Singleton instance with default configuration from appConfig
 *
 * Pre-configured PII service instance ready to use throughout the application.
 * Uses configuration from appConfig.security.pii.
 *
 * @example
 * ```typescript
 * import { piiService } from './services/pii.service';
 *
 * const text = "Contact John at john@example.com or 555-1234";
 * const { redactedText } = piiService.detectAndRedact(text);
 * console.log(redactedText);
 * ```
 */
export const piiService = new PIIService({
  types: Object.values(PIIType),
  preserveFormat: true,
  redactionChar: '*',
  minConfidence: appConfig.security.pii.minConfidence,
});
