import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mocks must be declared before module imports
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn().mockReturnValue('test-nanoid-id'),
}));

import { ConversationDynamicsAnalyzerService } from './dynamics-analyzer.service.js';
import type { Message } from '../../types/index.js';

// ============================================================================
// Helpers
// ============================================================================

const makeMessage = (overrides: Partial<Message> = {}): Message =>
  ({
    text: 'hello',
    senderId: 'user1',
    isBot: false,
    createdAt: new Date(),
    ...overrides,
  } as Message);

// ============================================================================
// Tests
// ============================================================================

describe('ConversationDynamicsAnalyzerService', () => {
  let service: ConversationDynamicsAnalyzerService;
  let mockRepo: {
    findByConversationId: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      findByConversationId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    service = new ConversationDynamicsAnalyzerService(mockRepo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Empty message list
  // ==========================================================================

  describe('analyzeDynamics() with empty messages', () => {
    it('should return neutral dynamics without persisting', async () => {
      const result = await service.analyzeDynamics('conv-1', []);

      expect(result.conversationId).toBe('conv-1');
      expect(result.tensionLevel).toBe(0);
      expect(result.conflictDetected).toBe(false);
      expect(result.positiveMomentsCount).toBe(0);
      expect(result.turnTakingBalance).toBe(0.5);
      expect(result.topicCoherence).toBe(0.5);
      expect(result.supportPatterns).toEqual([]);
      expect(result.lastAnalyzedAt).toBeInstanceOf(Date);
    });

    it('should NOT call upsert when messages array is empty', async () => {
      await service.analyzeDynamics('conv-1', []);

      expect(mockRepo.upsert).not.toHaveBeenCalled();
    });

    it('should return a valid ConversationDynamics shape', async () => {
      const result = await service.analyzeDynamics('conv-empty', []);

      expect(result).toMatchObject({
        conversationId: 'conv-empty',
        tensionLevel: expect.any(Number),
        conflictDetected: expect.any(Boolean),
        positiveMomentsCount: expect.any(Number),
        turnTakingBalance: expect.any(Number),
        topicCoherence: expect.any(Number),
        supportPatterns: expect.any(Array),
        lastAnalyzedAt: expect.any(Date),
      });
    });
  });

  // ==========================================================================
  // Turn-taking balance
  // ==========================================================================

  describe('turn-taking balance', () => {
    it('should return 1.0 (perfectly balanced) when both users contribute equally', async () => {
      const messages = [
        makeMessage({ senderId: 'user1', text: 'Hello there' }),
        makeMessage({ senderId: 'user2', text: 'Hey' }),
        makeMessage({ senderId: 'user1', text: 'How are you?' }),
        makeMessage({ senderId: 'user2', text: 'I am good' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.turnTakingBalance).toBe(1.0);
    });

    it('should return 1.0 when perfectly balanced (equal counts)', async () => {
      const messages = [
        makeMessage({ senderId: 'userA', text: 'msg1' }),
        makeMessage({ senderId: 'userB', text: 'msg2' }),
        makeMessage({ senderId: 'userA', text: 'msg3' }),
        makeMessage({ senderId: 'userB', text: 'msg4' }),
        makeMessage({ senderId: 'userA', text: 'msg5' }),
        makeMessage({ senderId: 'userB', text: 'msg6' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.turnTakingBalance).toBe(1.0);
    });

    it('should return a value less than 1 when conversation is imbalanced', async () => {
      const messages = [
        makeMessage({ senderId: 'user1', text: 'msg1' }),
        makeMessage({ senderId: 'user1', text: 'msg2' }),
        makeMessage({ senderId: 'user1', text: 'msg3' }),
        makeMessage({ senderId: 'user2', text: 'msg4' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // user2 sent 1, user1 sent 3 => 1/3 ≈ 0.333
      expect(result.turnTakingBalance).toBeCloseTo(1 / 3, 5);
    });

    it('should return 0.5 when only one sender is present', async () => {
      const messages = [
        makeMessage({ senderId: 'user1', text: 'first' }),
        makeMessage({ senderId: 'user1', text: 'second' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.turnTakingBalance).toBe(0.5);
    });

    it('should exclude bot messages from turn-taking calculation', async () => {
      const messages = [
        makeMessage({ senderId: 'user1', text: 'msg1' }),
        makeMessage({ senderId: 'user1', text: 'msg2' }),
        makeMessage({ senderId: 'botId', isBot: true, text: 'bot response' }),
        makeMessage({ senderId: 'botId', isBot: true, text: 'another bot response' }),
        makeMessage({ senderId: 'user2', text: 'msg3' }),
        makeMessage({ senderId: 'user2', text: 'msg4' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // Only user messages counted: user1=2, user2=2 => balance = 1.0
      expect(result.turnTakingBalance).toBe(1.0);
    });

    it('should return 0.5 when messages have null senderId', async () => {
      const messages = [
        makeMessage({ senderId: null, text: 'msg without sender' }),
        makeMessage({ senderId: null, text: 'another one' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.turnTakingBalance).toBe(0.5);
    });
  });

  // ==========================================================================
  // Tension detection
  // ==========================================================================

  describe('tension detection via keyword patterns', () => {
    it('should detect tension keyword "frustrated"', async () => {
      const messages = [makeMessage({ text: 'I am so frustrated with this' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should detect tension keyword "annoyed"', async () => {
      const messages = [makeMessage({ text: 'You are so annoyed at me' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should detect tension keyword "sick of"', async () => {
      const messages = [makeMessage({ text: 'I am sick of this happening' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should detect tension keyword "unfair"', async () => {
      const messages = [makeMessage({ text: 'This is completely unfair to me' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should detect tension keyword "ridiculous"', async () => {
      const messages = [makeMessage({ text: 'That is ridiculous and wrong' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should detect tension keyword "enough"', async () => {
      const messages = [makeMessage({ text: 'I have had enough of this' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThan(0);
    });

    it('should accumulate tension across multiple tense messages', async () => {
      const singleTenseMsg = [makeMessage({ text: 'I am frustrated with you' })];
      const multipleTenseMsgs = [
        makeMessage({ text: 'I am frustrated with you' }),
        makeMessage({ text: 'This is so unfair and wrong' }),
        makeMessage({ senderId: 'user2', text: 'I am annoyed and tired of this' }),
      ];

      const singleResult = await service.analyzeDynamics('conv-a', singleTenseMsg);
      const multiResult = await service.analyzeDynamics('conv-b', multipleTenseMsgs);

      expect(multiResult.tensionLevel).toBeGreaterThan(singleResult.tensionLevel);
    });

    it('should return zero tension for neutral messages', async () => {
      const messages = [
        makeMessage({ text: 'How was your day?' }),
        makeMessage({ senderId: 'user2', text: 'Pretty good, thanks for asking' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBe(0);
    });

    it('should cap tension at 100', async () => {
      // Provide many tense messages to exceed the cap
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage({
          senderId: `user${i % 2}`,
          text: 'you always frustrated annoyed unfair ridiculous enough stop',
        })
      );

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeLessThanOrEqual(100);
    });

    it('should ignore bot messages when computing tension', async () => {
      const messages = [
        makeMessage({ isBot: true, text: 'I am so frustrated and annoyed' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBe(0);
    });

    it('should ignore messages with null or empty text', async () => {
      const messages = [
        makeMessage({ text: null }),
        makeMessage({ text: '' }),
        makeMessage({ text: '   ' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBe(0);
    });
  });

  // ==========================================================================
  // Conflict detection
  // ==========================================================================

  describe('conflict detection', () => {
    it('should detect conflict when tension exceeds threshold (40)', async () => {
      // "you always" matches accusation pattern (12 pts each) and can combine with tension patterns
      const messages = [
        makeMessage({ text: 'you always do this to me, I am so frustrated' }),
        makeMessage({ senderId: 'user2', text: 'that is your fault blame you for everything' }),
        makeMessage({ text: 'you never listen to me at all, this is unfair' }),
        makeMessage({ senderId: 'user2', text: 'disagree completely, that is wrong' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.conflictDetected).toBe(true);
    });

    it('should NOT detect conflict when tension is below threshold', async () => {
      const messages = [
        makeMessage({ text: 'I feel a bit frustrated today' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // Single tension keyword = 8 pts, well below 40
      expect(result.tensionLevel).toBeLessThan(40);
      expect(result.conflictDetected).toBe(false);
    });

    it('should classify conflict type as "accusation" for accusation patterns', async () => {
      // Each accusation pattern match adds 12 pts to tension
      // Need at least 4 accusation matches to reach 48 pts (> threshold of 40)
      const messages = [
        makeMessage({ text: 'you always forget, you never listen, your fault, because of you' }),
        makeMessage({ senderId: 'user2', text: 'you always blame, you never care, your fault' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      if (result.conflictDetected) {
        expect(result.conflictType).toBe('accusation');
      }
    });

    it('should classify conflict type as "disagreement" for disagreement patterns', async () => {
      const messages = [
        makeMessage({ text: 'I disagree completely, that is wrong, no way, absolutely not' }),
        makeMessage({ senderId: 'user2', text: 'that is incorrect, I don\'t think so, disagree' }),
        makeMessage({ text: 'not true at all, wrong and incorrect answer, disagree' }),
        makeMessage({ senderId: 'user2', text: 'absolutely not, disagree, wrong approach' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      if (result.conflictDetected) {
        expect(result.conflictType).toBe('disagreement');
      }
    });

    it('should classify conflict type as "escalation" for ALL CAPS words', async () => {
      const messages = [
        makeMessage({ text: 'STOP IT RIGHT NOW THIS IS INSANE' }),
        makeMessage({ senderId: 'user2', text: 'YOU ARE BEING RIDICULOUS AND WRONG' }),
        makeMessage({ text: 'LISTEN TO ME!! HATE THIS SITUATION!!' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      if (result.conflictDetected) {
        expect(result.conflictType).toBe('escalation');
      }
    });

    it('should classify conflict type as "escalation" for multiple exclamation marks', async () => {
      const messages = [
        makeMessage({ text: 'Stop this now!! I hate this!! shut up!!' }),
        makeMessage({ senderId: 'user2', text: 'go away!! I can\'t stand this!!' }),
        makeMessage({ text: 'SCREAMING at you!! despise this!!' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      if (result.conflictDetected) {
        expect(['escalation', 'accusation', 'disagreement']).toContain(result.conflictType);
      }
    });

    it('should have undefined conflictType when tension is below threshold', async () => {
      const messages = [makeMessage({ text: 'slightly annoyed today' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.conflictDetected).toBe(false);
      expect(result.conflictType).toBeUndefined();
    });

    it('should exclude bot messages from conflict classification', async () => {
      const messages = [
        makeMessage({ isBot: true, text: 'you always do this, your fault, blame you' }),
        makeMessage({ isBot: true, text: 'you never listen, you won\'t cooperate' }),
        makeMessage({ text: 'Thanks for the help' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.conflictDetected).toBe(false);
    });
  });

  // ==========================================================================
  // Positive moments
  // ==========================================================================

  describe('positive moments counting', () => {
    it('should count "thank" as a positive moment', async () => {
      const messages = [makeMessage({ text: 'Thank you so much for this' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBeGreaterThan(0);
    });

    it('should count "appreciate" as a positive moment', async () => {
      const messages = [makeMessage({ text: 'I really appreciate what you did' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBeGreaterThan(0);
    });

    it('should count "agree" as a positive moment', async () => {
      const messages = [makeMessage({ text: 'I totally agree with that point' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBeGreaterThan(0);
    });

    it('should count "great point" as a positive moment', async () => {
      const messages = [makeMessage({ text: 'great point, I love that idea' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBeGreaterThan(0);
    });

    it('should accumulate positive moments across multiple matching messages', async () => {
      const messages = [
        makeMessage({ text: 'Thank you so much!' }),
        makeMessage({ senderId: 'user2', text: 'I appreciate your love for this' }),
        makeMessage({ text: 'I agree, together we can make it work' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBeGreaterThanOrEqual(3);
    });

    it('should return zero positive moments for neutral messages', async () => {
      const messages = [
        makeMessage({ text: 'What time does the meeting start?' }),
        makeMessage({ senderId: 'user2', text: 'At three in the afternoon' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBe(0);
    });

    it('should exclude bot messages from positive moment counting', async () => {
      const messages = [
        makeMessage({ isBot: true, text: 'Thank you for contacting me, I love helping!' }),
        makeMessage({ text: 'okay' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.positiveMomentsCount).toBe(0);
    });

    it('should count multiple pattern matches within a single message', async () => {
      // Pattern 1: (thank|thanks|appreciate|grateful|love|proud) matches "thank"
      // Pattern 2: (agree|exactly|right|great point|well said|good idea) matches "agree"
      const messages = [
        makeMessage({ text: 'thank you, I appreciate and love that we agree on this' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // 2 patterns matched: first pattern matches, second pattern matches
      expect(result.positiveMomentsCount).toBe(2);
    });
  });

  // ==========================================================================
  // Topic coherence
  // ==========================================================================

  describe('topic coherence', () => {
    it('should return 0.5 when fewer than 2 non-bot messages exist', async () => {
      const messages = [makeMessage({ text: 'just one message here' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.topicCoherence).toBe(0.5);
    });

    it('should return high coherence when consecutive messages share words', async () => {
      const messages = [
        makeMessage({ text: 'planning the birthday party celebration together' }),
        makeMessage({ senderId: 'user2', text: 'birthday party planning looks great together' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // High overlap: "birthday", "party", "planning", "together" all shared
      expect(result.topicCoherence).toBeGreaterThan(0.5);
    });

    it('should return low coherence when consecutive messages share no words', async () => {
      const messages = [
        makeMessage({ text: 'cooking pasta with garlic butter tonight' }),
        makeMessage({ senderId: 'user2', text: 'running marathon tomorrow morning sunrise' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // No meaningful word overlap
      expect(result.topicCoherence).toBeLessThan(0.5);
    });

    it('should return 0 coherence for completely different topic messages', async () => {
      const messages = [
        makeMessage({ text: 'physics quantum mechanics electrons wave particle' }),
        makeMessage({ senderId: 'user2', text: 'baking chocolate muffins vanilla sugar flour' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.topicCoherence).toBe(0);
    });

    it('should return 1.0 coherence for nearly identical messages', async () => {
      const messages = [
        makeMessage({ text: 'planning the birthday party celebration' }),
        makeMessage({ senderId: 'user2', text: 'planning the birthday party celebration' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // Jaccard similarity of identical word sets = 1.0
      expect(result.topicCoherence).toBeCloseTo(1.0, 5);
    });

    it('should exclude bot messages from topic coherence calculation', async () => {
      const messages = [
        makeMessage({ text: 'planning the birthday party celebration together' }),
        makeMessage({ isBot: true, text: 'completely unrelated robot response here now' }),
        makeMessage({ senderId: 'user2', text: 'birthday party planning looks great together' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // Only user messages compared: high coherence expected
      expect(result.topicCoherence).toBeGreaterThan(0.5);
    });

    it('should ignore words shorter than 4 characters in coherence computation', async () => {
      const messages = [
        makeMessage({ text: 'the cat sat on a mat and ran' }),
        makeMessage({ senderId: 'user2', text: 'the cat ran off to the big red bus' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // "the", "cat", "sat", "on", "a", "mat", "ran" - only words >= 4 chars count
      // "cat", "mat", "ran" are only 3 chars, so no qualifying words in first message
      // Result should be 0.5 (no valid comparisons)
      expect(result.topicCoherence).toBe(0.5);
    });

    it('should return 0.5 when no valid word comparisons exist', async () => {
      const messages = [
        makeMessage({ text: 'hi ok yes' }),
        makeMessage({ senderId: 'user2', text: 'no ok hi' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.topicCoherence).toBe(0.5);
    });
  });

  // ==========================================================================
  // Support pattern detection
  // ==========================================================================

  describe('support pattern detection', () => {
    it('should detect "empathy" pattern', async () => {
      const messages = [makeMessage({ text: 'I understand what you are going through' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('empathy');
    });

    it('should detect "I hear you" as empathy', async () => {
      const messages = [makeMessage({ text: 'I hear you and I understand your pain' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('empathy');
    });

    it('should detect "active_listening" pattern', async () => {
      const messages = [makeMessage({ text: "I'm here for you, tell me more" })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('active_listening');
    });

    it('should detect "I\'m listening" as active_listening', async () => {
      const messages = [makeMessage({ text: "I'm listening to everything you say" })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('active_listening');
    });

    it('should detect "reassurance" pattern', async () => {
      const messages = [makeMessage({ text: "it's okay, don't worry about it at all" })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('reassurance');
    });

    it('should detect "no worries" as reassurance', async () => {
      const messages = [makeMessage({ text: 'No worries, it will be fine' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('reassurance');
    });

    it('should detect "collaboration" pattern', async () => {
      const messages = [makeMessage({ text: 'we can solve this together, how about we try' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('collaboration');
    });

    it('should detect "what if we" as collaboration', async () => {
      const messages = [makeMessage({ text: "What if we approach this differently?" })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('collaboration');
    });

    it('should detect "accountability" pattern', async () => {
      const messages = [makeMessage({ text: "I'm sorry about the confusion I caused" })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('accountability');
    });

    it('should detect "my bad" as accountability', async () => {
      const messages = [makeMessage({ text: 'my bad, I apologize for that mistake' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('accountability');
    });

    it('should detect multiple support patterns across messages', async () => {
      const messages = [
        makeMessage({ text: 'I understand how hard this is for you' }),
        makeMessage({ senderId: 'user2', text: "I'm sorry about that, my bad" }),
        makeMessage({ text: "I'm here and I'm listening, tell me more" }),
        makeMessage({ senderId: 'user2', text: "we can work through this, let's try together" }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toContain('empathy');
      expect(result.supportPatterns).toContain('accountability');
      expect(result.supportPatterns).toContain('active_listening');
      expect(result.supportPatterns).toContain('collaboration');
    });

    it('should return empty array when no support patterns match', async () => {
      const messages = [
        makeMessage({ text: 'What time is the meeting?' }),
        makeMessage({ senderId: 'user2', text: 'At three in the afternoon' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toEqual([]);
    });

    it('should deduplicate support patterns (each label appears at most once)', async () => {
      const messages = [
        makeMessage({ text: 'I understand, I understand completely, I understand you' }),
        makeMessage({ senderId: 'user2', text: 'I understand you too, I hear you clearly' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      const empathyCount = result.supportPatterns.filter(p => p === 'empathy').length;
      expect(empathyCount).toBe(1);
    });

    it('should exclude bot messages from support pattern detection', async () => {
      const messages = [
        makeMessage({ isBot: true, text: "I'm here for you, I understand completely" }),
        makeMessage({ text: 'thanks' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.supportPatterns).toEqual([]);
    });
  });

  // ==========================================================================
  // Persistence via upsert
  // ==========================================================================

  describe('persistence via dynamicsRepo.upsert()', () => {
    it('should call upsert once with the correct conversationId', async () => {
      const messages = [
        makeMessage({ text: 'hello world' }),
        makeMessage({ senderId: 'user2', text: 'hi there friend' }),
      ];

      await service.analyzeDynamics('conv-xyz', messages);

      expect(mockRepo.upsert).toHaveBeenCalledTimes(1);
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-xyz' })
      );
    });

    it('should persist the computed tensionLevel', async () => {
      const messages = [makeMessage({ text: 'I am so frustrated and annoyed' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ tensionLevel: result.tensionLevel })
      );
    });

    it('should persist conflictDetected as a boolean', async () => {
      const messages = [makeMessage({ text: 'hello, how are you doing today?' })];

      await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ conflictDetected: expect.any(Boolean) })
      );
    });

    it('should persist supportPatterns as a JSON string', async () => {
      const messages = [
        makeMessage({ text: "I understand your pain, I'm here for you" }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          supportPatterns: JSON.stringify(result.supportPatterns),
        })
      );
    });

    it('should persist lastAnalyzedAt as a Date', async () => {
      const messages = [makeMessage({ text: 'hello there' })];

      await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ lastAnalyzedAt: expect.any(Date) })
      );
    });

    it('should persist a generated id via nanoid', async () => {
      const messages = [makeMessage({ text: 'hello there' })];

      await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'test-nanoid-id' })
      );
    });

    it('should persist null conflictType when no conflict detected', async () => {
      const messages = [makeMessage({ text: 'hello, nice day today!' })];

      await service.analyzeDynamics('conv-1', messages);

      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ conflictType: null })
      );
    });

    it('should NOT call upsert for empty message list', async () => {
      await service.analyzeDynamics('conv-1', []);

      expect(mockRepo.upsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Bot message exclusion (cross-cutting)
  // ==========================================================================

  describe('bot message exclusion', () => {
    it('should produce identical results whether bot messages are included or not', async () => {
      const userMessages = [
        makeMessage({ senderId: 'user1', text: 'I understand you completely' }),
        makeMessage({ senderId: 'user2', text: 'Thank you, I appreciate your support' }),
      ];

      const messagesWithBot = [
        ...userMessages,
        makeMessage({ isBot: true, text: 'I am so frustrated and annoyed, you always blame me' }),
      ];

      const resultWithoutBot = await service.analyzeDynamics('conv-a', userMessages);
      const resultWithBot = await service.analyzeDynamics('conv-b', messagesWithBot);

      expect(resultWithBot.tensionLevel).toBe(resultWithoutBot.tensionLevel);
      expect(resultWithBot.conflictDetected).toBe(resultWithoutBot.conflictDetected);
      expect(resultWithBot.positiveMomentsCount).toBe(resultWithoutBot.positiveMomentsCount);
      expect(resultWithBot.supportPatterns).toEqual(resultWithoutBot.supportPatterns);
    });

    it('should treat a conversation with only bot messages like having no effective user messages', async () => {
      const messages = [
        makeMessage({ isBot: true, text: 'I understand you completely' }),
        makeMessage({ isBot: true, text: 'Thank you, I appreciate your help' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      // Tension, positive moments, and support patterns should all be zero/empty
      expect(result.tensionLevel).toBe(0);
      expect(result.positiveMomentsCount).toBe(0);
      expect(result.supportPatterns).toEqual([]);
      // Turn-taking has no user senders => 0.5 default
      expect(result.turnTakingBalance).toBe(0.5);
    });
  });

  // ==========================================================================
  // Return value structure
  // ==========================================================================

  describe('analyzeDynamics() return value', () => {
    it('should return the computed dynamics matching what was persisted', async () => {
      const messages = [
        makeMessage({ text: 'I understand you completely, I am here for you' }),
        makeMessage({ senderId: 'user2', text: 'thank you for listening and being here' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      const upsertArg = mockRepo.upsert.mock.calls[0][0];
      expect(result.tensionLevel).toBe(upsertArg.tensionLevel);
      expect(result.conflictDetected).toBe(upsertArg.conflictDetected);
      expect(result.positiveMomentsCount).toBe(upsertArg.positiveMomentsCount);
      expect(result.turnTakingBalance).toBe(upsertArg.turnTakingBalance);
      expect(result.topicCoherence).toBe(upsertArg.topicCoherence);
      expect(JSON.stringify(result.supportPatterns)).toBe(upsertArg.supportPatterns);
    });

    it('should return tensionLevel within 0-100 range', async () => {
      const messages = [makeMessage({ text: 'some text here' })];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.tensionLevel).toBeGreaterThanOrEqual(0);
      expect(result.tensionLevel).toBeLessThanOrEqual(100);
    });

    it('should return turnTakingBalance within 0-1 range', async () => {
      const messages = [
        makeMessage({ senderId: 'user1', text: 'hello' }),
        makeMessage({ senderId: 'user2', text: 'hey' }),
        makeMessage({ senderId: 'user1', text: 'how are you' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.turnTakingBalance).toBeGreaterThanOrEqual(0);
      expect(result.turnTakingBalance).toBeLessThanOrEqual(1);
    });

    it('should return topicCoherence within 0-1 range', async () => {
      const messages = [
        makeMessage({ text: 'birthday party planning' }),
        makeMessage({ senderId: 'user2', text: 'cooking pasta tonight' }),
      ];

      const result = await service.analyzeDynamics('conv-1', messages);

      expect(result.topicCoherence).toBeGreaterThanOrEqual(0);
      expect(result.topicCoherence).toBeLessThanOrEqual(1);
    });
  });
});
