/**
 * AI service instances (lazy-loaded)
 *
 * Use these getters to avoid circular dependencies and eager instantiation.
 * Services are loaded on first access and cached for subsequent calls.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import type { MemoryService } from '../memory.service';
import type { ConsolidationService } from '../consolidation.service';
import type { UserPreferenceService } from '../userPreference.service';
import type { ContactService } from '../contact.service';
import type { ContextManagerService } from '../contextManager.service';
import type { SemanticCacheService } from '../semanticCache.service';
import type { EnhancedIntentClassifierService } from '../enhancedIntentClassifier.service';
import type { EscalationService } from '../escalation.service';
import type { ImperativeDetectionService } from '../imperativeDetection.service';
import type { FrustrationDetectorService } from '../frustrationDetector.service';
import type { EmbeddingClient } from '../../clients/embedding.client';
import type { ClaudeClient } from '../../clients/claude.client';

let _memoryService: MemoryService | null = null;
let _consolidationService: ConsolidationService | null = null;
let _userPreferenceService: UserPreferenceService | null = null;
let _contactService: ContactService | null = null;
let _contextManagerService: ContextManagerService | null = null;
let _semanticCacheService: SemanticCacheService | null = null;
let _enhancedIntentClassifier: EnhancedIntentClassifierService | null = null;
let _escalationService: EscalationService | null = null;
let _imperativeDetectionService: ImperativeDetectionService | null = null;
let _frustrationDetectorService: FrustrationDetectorService | null = null;
let _embeddingClient: EmbeddingClient | null = null;
let _claudeClient: ClaudeClient | null = null;

export function getMemoryService(): MemoryService {
  if (!_memoryService) {

    const { memoryService } = require('../factory/index');
    _memoryService = memoryService;
  }
  return _memoryService!;
}

export function getConsolidationService(): ConsolidationService {
  if (!_consolidationService) {

    const { consolidationService } = require('../factory/index');
    _consolidationService = consolidationService;
  }
  return _consolidationService!;
}

export function getUserPreferenceService(): UserPreferenceService {
  if (!_userPreferenceService) {

    const { userPreferenceService } = require('../factory/index');
    _userPreferenceService = userPreferenceService;
  }
  return _userPreferenceService!;
}

export function getContextManagerService(): ContextManagerService {
  if (!_contextManagerService) {

    const { contextManagerService } = require('../factory/index');
    _contextManagerService = contextManagerService;
  }
  return _contextManagerService!;
}

export function getSemanticCacheService(): SemanticCacheService {
  if (!_semanticCacheService) {

    const { semanticCacheService } = require('../factory/index');
    _semanticCacheService = semanticCacheService;
  }
  return _semanticCacheService!;
}

export function getEnhancedIntentClassifier(): EnhancedIntentClassifierService {
  if (!_enhancedIntentClassifier) {

    const { enhancedIntentClassifier } = require('../factory/index');
    _enhancedIntentClassifier = enhancedIntentClassifier;
  }
  return _enhancedIntentClassifier!;
}

export function getEscalationService(): EscalationService {
  if (!_escalationService) {

    const { escalationService } = require('../factory/index');
    _escalationService = escalationService;
  }
  return _escalationService!;
}

export function getImperativeDetectionService(): ImperativeDetectionService {
  if (!_imperativeDetectionService) {

    const { imperativeDetectionService } = require('../factory/index');
    _imperativeDetectionService = imperativeDetectionService;
  }
  return _imperativeDetectionService!;
}

export function getFrustrationDetectorService(): FrustrationDetectorService {
  if (!_frustrationDetectorService) {

    const { frustrationDetectorService } = require('../factory/index');
    _frustrationDetectorService = frustrationDetectorService;
  }
  return _frustrationDetectorService!;
}

export function getEmbeddingClient(): EmbeddingClient {
  if (!_embeddingClient) {

    const { embeddingClient } = require('../factory/index');
    _embeddingClient = embeddingClient;
  }
  return _embeddingClient!;
}

export function getClaudeClient(): ClaudeClient {
  if (!_claudeClient) {

    const { claudeClient } = require('../factory/index');
    _claudeClient = claudeClient;
  }
  return _claudeClient!;
}

export function getContactService(): ContactService {
  if (!_contactService) {

    const { contactService } = require('../factory/index');
    _contactService = contactService;
  }
  return _contactService!;
}

/**
 * Reset all AI service instances (for testing)
 */
export function resetAIServices(): void {
  _memoryService = null;
  _consolidationService = null;
  _userPreferenceService = null;
  _contactService = null;
  _contextManagerService = null;
  _semanticCacheService = null;
  _enhancedIntentClassifier = null;
  _escalationService = null;
  _imperativeDetectionService = null;
  _frustrationDetectorService = null;
  _embeddingClient = null;
  _claudeClient = null;
}
