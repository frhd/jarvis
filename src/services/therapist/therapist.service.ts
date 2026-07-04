/**
 * Therapist Service - Main Orchestration
 *
 * Coordinates all therapist mode components for 2-person group chats.
 */

import { logger } from '../../utils/logger.js';
import { featureFlags, FeatureFlagNames } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
import type { Message, User } from '../../types/index.js';
import type { TherapistModeType } from '../../db/schema.js';
import type { EnhancedIntentResult } from '../../types/intent.types.js';

import { DyadDetectorService } from './dyad-detector.service.js';
import { ConsentManagerService } from './consent-manager.service.js';
import { EmotionalAnalyzerService } from './emotional-analyzer.service.js';
import { InterventionEngineService } from './intervention-engine.service.js';
import { ResponseGeneratorService } from './response-generator.service.js';
import { DyadContextService } from './dyad-context.service.js';

import type {
  DyadInfo,
  ConsentStatus,
  InterventionDecision,
  TherapeuticResponse,
  TherapistConfig,
  ParticipantEmotionalState,
} from './types.js';
import type { ITherapistService } from '../../interfaces/therapist.js';
export type { ITherapistService };

export class TherapistService implements ITherapistService {
  private dyadDetector: DyadDetectorService;
  private consentManager: ConsentManagerService;
  private emotionalAnalyzer: EmotionalAnalyzerService;
  private interventionEngine: InterventionEngineService;
  private responseGenerator: ResponseGeneratorService;
  private dyadContextBuilder: DyadContextService;

  private intentClassifier: {
    classifyIntent(message: string, context?: string): Promise<EnhancedIntentResult | null>;
  };
  private messageRepo: {
    findRecentByChatId(chatId: string, limit: number): Promise<Message[]>;
    findRecentByConversationId(conversationId: string, limit: number): Promise<Message[]>;
  };
  private telegramService: {
    sendMessage(chatId: string, text: string, replyToMessageId?: number): Promise<{ id: number } | null>;
    setTyping(chatId: string): Promise<void>;
    markAsRead(chatId: string, messageId: number): Promise<void>;
  };
  private conversationRepo: {
    findById(id: string): Promise<{ id: string; platformConversationId: string } | null>;
    updateParticipantCount(id: string, count: number): Promise<void>;
  };
  private therapistConfigRepo: {
    findByConversationId(conversationId: string): Promise<{
    id: string;
    conversationId: string;
    enabled: boolean;
    modeType: string;
    consentedByUserIds: string;
    responseFrequency: string;
    lastInterventionAt: number | null;
    interventionsCount: number;
  } | null>;
    updateIntervention(config: {
      conversationId: string;
      lastInterventionAt: Date;
      interventionsCount: number;
    }): Promise<void>;
  };
  private memoryRepo: {
    findActiveForUser(userId: string, limit: number): Promise<Array<{ memoryType: string; content: string }>>;
  };
  private dynamicsRepo: {
    findByConversationId(conversationId: string): Promise<{
    id: string;
    conversationId: string;
    tensionLevel: number;
    conflictDetected: boolean;
    conflictType: string | null;
    positiveMomentsCount: number;
    turnTakingBalance: number;
    topicCoherence: number;
    supportPatterns: string;
    lastAnalyzedAt: number;
  } | null>;
    upsert(dynamics: {
      id: string;
      conversationId: string;
      tensionLevel: number;
      conflictDetected: boolean;
      conflictType?: string;
      positiveMomentsCount: number;
      turnTakingBalance: number;
      topicCoherence: number;
      supportPatterns: string;
      lastAnalyzedAt: number;
    }): Promise<void>;
  } | null;

  private identityService: {
    resolveUser(platform: string, platformUserId: string, metadata?: Record<string, unknown>): Promise<User>;
  };

  private llmRouter: {
    routeGenerateRequest(message: Message): Promise<{ content: string } | null>;
  };

  private userRepository: {
    findById(id: string): Promise<User | null>;
  };
  private queueRepository: {
    create(item: { id: string; messageId: string; status: string; priority: number }): Promise<void>;
  };

  private metricsService: {
    increment(name: string, tags?: Record<string, unknown>): void;
    histogram(name: string, value: number, tags?: Record<string, unknown>): void;
  } | null = null;

