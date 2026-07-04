import {
  CalendarService,
  formatEventForDisplay,
  resolveReadRange,
  type CalendarLLM,
} from './calendar.service.js';
import type { CalendarClient, CalendarEvent } from '../../clients/calendar.client.js';
import type { CalendarEventInfo } from '../../interfaces/services.js';

/** Build a mock CalendarClient with spy-able methods. */
function mockClient(overrides: Partial<CalendarClient> = {}) {
  return {
    listEvents: vi.fn<[string, string], Promise<CalendarEvent[]>>().mockResolvedValue([]),
    createEvent: vi.fn<[unknown], Promise<string>>().mockResolvedValue('new-uid'),
    ...overrides,
  } as unknown as CalendarClient & {
    listEvents: ReturnType<typeof vi.fn>;
    createEvent: ReturnType<typeof vi.fn>;
  };
}

/** Build a mock LLM whose chat() returns the given content. */
function mockLLM(content: string): CalendarLLM {
  return { chat: vi.fn().mockResolvedValue({ content }) };
}

const CONFIG = { enabled: true, timezone: 'UTC' };
const KEY = 'conv-1';

describe('CalendarService.isEnabled', () => {
  it('is false when the feature is disabled', () => {
    const svc = new CalendarService({ ...CONFIG, enabled: false }, mockClient(), mockLLM('{}'));
    expect(svc.isEnabled()).toBe(false);
  });

  it('is false when no client is configured', () => {
    const svc = new CalendarService(CONFIG, null, mockLLM('{}'));
    expect(svc.isEnabled()).toBe(false);
  });

  it('is true when enabled and a client is present', () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{}'));
    expect(svc.isEnabled()).toBe(true);
  });
});

describe('CalendarService.getEvents', () => {
  it('delegates to the client and maps fields', async () => {
    const event: CalendarEvent = {
      uid: 'u1',
      title: 'Standup',
      startISO: '2026-07-01T09:00:00.000Z',
      endISO: '2026-07-01T09:30:00.000Z',
      location: 'Zoom',
    };
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue([event]),
    } as Partial<CalendarClient>);
    const svc = new CalendarService(CONFIG, client, mockLLM('{}'));

    const result = await svc.getEvents('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');

    expect(client.listEvents).toHaveBeenCalledWith(
      '2026-07-01T00:00:00Z',
      '2026-07-02T00:00:00Z'
    );
    expect(result).toEqual([
      {
        title: 'Standup',
        startISO: '2026-07-01T09:00:00.000Z',
        endISO: '2026-07-01T09:30:00.000Z',
        location: 'Zoom',
        notes: undefined,
      },
    ]);
  });
});

