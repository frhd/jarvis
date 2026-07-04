import { logger } from '../../utils/logger.js';
import { safeJsonParse } from '../../utils/type-guards.js';
import { ValidationError } from '../../errors/error-classes.js';
import type { CalendarClient } from '../../clients/calendar.client.js';
import type { CalendarEventInfo, ICalendarService } from '../../interfaces/services.js';

/** How long a proposed (unconfirmed) event is held before it expires. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Default event duration when the user gives a start but no end/duration. */
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

/** Token budget for the extraction call — the response is a tiny JSON object. */
const EXTRACTION_MAX_TOKENS = 300;

/**
 * Minimal LLM dependency used for natural-language event extraction.
 * Structurally compatible with `LLMClient.chat`.
 */
export interface CalendarLLM {
  chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    requestId?: string,
    options?: { maxTokens?: number }
  ): Promise<{ content: string }>;
}

export interface CalendarServiceConfig {
  enabled: boolean;
  /** IANA timezone used to resolve relative dates ("tomorrow", "Friday"). */
  timezone: string;
}

interface PendingProposal {
  event: CalendarEventInfo;
  expiresAt: number;
}

/** Shape the LLM is asked to return for event extraction. */
interface ExtractedEventJson {
  title: string;
  startISO?: string;
  endISO?: string;
  location?: string;
}

/**
 * CalendarService
 *
 * Business logic for reading and creating Apple/iCloud calendar events.
 * Owns the confirm-first flow: proposals are held per-conversation until the
 * owner confirms, then the exact stored event is written.
 */
export class CalendarService implements ICalendarService {
  private readonly config: CalendarServiceConfig;
  private readonly client: CalendarClient | null;
  private readonly llm: CalendarLLM;
  private readonly pending = new Map<string, PendingProposal>();

  /**
   * @param client - CalDAV client, or null when the integration is not configured.
   */
  constructor(config: CalendarServiceConfig, client: CalendarClient | null, llm: CalendarLLM) {
    this.config = config;
    this.client = client;
    this.llm = llm;
  }

  isEnabled(): boolean {
    return this.config.enabled && this.client !== null;
  }

  async getEvents(startISO: string, endISO: string): Promise<CalendarEventInfo[]> {
    const client = this.requireClient();
    const events = await client.listEvents(startISO, endISO);
    return events.map((e) => ({
      title: e.title,
      startISO: e.startISO,
      endISO: e.endISO,
      location: e.location,
      notes: e.notes,
    }));
  }

  async extractEventFromText(text: string): Promise<CalendarEventInfo | null> {
    const prompt = this.buildExtractionPrompt(text);

    let content: string;
    try {
      const response = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        undefined,
        { maxTokens: EXTRACTION_MAX_TOKENS }
      );
      content = response.content;
    } catch (error) {
      logger.warn('[CalendarService] Event extraction LLM call failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }

    const parsed = safeJsonParse<ExtractedEventJson>(this.stripToJson(content));
    if (!parsed || !parsed.title || !parsed.title.trim() || !parsed.startISO) {
      logger.info('[CalendarService] Could not extract an event from text', {
        preview: text.substring(0, 80),
      });
      return null;
    }

    const start = new Date(parsed.startISO);
    if (Number.isNaN(start.getTime())) {
      return null;
    }

    let end = parsed.endISO ? new Date(parsed.endISO) : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    }

    return {
      title: parsed.title.trim(),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      location: parsed.location?.trim() || undefined,
    };
  }

