/**
 * Therapist Services Factory
 *
 * Instantiates therapist-related services, gated behind the THERAPIST_ENABLED flag.
 * Uses type assertions where repository return types (Date, boolean) don't match
 * service constructor inline types (number, number) — these are structural mismatches
 * from the initial service authoring that will be normalized in a later phase.
 */

import { featureFlags, FeatureFlagNames } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
import { ClaudeClient } from '../../clients/claude.client.js';
import { createLogger } from '../../utils/logger.js';

import { DyadDetectorService } from '../therapist/dyad-detector.service.js';
import { ConsentManagerService } from '../therapist/consent-manager.service.js';
import { EmotionalAnalyzerService } from '../therapist/emotional-analyzer.service.js';
import { InterventionEngineService } from '../therapist/intervention-engine.service.js';
import { ResponseGeneratorService } from '../therapist/response-generator.service.js';
import { DyadContextService } from '../therapist/dyad-context.service.js';
import { ConversationDynamicsAnalyzerService } from '../therapist/dynamics-analyzer.service.js';
import { TherapistService } from '../therapist/therapist.service.js';

import {
  therapistModeRepository,
  emotionalStateRepository,
  conversationDynamicsRepository,
  messageRepository,
  memoryRepository,
  userRepository,
  senderRepository,
} from '../../repositories/index.js';

import { unifiedConversationRepository, chatRepository } from '../../repositories/index.js';
import { identityService } from './core-services.js';
import { PLATFORM_TELEGRAM } from '../../config/platforms.js';
import type { IIdentityResolver } from '../therapist/consent-manager.service.js';
import { resolveRecentMessagesForConversation } from '../therapist/resolve-conversation-messages.js';
import { enhancedIntentClassifier } from './ai-services.js';
import { metricsService } from './monitoring-services.js';
import { llmService, telegramService } from './core-services.js';

const logger = createLogger('TherapistFactory');

/**
 * Adapter: adds updateParticipantCount to conversation repository
 */
function createConversationRepoAdapter() {
  return {
    findById: (id: string) => unifiedConversationRepository.findById(id),
    updateParticipantCount: async (id: string, count: number) => {
      // Update via the repository's update method
      await unifiedConversationRepository.update(id, { participantCount: count } as any);
    },
  };
}

/**
 * Adapter: adds findRecentByConversationId to message repository
 */
function createMessageRepoAdapter() {
  return {
    findRecentByChatId: (chatId: string, limit: number) =>
      messageRepository.findRecentByChatId(chatId, limit),
    findRecentByConversationId: (conversationId: string, limit: number) =>
      resolveRecentMessagesForConversation(
        {
          conversations: unifiedConversationRepository,
          chats: chatRepository,
          messages: messageRepository,
        },
        conversationId,
        limit
      ),
  };
}

/**
 * Adapter: wraps LLMClient.chat() into the shape ResponseGeneratorService expects
 */
function createLlmClientAdapter() {
  const client = llmService.getClient();
  return {
    chat: async (request: {
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
    }) => {
      const result = await client.chat(
        request.messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      );
      return { content: result.content };
    },
  };
}

/**
 * Adapter: wraps the Claude CLI client into the shape ResponseGeneratorService expects.
 *
 * Therapeutic responses benefit from a stronger model than the local Ollama default, so
 * the therapist routes through Claude (CLAUDE_MODEL, e.g. opus). The system message from
 * the response generator (the therapist persona + safety guidance) is delivered as the
 * CLI `context` prefix; we use a dedicated client with no construction-time systemPrompt
 * so the general Jarvis persona doesn't bleed into the therapist framing.
 */
function createClaudeClientAdapter() {
  const client = new ClaudeClient({
    cliPath: appConfig.claude.cliPath,
    timeoutMs: appConfig.claude.timeoutMs,
    model: appConfig.therapist.model,
    systemPrompt: '',
  });

  return {
    chat: async (request: {
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
    }) => {
      const systemPrompt = request.messages
        .filter(m => m.role === 'system')
        .map(m => m.content)
        .join('\n\n');
      const userPrompt = request.messages
        .filter(m => m.role !== 'system')
        .map(m => m.content)
        .join('\n\n');

      const result = await client.chat(userPrompt, systemPrompt || undefined);

      // Throw on failure so ResponseGeneratorService falls back instead of sending an
      // empty message (the Ollama adapter likewise rejects on error).
      if (!result.success) {
        throw new Error(result.error || 'Claude CLI returned no content');
      }

      return { content: result.content };
    },
  };
}

