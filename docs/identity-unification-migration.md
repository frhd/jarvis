# Identity Unification Migration (`messages.userId`)

**Status:** Proposed / not started
**Logged:** 2026-06-20
**Owner:** TBD
**Origin:** Therapist-mode consent bug (see "Background" below)

## Summary

The codebase is mid-migration from Telegram-specific identifiers (`senders.id`,
`chats.id`) to a platform-agnostic unified identity system (`users.id`,
`conversations.id`). The `messages` table was **never migrated** — it still
stores only `senderId` (a `senders.id`) and `chatId`, with no `userId` /
`conversationId` columns. As a result, any code that derives identity from
messages operates in the legacy `senderId` space, while newer code (consent,
memories) operates in the unified `users.id` space. These two ID spaces both map
to the same Telegram ID but never string-match, which silently breaks features
that compare across them.

This document tracks the **proper fix** (Option 3): give `messages` a unified
`userId`, backfill it, populate it on ingest, and migrate identity-consuming code
to unified IDs.

## Background — the bug that surfaced this

Therapist mode never intervened in a monitored group despite being
enabled and consented. Root cause:

- Consent (`therapistModeConfig.consented_by_user_ids`) is stored as unified
  `users.id` values.
- The dyad detector derives participants from recent messages
  (`dyad-detector.service.ts` → `getParticipants`), keying on
  `msg.userId || msg.senderId`. Because `messages` has **no `userId` column**, it
  always falls back to `senderId`.
- The consent check then compared `senderId`s against `users.id`s → zero overlap
  → `"Both participants have not consented"` → no intervention.

| Person | Telegram ID | `senders.id` (detector) | `users.id` (consent) |
|--------|------------|-------------------------|----------------------|
| User A | 111111111  | `sndr_aaaaaaaaaaaaaaaa`  | `user_aaaaaaaaaaaaaaaa` |
| User B | 222222222  | `sndr_bbbbbbbbbbbbbbbb`  | `user_bbbbbbbbbbbbbbbb` |

### Interim fix already shipped (Option 2)

`ConsentManagerService.getConsentStatus` now normalizes both participant IDs and
stored consent IDs to a canonical Telegram-ID key via an injected
`IIdentityResolver` (`consent-manager.service.ts`, wired in
`factory/therapist-services.ts`). This makes consent match regardless of ID
space and is backward compatible (falls back to raw compare when no resolver is
wired). It does **not** remove the underlying dual-ID-space hazard — hence this
migration.

## Why the full migration is still worth doing

The therapist module is internally consistent in `senderId` space today
(`emotional-analyzer.service.ts:334` also keys on `msg.senderId`, and
`intervention-engine.service.ts` compares `message.senderId === state.userId`).
The risk is that every new feature reading identity from messages must remember
to translate, or it reintroduces exactly this class of mismatch. Unifying
`messages` onto `userId` removes the translation burden permanently and benefits
all message consumers (memories, analytics, future platforms).

## Scope / proposed steps

1. **Schema**: add nullable `userId` (FK → `users.id`) and `conversationId`
   (FK → `conversations.id`) to `messages` in `src/db/schema.ts`; create a
   Drizzle migration (update `meta/_journal.json` — see CLAUDE.md gotchas).
2. **Backfill**: script to populate `userId`/`conversationId` from existing
   `senderId`/`chatId` via `platform_identities` + `conversations`
   (cf. existing `db:backfill:identity`, `db:backfill:memory-refs`).
3. **Ingest**: populate `userId`/`conversationId` at write time. Handlers already
   resolve identity early (`identityService.resolveUser/resolveConversation`),
   so the unified IDs exist when the message row is created.
4. **Migrate consumers to unified IDs, in lockstep** — miss one and the mismatch
   returns:
   - `dyad-detector.service.ts` `getParticipants` (drop the `senderId` fallback)
   - `emotional-analyzer.service.ts` (`const userId = msg.senderId`)
   - `intervention-engine.service.ts` (`message.senderId === state.userId`)
   - any other `msg.senderId`-keyed identity logic
5. **Retire the interim shim**: once participants are unified `userId`s, the
   `IIdentityResolver` normalization in `ConsentManagerService` becomes a no-op
   and can be removed (keep the tests).

## Acceptance criteria

- New messages persist `userId` + `conversationId`; backfill covers history.
- Therapist participant detection yields unified `users.id`s with no fallback.
- Consent comparison works without the translation shim.
- No feature compares a `senderId` against a `users.id` anywhere.

## Risks

- Touches the hot ingestion path and a core table — do as a deliberate,
  separately-tested project, **not** bundled into a feature fix.
- Lockstep consumer migration is the failure-prone part; land schema + backfill
  first, then migrate consumers behind tests.
