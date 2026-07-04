import type { ChatType } from '../types/index.js';

/**
 * Derive our internal {@link ChatType} from a Telegram chat entity returned by
 * TDLib/gramjs (`Api.TypeChat`: User | Chat | Channel | ...).
 *
 * Telegram models chats as distinct classes:
 *   - `User`                      → a 1:1 DM            → 'private'
 *   - `Chat` / `ChatForbidden`    → a basic group      → 'group'
 *   - `Channel` (megagroup)       → a supergroup       → 'supergroup'
 *   - `Channel` (broadcast)       → a broadcast channel→ 'channel'
 *
 * The previous inline logic only inspected `broadcast`/`megagroup`, which exist
 * solely on `Channel`. A basic `Chat` (e.g. a small 2-person group) has neither
 * property, so it silently fell through to 'private' — meaning real groups were
 * stored as DMs and never routed through group-only features (therapist mode).
 */
export function deriveChatType(chat: unknown): ChatType {
  if (!chat || typeof chat !== 'object') {
    return 'private';
  }

  const entity = chat as { className?: string; broadcast?: boolean; megagroup?: boolean };

  // Explicit Channel flags take precedence (present on real Api.Channel entities).
  if (entity.broadcast === true) {
    return 'channel';
  }
  if (entity.megagroup === true) {
    return 'supergroup';
  }

  switch (entity.className) {
    case 'Channel':
    case 'ChannelForbidden':
      // A channel that is neither broadcast nor megagroup defaults to supergroup.
      return 'supergroup';
    case 'Chat':
    case 'ChatForbidden':
    case 'ChatEmpty':
      return 'group';
    default:
      // Entities carrying broadcast/megagroup keys are chat/channel contexts, so
      // a non-broadcast, non-megagroup one is a basic group; everything else
      // (e.g. an Api.User DM) is private.
      if ('broadcast' in entity || 'megagroup' in entity) {
        return 'group';
      }
      return 'private';
  }
}
