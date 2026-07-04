/**
 * Tests for Phone Normalizer Utility
 */

import { describe, it, expect } from 'vitest';
import { PhoneNormalizer } from './phone-normalizer.js';

describe('PhoneNormalizer', () => {
  describe('normalize - German numbers', () => {
    it('should normalize E.164 format', () => {
      const result = PhoneNormalizer.normalize('+4917612345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.display).toBe('+49 176 12345678');
      expect(result.country).toBe('Germany');
      expect(result.isValid).toBe(true);
    });

    it('should normalize with spaces', () => {
      const result = PhoneNormalizer.normalize('+49 176 12345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.display).toBe('+49 176 12345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize with dashes', () => {
      const result = PhoneNormalizer.normalize('+49-176-12345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize with parentheses', () => {
      const result = PhoneNormalizer.normalize('+49 (176) 12345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize local German format (0176...) ', () => {
      const result = PhoneNormalizer.normalize('017612345678', 'de');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.display).toBe('+49 176 12345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize local German format with spaces', () => {
      const result = PhoneNormalizer.normalize('0176 1234 5678', 'de');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize 00 prefix format', () => {
      const result = PhoneNormalizer.normalize('004917612345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.isValid).toBe(true);
    });

    it('should normalize without + prefix but with country code', () => {
      const result = PhoneNormalizer.normalize('4917612345678');
      expect(result.normalized).toBe('+4917612345678');
      expect(result.isValid).toBe(true);
    });
  });

  describe('normalize - edge cases', () => {
    it('should handle empty input', () => {
      const result = PhoneNormalizer.normalize('');
      expect(result.normalized).toBe('');
      expect(result.display).toBe('');
      expect(result.isValid).toBe(false);
    });

    it('should handle whitespace only', () => {
      const result = PhoneNormalizer.normalize('   ');
      expect(result.normalized).toBe('');  // No digits, return empty
      expect(result.display).toBe('');
      expect(result.isValid).toBe(false);
    });

    it('should handle invalid format (no digits)', () => {
      const result = PhoneNormalizer.normalize('abc');
      expect(result.normalized).toBe('');  // No digits, return empty
      expect(result.display).toBe('');
      expect(result.isValid).toBe(false);
    });

    it('should handle too short number', () => {
      const result = PhoneNormalizer.normalize('+1234');
      expect(result.isValid).toBe(false);
    });

    it('should handle too long number', () => {
      const result = PhoneNormalizer.normalize('+123456789012345678');
      expect(result.isValid).toBe(false);
    });
  });

  describe('equals - comparison', () => {
    it('should detect equal numbers in different formats', () => {
      expect(PhoneNormalizer.equals('+4917612345678', '+49 176 12345678')).toBe(true);
      expect(PhoneNormalizer.equals('+4917612345678', '017612345678')).toBe(true);
      expect(PhoneNormalizer.equals('004917612345678', '+49 176 12345678')).toBe(true);
    });

    it('should detect different numbers', () => {
      expect(PhoneNormalizer.equals('+4917612345678', '+4917612345679')).toBe(false);
      expect(PhoneNormalizer.equals('+4917612345678', '+49123456789')).toBe(false);
    });
  });

  describe('extractFromText - extraction', () => {
    it('should extract single phone number', () => {
      const result = PhoneNormalizer.extractFromText('Call me at +4917612345678');
      expect(result).toEqual(['+4917612345678']);
    });

    it('should extract multiple phone numbers', () => {
      const result = PhoneNormalizer.extractFromText(
        'Call Max at +4917612345678 or Sarah at +49123456789'
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle numbers with spaces', () => {
      const result = PhoneNormalizer.extractFromText('Max\'s number is +49 176 12345678');
      expect(result).toContain('+4917612345678');
    });

    it('should return empty array for no numbers', () => {
      const result = PhoneNormalizer.extractFromText('This is just text with no phone numbers');
      expect(result).toEqual([]);
    });

    it('should remove duplicates', () => {
      const result = PhoneNormalizer.extractFromText(
        'Call +4917612345678 or +49 176 12345678'
      );
      expect(result.length).toBe(1);
    });
  });

  describe('mask - privacy', () => {
    it('should mask phone number showing last 4 digits', () => {
      const result = PhoneNormalizer.mask('+4917612345678');
      expect(result).toBe('+*********5678');
    });

    it('should handle invalid numbers', () => {
      const result = PhoneNormalizer.mask('+1234');
      expect(result).toBe('*** INVALID ***');
    });

    it('should work with different input formats', () => {
      const result1 = PhoneNormalizer.mask('+4917612345678');
      const result2 = PhoneNormalizer.mask('017612345678');
      expect(result1).toBe(result2); // Both should normalize to same mask
    });
  });

  describe('formatForDisplay - display formatting', () => {
    it('should format for German numbers', () => {
      const result = PhoneNormalizer.formatForDisplay('4917612345678');
      expect(result).toBe('+49 176 12345678');
    });

    it('should handle shorter numbers', () => {
      const result = PhoneNormalizer.formatForDisplay('491234567');
      // For 9 digits (49 + 7 national), should be: +49 123 4567
      expect(result).toBe('+49 123 4567');
    });

    it('should handle very short numbers', () => {
      const result = PhoneNormalizer.formatForDisplay('4912345');
      // Should format with country code: +49 12 345
      expect(result).toBe('+49 12 345');
    });
  });
});
