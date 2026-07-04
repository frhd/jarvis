/**
 * AI/LLM Services Factory
 *
 * Instantiates and exports AI-related services including:
 * - Embedding client
 * - Memory services
 * - Claude client
 * - Intent classification services
 * - Escalation services
 * - Detection services
 * - Voice transcription feedback service
 * - Status handler for system and improvement status
 */

import { llmService, telegramService, contactService } from './core-services.js';
import { EmbeddingClient } from '../../clients/embedding.client.js';
import { ClaudeClient } from '../../clients/claude.client.js';
import { MemoryService } from '../memory.service.js';
import { ConsolidationService } from '../consolidation.service.js';
import { UserPreferenceService } from '../userPreference.service.js';
import { ContextManagerService } from '../contextManager.service.js';
import { SemanticCacheService } from '../semanticCache.service.js';
import { IntentClassifierService } from '../intentClassifier.service.js';
import { EnhancedIntentClassifierService } from '../enhancedIntentClassifier.service.js';
import { EscalationService } from '../escalation.service.js';
import { ImperativeDetectionService } from '../imperativeDetection.service.js';
import { FrustrationDetectorService } from '../frustrationDetector.service.js';
import { VoiceTranscriptionFeedbackService } from '../voiceTranscriptionFeedback.service.js';
import { StatusHandlerService } from '../statusHandler.service.js';
import { healthService } from '../health.service.js';
import {
  memoryRepository,
  embeddingRepository,
  conversationSummaryRepository,
  messageRepository,
  userPreferenceRepository,
  semanticCacheRepository,
} from '../../repositories/index.js';
import { appConfig } from '../../config/index.js';

// Embedding client for semantic memory
export const embeddingClient = new EmbeddingClient({
  baseUrl: appConfig.llm.baseUrl,
  model: appConfig.embedding.model,
  dimensions: appConfig.embedding.dimensions,
  timeoutMs: appConfig.embedding.timeoutMs,
});

// Memory service for conversation memory
export const memoryService = new MemoryService(
  llmService.getClient(),
  embeddingClient,
  memoryRepository,
  embeddingRepository
);

// Consolidation service for memory consolidation and conversation summarization
export const consolidationService = new ConsolidationService(
  llmService.getClient(),
  embeddingClient,
  memoryRepository,
  embeddingRepository,
  conversationSummaryRepository,
  messageRepository
);

// User preference service for preference extraction and personalization
export const userPreferenceService = new UserPreferenceService(
  llmService.getClient(),
  userPreferenceRepository
);


// Context manager service for RAG pipeline and enhanced context management
export const contextManagerService = new ContextManagerService(
  embeddingClient,
  embeddingRepository,
  memoryRepository,
  messageRepository,
  conversationSummaryRepository,
  userPreferenceService,
  contactService
);

// Semantic cache service for response caching
export const semanticCacheService = new SemanticCacheService(
  embeddingClient,
  semanticCacheRepository,
  embeddingRepository
);

// Claude client for complex tasks
export const claudeClient = new ClaudeClient({
  cliPath: appConfig.claude.cliPath,
  timeoutMs: appConfig.claude.timeoutMs,
  model: appConfig.claude.model,
  systemPrompt: appConfig.claude.systemPrompt,
});

// Intent classifier (uses Ollama via llmService)
export const intentClassifier = new IntentClassifierService(
  llmService.getClient()
);

// Enhanced intent classifier with granular taxonomy and multi-turn detection
export const enhancedIntentClassifier = new EnhancedIntentClassifierService(
  llmService.getClient()
);

// Escalation service for uncertain intent classifications
export const escalationService = new EscalationService(claudeClient);

// Imperative detection service for detecting commands and frustration
export const imperativeDetectionService = new ImperativeDetectionService();

// Frustration detector service for detecting user frustration
export const frustrationDetectorService = new FrustrationDetectorService();

// Voice transcription feedback service for user feedback during transcription
// Only instantiated when Telegram is enabled
export const voiceTranscriptionFeedbackService: VoiceTranscriptionFeedbackService | null =
  appConfig.telegram.enabled ? new VoiceTranscriptionFeedbackService(telegramService) : null;

// Status handler service for system health status requests
export const statusHandler = new StatusHandlerService(
  healthService,
  { enabled: true }
);

/**
 * Start keep-alive to prevent model unloading
 * Call this function to initiate the keep-alive process for the enhanced intent classifier
 */
export function startKeepAlive(): void {
  enhancedIntentClassifier.startKeepAlive();
}
