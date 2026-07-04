/**
 * Schedule Calculation Utilities for Proactive Messaging
 *
 * Pure functions for calculating next run times, checking quiet hours,
 * and determining when quiet hours end. Uses croner for cron parsing
 * and Intl.DateTimeFormat for timezone conversions.
 */

import { Cron } from 'croner';
import type { ProactiveScheduleType } from '../../types/proactive.types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('schedule-utils');

/**
 * Get the hour component of a Date in a specific timezone.
 * Uses Intl.DateTimeFormat to correctly handle DST and timezone offsets.
 */
function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  return parseInt(formatter.format(date), 10);
}

/**
 * Calculate the next run time for a proactive job based on its schedule type.
 *
 * @param scheduleType - The type of schedule: 'cron', 'every', or 'at'
 * @param scheduleValue - The schedule value (cron expression, ms interval, or ISO timestamp)
 * @param timezone - IANA timezone string (e.g., 'Europe/Berlin')
 * @param fromDate - Reference date for calculation (defaults to now)
 * @returns The next Date to run, or null if the schedule is invalid or in the past
 */
export function calculateNextRunTime(
  scheduleType: ProactiveScheduleType,
  scheduleValue: string,
  timezone: string,
  fromDate?: Date,
): Date | null {
  const ref = fromDate ?? new Date();

  try {
    switch (scheduleType) {
      case 'cron': {
        const cron = new Cron(scheduleValue, { timezone });
        const next = cron.nextRun(ref);
        return next;
      }

      case 'every': {
        const intervalMs = Number(scheduleValue);
        if (isNaN(intervalMs) || intervalMs <= 0) {
          logger.warn('Invalid interval for "every" schedule', { scheduleValue });
          return null;
        }
        return new Date(ref.getTime() + intervalMs);
      }

      case 'at': {
        const targetDate = new Date(scheduleValue);
        if (isNaN(targetDate.getTime())) {
          logger.warn('Invalid ISO timestamp for "at" schedule', { scheduleValue });
          return null;
        }
        if (targetDate.getTime() <= ref.getTime()) {
          return null;
        }
        return targetDate;
      }

      default: {
        logger.warn('Unknown schedule type', { scheduleType });
        return null;
      }
    }
  } catch (error) {
    logger.error('Error calculating next run time', { scheduleType, scheduleValue, error });
    return null;
  }
}

/**
 * Check whether a given date falls within quiet hours in a specific timezone.
 *
 * Handles wrapping across midnight (e.g., 22:00-08:00) as well as
 * same-day ranges (e.g., 01:00-06:00).
 *
 * @param date - The date to check
 * @param quietStart - Hour when quiet hours begin (0-23)
 * @param quietEnd - Hour when quiet hours end (0-23)
 * @param timezone - IANA timezone string
 * @returns true if the date is within quiet hours
 */
export function isInQuietHours(
  date: Date,
  quietStart: number,
  quietEnd: number,
  timezone: string,
): boolean {
  if (quietStart === quietEnd) {
    return false;
  }

  const hour = getHourInTimezone(date, timezone);

  if (quietStart > quietEnd) {
    // Wraps midnight, e.g., 22:00-08:00
    return hour >= quietStart || hour < quietEnd;
  }

  // Same day, e.g., 01:00-06:00
  return hour >= quietStart && hour < quietEnd;
}

/**
 * Get the next time quiet hours end in the specified timezone.
 *
 * Uses croner to find the next occurrence of quietEnd:00 in the timezone,
 * which correctly handles DST transitions and timezone offsets.
 *
 * @param quietEnd - Hour when quiet hours end (0-23)
 * @param timezone - IANA timezone string
 * @param fromDate - Reference date (defaults to now)
 * @returns The next Date when quiet hours end
 */
export function getNextNonQuietTime(
  quietEnd: number,
  timezone: string,
  fromDate?: Date,
): Date {
  const ref = fromDate ?? new Date();

  // Use croner to find the next occurrence of the quiet end hour in the timezone.
  // Cron expression "0 <hour> * * *" fires at <hour>:00 every day.
  const cron = new Cron(`0 ${quietEnd} * * *`, { timezone });
  const next = cron.nextRun(ref);

  if (next) {
    return next;
  }

  // Fallback: should not happen with a valid cron, but return tomorrow at quietEnd
  // as a safety measure.
  logger.warn('Cron nextRun returned null for quiet end calculation, using fallback', {
    quietEnd,
    timezone,
  });
  const fallback = new Date(ref);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(quietEnd, 0, 0, 0);
  return fallback;
}
