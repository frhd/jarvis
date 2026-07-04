import { vi, beforeEach, afterEach } from 'vitest';
import type { DyadParticipant, ParticipantEmotionalState, ConversationDynamics } from './types.js';
import type { Message } from '../../types/index.js';

// Mocks must be declared before importing the module under test
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { DyadContextService } from './dyad-context.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMessage = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg1',
    telegramMessageId: 1,
    chatId: 'chat1',
    senderId: 'user1',
    text: 'hello',
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    transcript: null,
    transcriptStatus: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    rawJson: '{}',
    isBot: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Message);

const makeParticipant = (userId: string, displayName: string): DyadParticipant => ({
  userId,
  displayName,
  platformUserId: `tg_${userId}`,
  recentMessageCount: 5,
  lastMessageAt: new Date('2024-01-01T00:00:00Z'),
});

const makeEmotionalState = (userId: string): ParticipantEmotionalState => ({
  userId,
  analysis: {
    primaryEmotion: 'neutral',
    intensity: 50,
    trend: 'stable',
    confidence: 0.8,
    indicators: [],
  },
  lastAnalyzedAt: new Date('2024-01-01T00:00:00Z'),
});

const makeDynamics = (overrides: Partial<ConversationDynamics> = {}): ConversationDynamics => ({
  conversationId: 'conv1',
  tensionLevel: 0,
  conflictDetected: false,
  positiveMomentsCount: 0,
  turnTakingBalance: 0.5,
  topicCoherence: 0.5,
  supportPatterns: [],
  lastAnalyzedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMemoryRepo = {
  findActiveForUser: vi.fn().mockResolvedValue([]),
};

const mockEmotionalAnalyzer = {
  analyzeDyadEmotions: vi.fn().mockResolvedValue([]),
};

const mockDynamicsAnalyzer = {
  analyzeDynamics: vi.fn().mockResolvedValue(makeDynamics()),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DyadContextService', () => {
  let service: DyadContextService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DyadContextService(mockMemoryRepo, mockEmotionalAnalyzer, mockDynamicsAnalyzer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize without errors', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(DyadContextService);
    });
  });

  describe('buildDyadContext', () => {
    describe('participant contexts with emotional states', () => {
      it('should return participant contexts including emotional state when analyzer provides them', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const bob = makeParticipant('bob', 'Bob');
        const aliceState = makeEmotionalState('alice');
        const bobState = makeEmotionalState('bob');

        mockEmotionalAnalyzer.analyzeDyadEmotions.mockResolvedValue([aliceState, bobState]);

        const result = await service.buildDyadContext('conv1', [alice, bob], []);

        expect(result.participants).toHaveLength(2);

        const aliceCtx = result.participants.find(p => p.userId === 'alice');
        const bobCtx = result.participants.find(p => p.userId === 'bob');

        expect(aliceCtx?.emotionalState).toEqual(aliceState);
        expect(bobCtx?.emotionalState).toEqual(bobState);
      });

      it('should set emotionalState to undefined when analyzer returns no match for a participant', async () => {
        const alice = makeParticipant('alice', 'Alice');
        mockEmotionalAnalyzer.analyzeDyadEmotions.mockResolvedValue([]);

        const result = await service.buildDyadContext('conv1', [alice], []);

        expect(result.participants[0].emotionalState).toBeUndefined();
      });

      it('should call analyzeDyadEmotions with conversationId and messages', async () => {
        const messages = [makeMessage({ senderId: 'alice' })];
        await service.buildDyadContext('conv42', [makeParticipant('alice', 'Alice')], messages);

        expect(mockEmotionalAnalyzer.analyzeDyadEmotions).toHaveBeenCalledWith('conv42', messages);
      });

      it('should include memories in participant context by default', async () => {
        const alice = makeParticipant('alice', 'Alice');
        mockMemoryRepo.findActiveForUser.mockResolvedValue([
          { content: 'loves hiking', memoryType: 'preference', createdAt: new Date() },
          { content: 'works in tech', memoryType: 'fact', createdAt: new Date() },
        ]);

        const result = await service.buildDyadContext('conv1', [alice], []);

        expect(result.participants[0].relevantMemories).toEqual([
          '[preference] loves hiking',
          '[fact] works in tech',
        ]);
      });

      it('should include recentMessages filtered for each participant', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const bob = makeParticipant('bob', 'Bob');
        const messages = [
          makeMessage({ senderId: 'alice', text: 'hi' }),
          makeMessage({ senderId: 'bob', text: 'hello' }),
          makeMessage({ senderId: 'alice', text: 'how are you?' }),
        ];

        const result = await service.buildDyadContext('conv1', [alice, bob], messages);

        const aliceCtx = result.participants.find(p => p.userId === 'alice');
        const bobCtx = result.participants.find(p => p.userId === 'bob');

        expect(aliceCtx?.recentMessages.every(m => m.senderId === 'alice')).toBe(true);
        expect(bobCtx?.recentMessages.every(m => m.senderId === 'bob')).toBe(true);
      });
    });

    describe('includeDynamics option', () => {
      it('should include conversation dynamics when includeDynamics is true (default)', async () => {
        const dynamics = makeDynamics({ tensionLevel: 30, conflictDetected: true });
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(dynamics);

        const result = await service.buildDyadContext('conv1', [], [], { includeDynamics: true });

        expect(result.dynamics).toEqual(dynamics);
        expect(mockDynamicsAnalyzer.analyzeDynamics).toHaveBeenCalledOnce();
      });

      it('should include dynamics by default when no options are passed', async () => {
        const dynamics = makeDynamics();
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(dynamics);

        const result = await service.buildDyadContext('conv1', [], []);

        expect(result.dynamics).toEqual(dynamics);
        expect(mockDynamicsAnalyzer.analyzeDynamics).toHaveBeenCalledOnce();
      });

      it('should skip dynamics and return null when includeDynamics is false', async () => {
        const result = await service.buildDyadContext('conv1', [], [], { includeDynamics: false });

        expect(result.dynamics).toBeNull();
        expect(mockDynamicsAnalyzer.analyzeDynamics).not.toHaveBeenCalled();
      });
    });

    describe('includeMemories option', () => {
      it('should query memories for each participant when includeMemories is true (default)', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const bob = makeParticipant('bob', 'Bob');

        await service.buildDyadContext('conv1', [alice, bob], [], { includeMemories: true });

        expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledTimes(2);
        expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledWith('alice', 5);
        expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledWith('bob', 5);
      });

      it('should include memories by default when no options are passed', async () => {
        const alice = makeParticipant('alice', 'Alice');
        await service.buildDyadContext('conv1', [alice], []);

        expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledWith('alice', 5);
      });

      it('should skip memory queries when includeMemories is false', async () => {
        const alice = makeParticipant('alice', 'Alice');

        const result = await service.buildDyadContext('conv1', [alice], [], { includeMemories: false });

        expect(mockMemoryRepo.findActiveForUser).not.toHaveBeenCalled();
        expect(result.participants[0].relevantMemories).toEqual([]);
      });
    });

    describe('conversationContext formatting', () => {
      it('should format messages as "Name: text" joined by newlines', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const bob = makeParticipant('bob', 'Bob');
        const messages = [
          makeMessage({ senderId: 'alice', text: 'Hi Bob!', isBot: false }),
          makeMessage({ senderId: 'bob', text: 'Hey Alice!', isBot: false }),
        ];

        const result = await service.buildDyadContext('conv1', [alice, bob], messages);

        expect(result.conversationContext).toBe('Alice: Hi Bob!\nBob: Hey Alice!');
      });

      it('should label bot messages as "Jarvis"', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const messages = [
          makeMessage({ senderId: 'alice', text: 'How are you?', isBot: false }),
          makeMessage({ senderId: null as unknown as string, text: 'I am doing well!', isBot: true }),
        ];

        const result = await service.buildDyadContext('conv1', [alice], messages);

        expect(result.conversationContext).toBe('Alice: How are you?\nJarvis: I am doing well!');
      });

      it('should fall back to "User" when senderId is not in participants list', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const messages = [
          makeMessage({ senderId: 'unknown-user', text: 'mystery message', isBot: false }),
        ];

        const result = await service.buildDyadContext('conv1', [alice], messages);

        expect(result.conversationContext).toBe('User: mystery message');
      });

      it('should use "[non-text]" for messages with no text', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const messages = [
          makeMessage({ senderId: 'alice', text: null as unknown as string, isBot: false }),
        ];

        const result = await service.buildDyadContext('conv1', [alice], messages);

        expect(result.conversationContext).toBe('Alice: [non-text]');
      });

      it('should use "Participant" as fallback when participant has no displayName', async () => {
        const noName: DyadParticipant = {
          userId: 'anon',
          displayName: null,
          platformUserId: 'tg_anon',
          recentMessageCount: 1,
          lastMessageAt: new Date(),
        };
        const messages = [makeMessage({ senderId: 'anon', text: 'hello', isBot: false })];

        const result = await service.buildDyadContext('conv1', [noName], messages);

        expect(result.conversationContext).toBe('Participant: hello');
      });

      it('should limit conversation context to the last 15 messages', async () => {
        const alice = makeParticipant('alice', 'Alice');
        // Create 20 messages
        const messages = Array.from({ length: 20 }, (_, i) =>
          makeMessage({ senderId: 'alice', text: `msg${i}`, isBot: false })
        );

        const result = await service.buildDyadContext('conv1', [alice], messages);

        const lines = result.conversationContext.split('\n');
        expect(lines).toHaveLength(15);
        // Should contain the last 15 (msg5 through msg19)
        expect(lines[0]).toBe('Alice: msg5');
        expect(lines[14]).toBe('Alice: msg19');
      });

      it('should return an empty string when there are no messages', async () => {
        const result = await service.buildDyadContext('conv1', [], []);

        expect(result.conversationContext).toBe('');
      });
    });

    describe('topicSummary generation', () => {
      it('should identify top words from message text', async () => {
        const messages = [
          makeMessage({ text: 'feeling upset about everything today feeling really upset' }),
          makeMessage({ text: 'everything makes sense today really' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages);

        // Words longer than 4 chars: "feeling", "upset", "about", "everything", "today", "feeling", "really", "upset", "everything", "makes", "sense", "today", "really"
        expect(result.topicSummary).toContain('Discussing:');
      });

      it('should return "General conversation" when messages have no words longer than 4 characters', async () => {
        const messages = [
          makeMessage({ text: 'hi yes no' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: false });

        expect(result.topicSummary).toBe('General conversation');
      });

      it('should append "(with some tension)" note when dynamics has conflictDetected true', async () => {
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(
          makeDynamics({ conflictDetected: true, positiveMomentsCount: 0 })
        );
        const messages = [
          makeMessage({ text: 'really feeling frustrated about everything lately' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: true });

        expect(result.topicSummary).toContain('(with some tension)');
      });

      it('should append "(positive tone)" note when positiveMomentsCount is greater than 2', async () => {
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(
          makeDynamics({ conflictDetected: false, positiveMomentsCount: 3 })
        );
        const messages = [
          makeMessage({ text: 'really happy about everything today wonderful' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: true });

        expect(result.topicSummary).toContain('(positive tone)');
      });

      it('should not append any tone note when positiveMomentsCount is exactly 2', async () => {
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(
          makeDynamics({ conflictDetected: false, positiveMomentsCount: 2 })
        );
        const messages = [
          makeMessage({ text: 'really happy about everything today wonderful' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: true });

        expect(result.topicSummary).not.toContain('(positive tone)');
        expect(result.topicSummary).not.toContain('(with some tension)');
      });

      it('should not append any tone note when dynamics is null (includeDynamics false)', async () => {
        const messages = [
          makeMessage({ text: 'really happy about everything today wonderful' }),
        ];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: false });

        expect(result.topicSummary).not.toContain('(positive tone)');
        expect(result.topicSummary).not.toContain('(with some tension)');
      });

      it('should not add both conflict and positive notes at the same time', async () => {
        // conflictDetected takes precedence since it is checked first
        mockDynamicsAnalyzer.analyzeDynamics.mockResolvedValue(
          makeDynamics({ conflictDetected: true, positiveMomentsCount: 5 })
        );
        const messages = [makeMessage({ text: 'really upset about everything today' })];

        const result = await service.buildDyadContext('conv1', [], messages, { includeDynamics: true });

        expect(result.topicSummary).toContain('(with some tension)');
        expect(result.topicSummary).not.toContain('(positive tone)');
      });
    });

    describe('result shape', () => {
      it('should always return participants, conversationContext, dynamics, and topicSummary fields', async () => {
        const result = await service.buildDyadContext('conv1', [], []);

        expect(result).toHaveProperty('participants');
        expect(result).toHaveProperty('conversationContext');
        expect(result).toHaveProperty('dynamics');
        expect(result).toHaveProperty('topicSummary');
      });

      it('should preserve all participant fields from input plus added context fields', async () => {
        const alice = makeParticipant('alice', 'Alice');
        const result = await service.buildDyadContext('conv1', [alice], []);

        const aliceCtx = result.participants[0];
        expect(aliceCtx.userId).toBe('alice');
        expect(aliceCtx.displayName).toBe('Alice');
        expect(aliceCtx.platformUserId).toBe('tg_alice');
        expect(aliceCtx.recentMessageCount).toBe(5);
        expect(aliceCtx).toHaveProperty('emotionalState');
        expect(aliceCtx).toHaveProperty('recentMessages');
        expect(aliceCtx).toHaveProperty('relevantMemories');
      });

      it('should handle multiple participants in parallel', async () => {
        const participants = [
          makeParticipant('alice', 'Alice'),
          makeParticipant('bob', 'Bob'),
          makeParticipant('carol', 'Carol'),
        ];

        const result = await service.buildDyadContext('conv1', participants, []);

        expect(result.participants).toHaveLength(3);
        expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledTimes(3);
      });
    });
  });
});
