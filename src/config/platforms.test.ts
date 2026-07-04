import { describe, it, expect } from 'vitest';
import { mapTelegramChatType, PLATFORM_TELEGRAM, PLATFORM_SLACK } from './platforms';

describe('mapTelegramChatType', () => {
  it('should map private to dm', () => {
    expect(mapTelegramChatType('private')).toBe('dm');
  });

  it('should map group to group', () => {
    expect(mapTelegramChatType('group')).toBe('group');
  });

  it('should map supergroup to group', () => {
    expect(mapTelegramChatType('supergroup')).toBe('group');
  });

  it('should map channel to channel', () => {
    expect(mapTelegramChatType('channel')).toBe('channel');
  });

  it('should default unknown types to dm', () => {
    expect(mapTelegramChatType('unknown')).toBe('dm');
  });
});

describe('platform constants', () => {
  it('should export correct platform values', () => {
    expect(PLATFORM_TELEGRAM).toBe('telegram');
    expect(PLATFORM_SLACK).toBe('slack');
  });
});
