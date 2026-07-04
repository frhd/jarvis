/**
 * Resolves the recent messages for a unified conversation.
 *
 * The `messages` table is keyed by the INTERNAL `chats.id`, but a unified
 * `conversation` stores the platform-native id (the Telegram chat id) in
 * `platformConversationId`. Earlier code passed that Telegram id straight to
 * `findRecentByChatId`, which filters on `chats.id`, so it never matched any
 * rows — silently returning zero participants and disabling dyad detection.
 *
 * This bridges the two id spaces: conversation → telegram id → internal chat id
 * → messages.
 */

export interface ConversationLookup {
  findById(id: string): Promise<{ platformConversationId: string } | null>;
}

export interface ChatLookup {
  findByTelegramId(telegramId: string): Promise<{ id: string } | null>;
}

export interface MessageLookup<T> {
  findRecentByChatId(chatId: string, limit: number): Promise<T[]>;
}

export interface ResolveConversationMessagesDeps<T> {
  conversations: ConversationLookup;
  chats: ChatLookup;
  messages: MessageLookup<T>;
}

export async function resolveRecentMessagesForConversation<T>(
  deps: ResolveConversationMessagesDeps<T>,
  conversationId: string,
  limit: number
): Promise<T[]> {
  const conversation = await deps.conversations.findById(conversationId);
  if (!conversation) {
    return [];
  }

  const chat = await deps.chats.findByTelegramId(conversation.platformConversationId);
  if (!chat) {
    return [];
  }

  return deps.messages.findRecentByChatId(chat.id, limit);
}
