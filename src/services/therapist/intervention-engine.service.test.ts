import { beforeEach, afterEach, vi } from 'vitest';
import { InterventionEngineService } from './intervention-engine.service.js';
import type { TherapistConfig } from './types.js';
import type { EnhancedIntentResult } from '../../types/intent.types.js';
import type { DyadParticipant, ParticipantEmotionalState, ConversationDynamics } from './types.js';

// Mock logger to suppress output
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Constants from service
const MIN_MESSAGES_BEFORE_INTERVENTION = 3;
const DEFAULT_MAX_RESPONSES_PER_HOUR = 2;
const DEFAULT_COOLDOWN_MS = 600000;
const TENSION_THRESHOLD = 60;
const CELEBRATION_CONFIDENCE_THRESHOLD = 0.8;

describe('InterventionEngineService', () => {
  let service: InterventionEngineService;
  let mockConfig: TherapistConfig;
  const mockMessage = {
    id: 'msg1',
    text: 'I really feel frustrated with this situation',
    senderId: 'user1',
    chatId: 'chat1',
    createdAt: new Date(),
    telegramMessageId: 1,
    rawJson: '{}',
  };

  beforeEach(() => {
    service = new InterventionEngineService();
    mockConfig = {
      conversationId: 'test_conversation',
      enabled: true,
      modeType: 'therapist' as const,
      consentedByUserIds: ['user1', 'user2'],
      responseFrequency: 'balanced' as const,
      interventionsCount: 0,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldIntervene', () => {
    it('should not intervene when below min messages', async () => {
      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        null,
        [], // recent messages
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('Not enough messages yet (0/3)');
    });

    it('should not intervene during cooldown', async () => {
      const oneHourAgo = new Date(Date.now() - 1000 * 60 * 5); // 5 minutes ago
      const cooldownConfig = {
        ...mockConfig,
        lastInterventionAt: oneHourAgo,
      };

      const result = await service.shouldIntervene(
        cooldownConfig,
        mockMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toBe('Cooldown period active');
      expect(result.cooldownRemaining).toBeDefined();
      expect(result.cooldownRemaining!).toBeGreaterThan(0);
    });

    it('should not intervene when rate limit reached', async () => {
      // Record multiple interventions
      await service.recordIntervention('test_conversation');
      await service.recordIntervention('test_conversation');
      await service.recordIntervention('test_conversation');

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('Rate limit reached (3/2 per hour)');
    });

    it('should return DE_ESCALATION for high tension', async () => {
      const dynamics: ConversationDynamics = {
        conversationId: 'test_conversation',
        tensionLevel: 75,
        conflictDetected: true,
        conflictType: 'escalated_argument',
        positiveMomentsCount: 0,
        turnTakingBalance: 0.5,
        topicCoherence: 0.7,
        supportPatterns: [],
        lastAnalyzedAt: new Date(),
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        dynamics
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('DE_ESCALATION');
      expect(result.confidence).toBe(0.9);
      expect(result.reason).toContain('High tension level detected');
    });

    it('should return BRIDGE_BUILDING for conflict moment intent', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'conflict',
        childIntent: 'conflict_moment',
        confidence: 0.85,
        entities: [],
        intentDetected: true,
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('BRIDGE_BUILDING');
      expect(result.confidence).toBe(0.85);
      expect(result.reason).toBe('Conflict moment detected from intent');
    });

    it('should return VALIDATION for emotional expression with high intensity', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'emotional_expression',
        childIntent: 'emotional_expression',
        confidence: 0.9,
        entities: [],
        intentDetected: true,
      };

      const emotionalStates: ParticipantEmotionalState[] = [
        {
          userId: 'user1',
          analysis: {
            primaryEmotion: 'anger',
            intensity: 75,
            trend: 'stable',
            confidence: 0.8,
            indicators: ['frustrated', 'angry'],
          },
          lastAnalyzedAt: new Date(),
        },
      ];

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        emotionalStates,
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('VALIDATION');
      expect(result.confidence).toBe(0.9);
      expect(result.reason).toBe('Strong emotional expression detected');
    });

    it('should not intervene for emotional expression with low intensity', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'emotional_expression',
        childIntent: 'emotional_expression',
        confidence: 0.9,
        entities: [],
        intentDetected: true,
      };

      const emotionalStates: ParticipantEmotionalState[] = [
        {
          userId: 'user1',
          analysis: {
            primaryEmotion: 'sadness',
            intensity: 25,
            trend: 'stable',
            confidence: 0.8,
            indicators: ['mild sadness'],
          },
          lastAnalyzedAt: new Date(),
        },
      ];

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        emotionalStates,
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toBe('No intervention triggers met');
    });

    it('should return VALIDATION for seeking validation intent', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'request_support',
        childIntent: 'seeking_validation',
        confidence: 0.75,
        entities: [],
        intentDetected: true,
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('VALIDATION');
      expect(result.confidence).toBe(0.75);
      expect(result.reason).toBe('User seeking validation');
    });

    it('should return CELEBRATION for celebration moment', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'positive',
        childIntent: 'celebration_moment',
        confidence: 0.9,
        entities: [],
        intentDetected: true,
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('CELEBRATION');
      expect(result.confidence).toBe(0.9);
      expect(result.reason).toBe('Positive celebration moment detected');
    });

    it('should not intervene for celebration with low confidence', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'positive',
        childIntent: 'celebration_moment',
        confidence: 0.7, // Below threshold
        entities: [],
        intentDetected: true,
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toBe('No intervention triggers met');
    });

    it('should return ACTIVE_LISTENING for support request', async () => {
      const intent: EnhancedIntentResult = {
        intent: 'request_support',
        childIntent: 'support_request',
        confidence: 0.8,
        entities: [],
        intentDetected: true,
      };

      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        intent,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('ACTIVE_LISTENING');
      expect(result.confidence).toBe(0.8);
      expect(result.reason).toBe('Support request detected');
    });

    it('should not intervene when no triggers are met', async () => {
      const result = await service.shouldIntervene(
        mockConfig,
        mockMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toBe('No intervention triggers met');
    });
  });

  describe('shouldIntervene — direct @mention bypass', () => {
    let mentionService: InterventionEngineService;
    const mentionMessage = {
      ...mockMessage,
      text: '@jarvis_1337 helf uns die Probleme klarzumachen',
    };

    beforeEach(() => {
      mentionService = new InterventionEngineService({ mentionHandles: ['jarvis', 'jarvis_1337'] });
    });

    it('responds when mentioned even below min messages', async () => {
      const result = await mentionService.shouldIntervene(
        mockConfig,
        mentionMessage,
        null,
        [], // no context yet
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('ACTIVE_LISTENING');
      expect(result.reason).toBe('Directly mentioned');
    });

    it('responds when mentioned even during cooldown', async () => {
      const cooldownConfig = {
        ...mockConfig,
        lastInterventionAt: new Date(Date.now() - 1000 * 60 * 2), // 2 min ago
      };

      const result = await mentionService.shouldIntervene(
        cooldownConfig,
        mentionMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.reason).toBe('Directly mentioned');
    });

    it('responds when mentioned even when rate limit reached', async () => {
      await mentionService.recordIntervention('test_conversation');
      await mentionService.recordIntervention('test_conversation');
      await mentionService.recordIntervention('test_conversation');

      const result = await mentionService.shouldIntervene(
        mockConfig,
        mentionMessage,
        null,
        Array(MIN_MESSAGES_BEFORE_INTERVENTION).fill(mockMessage),
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.reason).toBe('Directly mentioned');
    });

    it('prefers a specific trigger type over the mention default', async () => {
      const dynamics: ConversationDynamics = {
        conversationId: 'test_conversation',
        tensionLevel: 75,
        conflictDetected: true,
        conflictType: 'escalated_argument',
        positiveMomentsCount: 0,
        turnTakingBalance: 0.5,
        topicCoherence: 0.7,
        supportPatterns: [],
        lastAnalyzedAt: new Date(),
      };

      const result = await mentionService.shouldIntervene(
        mockConfig,
        mentionMessage,
        null,
        [], // below min, but mentioned → not blocked
        [],
        [],
        dynamics
      );

      expect(result.shouldIntervene).toBe(true);
      expect(result.interventionType).toBe('DE_ESCALATION');
    });

    it('does not bypass when handles are not configured', async () => {
      // Default service has no mention handles
      const result = await service.shouldIntervene(
        mockConfig,
        mentionMessage,
        null,
        [], // below min
        [],
        [],
        null
      );

      expect(result.shouldIntervene).toBe(false);
      expect(result.reason).toContain('Not enough messages yet');
    });
  });

  describe('recordIntervention', () => {
    it('should record intervention and prune old timestamps', async () => {
      const oldTimestamps = Array.from({ length: 5 }, (_, i) => Date.now() - (i * 2 + 1) * 1000 * 60 * 60);

      // Set up initial timestamps
      const interventionService = new InterventionEngineService();
      const map = (interventionService as any).interventionTimestamps;
      map.set('test_conversation', oldTimestamps);

      // Record new intervention
      await interventionService.recordIntervention('test_conversation');

      // Get recorded timestamps
      const recordedTimestamps = Array.from(map.get('test_conversation'));
      const oneHourAgo = Date.now() - 3600000;
      const recentCount = recordedTimestamps.filter(t => t > oneHourAgo).length;

      expect(recentCount).toBe(1); // Only the new timestamp is within the last hour
    });
  });

  describe('getRemainingCooldown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return 0 when no previous intervention', () => {
      const result = service.getRemainingCooldown(mockConfig);
      expect(result).toBe(0);
    });

    it('should return positive cooldown for recent intervention', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const cooldownConfig = {
        ...mockConfig,
        lastInterventionAt: fiveMinutesAgo,
      };

      const result = service.getRemainingCooldown(cooldownConfig);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(DEFAULT_COOLDOWN_MS);
    });

    it('should return 0 for old intervention', () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const cooldownConfig = {
        ...mockConfig,
        lastInterventionAt: thirtyMinutesAgo,
      };

      const result = service.getRemainingCooldown(cooldownConfig);
      expect(result).toBe(0);
    });

    it('should respect custom cooldown duration', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const cooldownConfig = {
        ...mockConfig,
        lastInterventionAt: fiveMinutesAgo,
      };

      // Create service with custom cooldown
      const customService = new InterventionEngineService({ cooldownMs: 10 * 60 * 1000 }); // 10 minutes
      const result = customService.getRemainingCooldown(cooldownConfig);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10 * 60 * 1000);
    });
  });
});