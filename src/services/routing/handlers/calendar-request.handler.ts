/**
 * CalendarRequestHandler - Reads and creates Apple/iCloud calendar events.
 *
 * Owner-only (personal calendar). Event creation is confirm-first: a create
 * request produces a proposal that is written only after the owner confirms in a
 * follow-up message.
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService, LLMRouterResult } from '../llm-router.service.js';
import type { ICalendarService, CalendarEventInfo } from '../../../interfaces/services.js';
import { formatEventForDisplay, resolveReadRange } from '../../calendar/calendar.service.js';
import { appConfig } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';

/** Polite refusal for non-owners (the calendar is the owner's personal account). */
const NON_OWNER_REFUSAL =
  "I can only access the owner's personal calendar. Happy to help with something else!";

/** Affirmative replies that confirm a pending proposal. */
const CONFIRM_PATTERN =
  /^\s*(yes|yep|yeah|yup|confirm|confirmed|do it|sure|ok|okay|go ahead|sounds good|please do|create it|add it|book it|schedule it|correct)\b/i;

/** Replies that cancel a pending proposal. */
const CANCEL_PATTERN =
  /^\s*(no|nope|nah|cancel|don'?t|do not|never ?mind|stop|abort|scratch that|forget it)\b/i;

/** Requests to read the calendar. */
const READ_PATTERNS: RegExp[] = [
  /\b(what('?s| is| are)?)\b.*\b(calendar|schedule|agenda|events?|meetings?|appointments?|plans?)\b/i,
  /\b(do i have|any)\b.*\b(events?|meetings?|appointments?|plans?)\b/i,
  /\b(my|the)\s+(calendar|schedule|agenda)\b/i,
  /\b(am i (free|busy))\b/i,
  /\bwhat('?s| is) (on|up|happening)\b.*\b(today|tomorrow|this week|weekend)\b/i,
];

/** Requests to create an event. */
const CREATE_PATTERNS: RegExp[] = [
  /\b(schedule|book|set up|set ?up|add|create|put|arrange|plan)\b.*\b(meeting|event|appointment|call|lunch|dinner|breakfast|coffee|reminder|catch ?up|sync|1[:\-]?1)\b/i,
  /\badd\b.*\bto (my|the) calendar\b/i,
  /\b(put|block)\b.*\bon (my|the) calendar\b/i,
  /\bschedule\b.*\b(at|on|for|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next)\b/i,
];

export class CalendarRequestHandler implements RoutingHandler {
  readonly name = 'CalendarRequestHandler';
  readonly priority = HANDLER_PRIORITY.CALENDAR;

  constructor(
    private llmRouter: LLMRouterService,
    private calendarService: ICalendarService,
    private buildContextFn: (context: RoutingContext) => Promise<string>
  ) {}

  canHandle(context: RoutingContext): boolean {
    if (!this.calendarService.isEnabled()) {
      return false;
    }

    const text = context.messageText || '';

    // A pending proposal turns a bare "yes"/"no" into a calendar action.
    if (this.getPending(context) && (CONFIRM_PATTERN.test(text) || CANCEL_PATTERN.test(text))) {
      return true;
    }

    return this.isReadRequest(text) || this.isCreateRequest(text);
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { isOwner, messageText } = context;

    if (!isOwner) {
      logger.warn('[CalendarRequestHandler] Non-owner attempted calendar access', {
        messageId: context.message.id,
        senderId: context.sender?.telegramId,
      });
      return this.direct(NON_OWNER_REFUSAL);
    }

    const key = this.conversationKey(context);
    const pending = this.calendarService.getPendingProposal(key);

    // Resolve a pending proposal first.
    if (pending && CANCEL_PATTERN.test(messageText)) {
      this.calendarService.discardPending(key);
      return this.direct("Okay, I won't add that event.");
    }
    if (pending && CONFIRM_PATTERN.test(messageText)) {
      return this.commit(context, key);
    }

    // A create request takes precedence over an incidental read match.
    if (this.isCreateRequest(messageText)) {
      return this.propose(context, key);
    }

    return this.read(context);
  }

  /** Read events for the requested window and let the LLM answer naturally. */
  private async read(context: RoutingContext): Promise<HandlerResult> {
    const { message, conversationHistory, messageText } = context;
    const { startISO, endISO } = resolveReadRange(messageText, this.timezone());

    let events: CalendarEventInfo[];
    try {
      events = await this.calendarService.getEvents(startISO, endISO);
    } catch (error) {
      logger.error('[CalendarRequestHandler] Failed to read calendar', {
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.direct("I couldn't reach your calendar just now. Please try again shortly.");
    }

    const baseContext = await this.buildContextFn(context);
    const eventsText = events.length
      ? events.map((e) => `- ${formatEventForDisplay(e, this.timezone())}`).join('\n')
      : '(no events in this window)';

    const enhancedContext =
      `${baseContext}\n\n[Calendar events for the requested window]:\n${eventsText}\n\n` +
      `[Instructions]: Answer the user's calendar question using the events above. ` +
      `Times are already in the user's timezone (${this.timezone()}). If there are no events, say so plainly.`;

    const result = await this.llmRouter.handleWithClaude(message, enhancedContext, conversationHistory);
    return { handled: true, result };
  }

  /** Parse a create request, store a proposal, and ask for confirmation. */
  private async propose(context: RoutingContext, key: string): Promise<HandlerResult> {
    const event = await this.calendarService.extractEventFromText(context.messageText);
    if (!event) {
      return this.direct(
        "I couldn't work out the event details. Try something like " +
          '"schedule lunch with Sam on Friday at noon".'
      );
    }

    this.calendarService.proposeEvent(key, event);
    logger.info('[CalendarRequestHandler] Proposed event awaiting confirmation', {
      messageId: context.message.id,
      title: event.title,
    });

    return this.direct(
      `I'll add: ${formatEventForDisplay(event, this.timezone())}.\nShould I go ahead? (yes / no)`
    );
  }

  /** Write the confirmed proposal to the calendar. */
  private async commit(context: RoutingContext, key: string): Promise<HandlerResult> {
    try {
      const event = await this.calendarService.commitPending(key);
      logger.info('[CalendarRequestHandler] Event committed', {
        messageId: context.message.id,
        title: event.title,
      });
      return this.direct(`Done — added ${formatEventForDisplay(event, this.timezone())} to your calendar.`);
    } catch (error) {
      logger.error('[CalendarRequestHandler] Failed to create event', {
        messageId: context.message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.direct("I couldn't create that event — the calendar service errored. Please try again.");
    }
  }

  private isReadRequest(text: string): boolean {
    return READ_PATTERNS.some((p) => p.test(text));
  }

  private isCreateRequest(text: string): boolean {
    return CREATE_PATTERNS.some((p) => p.test(text));
  }

  private getPending(context: RoutingContext): CalendarEventInfo | null {
    return this.calendarService.getPendingProposal(this.conversationKey(context));
  }

  private conversationKey(context: RoutingContext): string {
    return context.identityOptions?.conversationId ?? context.message.chatId;
  }

  private timezone(): string {
    return appConfig.calendar.timezone;
  }

  private direct(content: string): HandlerResult {
    const result: LLMRouterResult = { success: true, content, routedTo: 'claude' };
    return { handled: true, result };
  }
}
