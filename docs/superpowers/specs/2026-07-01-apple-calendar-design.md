# Apple Calendar Access for Jarvis — Design

**Date:** 2026-07-01
**Status:** Approved, implementing

## Goal

Let Jarvis **read** events from and **create** events on the owner's Apple (iCloud)
calendar through natural chat, e.g. "what's on my calendar today?" and "schedule
lunch with Sam Friday at noon".

## Decisions (from brainstorming)

1. **Capability:** read + create (no edit/delete).
2. **Access method:** CalDAV to iCloud using an app-specific password. Chosen over
   EventKit (fragile TCC grants for a pm2 daemon) and AppleScript (slow/flaky, needs
   Calendar.app running). CalDAV behaves like a proper server integration.
3. **Surface:** chat only — no proactive/context injection in this version.
4. **Create safety:** confirm-first. Jarvis parses the request, echoes the exact
   event back, and writes only after the owner confirms.
5. **Access control:** owner-only (`OWNER_TELEGRAM_ID`), same as agentic requests.

## Architecture

Follows Jarvis's existing layers: client → service → routing handler.

### Config (`src/config/env-schema.ts`, `src/config/index.ts`, `feature-flags.ts`)
Disabled by default.
- `CALENDAR_ENABLED` (default `false`)
- `CALENDAR_CALDAV_URL` (default `https://caldav.icloud.com`)
- `CALENDAR_APPLE_ID` — iCloud email
- `CALENDAR_APP_PASSWORD` — app-specific password (from appleid.apple.com; lives in `.env`, never committed)
- `CALENDAR_NAME` — optional target calendar display name (defaults to the principal's default calendar)
- `CALENDAR_TIMEZONE` — IANA tz for resolving relative times (defaults to `PROACTIVE_TIMEZONE`)

### Client — `src/clients/calendar.client.ts`
Thin wrapper over `tsdav` (CalDAV) + `ical.js` (iCalendar parse/build).
- `connect()` — logs in, discovers calendars, caches the target calendar handle
- `listEvents(startISO, endISO)` — fetch VEVENTs in range, parse to `CalendarEvent`
- `createEvent(event)` — build a VEVENT (UTC `Z` times) and PUT to target calendar
- Auth/network failures mapped to Jarvis error classes

### Service — `src/services/calendar/calendar.service.ts` (`ICalendarService`)
- `getEvents({ startISO, endISO })` — validate range, call client, return sorted events
- `extractEventFromText(text)` — one LLM call (`LLMClient.chat`) that turns NL into
  `{ title, startISO, endISO, location? }`, given current date/time + timezone
- **Confirm-first flow (deterministic, not LLM-trusted):**
  - `proposeEvent(conversationId, event)` → store in an in-memory pending map keyed by
    `conversationId` with a 10-min TTL; return a human-readable summary
  - `getPendingProposal(conversationId)` / `commitPending(conversationId)` /
    `discardPending(conversationId)` — commit writes the *stored* event (arg-drift-proof)

### Routing handler — `src/services/routing/handlers/calendar-request.handler.ts`
Registered in the existing `RoutingChain` (`responseRouter.service.ts`) at a new
`HANDLER_PRIORITY.CALENDAR = 45` (above web-search/greeting/agentic so calendar
phrases win). Mirrors `AgenticRequestHandler`'s owner gate.

`canHandle`: true when the message matches calendar read/create patterns, **or** a
pending proposal exists for the conversation and the message is a confirm/cancel.

`handle`:
- non-owner → polite refusal (personal calendar)
- pending proposal + confirm → `commitPending`, report created event
- pending proposal + cancel → `discardPending`, acknowledge
- read intent → `getEvents`, inject events into context, answer via `handleWithClaude`
- create intent → `extractEventFromText` → `proposeEvent` → return the echo + "confirm?"

### Wiring
Client + service instantiated in `src/services/factory/`, lazy getter in
`src/services/instances/`, handler registered in `createRoutingChain()`.

## Error handling
Bad app-password → "calendar auth failed, check credentials"; network/timeout →
retryable/generic failure message; empty range → friendly "nothing on your calendar";
`CALENDAR_ENABLED=false` → handler `canHandle` returns false (falls through to chat).

## Testing
Unit tests for `CalendarService` against a **mocked** `CalendarClient`: range
resolution, propose→commit token flow, expired/invalid/cancelled proposal, disabled
state, extraction JSON parsing. Real-CalDAV client test needs live iCloud creds → run
standalone (repo convention), excluded from vitest.

## New dependencies
`tsdav` ^2.3.0, `ical.js` ^2.2.1.
