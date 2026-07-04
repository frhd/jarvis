/**
 * Tests for Contact Repository
 * Focuses on phone number normalization and contact lookup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactRepository } from './contact.repository.js';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';

// Mock database
vi.mock('../db/client.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

describe('ContactRepository', () => {
  let repository: ContactRepository;

  beforeEach(() => {
    repository = new ContactRepository();
    vi.clearAllMocks();
  });

  describe('Phone number normalization', () => {
    it('should normalize E.164 format correctly', () => {
      // The normalize method is private, but we can test via upsert/findByPhoneNumber
      // by checking that the normalized value is what we expect
      const input = '+4917612345678';
      const expected = '+4917612345678';

      // Test the normalization logic directly
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe(expected);
    });

    it('should normalize German local format (0176...) ', () => {
      const input = '017612345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should normalize with spaces', () => {
      const input = '+49 176 12345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should normalize with dashes', () => {
      const input = '+49-176-12345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should normalize with parentheses', () => {
      const input = '+49 (176) 12345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should normalize 00 prefix format', () => {
      const input = '004917612345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should normalize without + but with country code', () => {
      const input = '4917612345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should handle German number starting with 0', () => {
      const input = '017612345678';
      // @ts-expect-error - accessing private method for testing
      const result = (repository as any).normalizePhoneNumber(input);

      expect(result).toBe('+4917612345678');
    });

    it('should consistently normalize the same number in different formats', () => {
      const formats = [
        '+4917612345678',
        '+49 176 12345678',
        '+49-176-12345678',
        '+49 (176) 12345678',
        '004917612345678',
        '4917612345678',
        '017612345678',
        '0176 1234 5678',
      ];

      const results = formats.map(format =>
        // @ts-expect-error - accessing private method for testing
        (repository as any).normalizePhoneNumber(format)
      );

      // All should normalize to the same value
      const normalized = results[0];
      expect(results.every(r => r === normalized)).toBe(true);
      expect(normalized).toBe('+4917612345678');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle Lenn\'s phone number in various formats', () => {
      const formats = [
        '+4917612345678',    // User provided this
        '+49 17612345678',  // Bot showed this (with space after 49)
        '017612345678',      // Local format
      ];

      const results = formats.map(format =>
        // @ts-expect-error - accessing private method for testing
        (repository as any).normalizePhoneNumber(format)
      );

      // All should normalize consistently
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
      expect(uniqueResults.has('+4917612345678')).toBe(true);
    });

    it('should handle phone numbers mentioned in conversation context', () => {
      const contextNumbers = [
        '+4917612345678',
        '017612345678',
        '+49 176 1234 5678',
      ];

      const results = contextNumbers.map(num =>
        // @ts-expect-error - accessing private method for testing
        (repository as any).normalizePhoneNumber(num)
      );

      // Should all normalize to same value for consistent lookup
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    });
  });
});