// ============================================================================
// Service creation (null when disabled)
// ============================================================================

function createTherapistServices() {
  if (!featureFlags.isEnabled(FeatureFlagNames.THERAPIST_ENABLED)) {
    logger.info('[TherapistFactory] Therapist mode disabled — skipping initialization');
    return null;
  }

  const conversationRepoAdapter = createConversationRepoAdapter();
  const messageRepoAdapter = createMessageRepoAdapter();
  // Prefer Claude for therapeutic responses (better at nuance and safety handling);
  // fall back to the local Ollama client when Claude is disabled.
  const llmClientAdapter = appConfig.claude.enabled
    ? createClaudeClientAdapter()
    : createLlmClientAdapter();
  logger.info('[TherapistFactory] Response generator LLM backend', {
    backend: appConfig.claude.enabled ? 'claude' : 'ollama',
    model: appConfig.claude.enabled ? appConfig.therapist.model : appConfig.llm.model,
  });

  // Type assertions (as any) are used below because service constructors use
  // inline structural types with number timestamps while repos return Date objects.
  // This will be cleaned up when services are updated to use the interface types.

  const dyadDetector = new DyadDetectorService(
    messageRepoAdapter as any,
    conversationRepoAdapter as any,
    identityService,
    therapistModeRepository as any,
  );

  // Bridges the two identity spaces used by therapist mode: consent is stored
  // as unified users.id, but detected participants are raw senders.id. Both
  // resolve to a Telegram ID, which is used as the canonical comparison key.
  const consentIdentityResolver: IIdentityResolver = {
    async toTelegramId(id: string): Promise<string | null> {
      // Most participant ids are senderIds; try that first.
      const sender = await senderRepository.findById(id);
      if (sender?.telegramId) {
        return sender.telegramId;
      }
      // Otherwise treat it as a unified userId and resolve its Telegram identity.
      const identities = await identityService.getIdentitiesForUser(id);
      const telegram = identities.find(i => i.platform === PLATFORM_TELEGRAM);
      return telegram?.platformUserId ?? null;
    },
  };

  const consentManager = new ConsentManagerService(
    therapistModeRepository as any,
    consentIdentityResolver,
  );

  const emotionalAnalyzer = new EmotionalAnalyzerService(
    emotionalStateRepository as any,
  );

  const interventionEngine = new InterventionEngineService({
    mentionHandles: appConfig.therapist.mentionHandles,
  });

  const responseGenerator = new ResponseGeneratorService(
    llmClientAdapter,
  );

  const dynamicsAnalyzer = new ConversationDynamicsAnalyzerService(
    conversationDynamicsRepository as any,
  );

  const dyadContextBuilder = new DyadContextService(
    memoryRepository as any,
    emotionalAnalyzer,
    dynamicsAnalyzer,
  );

  const therapistService = new TherapistService({
    dyadDetector,
    consentManager,
    emotionalAnalyzer,
    interventionEngine,
    responseGenerator,
    dyadContextBuilder,
    intentClassifier: enhancedIntentClassifier,
    messageRepo: messageRepoAdapter as any,
    telegramService,
    conversationRepo: conversationRepoAdapter as any,
    therapistConfigRepo: therapistModeRepository as any,
    memoryRepo: memoryRepository as any,
    dynamicsRepo: conversationDynamicsRepository as any,
    identityService,
    llmRouter: { routeGenerateRequest: async () => null },
    userRepository,
    queueRepository: { create: async () => {} } as any,
    metricsService,
  });

  logger.info('[TherapistFactory] Therapist services initialized');

  return {
    dyadDetector,
    consentManager,
    emotionalAnalyzer,
    interventionEngine,
    responseGenerator,
    dyadContextBuilder,
    therapistService,
  };
}

const services = createTherapistServices();

export const dyadDetectorService = services?.dyadDetector ?? null;
export const consentManagerService = services?.consentManager ?? null;
export const emotionalAnalyzerService = services?.emotionalAnalyzer ?? null;
export const interventionEngineService = services?.interventionEngine ?? null;
export const responseGeneratorService = services?.responseGenerator ?? null;
export const dyadContextBuilderService = services?.dyadContextBuilder ?? null;
export const therapistService = services?.therapistService ?? null;
