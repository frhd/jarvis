/**
 * Phone Number Normalizer Utility
 *
 * Centralized phone number normalization following E.164 standard.
 * Handles various international formats and edge cases.
 *
 * E.164 format: +[country code][national number]
 * Example: +4917612345678 (Germany)
 *
 * Supported formats:
 * - E.164: +4917612345678
 * - International: 004917612345678, 4917612345678
 * - German local: 017612345678, 0176 12345678
 * - Spaced: +49 176 12345678, +49 17612345678
 * - Dashed: +49-176-12345678
 * - Parentheses: +49 (176) 12345678
 */

export interface NormalizedPhone {
  original: string;
  normalized: string; // E.164 format: +4917612345678
  display: string; // User-friendly: +49 176 12345678
  country?: string;
  isValid: boolean;
}

/**
 * Phone number patterns for different formats
 */
const PHONE_PATTERNS = {
  // E.164 format: +4917612345678
  e164: /^\+(\d{10,15})$/,

  // International format without +: 004917612345678, 4917612345678
  internationalWithoutPlus: /^(00)?(\d{11,16})$/,

  // German local format: 017612345678, 0176 12345678
  germanLocal: /^0\d{2,3}\d{7,9}$/,

  // German mobile: 01[567][0-9]{7,9}
  germanMobile: /^0(1[567]|[67]0|8[0-9]|9[0-9])\d{7,9}$/,

  // US format: +1 (555) 123-4567
  us: /^\+1\s*[\(\s]*\d{3}[\)\s]*[\s-]*\d{3}[\s-]*\d{4}$/,
} as const;

/**
 * Country codes for detection
 */
const COUNTRY_CODES = {
  // Germany
  de: { code: '49', name: 'Germany' },
  // United States
  us: { code: '1', name: 'United States' },
  // United Kingdom
  uk: { code: '44', name: 'United Kingdom' },
  // France
  fr: { code: '33', name: 'France' },
  // Italy
  it: { code: '39', name: 'Italy' },
  // Spain
  es: { code: '34', name: 'Spain' },
  // Netherlands
  nl: { code: '31', name: 'Netherlands' },
  // Belgium
  be: { code: '32', name: 'Belgium' },
  // Switzerland
  ch: { code: '41', name: 'Switzerland' },
  // Austria
  at: { code: '43', name: 'Austria' },
  // Poland
  pl: { code: '48', name: 'Poland' },
  // Czech Republic
  cz: { code: '420', name: 'Czech Republic' },
} as const;

/**
 * Phone number normalizer utility class
 */
export class PhoneNormalizer {
  /**
   * Normalize a phone number to E.164 format
   *
   * @param input - Phone number in any format
   * @param defaultCountry - Default country code (default: 'de' for Germany)
   * @returns Normalized phone number with metadata
   */
  static normalize(input: string, defaultCountry: keyof typeof COUNTRY_CODES = 'de'): NormalizedPhone {
    const original = input.trim();

    // Early return for empty input or whitespace only (no digits)
    if (!original || !/\d/.test(original)) {
      return {
        original,
        normalized: '',
        display: '',
        isValid: false,
      };
    }

    // Step 1: Remove all formatting characters (spaces, dashes, parentheses)
    let digits = original.replace(/[\s\-\(\)]/g, '');

    // Step 2: Handle leading +
    let hasLeadingPlus = false;
    if (digits.startsWith('+')) {
      hasLeadingPlus = true;
      digits = digits.substring(1);
    }

    // Step 3: Handle 00 prefix (international format)
    if (digits.startsWith('00')) {
      digits = digits.substring(2);
    }

    // Step 4: Handle local format (leading 0 for Germany)
    // Assume Germany if it starts with 0 and no country code
    if (digits.startsWith('0') && !digits.startsWith('00') && defaultCountry === 'de') {
      // Remove leading 0 and add 49
      digits = COUNTRY_CODES.de.code + digits.substring(1);
    }

    // Step 5: Add + prefix
    const normalized = '+' + digits;

    // Step 6: Generate display format (spaces every 3 digits, then rest)
    const display = this.formatForDisplay(digits);

    // Step 7: Try to detect country
    const country = this.detectCountry(digits);

    // Step 8: Validate
    const isValid = this.isValid(normalized);

    return {
      original,
      normalized,
      display,
      country,
      isValid,
    };
  }

