export const PLATFORM_TELEGRAM = 'telegram' as const;
export const PLATFORM_SLACK = 'slack' as const;
export const PLATFORM_WHATSAPP = 'whatsapp' as const;

export type Platform = typeof PLATFORM_TELEGRAM | typeof PLATFORM_SLACK | typeof PLATFORM_WHATSAPP;

export const CONVERSATION_TYPES = ['dm', 'group', 'channel'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * Map Telegram chat type to platform-agnostic ConversationType.
 * - 'private' → 'dm'
 * - 'group' / 'supergroup' → 'group'
 * - 'channel' → 'channel'
 */
export function mapTelegramChatType(type: string): ConversationType {
  switch (type) {
    case 'private':
      return 'dm';
    case 'group':
    case 'supergroup':
      return 'group';
    case 'channel':
      return 'channel';
    default:
      return 'dm';
  }
}
