/**
 * ProactiveMessageGenerator Tests
 *
 * Tests the message generation service that builds LLM prompts from
 * proactive message context and returns trimmed results with token usage.
 * The LLM client is mocked for isolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProactiveMessageGenerator } from './message-generator.service.js';
import type { ProactiveMessageContext } from '../../types/proactive.types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLlmClient() {
  return {
    chat: vi.fn().mockResolvedValue({
      content: 'Hello Alex! How are you today?',
      model: 'llama3.1:8b',
      promptEvalCount: 100,
      evalCount: 50,
    }),
  };
}

const baseContext: ProactiveMessageContext = {
  messageType: 'greeting',
  timezone: 'Europe/Berlin',
  localTime: new Date('2024-06-15T08:00:00'),
  dayOfWeek: 'Saturday',
  userName: 'Alex',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProactiveMessageGenerator', () => {
  let generator: ProactiveMessageGenerator;
  let mockLlmClient: ReturnType<typeof createMockLlmClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmClient = createMockLlmClient();
    generator = new ProactiveMessageGenerator(mockLlmClient);
  });

  // =========================================================================
  // Greeting generation
  // =========================================================================

  describe('Greeting generation', () => {
    it('includes user name and time context in prompt and returns trimmed message', async () => {
      const result = await generator.generate(baseContext);

      expect(result.message).toBe('Hello Alex! How are you today?');
      expect(result.model).toBe('llama3.1:8b');

      // Verify chat was called with two messages (system + user)
      expect(mockLlmClient.chat).toHaveBeenCalledTimes(1);
      const [messages] = mockLlmClient.chat.mock.calls[0];

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');

      // System prompt should be the greeting template
      expect(messages[0].content).toContain('warm greeting');

      // User prompt should contain the user name, day, timezone
      const userPrompt: string = messages[1].content;
      expect(userPrompt).toContain('Alex');
      expect(userPrompt).toContain('Saturday');
      expect(userPrompt).toContain('Europe/Berlin');
    });
  });

  // =========================================================================
  // Summary generation
  // =========================================================================

  describe('Summary generation', () => {
    it('includes recent conversation in prompt', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        messageType: 'summary',
        recentConversation: [
          { text: 'Hey Jarvis, what is the weather?', createdAt: new Date('2024-06-15T07:00:00'), isBot: false },
          { text: 'The weather is sunny and 25C.', createdAt: new Date('2024-06-15T07:01:00'), isBot: true },
        ],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];

      // System prompt should be the summary template
      expect(messages[0].content).toContain('daily summary');

      // User prompt should contain the conversation
      const userPrompt: string = messages[1].content;
      expect(userPrompt).toContain('Recent conversation:');
      expect(userPrompt).toContain('Hey Jarvis, what is the weather?');
      expect(userPrompt).toContain('The weather is sunny and 25C.');
      // Bot messages are labelled as Jarvis
      expect(userPrompt).toContain('Jarvis:');
      // User messages are labelled with userName
      expect(userPrompt).toContain('Alex:');
    });
  });

  // =========================================================================
  // Check-in generation
  // =========================================================================

  describe('Check-in generation', () => {
    it('builds appropriate prompt for checkin type', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        messageType: 'checkin',
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];

      // System prompt should be the checkin template
      expect(messages[0].content).toContain('check-in');
      expect(messages[0].content).toContain('how they\'re doing');

      // User prompt should still have basic context
      const userPrompt: string = messages[1].content;
      expect(userPrompt).toContain('Alex');
      expect(userPrompt).toContain('Saturday');
    });
  });

  // =========================================================================
  // Custom template
  // =========================================================================

  describe('Custom template', () => {
    it('uses customTemplate from context instead of default system prompt', async () => {
      const customTemplate = 'You are a pirate. Talk like a pirate at all times.';
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        messageType: 'custom',
        customTemplate,
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      expect(messages[0].content).toBe(customTemplate);
    });

    it('falls back to default prompt when customTemplate is not provided', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        messageType: 'custom',
        // no customTemplate
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      // Should use the default "custom" system prompt
      expect(messages[0].content).toContain('Generate a message based on the following context.');
      expect(messages[0].content).toContain('Do NOT use quotes around your message or any words.');
    });
  });

  // =========================================================================
  // Token usage tracking
  // =========================================================================

  describe('Token usage tracking', () => {
    it('maps promptEvalCount and evalCount correctly', async () => {
      mockLlmClient.chat.mockResolvedValue({
        content: 'Test response',
        model: 'llama3.1:8b',
        promptEvalCount: 200,
        evalCount: 75,
      });

      const result = await generator.generate(baseContext);

      expect(result.tokenUsage).toEqual({
        promptTokens: 200,
        completionTokens: 75,
        totalTokens: 275,
        model: 'llama3.1:8b',
      });
    });

    it('defaults to 0 when counts are undefined', async () => {
      mockLlmClient.chat.mockResolvedValue({
        content: 'Test response',
        model: 'llama3.1:8b',
        // promptEvalCount and evalCount are both undefined
      });

      const result = await generator.generate(baseContext);

      expect(result.tokenUsage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: 'llama3.1:8b',
      });
    });
  });

  // =========================================================================
  // User preferences included
  // =========================================================================

  describe('User preferences included', () => {
    it('preferences are formatted as category/key: value', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        userPreferences: [
          { category: 'communication', key: 'tone', value: 'casual' },
          { category: 'language', key: 'primary', value: 'English' },
        ],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('User preferences:');
      expect(userPrompt).toContain('- communication/tone: casual');
      expect(userPrompt).toContain('- language/primary: English');
    });
  });

  // =========================================================================
  // Memories included
  // =========================================================================

  describe('Memories included', () => {
    it('memories are formatted with type annotation', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        memories: [
          { content: 'User likes hiking on weekends', type: 'preference' },
          { content: 'User is working on a TypeScript project', type: 'fact' },
        ],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('Relevant memories:');
      expect(userPrompt).toContain('- [preference] User likes hiking on weekends');
      expect(userPrompt).toContain('- [fact] User is working on a TypeScript project');
    });
  });

  // =========================================================================
  // Custom context included
  // =========================================================================

  describe('Custom context included', () => {
    it('additional context key-value pairs are included for string values', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        customContext: {
          mood: 'happy',
          topic: 'weekend plans',
        },
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('Additional context:');
      expect(userPrompt).toContain('- mood: happy');
      expect(userPrompt).toContain('- topic: weekend plans');
    });

    it('non-string values are JSON-stringified', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        customContext: {
          count: 42,
          tags: ['work', 'urgent'],
        },
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('Additional context:');
      expect(userPrompt).toContain('- count: 42');
      expect(userPrompt).toContain('- tags: ["work","urgent"]');
    });
  });

  // =========================================================================
  // LLM failure handling
  // =========================================================================

  describe('LLM failure handling', () => {
    it('throws descriptive error when LLM call fails with Error', async () => {
      mockLlmClient.chat.mockRejectedValue(new Error('Connection timed out'));

      await expect(generator.generate(baseContext)).rejects.toThrow(
        'Proactive message generation failed for type "greeting": Connection timed out',
      );
    });

    it('throws descriptive error when LLM call fails with non-Error', async () => {
      mockLlmClient.chat.mockRejectedValue('some string error');

      await expect(generator.generate(baseContext)).rejects.toThrow(
        'Proactive message generation failed for type "greeting": Unknown error during message generation',
      );
    });

    it('includes the message type in the error message', async () => {
      mockLlmClient.chat.mockRejectedValue(new Error('Model not found'));

      const ctx: ProactiveMessageContext = {
        ...baseContext,
        messageType: 'summary',
      };

      await expect(generator.generate(ctx)).rejects.toThrow(
        'Proactive message generation failed for type "summary": Model not found',
      );
    });
  });

  // =========================================================================
  // Empty context fields
  // =========================================================================

  describe('Empty context fields', () => {
    it('handles gracefully when optional fields are empty arrays', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        userPreferences: [],
        recentConversation: [],
        memories: [],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      // Empty arrays should not produce section headers
      expect(userPrompt).not.toContain('User preferences:');
      expect(userPrompt).not.toContain('Recent conversation:');
      expect(userPrompt).not.toContain('Relevant memories:');
    });

    it('handles gracefully when optional fields are undefined', async () => {
      const ctx: ProactiveMessageContext = {
        messageType: 'greeting',
        timezone: 'Europe/Berlin',
        localTime: new Date('2024-06-15T08:00:00'),
        dayOfWeek: 'Saturday',
        // userName, userPreferences, recentConversation, memories, customContext all undefined
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      // Without userName, should use "the user"
      expect(userPrompt).toContain('User: the user');
      // Should not contain optional sections
      expect(userPrompt).not.toContain('User preferences:');
      expect(userPrompt).not.toContain('Recent conversation:');
      expect(userPrompt).not.toContain('Relevant memories:');
      expect(userPrompt).not.toContain('Additional context:');
    });

    it('handles empty customContext object gracefully', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        customContext: {},
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).not.toContain('Additional context:');
    });
  });

  // =========================================================================
  // Response content trimming
  // =========================================================================

  describe('Response content is trimmed', () => {
    it('whitespace is trimmed from LLM output', async () => {
      mockLlmClient.chat.mockResolvedValue({
        content: '  \n  Hello Alex! Good morning.  \n  ',
        model: 'llama3.1:8b',
        promptEvalCount: 50,
        evalCount: 20,
      });

      const result = await generator.generate(baseContext);

      expect(result.message).toBe('Hello Alex! Good morning.');
    });
  });

  // =========================================================================
  // All message types use correct system prompts
  // =========================================================================

  describe('System prompt selection', () => {
    const messageTypes = [
      { type: 'greeting' as const, expectedFragment: 'warm greeting' },
      { type: 'checkin' as const, expectedFragment: 'check-in' },
      { type: 'summary' as const, expectedFragment: 'daily summary' },
      { type: 'reminder' as const, expectedFragment: 'reminder' },
      { type: 'followup' as const, expectedFragment: 'follow-up' },
    ];

    for (const { type, expectedFragment } of messageTypes) {
      it(`uses correct system prompt for "${type}" type`, async () => {
        const ctx: ProactiveMessageContext = {
          ...baseContext,
          messageType: type,
        };

        await generator.generate(ctx);

        const [messages] = mockLlmClient.chat.mock.calls[0];
        expect(messages[0].content).toContain(expectedFragment);
      });
    }
  });

  // =========================================================================
  // Full context prompt construction
  // =========================================================================

  describe('Full context prompt construction', () => {
    it('builds a complete prompt with all context fields populated', async () => {
      const ctx: ProactiveMessageContext = {
        messageType: 'checkin',
        timezone: 'America/New_York',
        localTime: new Date('2024-12-25T14:30:00'),
        dayOfWeek: 'Wednesday',
        userName: 'Alice',
        userPreferences: [
          { category: 'style', key: 'formality', value: 'informal' },
        ],
        recentConversation: [
          { text: 'Working on the project', createdAt: new Date('2024-12-25T14:00:00'), isBot: false },
          { text: 'Good progress!', createdAt: new Date('2024-12-25T14:05:00'), isBot: true },
        ],
        memories: [
          { content: 'Alice is a software engineer', type: 'fact' },
        ],
        customContext: {
          lastSeen: '2 hours ago',
        },
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      // Basic context
      expect(userPrompt).toContain('User: Alice');
      expect(userPrompt).toContain('Day: Wednesday');
      expect(userPrompt).toContain('Timezone: America/New_York');

      // Preferences
      expect(userPrompt).toContain('- style/formality: informal');

      // Conversation
      expect(userPrompt).toContain('Alice: Working on the project');
      expect(userPrompt).toContain('Jarvis: Good progress!');

      // Memories
      expect(userPrompt).toContain('- [fact] Alice is a software engineer');

      // Custom context
      expect(userPrompt).toContain('- lastSeen: 2 hours ago');
    });
  });

  // =========================================================================
  // Conversation speaker labelling
  // =========================================================================

  describe('Conversation speaker labelling', () => {
    it('labels user messages with userName and bot messages with Jarvis', async () => {
      const ctx: ProactiveMessageContext = {
        ...baseContext,
        userName: 'Bob',
        recentConversation: [
          { text: 'Hello', createdAt: new Date('2024-06-15T07:00:00'), isBot: false },
          { text: 'Hi Bob!', createdAt: new Date('2024-06-15T07:01:00'), isBot: true },
        ],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('Bob: Hello');
      expect(userPrompt).toContain('Jarvis: Hi Bob!');
    });

    it('uses "the user" for unnamed user in conversation', async () => {
      const ctx: ProactiveMessageContext = {
        messageType: 'greeting',
        timezone: 'Europe/Berlin',
        localTime: new Date('2024-06-15T08:00:00'),
        dayOfWeek: 'Saturday',
        // no userName
        recentConversation: [
          { text: 'Hello', createdAt: new Date('2024-06-15T07:00:00'), isBot: false },
        ],
      };

      await generator.generate(ctx);

      const [messages] = mockLlmClient.chat.mock.calls[0];
      const userPrompt: string = messages[1].content;

      expect(userPrompt).toContain('the user: Hello');
    });
  });
});
