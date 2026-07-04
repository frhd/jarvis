import { describe, it, expect, vi } from 'vitest';
import { resolveRecentMessagesForConversation } from './resolve-conversation-messages.js';

describe('resolveRecentMessagesForConversation', () => {
  const conversationId = 'conv_1';
  const telegramChatId = '-5263829601';
  const internalChatId = 'hsc_internal_id';

  function makeDeps(overrides: {
    conversation?: { platformConversationId: string } | null;
    chat?: { id: string } | null;
    messages?: Array<{ id: string }>;
  }) {
    const findRecentByChatId = vi.fn().mockResolvedValue(overrides.messages ?? []);
    return {
      deps: {
        conversations: {
          findById: vi.fn().mockResolvedValue(
            overrides.conversation === undefined
              ? { platformConversationId: telegramChatId }
              : overrides.conversation
          ),
        },
        chats: {
          findByTelegramId: vi.fn().mockResolvedValue(
            overrides.chat === undefined ? { id: internalChatId } : overrides.chat
          ),
        },
        messages: { findRecentByChatId },
      },
      findRecentByChatId,
    };
  }

  it('returns [] when the conversation is not found', async () => {
    const { deps } = makeDeps({ conversation: null });
    const result = await resolveRecentMessagesForConversation(deps, conversationId, 50);
    expect(result).toEqual([]);
  });

  it('returns [] when no chat matches the conversation telegram id', async () => {
    const { deps } = makeDeps({ chat: null });
    const result = await resolveRecentMessagesForConversation(deps, conversationId, 50);
    expect(result).toEqual([]);
  });

  // The bug: the old adapter passed the conversation's platformConversationId
  // (the Telegram chat id) straight to findRecentByChatId, which filters on the
  // INTERNAL chats.id — so it always found 0 messages.
  it('resolves the internal chat id from the telegram id before querying messages', async () => {
    const messages = [{ id: 'm1' }, { id: 'm2' }];
    const { deps, findRecentByChatId } = makeDeps({ messages });

    const result = await resolveRecentMessagesForConversation(deps, conversationId, 50);

    expect(deps.chats.findByTelegramId).toHaveBeenCalledWith(telegramChatId);
    expect(findRecentByChatId).toHaveBeenCalledWith(internalChatId, 50);
    expect(result).toEqual(messages);
  });
});
