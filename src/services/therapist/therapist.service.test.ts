import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies BEFORE importing the service
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../config/feature-flags.js', () => ({
  featureFlags: {
    isEnabled: vi.fn(() => true),
  },
  FeatureFlagNames: {
    THERAPIST_ENABLED: 'THERAPIST_ENABLED',
    THERAPIST_REQUIRES_CONSENT: 'THERAPIST_REQUIRES_CONSENT',
    THERAPIST_EMOTIONAL_ANALYSIS: 'THERAPIST_EMOTIONAL_ANALYSIS',
  },
}));

vi.mock('../../config/index.js', () => ({
  appConfig: {
    response: {
      contextWindowSize: 50,
    },
  },
}));

// Import after mocks
import { TherapistService } from './therapist.service.js';
import { DyadDetectorService } from './dyad-detector.service.js';
import { ConsentManagerService } from './consent-manager.service.js';
import { EmotionalAnalyzerService } from './emotional-analyzer.service.js';
import { InterventionEngineService } from './intervention-engine.service.js';
import { ResponseGeneratorService } from './response-generator.service.js';
import { DyadContextService } from './dyad-context.service.js';
import type { EnhancedIntentResult } from '../../types/intent.types.js';
import type { Message, User } from '../../types/index.js';
import type { TherapistModeType } from '../../db/schema.js';
import type {
  DyadInfo,
  ConsentStatus,
  InterventionDecision,
  TherapeuticResponse,
  TherapistConfig,
  ParticipantEmotionalState,
} from './types.js';

// Mock dependencies
const mockDyadDetector = {
  getDyadInfo: vi.fn(),
  isDyad: vi.fn(),
  getParticipants: vi.fn(),
} as unknown as DyadDetectorService;

const mockConsentManager = {
  getConsentStatus: vi.fn(),
} as unknown as ConsentManagerService;

const mockEmotionalAnalyzer = {
  analyzeDyadEmotions: vi.fn(),
} as unknown as EmotionalAnalyzerService;

const mockInterventionEngine = {
  shouldIntervene: vi.fn(),
  recordIntervention: vi.fn(),
} as unknown as InterventionEngineService;

const mockResponseGenerator = {
  generateResponse: vi.fn(),
} as unknown as ResponseGeneratorService;

const mockDyadContextBuilder = {
  buildDyadContext: vi.fn(),
} as unknown as DyadContextService;

const mockIntentClassifier = {
  classifyIntent: vi.fn(),
} as any;

const mockMessageRepo = {
  findRecentByConversationId: vi.fn(),
  findRecentByChatId: vi.fn(),
} as any;

const mockTelegramService = {
  sendMessage: vi.fn(),
  setTyping: vi.fn(),
  markAsRead: vi.fn(),
} as any;

const mockConversationRepo = {
  findById: vi.fn(),
  updateParticipantCount: vi.fn(),
} as any;

const mockTherapistConfigRepo = {
  findByConversationId: vi.fn(),
  updateIntervention: vi.fn(),
} as any;

const mockMemoryRepo = {
  findActiveForUser: vi.fn(),
} as any;

const mockDynamicsRepo = {
  findByConversationId: vi.fn(),
  upsert: vi.fn(),
} as any;

const mockIdentityService = {
  resolveUser: vi.fn(),
} as any;

const mockLlmRouter = {
  routeGenerateRequest: vi.fn(),
} as any;

const mockUserRepository = {
  findById: vi.fn(),
} as any;

const mockQueueRepository = {
  create: vi.fn(),
} as any;

const mockMetricsService = {
  increment: vi.fn(),
  histogram: vi.fn(),
} as any;

// Create therapist service instance
const service = new TherapistService({
  dyadDetector: mockDyadDetector,
  consentManager: mockConsentManager,
  emotionalAnalyzer: mockEmotionalAnalyzer,
  interventionEngine: mockInterventionEngine,
  responseGenerator: mockResponseGenerator,
  dyadContextBuilder: mockDyadContextBuilder,
  intentClassifier: mockIntentClassifier,
  messageRepo: mockMessageRepo,
  telegramService: mockTelegramService,
  conversationRepo: mockConversationRepo,
  therapistConfigRepo: mockTherapistConfigRepo,
  memoryRepo: mockMemoryRepo,
  dynamicsRepo: mockDynamicsRepo,
  identityService: mockIdentityService,
  llmRouter: mockLlmRouter,
  userRepository: mockUserRepository,
  queueRepository: mockQueueRepository,
  metricsService: mockMetricsService,
});

