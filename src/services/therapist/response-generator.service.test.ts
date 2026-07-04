import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResponseGeneratorService } from './response-generator.service.js';
import type { InterventionContext, TherapeuticResponse } from './types.js';
import type { Message } from '../../types/index.js';

// Mock the logger to suppress output in tests
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock LLM client
const mockLLMClient = {
  chat: vi.fn(),
};

describe('ResponseGeneratorService', () => {
  let service: ResponseGeneratorService;

  beforeEach(() => {
    service = new ResponseGeneratorService(mockLLMClient);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateResponse', () => {
    const mockContext: InterventionContext = {
      conversationId: 'conv_123',
      messageId: 'msg_456',
      interventionType: 'ACTIVE_LISTENING',
      confidence: 0.8,
      reason: 'High emotional expression detected',
      recentMessages: [
        { id: 'msg_1', text: "I'm feeling really sad today", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: "That makes sense, things have been tough", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ],
      participants: [
        { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 1 },
        { userId: 'user_2', displayName: 'Bob', platformUserId: 'tg_user_2', recentMessageCount: 1 },
      ],
      dynamics: {
        conversationId: 'conv_123',
        tensionLevel: 30,
        conflictDetected: false,
        positiveMomentsCount: 0,
        turnTakingBalance: 0.5,
        topicCoherence: 0.8,
        supportPatterns: ['active listening'],
        lastAnalyzedAt: new Date(),
      },
    };

    it('should call LLM with correct system prompt and context', async () => {
      // Arrange
      const mockResponse = { content: 'I hear both perspectives clearly.' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      await service.generateResponse(mockContext);

      // Assert
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      const call = mockLLMClient.chat.mock.calls[0][0];
      expect(call).toEqual({
        messages: [
          { role: 'system', content: expect.stringContaining('You are Jarvis in Therapist/Listener mode') },
          { role: 'user', content: expect.stringContaining('Your intervention type: ACTIVE_LISTENING') },
        ],
        temperature: 0.7,
        maxTokens: 150,
      });
    });

    it('should return TherapeuticResponse with content and metadata on success', async () => {
      // Arrange
      const mockResponse = { content: 'It sounds like you\'re both going through something difficult.' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      const result = await service.generateResponse(mockContext);

      // Assert
      expect(result).toEqual({
        content: 'It sounds like you\'re both going through something difficult.',
        interventionType: 'ACTIVE_LISTENING',
        metadata: {
          confidence: 0.8,
          participantsAddressed: ['user_1', 'user_2'],
          emotionKeywords: ['feel', 'feeling', 'sad'],
        },
      });

      expect(result.metadata.emotionKeywords).toContain('sad');
    });

    it('should return fallback response when LLM fails', async () => {
      // Arrange
      mockLLMClient.chat.mockRejectedValue(new Error('LLM timeout'));

      // Act
      const result = await service.generateResponse(mockContext);

      // Assert
      expect(result).toEqual<TherapeuticResponse>({
        content: 'I hear both of you sharing important perspectives.',
        interventionType: 'ACTIVE_LISTENING',
        metadata: {
          confidence: 0.5,
          participantsAddressed: ['user_1', 'user_2'],
          emotionKeywords: [],
        },
      });
    });

    it('should extract emotion keywords from messages', async () => {
      // Arrange
      const contextWithEmotions: InterventionContext = {
        ...mockContext,
        recentMessages: [
          { id: 'msg_1', text: "I'm feeling anxious and worried about the situation", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
          { id: 'msg_2', text: "I'm excited but also scared about what might happen", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        ],
      };

      const mockResponse = { content: 'I sense mixed emotions here.' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      const result = await service.generateResponse(contextWithEmotions);

      // Assert - Should extract up to 5 keywords in order of emotionWords array
      expect(result.metadata.emotionKeywords).toEqual(['feel', 'feeling', 'anxious', 'worried', 'excited']);
    });

    it('should extract emotion keywords case insensitively', async () => {
      // Arrange
      const contextWithMixedCase: InterventionContext = {
        ...mockContext,
        recentMessages: [
          { id: 'msg_1', text: "I'm HAPPY and FEELING great", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        ],
      };

      const mockResponse = { content: 'Great to hear!' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      const result = await service.generateResponse(contextWithMixedCase);

      // Assert
      expect(result.metadata.emotionKeywords).toEqual(['feel', 'feeling', 'happy']);
    });

    it('should deduplicate emotion keywords', async () => {
      // Arrange
      const contextWithDuplicates: InterventionContext = {
        ...mockContext,
        recentMessages: [
          { id: 'msg_1', text: "I feel sad and I'm feeling very sad today", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        ],
      };

      const mockResponse = { content: 'I understand your sadness.' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      const result = await service.generateResponse(contextWithDuplicates);

      // Assert
      expect(result.metadata.emotionKeywords).toEqual(['feel', 'feeling', 'sad']);
    });

    it('should limit emotion keywords to 5 maximum', async () => {
      // Arrange
      const contextWithManyEmotions: InterventionContext = {
        ...mockContext,
        recentMessages: [
          { id: 'msg_1', text: "I feel anxious, worried, excited, scared, happy, sad, angry, frustrated", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        ],
      };

      const mockResponse = { content: 'Many emotions here.' };
      mockLLMClient.chat.mockResolvedValue(mockResponse);

      // Act
      const result = await service.generateResponse(contextWithManyEmotions);

      // Assert - Should return first 5 emotion words from the predefined array
      expect(result.metadata.emotionKeywords).toHaveLength(5);
    });
  });

  describe('getInterventionGuidance', () => {
    it('should return guidance for Active Listening', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'ACTIVE_LISTENING' as const,
      };

      const guidance = (service as any).getInterventionGuidance('ACTIVE_LISTENING', context);

      expect(guidance).toContain('Reflect what you\'re hearing');
      expect(guidance).toContain('It sounds like...');
      expect(guidance).toContain('I\'m hearing that...');
    });

    it('should return guidance for Validation', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'Bob', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'VALIDATION' as const,
      };

      const guidance = (service as any).getInterventionGuidance('VALIDATION', context);

      expect(guidance).toContain('Validate the emotions being expressed');
      expect(guidance).toContain('That makes sense...');
      expect(guidance).toContain('It\'s understandable that...');
    });

    it('should return guidance for Bridge Building with participant names', () => {
      const context = {
        participants: [
          { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 1 },
          { userId: 'user_2', displayName: 'Bob', platformUserId: 'tg_user_2', recentMessageCount: 1 },
        ],
        interventionType: 'BRIDGE_BUILDING' as const,
      };

      const guidance = (service as any).getInterventionGuidance('BRIDGE_BUILDING', context);

      expect(guidance).toContain('Help connect the two perspectives');
      expect(guidance).toContain('I hear Alice and Bob saying...');
      expect(guidance).toContain('It seems like you both...');
    });

    it('should return guidance for De-escalation', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'Charlie', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'DE_ESCALATION' as const,
      };

      const guidance = (service as any).getInterventionGuidance('DE_ESCALATION', context);

      expect(guidance).toContain('Help slow things down');
      expect(guidance).toContain('Let\'s take a moment...');
      expect(guidance).toContain('I can see this is important to both of you...');
    });

    it('should return guidance for Celebration', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'Diana', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'CELEBRATION' as const,
      };

      const guidance = (service as any).getInterventionGuidance('CELEBRATION', context);

      expect(guidance).toContain('Celebrate this positive moment together');
      expect(guidance).toContain('This is wonderful!');
      expect(guidance).toContain('It\'s great to see...');
    });

    it('should return guidance for Summation', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'Eve', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'SUMMATION' as const,
      };

      const guidance = (service as any).getInterventionGuidance('SUMMATION', context);

      expect(guidance).toContain('Summarize what you\'ve heard');
      expect(guidance).toContain('Let me make sure I understand...');
      expect(guidance).toContain('So far we\'ve discussed...');
    });

    it('should return default guidance for unknown intervention type', () => {
      const context = {
        participants: [{ userId: 'user_1', displayName: 'User', platformUserId: 'tg_user_1', recentMessageCount: 1 }],
        interventionType: 'UNKNOWN_TYPE' as any,
      };

      const guidance = (service as any).getInterventionGuidance('UNKNOWN_TYPE', context);

      expect(guidance).toBe('Provide a brief, supportive response that adds value to the conversation.');
    });
  });

  describe('buildParticipantContext', () => {
    it('should include participant names and recent messages', () => {
      const participants = [
        { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 2 },
        { userId: 'user_2', displayName: 'Bob', platformUserId: 'tg_user_2', recentMessageCount: 1 },
      ];

      const messages: Message[] = [
        { id: 'msg_1', text: "Hello everyone", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: "How are you?", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_3', text: "I'm doing well", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const context = (service as any).buildParticipantContext(participants, messages);

      expect(context).toContain('- Alice: Recent: "Hello everyone | I\'m doing well"');
      expect(context).toContain('- Bob: Recent: "How are you?"');
    });

    it('should handle missing display names', () => {
      const participants = [
        { userId: 'user_1', displayName: null, platformUserId: 'tg_user_1', recentMessageCount: 1 },
        { userId: 'user_2', displayName: undefined, platformUserId: 'tg_user_2', recentMessageCount: 1 },
      ];

      const messages: Message[] = [
        { id: 'msg_1', text: "Hello", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: "Hi there", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const context = (service as any).buildParticipantContext(participants, messages);

      expect(context).toContain('- Participant: Recent: "Hello"');
      expect(context).toContain('- Participant: Recent: "Hi there"');
    });

    it('should handle participants with no messages', () => {
      const participants = [
        { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 0 },
        { userId: 'user_2', displayName: 'Bob', platformUserId: 'tg_user_2', recentMessageCount: 1 },
      ];

      const messages: Message[] = [
        { id: 'msg_1', text: "Only Bob spoke", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const context = (service as any).buildParticipantContext(participants, messages);

      expect(context).toContain('- Alice: No recent messages');
      expect(context).toContain('- Bob: Recent: "Only Bob spoke"');
    });

    it('should filter messages by participant and get last 3', () => {
      const participants = [
        { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 3 },
      ];

      const messages: Message[] = [
        { id: 'msg_1', text: "First message", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: "Second message", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_3', text: "Third message", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_4', text: "Fourth message", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_5', text: "Fifth message", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const context = (service as any).buildParticipantContext(participants, messages);

      // Should include only Alice's last 3 messages in chronological order
      expect(context).toContain('- Alice: Recent: "Third message | Fourth message | Fifth message"');
      expect(context).not.toContain('Second message');
      expect(context).not.toContain('First message');
    });

    it('should filter out empty text messages', () => {
      const participants = [
        { userId: 'user_1', displayName: 'Alice', platformUserId: 'tg_user_1', recentMessageCount: 3 },
      ];

      const messages: Message[] = [
        { id: 'msg_1', text: "", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: null, senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_3', text: "Valid message", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const context = (service as any).buildParticipantContext(participants, messages);

      expect(context).toContain('- Alice: Recent: "Valid message"');
    });
  });

  describe('extractEmotionKeywords', () => {
    it('should extract emotion words from messages', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "I feel sad and happy about this", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: "It makes me angry sometimes", senderId: 'user_2', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toEqual(['feel', 'sad', 'happy', 'angry']);
    });

    it('should be case insensitive', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "I'm HAPPY and feeling EXCITED", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toEqual(['feel', 'feeling', 'happy', 'excited']);
    });

    it('should deduplicate keywords', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "I feel sad and I'm feeling very sad", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toEqual(['feel', 'feeling', 'sad']);
    });

    it('should limit to 5 maximum keywords', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "I feel anxious, worried, excited, scared, happy, sad, angry, frustrated", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toHaveLength(5);
      // Should be the first 5 matches in order of emotionWords array
      expect(keywords).toEqual(['feel', 'sad', 'happy', 'angry', 'frustrated']);
    });

    it('should handle empty messages', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
        { id: 'msg_2', text: null, senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toEqual([]);
    });

    it('should handle messages with no emotion words', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "The weather is nice today", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      expect(keywords).toEqual([]);
    });

    it('should preserve order of emotion words array, not text order', () => {
      const messages: Message[] = [
        { id: 'msg_1', text: "worried anxious excited scared happy", senderId: 'user_1', chatId: 'conv_123', timestamp: new Date(), isBot: false },
      ];

      const keywords = (service as any).extractEmotionKeywords(messages);

      // Should be in order of emotionWords array: feel, feeling, sad, happy, angry, frustrated, anxious, worried, excited, scared
      expect(keywords).toEqual(['happy', 'anxious', 'worried', 'excited', 'scared']);
    });
  });

  describe('getFallbackResponse', () => {
    it('should return fallback for Active Listening', () => {
      const fallback = (service as any).getFallbackResponse('ACTIVE_LISTENING');
      expect(fallback).toBe('I hear both of you sharing important perspectives.');
    });

    it('should return fallback for Validation', () => {
      const fallback = (service as any).getFallbackResponse('VALIDATION');
      expect(fallback).toBe('Your feelings on this matter are completely valid.');
    });

    it('should return fallback for Bridge Building', () => {
      const fallback = (service as any).getFallbackResponse('BRIDGE_BUILDING');
      expect(fallback).toBe('It seems like there might be some common ground here.');
    });

    it('should return fallback for De-escalation', () => {
      const fallback = (service as any).getFallbackResponse('DE_ESCALATION');
      expect(fallback).toBe('Let\'s take a moment to breathe and hear each other out.');
    });

    it('should return fallback for Celebration', () => {
      const fallback = (service as any).getFallbackResponse('CELEBRATION');
      expect(fallback).toBe('This is a wonderful moment to celebrate together!');
    });

    it('should return fallback for Summation', () => {
      const fallback = (service as any).getFallbackResponse('SUMMATION');
      expect(fallback).toBe('Let me reflect on what I\'ve heard from both of you...');
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt with all components', () => {
      const prompt = (service as any).buildPrompt(
        'ACTIVE_LISTENING',
        '- Alice: Recent: "Hello"\n- Bob: Recent: "Hi there"',
        'Recent conversation:\nAlice: Hello\nBob: Hi there',
        'Reflect what you\'re hearing from both participants'
      );

      expect(prompt).toContain('You are observing a 2-person conversation');
      expect(prompt).toContain('Your intervention type: ACTIVE_LISTENING');
      expect(prompt).toContain('Participants:');
      expect(prompt).toContain('- Alice: Recent: "Hello"');
      expect(prompt).toContain('- Bob: Recent: "Hi there"');
      expect(prompt).toContain('Recent conversation:');
      expect(prompt).toContain('Alice: Hello');
      expect(prompt).toContain('Bob: Hi there');
      expect(prompt).toContain('Guidance for this intervention:');
      expect(prompt).toContain('Reflect what you\'re hearing from both participants');
      expect(prompt).toContain('Generate a brief (1-3 sentences) therapeutic response:');
    });
  });
});