  proposeEvent(conversationKey: string, event: CalendarEventInfo): void {
    this.pending.set(conversationKey, {
      event,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
  }

  getPendingProposal(conversationKey: string): CalendarEventInfo | null {
    const pending = this.pending.get(conversationKey);
    if (!pending) {
      return null;
    }
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(conversationKey);
      return null;
    }
    return pending.event;
  }

  async commitPending(conversationKey: string): Promise<CalendarEventInfo> {
    const event = this.getPendingProposal(conversationKey);
    if (!event) {
      throw new ValidationError('No pending calendar event to confirm (it may have expired).');
    }

    const client = this.requireClient();
    await client.createEvent({
      title: event.title,
      startISO: event.startISO,
      endISO: event.endISO,
      location: event.location,
      notes: event.notes,
    });

    this.pending.delete(conversationKey);
    return event;
  }

  discardPending(conversationKey: string): boolean {
    return this.pending.delete(conversationKey);
  }

  private requireClient(): CalendarClient {
    if (!this.client) {
      throw new ValidationError('Calendar integration is not configured.');
    }
    return this.client;
  }

  /** Build the extraction prompt, anchoring relative dates to the current time. */
  private buildExtractionPrompt(text: string): string {
    const nowLocal = new Intl.DateTimeFormat('en-US', {
      timeZone: this.config.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    return [
      'You convert a user request into a single calendar event and output ONLY minified JSON.',
      `Current date and time: ${nowLocal} (timezone ${this.config.timezone}).`,
      'JSON shape: {"title":string,"startISO":string,"endISO":string,"location":string}',
      'Rules:',
      '- startISO and endISO MUST be full ISO-8601 with a UTC offset, e.g. 2026-07-03T12:00:00-07:00.',
      '- Resolve relative dates ("today","tomorrow","Friday","next week") against the current date above.',
      '- If no end or duration is stated, omit endISO (a default duration is applied).',
      '- "location" is optional; omit it if not mentioned.',
      '- If the text is NOT a request to create an event, output {"title":""}.',
      `User request: "${text}"`,
    ].join('\n');
  }

  /** Extract the first JSON object from a possibly chatty LLM response. */
  private stripToJson(content: string): string {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return content;
    }
    return content.slice(start, end + 1);
  }
}

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return the UTC instant of local midnight `dayOffset` days from `now` in `tz`.
 * Handles arbitrary timezones without a date library (DST transitions may be off
 * by an hour at the boundary, which is acceptable for day-range queries).
 */
function startOfLocalDayUTC(now: Date, tz: string, dayOffset: number): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  // Local midnight, expressed as if the wall-clock time were UTC.
  const guessUTC = Date.UTC(get('year'), get('month') - 1, get('day')) + dayOffset * DAY_MS;
  // Correct for the zone's offset at that instant.
  const offsetMs = zoneOffsetMs(new Date(guessUTC), tz);
  return new Date(guessUTC - offsetMs);
}

/** Offset (ms) of `tz` at the given instant: local wall-clock minus UTC. */
function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUTC - date.getTime();
}

/**
 * Resolve a natural-language read request into a concrete [startISO, endISO) range.
 * Defaults to "today". Recognizes tomorrow, this/next week, and month windows.
 */
export function resolveReadRange(
  text: string,
  timezone: string,
  now: Date = new Date()
): { startISO: string; endISO: string } {
  const lower = text.toLowerCase();
  const today = startOfLocalDayUTC(now, timezone, 0);

  let start = today;
  let days = 1;

  if (/\btomorrow\b/.test(lower)) {
    start = startOfLocalDayUTC(now, timezone, 1);
    days = 1;
  } else if (/\bmonth\b/.test(lower)) {
    days = 31;
  } else if (/\bweek\b/.test(lower)) {
    days = 7;
  }

  const end = new Date(start.getTime() + days * DAY_MS);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * Format an event for user-facing display in the given timezone.
 * Used by the routing handler to echo proposals and confirmations.
 */
export function formatEventForDisplay(event: CalendarEventInfo, timezone: string): string {
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const start = new Date(event.startISO);
  const end = new Date(event.endISO);
  const when = `${dateFmt.format(start)} – ${timeFmt.format(end)}`;
  const location = event.location ? ` @ ${event.location}` : '';
  return `${event.title} (${when})${location}`;
}