  constructor(
    deps: {
      dyadDetector: DyadDetectorService;
      consentManager: ConsentManagerService;
      emotionalAnalyzer: EmotionalAnalyzerService;
      interventionEngine: InterventionEngineService;
      responseGenerator: ResponseGeneratorService;
      dyadContextBuilder: DyadContextService;
      intentClassifier: TherapistService['intentClassifier'];
      messageRepo: TherapistService['messageRepo'];
      telegramService: TherapistService['telegramService'];
      conversationRepo: TherapistService['conversationRepo'];
      therapistConfigRepo: TherapistService['therapistConfigRepo'];
      memoryRepo: TherapistService['memoryRepo'];
      dynamicsRepo: TherapistService['dynamicsRepo'];
      identityService: TherapistService['identityService'];
      llmRouter: TherapistService['llmRouter'];
      userRepository: TherapistService['userRepository'];
      queueRepository: TherapistService['queueRepository'];
      metricsService?: TherapistService['metricsService'];
    },
  ) {
    this.dyadDetector = deps.dyadDetector;
    this.consentManager = deps.consentManager;
    this.emotionalAnalyzer = deps.emotionalAnalyzer;
    this.interventionEngine = deps.interventionEngine;
    this.responseGenerator = deps.responseGenerator;
    this.dyadContextBuilder = deps.dyadContextBuilder;
    this.intentClassifier = deps.intentClassifier;
    this.messageRepo = deps.messageRepo;
    this.telegramService = deps.telegramService;
    this.conversationRepo = deps.conversationRepo;
    this.therapistConfigRepo = deps.therapistConfigRepo;
    this.memoryRepo = deps.memoryRepo;
    this.dynamicsRepo = deps.dynamicsRepo ?? null;
    this.identityService = deps.identityService;
    this.llmRouter = deps.llmRouter;
    this.userRepository = deps.userRepository;
    this.queueRepository = deps.queueRepository;
    this.metricsService = deps.metricsService ?? null;
  }

  /**
   * Check if therapist mode is enabled for a conversation
   */
  async isEnabledForChat(conversationId: string): Promise<boolean> {
    // Check feature flag first
    if (!featureFlags.isEnabled(FeatureFlagNames.THERAPIST_ENABLED)) {
      return false;
    }

    const dyadInfo = await this.dyadDetector.getDyadInfo(conversationId);
    if (!dyadInfo?.isDyad) {
      return false;
    }

    // Check config
    const config = await this.therapistConfigRepo.findByConversationId(conversationId);
    return config?.enabled === true;
  }