const mockLogger = (await import('../../utils/logger.js')).logger;
const mockFeatureFlags = (await import('../../config/feature-flags.js')).featureFlags;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isEnabledForChat', () => {
  it('should return false when feature flag is off', async () => {
    mockFeatureFlags.isEnabled.mockReturnValue(false);

    const result = await service.isEnabledForChat('conv_123');

    expect(result).toBe(false);
    expect(mockFeatureFlags.isEnabled).toHaveBeenCalledWith('THERAPIST_ENABLED');
  });

  it('should return false when not a dyad', async () => {
    mockFeatureFlags.isEnabled.mockReturnValue(true);
    mockDyadDetector.getDyadInfo.mockResolvedValue({ isDyad: false } as DyadInfo);

    const result = await service.isEnabledForChat('conv_123');

    expect(result).toBe(false);
    expect(mockDyadDetector.getDyadInfo).toHaveBeenCalledWith('conv_123');
  });

  it('should return false when config not found', async () => {
    mockFeatureFlags.isEnabled.mockReturnValue(true);
    mockDyadDetector.getDyadInfo.mockResolvedValue({ isDyad: true } as DyadInfo);
    mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

    const result = await service.isEnabledForChat('conv_123');

    expect(result).toBe(false);
    expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv_123');
  });

  it('should return false when config is disabled', async () => {
    mockFeatureFlags.isEnabled.mockReturnValue(true);
    mockDyadDetector.getDyadInfo.mockResolvedValue({ isDyad: true } as DyadInfo);
    mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
      id: 'config_123',
      conversationId: 'conv_123',
      enabled: false,
      modeType: 'supportive' as TherapistModeType,
      consentedByUserIds: '[]',
      responseFrequency: 'moderate',
      lastInterventionAt: null,
      interventionsCount: 0,
    });

    const result = await service.isEnabledForChat('conv_123');

    expect(result).toBe(false);
    expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv_123');
  });

  it('should return true when all conditions are met', async () => {
    mockFeatureFlags.isEnabled.mockReturnValue(true);
    mockDyadDetector.getDyadInfo.mockResolvedValue({ isDyad: true } as DyadInfo);
    mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
      id: 'config_123',
      conversationId: 'conv_123',
      enabled: true,
      modeType: 'supportive' as TherapistModeType,
      consentedByUserIds: '[]',
      responseFrequency: 'moderate',
      lastInterventionAt: null,
      interventionsCount: 0,
    });

    const result = await service.isEnabledForChat('conv_123');

    expect(result).toBe(true);
    expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv_123');
  });
});

