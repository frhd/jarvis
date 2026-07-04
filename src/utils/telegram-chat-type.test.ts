import { describe, it, expect } from 'vitest';
import { deriveChatType } from './telegram-chat-type.js';

describe('deriveChatType', () => {
  it('returns "private" for a user entity', () => {
    expect(deriveChatType({ className: 'User' })).toBe('private');
  });

  // The bug: a basic Telegram group is an Api.Chat with neither `broadcast`
  // nor `megagroup`, so the old logic silently fell through to "private".
  it('returns "group" for a basic group (Api.Chat with no broadcast/megagroup)', () => {
    expect(deriveChatType({ className: 'Chat', participantsCount: 2 })).toBe('group');
  });

  it('returns "group" for a forbidden/empty basic chat', () => {
    expect(deriveChatType({ className: 'ChatForbidden' })).toBe('group');
  });

  it('returns "supergroup" for a megagroup channel', () => {
    expect(deriveChatType({ className: 'Channel', megagroup: true })).toBe('supergroup');
  });

  it('returns "channel" for a broadcast channel', () => {
    expect(deriveChatType({ className: 'Channel', broadcast: true })).toBe('channel');
  });

  it('returns "private" for null/undefined', () => {
    expect(deriveChatType(null)).toBe('private');
    expect(deriveChatType(undefined)).toBe('private');
  });

  // Flag-based detection: some callers/tests provide only broadcast/megagroup
  // booleans (no className). A chat-like entity that is neither broadcast nor
  // megagroup is a basic group.
  it('returns "group" for an entity with broadcast=false, megagroup=false', () => {
    expect(deriveChatType({ broadcast: false, megagroup: false })).toBe('group');
  });

  it('returns "supergroup" for an entity with megagroup=true (no className)', () => {
    expect(deriveChatType({ broadcast: false, megagroup: true })).toBe('supergroup');
  });

  it('returns "channel" for an entity with broadcast=true (no className)', () => {
    expect(deriveChatType({ broadcast: true })).toBe('channel');
  });
});
