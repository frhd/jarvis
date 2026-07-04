/**
 * Schedule Utility Tests
 *
 * Tests for pure schedule calculation functions: calculateNextRunTime,
 * isInQuietHours, and getNextNonQuietTime. Uses fixed dates throughout
 * for determinism. Does not mock croner -- tests real integration.
 *
 * Timezone note: June 15 2024 is summer in Europe/Berlin (CEST = UTC+2).
 *   8:00 Berlin = 06:00 UTC
 *  18:00 Berlin = 16:00 UTC
 *  22:00 Berlin = 20:00 UTC
 *  23:00 Berlin = 21:00 UTC
 *   0:00 Berlin = 22:00 UTC (previous day)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  calculateNextRunTime,
  isInQuietHours,
  getNextNonQuietTime,
} from './schedule-utils.js';

// Fixed reference: Saturday June 15, 2024, 12:00 Berlin (10:00 UTC)
const FIXED_FROM = new Date('2024-06-15T10:00:00Z');
const TZ = 'Europe/Berlin';

describe('schedule-utils', () => {
  // ==========================================================================
  // calculateNextRunTime
  // ==========================================================================

  describe('calculateNextRunTime', () => {
    describe('cron schedules', () => {
      it('returns next 8am Berlin for "0 8 * * *"', () => {
        // From Saturday 12:00 Berlin, the next 8:00 Berlin is Sunday 8:00 Berlin
        // Sunday 8:00 Berlin (CEST) = Sunday 06:00 UTC = 2024-06-16T06:00:00Z
        const result = calculateNextRunTime('cron', '0 8 * * *', TZ, FIXED_FROM);

        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2024-06-16T06:00:00.000Z');
      });

      it('returns next Sunday 6pm Berlin for "0 18 * * 0"', () => {
        // June 15 2024 is Saturday. Next Sunday is June 16.
        // Sunday 18:00 Berlin (CEST) = Sunday 16:00 UTC = 2024-06-16T16:00:00Z
        const result = calculateNextRunTime('cron', '0 18 * * 0', TZ, FIXED_FROM);

        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2024-06-16T16:00:00.000Z');
      });

      it('returns null for an invalid cron expression', () => {
        const result = calculateNextRunTime('cron', 'not-a-cron', TZ, FIXED_FROM);

        expect(result).toBeNull();
      });
    });

    describe('every (interval) schedules', () => {
      it('adds 12 hours (43200000ms) to fromDate', () => {
        const result = calculateNextRunTime('every', '43200000', TZ, FIXED_FROM);

        expect(result).not.toBeNull();
        // 10:00 UTC + 12h = 22:00 UTC
        expect(result!.toISOString()).toBe('2024-06-15T22:00:00.000Z');
      });

      it('returns null for NaN interval', () => {
        const result = calculateNextRunTime('every', 'abc', TZ, FIXED_FROM);

        expect(result).toBeNull();
      });

      it('returns null for zero interval', () => {
        const result = calculateNextRunTime('every', '0', TZ, FIXED_FROM);

        expect(result).toBeNull();
      });

      it('returns null for negative interval', () => {
        const result = calculateNextRunTime('every', '-5000', TZ, FIXED_FROM);

        expect(result).toBeNull();
      });
    });

    describe('at (one-shot) schedules', () => {
      it('returns the date for a future ISO timestamp', () => {
        const futureISO = '2024-12-25T00:00:00Z';
        const result = calculateNextRunTime('at', futureISO, TZ, FIXED_FROM);

        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2024-12-25T00:00:00.000Z');
      });

      it('returns null for a past ISO timestamp', () => {
        const pastISO = '2024-01-01T00:00:00Z';
        const result = calculateNextRunTime('at', pastISO, TZ, FIXED_FROM);

        expect(result).toBeNull();
      });

      it('returns null for an invalid ISO timestamp', () => {
        const result = calculateNextRunTime('at', 'not-a-date', TZ, FIXED_FROM);

        expect(result).toBeNull();
      });

      it('returns null when timestamp equals fromDate exactly', () => {
        // "at" schedule with timestamp <= ref returns null
        const result = calculateNextRunTime('at', FIXED_FROM.toISOString(), TZ, FIXED_FROM);

        expect(result).toBeNull();
      });
    });
  });

  // ==========================================================================
  // isInQuietHours
  // ==========================================================================

  describe('isInQuietHours', () => {
    describe('wrapping quiet hours (22-8, spans midnight)', () => {
      const quietStart = 22;
      const quietEnd = 8;

      it('returns true at 23:00 Berlin', () => {
        // 23:00 Berlin = 21:00 UTC
        const date = new Date('2024-06-15T21:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(true);
      });

      it('returns true at 07:00 Berlin', () => {
        // 07:00 Berlin = 05:00 UTC
        const date = new Date('2024-06-15T05:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(true);
      });

      it('returns false at 09:00 Berlin', () => {
        // 09:00 Berlin = 07:00 UTC
        const date = new Date('2024-06-15T07:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(false);
      });

      it('returns false at 21:00 Berlin', () => {
        // 21:00 Berlin = 19:00 UTC
        const date = new Date('2024-06-15T19:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(false);
      });

      it('returns true at midnight Berlin (00:00)', () => {
        // 00:00 Berlin June 15 = 22:00 UTC June 14
        const date = new Date('2024-06-14T22:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(true);
      });

      it('returns false at exactly 08:00 Berlin (quiet end boundary)', () => {
        // 08:00 Berlin = 06:00 UTC -- quietEnd is exclusive (hour < quietEnd)
        const date = new Date('2024-06-15T06:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(false);
      });
    });

    describe('non-wrapping quiet hours (01-06)', () => {
      const quietStart = 1;
      const quietEnd = 6;

      it('returns true at 03:00 Berlin', () => {
        // 03:00 Berlin = 01:00 UTC
        const date = new Date('2024-06-15T01:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(true);
      });

      it('returns false at 07:00 Berlin', () => {
        // 07:00 Berlin = 05:00 UTC
        const date = new Date('2024-06-15T05:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(false);
      });

      it('returns false at 00:00 Berlin (before quiet start)', () => {
        // 00:00 Berlin = 22:00 UTC previous day
        const date = new Date('2024-06-14T22:00:00Z');
        expect(isInQuietHours(date, quietStart, quietEnd, TZ)).toBe(false);
      });
    });

    describe('same start and end (e.g., 8-8)', () => {
      it('returns false (never quiet)', () => {
        // At any hour, same start/end means no quiet window
        const date = new Date('2024-06-15T10:00:00Z'); // 12:00 Berlin
        expect(isInQuietHours(date, 8, 8, TZ)).toBe(false);
      });

      it('returns false even at the exact same hour', () => {
        // 08:00 Berlin = 06:00 UTC
        const date = new Date('2024-06-15T06:00:00Z');
        expect(isInQuietHours(date, 8, 8, TZ)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // getNextNonQuietTime
  // ==========================================================================

  describe('getNextNonQuietTime', () => {
    it('returns today 08:00 Berlin when currently 07:00 Berlin', () => {
      // 07:00 Berlin = 05:00 UTC on June 15
      const from = new Date('2024-06-15T05:00:00Z');
      const result = getNextNonQuietTime(8, TZ, from);

      // Next occurrence of 08:00 Berlin is today: 2024-06-15T06:00:00Z
      expect(result.toISOString()).toBe('2024-06-15T06:00:00.000Z');
    });

    it('returns tomorrow 08:00 Berlin when currently 09:00 Berlin', () => {
      // 09:00 Berlin = 07:00 UTC on June 15
      const from = new Date('2024-06-15T07:00:00Z');
      const result = getNextNonQuietTime(8, TZ, from);

      // 08:00 Berlin has already passed today, so next is tomorrow
      expect(result.toISOString()).toBe('2024-06-16T06:00:00.000Z');
    });

    it('returns tomorrow 08:00 Berlin when currently exactly 08:00 Berlin', () => {
      // Exact boundary: 08:00 Berlin = 06:00 UTC
      const from = new Date('2024-06-15T06:00:00Z');
      const result = getNextNonQuietTime(8, TZ, from);

      // croner returns next occurrence strictly after fromDate
      expect(result.toISOString()).toBe('2024-06-16T06:00:00.000Z');
    });

    it('returns a Date object (never null)', () => {
      const result = getNextNonQuietTime(8, TZ, FIXED_FROM);

      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it('handles quietEnd=0 (midnight)', () => {
      // From 10:00 UTC (12:00 Berlin), next midnight Berlin is 22:00 UTC same day
      const result = getNextNonQuietTime(0, TZ, FIXED_FROM);

      expect(result).toBeInstanceOf(Date);
      // Next midnight Berlin from 12:00 Berlin = 2024-06-15T22:00:00Z
      expect(result.toISOString()).toBe('2024-06-15T22:00:00.000Z');
    });
  });
});