describe('processAndGenerateResponse', () => {
  const mockMessage: Message = {
    id: 'msg_123',
    text: 'Hello world',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    chatId: 'chat_123',
    senderId: 'user_123',
    telegramMessageId: 123,
    mediaType: null,
    mediaPath: null,
    rawJson: '{}',
    transcript: null,
    transcriptStatus: null,
  };

  const mockUser: User = {
    id: 'user_123',
    displayName: 'Test User',
    platformUserId: 'telegram_123',
    platform: 'telegram',
  };

  beforeEach(() => {
    // Reset all mocks for each test
    mockFeatureFlags.isEnabled.mockReturnValue(true);
    mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);
    mockMessageRepo.findRecentByConversationId.mockResolvedValue([]);
  });

  it('should return null when not enabled', async () => {
    service.isEnabledForChat = vi.fn().mockResolvedValue(false);

    const result = await service.processAndGenerateResponse('conv_123', mockMessage, mockUser);

    expect(result).toBe(null);
    expect(service.isEnabledForChat).toHaveBeenCalledWith('conv_123');
  });

  it('should return null when should not intervene', async () => {
    service.isEnabledForChat = vi.fn().mockResolvedValue(true);
    mockMessageRepo.findRecentByConversationId.mockResolvedValue([mockMessage]);

    // Mock shouldIntervene to return false
    service['shouldIntervene'] = vi.fn().mockResolvedValue({
      shouldIntervene: false,
      confidence: 0,
      reason: 'Not needed',
    });

    const result = await service.processAndGenerateResponse('conv_123', mockMessage, mockUser);

    expect(result).toBe(null);
    expect(mockLogger.debug).toHaveBeenCalledWith('[Therapist] Not intervening', {
      conversationId: 'conv_123',
      reason: 'Not needed',
    });
  });

  it('should successfully intervene and send response', async () => {
    service.isEnabledForChat = vi.fn().mockResolvedValue(true);

    // Mock recent messages
    const mockRecentMessages = [mockMessage];
    mockMessageRepo.findRecentByConversationId.mockResolvedValue(mockRecentMessages);

    // Mock shouldIntervene to return positive decision
    const mockDecision: InterventionDecision = {
      shouldIntervene: true,
      confidence: 0.8,
      reason: 'Detected emotional distress',
      interventionType: 'reflective',
    };
    service['shouldIntervene'] = vi.fn().mockResolvedValue(mockDecision);

    // Mock participants
    const mockParticipants = [
      { userId: 'user_123', role: 'sender' },
      { userId: 'user_456', role: 'recipient' },
    ];
    mockDyadDetector.getParticipants.mockResolvedValue(mockParticipants);

    // Mock dyad context
    const mockDyadContext = {
      conversationContext: 'Recent conversation about relationship issues',
      dynamics: {
        tensionLevel: 0.7,
        conflictDetected: true,
        conflictType: 'misunderstanding',
        positiveMomentsCount: 2,
        turnTakingBalance: 0.8,
        topicCoherence: 0.6,
        supportPatterns: 'active listening',
        lastAnalyzedAt: Date.now(),
      },
    };
    mockDyadContextBuilder.buildDyadContext.mockResolvedValue(mockDyadContext);

    // Mock emotional states
    const mockEmotionalStates: ParticipantEmotionalState[] = [
      {
        userId: 'user_123',
        sentiment: 'negative',
        emotions: { sadness: 0.7, anger: 0.3 },
        dominantEmotion: 'sadness',
      },
    ];
    mockEmotionalAnalyzer.analyzeDyadEmotions.mockResolvedValue(mockEmotionalStates);

    // Mock intent classification
    mockIntentClassifier.classifyIntent.mockResolvedValue({
      intent: 'emotional_distress',
      confidence: 0.9,
    } as EnhancedIntentResult);

    // Mock config
    const mockConfig: TherapistConfig = {
      conversationId: 'conv_123',
      enabled: true,
      modeType: 'supportive' as TherapistModeType,
      consentedByUserIds: [],
      responseFrequency: 'moderate',
      interventionsCount: 0,
    };
    service['getConfig'] = vi.fn().mockResolvedValue(mockConfig);

    // Mock generated response
    const mockResponse: TherapeuticResponse = {
      content: "I understand this is difficult for you. Can you tell me more about what's bothering you?",
      interventionType: 'reflective',
      confidence: 0.85,
    };
    mockResponseGenerator.generateResponse.mockResolvedValue(mockResponse);

    // Mock conversation
    const mockConversation = {
      id: 'conv_123',
      platformConversationId: '123456789',
    };
    mockConversationRepo.findById.mockResolvedValue(mockConversation);

    // Mock config repo update
    mockTherapistConfigRepo.updateIntervention.mockResolvedValue();

    const result = await service.processAndGenerateResponse('conv_123', mockMessage, mockUser);

    expect(result).toEqual(mockResponse);
    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      '123456789',
      "I understand this is difficult for you. Can you tell me more about what's bothering you?",
      123
    );
    expect(mockTherapistConfigRepo.updateIntervention).toHaveBeenCalledWith({
      conversationId: 'conv_123',
      lastInterventionAt: expect.any(Date),
      interventionsCount: 1,
    });
    expect(mockMetricsService.increment).toHaveBeenCalledWith('therapist.intervention', {
      type: 'reflective',
      conversationId: 'conv_123',
    });
    expect(mockMetricsService.histogram).toHaveBeenCalledWith('therapist.confidence', 0.8, {
      conversationId: 'conv_123',
    });
    expect(mockLogger.info).toHaveBeenCalledWith('[Therapist] Intervention sent', {
      conversationId: 'conv_123',
      type: 'reflective',
      confidence: 0.8,
    });
  });

  it('should return null and log error when error occurs', async () => {
    service.isEnabledForChat = vi.fn().mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await service.processAndGenerateResponse('conv_123', mockMessage, mockUser);

    expect(result).toBe(null);
    expect(mockLogger.error).toHaveBeenCalledWith('[Therapist] Failed to process message', {
      conversationId: 'conv_123',
      error: 'Test error',
    });
  });
});