  /**
   * Check if should intervene for a specific message
   */
  async shouldIntervene(
    conversationId: string,
    message: Message,
    recentMessages: Message[]
  ): Promise<InterventionDecision> {
    // Get therapist config
    const config = await this.getConfig(conversationId);
    if (!config || !config.enabled) {
      return {
        shouldIntervene: false,
        confidence: 0,
        reason: 'Therapist mode not enabled',
      };
    }

    // Check if dyad
    const isDyad = await this.dyadDetector.isDyad(conversationId);
    if (!isDyad) {
      return {
        shouldIntervene: false,
        confidence: 0,
        reason: 'Not a dyad (2-person group)',
      };
    }

    // Check consent
    if (featureFlags.isEnabled(FeatureFlagNames.THERAPIST_REQUIRES_CONSENT)) {
      const dyadInfo = await this.dyadDetector.getDyadInfo(conversationId);
      const consentStatus = await this.consentManager.getConsentStatus(
        conversationId,
        dyadInfo?.participants.map(p => p.userId) ?? [],
      );

      if (!consentStatus.hasAllConsent) {
        return {
          shouldIntervene: false,
          confidence: 0,
          reason: 'Both participants have not consented',
        };
      }
    }

    // Get participants
    const participants = await this.dyadDetector.getParticipants(conversationId);

    // Build dyad context
    const dyadContext = await this.dyadContextBuilder.buildDyadContext(
      conversationId,
      participants,
      recentMessages,
      { includeMemories: true, includeDynamics: true }
    );

    // Get emotional states
    let emotionalStates: ParticipantEmotionalState[] = [];
    if (featureFlags.isEnabled(FeatureFlagNames.THERAPIST_EMOTIONAL_ANALYSIS)) {
      emotionalStates = await this.emotionalAnalyzer.analyzeDyadEmotions(
        conversationId,
        recentMessages
      );
    }

    // Get conversation dynamics
    let dynamics = dyadContext.dynamics;

    // Classify intent
    const intent = await this.intentClassifier.classifyIntent(
      message.text || '',
      dyadContext.conversationContext
    );

    // Decide on intervention
    const decision = await this.interventionEngine.shouldIntervene(
      config,
      message,
      intent,
      recentMessages,
      participants,
      emotionalStates,
      dynamics
    );

    return decision;
  }
  /**
   * Process a message and generate a therapeutic response if appropriate
   */
  async processAndGenerateResponse(
    conversationId: string,
    message: Message,
    // NOTE: sender and identityOptions are reserved for future enhancements
    // such as personalized interventions based on user-specific data
    _sender: User | null,
    _identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<TherapeuticResponse | null> {
    try {
      // Check if enabled for this chat
      if (!(await this.isEnabledForChat(conversationId))) {
        return null;
      }

      // Get recent messages
      const recentMessages = await this.messageRepo.findRecentByConversationId(
        conversationId,
        appConfig.response.contextWindowSize
      );

      // Check if we should intervene
      const decision = await this.shouldIntervene(
        conversationId,
        message,
        recentMessages
      );

      if (!decision.shouldIntervene) {
        logger.debug('[Therapist] Not intervening', {
          conversationId,
          reason: decision.reason,
        });
        return null;
      }

      // Build context for intervention
      const participants = await this.dyadDetector.getParticipants(conversationId);

      const dyadContext = await this.dyadContextBuilder.buildDyadContext(
        conversationId,
        participants,
        recentMessages,
        { includeMemories: true, includeDynamics: true }
      );

      // Get emotional states
      const emotionalStates = featureFlags.isEnabled(FeatureFlagNames.THERAPIST_EMOTIONAL_ANALYSIS)
        ? await this.emotionalAnalyzer.analyzeDyadEmotions(
            conversationId,
            recentMessages
          )
        : [];

      const dynamics = dyadContext.dynamics;

      // Classify intent
      const intent = await this.intentClassifier.classifyIntent(
        message.text || '',
        dyadContext.conversationContext
      );

      // Get config for intervention type
      const config = await this.getConfig(conversationId);

      // Build intervention context
      const interventionContext = {
        conversationId,
        messageId: message.id,
        interventionType: decision.interventionType!,
        confidence: decision.confidence,
        reason: decision.reason,
        recentMessages,
        participants,
        dynamics,
      };

      // Generate response
      const response = await this.responseGenerator.generateResponse(interventionContext);

      // Record intervention
      await this.interventionEngine.recordIntervention(conversationId);

      // Update therapist config with new intervention timestamp
      await this.therapistConfigRepo.updateIntervention({
        conversationId,
        lastInterventionAt: new Date(),
        interventionsCount: (config?.interventionsCount || 0) + 1,
      });

      // Send response
      const conversation = await this.conversationRepo.findById(conversationId);
      if (conversation && response.content) {
        await this.telegramService.sendMessage(
          conversation.platformConversationId,
          response.content,
          message.telegramMessageId
        );
      }

      // Record metrics
      this.metricsService?.increment('therapist.intervention', {
        type: decision.interventionType,
        conversationId,
      });

      this.metricsService?.histogram('therapist.confidence', decision.confidence, {
        conversationId,
      });

      logger.info('[Therapist] Intervention sent', {
        conversationId,
        type: decision.interventionType,
        confidence: decision.confidence,
      });

      return response;
    } catch (error) {
      logger.error('[Therapist] Failed to process message', {
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
  /**
   * Get therapist config
   */
  private async getConfig(conversationId: string): Promise<TherapistConfig | null> {
    const config = await this.therapistConfigRepo.findByConversationId(conversationId);

    if (!config) {
      return null;
    }

    return {
      conversationId: config.conversationId,
      enabled: config.enabled,
      modeType: config.modeType as TherapistModeType,
      consentedByUserIds: JSON.parse(config.consentedByUserIds),
      responseFrequency: config.responseFrequency as 'minimal' | 'moderate' | 'active',
      lastInterventionAt: config.lastInterventionAt
        ? new Date(config.lastInterventionAt * 1000)
        : undefined,
      interventionsCount: config.interventionsCount,
    };
  }
}