describe('CalendarService confirm-first flow', () => {
  const event: CalendarEventInfo = {
    title: 'Lunch with Sam',
    startISO: '2026-07-03T19:00:00.000Z',
    endISO: '2026-07-03T20:00:00.000Z',
  };

  it('holds and returns a proposal per conversation', () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{}'));
    svc.proposeEvent(KEY, event);

    expect(svc.getPendingProposal(KEY)).toEqual(event);
    expect(svc.getPendingProposal('other-conv')).toBeNull();
  });

  it('commits the stored event and clears the proposal', async () => {
    const client = mockClient();
    const svc = new CalendarService(CONFIG, client, mockLLM('{}'));
    svc.proposeEvent(KEY, event);

    const committed = await svc.commitPending(KEY);

    expect(client.createEvent).toHaveBeenCalledWith({
      title: event.title,
      startISO: event.startISO,
      endISO: event.endISO,
      location: undefined,
      notes: undefined,
    });
    expect(committed).toEqual(event);
    expect(svc.getPendingProposal(KEY)).toBeNull();
  });

  it('throws when committing with no pending proposal', async () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{}'));
    await expect(svc.commitPending(KEY)).rejects.toThrow(/no pending/i);
  });

  it('discardPending clears and reports whether one existed', () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{}'));
    svc.proposeEvent(KEY, event);
    expect(svc.discardPending(KEY)).toBe(true);
    expect(svc.discardPending(KEY)).toBe(false);
    expect(svc.getPendingProposal(KEY)).toBeNull();
  });

  it('expires a proposal after the TTL', () => {
    vi.useFakeTimers();
    try {
      const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{}'));
      svc.proposeEvent(KEY, event);
      expect(svc.getPendingProposal(KEY)).toEqual(event);

      vi.advanceTimersByTime(11 * 60 * 1000); // past the 10-min TTL
      expect(svc.getPendingProposal(KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CalendarService.extractEventFromText', () => {
  it('parses a well-formed event and normalizes to UTC', async () => {
    const llm = mockLLM(
      '{"title":"Lunch with Sam","startISO":"2026-07-03T12:00:00-07:00","endISO":"2026-07-03T13:00:00-07:00","location":"Cafe"}'
    );
    const svc = new CalendarService(CONFIG, mockClient(), llm);

    const event = await svc.extractEventFromText('lunch with sam friday at noon at the cafe');

    expect(event).toEqual({
      title: 'Lunch with Sam',
      startISO: '2026-07-03T19:00:00.000Z',
      endISO: '2026-07-03T20:00:00.000Z',
      location: 'Cafe',
    });
  });

  it('applies a default 1-hour duration when no end is given', async () => {
    const llm = mockLLM('{"title":"Call","startISO":"2026-07-03T15:00:00Z"}');
    const svc = new CalendarService(CONFIG, mockClient(), llm);

    const event = await svc.extractEventFromText('call at 3pm');

    expect(event?.startISO).toBe('2026-07-03T15:00:00.000Z');
    expect(event?.endISO).toBe('2026-07-03T16:00:00.000Z');
  });

  it('returns null when the text is not an event', async () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('{"title":""}'));
    expect(await svc.extractEventFromText('how are you?')).toBeNull();
  });

  it('returns null when the LLM output is not valid JSON', async () => {
    const svc = new CalendarService(CONFIG, mockClient(), mockLLM('sorry, I cannot'));
    expect(await svc.extractEventFromText('schedule something')).toBeNull();
  });

  it('returns null when the LLM call throws', async () => {
    const llm: CalendarLLM = { chat: vi.fn().mockRejectedValue(new Error('boom')) };
    const svc = new CalendarService(CONFIG, mockClient(), llm);
    expect(await svc.extractEventFromText('schedule something')).toBeNull();
  });
});

describe('resolveReadRange', () => {
  const now = new Date('2026-07-01T15:00:00Z');

  it('defaults to today (a single UTC day)', () => {
    expect(resolveReadRange('what is on my calendar', 'UTC', now)).toEqual({
      startISO: '2026-07-01T00:00:00.000Z',
      endISO: '2026-07-02T00:00:00.000Z',
    });
  });

  it('resolves tomorrow', () => {
    expect(resolveReadRange('what about tomorrow?', 'UTC', now)).toEqual({
      startISO: '2026-07-02T00:00:00.000Z',
      endISO: '2026-07-03T00:00:00.000Z',
    });
  });

  it('resolves this week to a 7-day window', () => {
    const range = resolveReadRange('my schedule this week', 'UTC', now);
    expect(range.startISO).toBe('2026-07-01T00:00:00.000Z');
    expect(range.endISO).toBe('2026-07-08T00:00:00.000Z');
  });

  it('resolves month to a longer window', () => {
    const range = resolveReadRange('anything this month', 'UTC', now);
    expect(range.startISO).toBe('2026-07-01T00:00:00.000Z');
    expect(range.endISO).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('formatEventForDisplay', () => {
  it('includes the title and location', () => {
    const out = formatEventForDisplay(
      {
        title: 'Lunch with Sam',
        startISO: '2026-07-03T19:00:00.000Z',
        endISO: '2026-07-03T20:00:00.000Z',
        location: 'Cafe',
      },
      'UTC'
    );
    expect(out).toContain('Lunch with Sam');
    expect(out).toContain('Cafe');
  });
});