  /**
   * Format phone number for display with spaces
   *
   * E.164: +4917612345678 -> +49 176 12345678
   *
   * @param digits - Digits only (no + prefix)
   * @returns Formatted display string
   */
  static formatForDisplay(digits: string): string {
    // Extract country code (first 1-3 digits)
    let countryCode = '';
    let nationalNumber = digits;

    // Try to match known country codes
    for (const cc of Object.values(COUNTRY_CODES)) {
      if (digits.startsWith(cc.code)) {
        countryCode = cc.code;
        nationalNumber = digits.substring(cc.code.length);
        break;
      }
    }

    // If no match, use first digit as country code (fallback)
    if (!countryCode) {
      countryCode = digits[0];
      nationalNumber = digits.substring(1);
    }

    // Format national number with spaces
    // German format: 176 12345678 (3 digits, rest - no middle space for long numbers)
    let formattedNational = '';
    if (nationalNumber.length > 7) {
      // For German numbers (11 digits total: 49 + 11 = 11 total digits)
      // Format: 3 digits, then rest without additional middle space
      // Example: 176 12345678
      formattedNational = nationalNumber.slice(0, 3) + ' ' + nationalNumber.slice(3);
    } else if (nationalNumber.length > 4) {
      // Format: split in middle
      const mid = Math.floor(nationalNumber.length / 2);
      formattedNational = nationalNumber.slice(0, mid) + ' ' + nationalNumber.slice(mid);
    } else {
      formattedNational = nationalNumber;
    }

    return `+${countryCode} ${formattedNational}`;
  }

  /**
   * Try to detect country from phone number
   *
   * @param digits - Digits only (no + prefix)
   * @returns Country name or undefined
   */
  static detectCountry(digits: string): string | undefined {
    for (const cc of Object.values(COUNTRY_CODES)) {
      if (digits.startsWith(cc.code)) {
        return cc.name;
      }
    }
    return undefined;
  }

  /**
   * Validate if phone number is in valid E.164 format
   *
   * @param phoneNumber - Phone number (with + prefix)
   * @returns true if valid
   */
  static isValid(phoneNumber: string): boolean {
    if (!phoneNumber.startsWith('+')) {
      return false;
    }

    const digits = phoneNumber.substring(1);
    const length = digits.length;

    // E.164: max 15 digits (excluding +)
    // Country code: 1-3 digits
    // National number: min 7 digits (total 8-15 digits)
    if (length < 8 || length > 15) {
      return false;
    }

    return /^\d+$/.test(digits);
  }

  /**
   * Compare two phone numbers for equality
   * Both numbers are normalized before comparison
   *
   * @param phone1 - First phone number
   * @param phone2 - Second phone number
   * @returns true if they represent the same number
   */
  static equals(phone1: string, phone2: string): boolean {
    const norm1 = this.normalize(phone1);
    const norm2 = this.normalize(phone2);
    return norm1.normalized === norm2.normalized;
  }

  /**
   * Extract phone numbers from text
   *
   * @param text - Text to search
   * @returns Array of found phone numbers
   */
  static extractFromText(text: string): string[] {
    const phoneRegex = /(?:\+?\d{1,3}[\s\-\(\)]?)?\d{3,}[\s\-\(\)]?\d{3,}/g;
    const matches = text.match(phoneRegex);

    if (!matches) {
      return [];
    }

    // Remove duplicates and normalize
    const unique = new Set<string>();
    const results: string[] = [];

    for (const match of matches) {
      const normalized = this.normalize(match).normalized;
      if (normalized && !unique.has(normalized) && this.isValid(normalized)) {
        unique.add(normalized);
        results.push(normalized);
      }
    }

    return results;
  }

  /**
   * Mask phone number for privacy (show only last 4 digits)
   *
   * @param phoneNumber - Phone number to mask
   * @returns Masked phone number
   */
  static mask(phoneNumber: string): string {
    const normalized = this.normalize(phoneNumber);
    if (!normalized.isValid) {
      return '*** INVALID ***';
    }

    const digits = normalized.normalized.substring(1); // Remove +
    const visible = digits.slice(-4);
    const masked = '*'.repeat(digits.length - 4);

    return `+${masked}${visible}`;
  }
}

/**
 * Default phone normalizer instance (configured for Germany by default)
 */
export const phoneNormalizer = PhoneNormalizer;
