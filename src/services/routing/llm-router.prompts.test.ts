import { describe, it, expect } from 'vitest';
import { buildConversationMessages } from './llm-router.prompts.js';
import type { Message } from '../../types/index.js';

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: 'msg-1',
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: 1,
  text: 'Hello',
  isBot: false,
  mediaType: null,
  mediaPath: null,
  mediaFileId: null,
  replyToMessageId: null,
  forwardFromChatId: null,
  forwardFromMessageId: null,
  rawJson: '{}',
  createdAt: new Date(),
  transcript: null,
  transcriptStatus: null,
  transcriptLanguage: null,
  transcriptDurationMs: null,
  transcriptedAt: null,
  transcriptError: null,
  ...overrides,
});

describe('buildConversationMessages', () => {
  it('should append history and current message after the system prompt', () => {
    const history: Message[] = [
      createMockMessage({ id: 'msg-old', text: 'Earlier message', isBot: true }),
    ];
    const currentMessage = createMockMessage({ id: 'msg-current', text: 'Current message' });

    const messages = buildConversationMessages(history, currentMessage);

    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Earlier message' });
    expect(messages[2]).toEqual({ role: 'user', content: 'Current message' });
  });

  it('should not duplicate the current message when history already contains it', () => {
    const currentMessage = createMockMessage({ id: 'msg-current', text: 'Current message' });
    // Ingestion persists the message before processing, so the freshly
    // fetched history contains it as the newest entry (descending order)
    const history: Message[] = [
      currentMessage,
      createMockMessage({ id: 'msg-old', text: 'Earlier message', isBot: true }),
    ];

    const messages = buildConversationMessages(history, currentMessage);

    expect(messages.filter((m) => m.content === 'Current message')).toHaveLength(1);
    expect(messages).toHaveLength(3); // system + earlier + current
  });
});
