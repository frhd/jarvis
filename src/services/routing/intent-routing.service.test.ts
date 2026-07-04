import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentRoutingService, IntentRoutingResult } from './intent-routing.service.js';
import type { IntentClassifierService, IntentClassificationResult, IntentCategory } from '../intentClassifier.service.js';
import type { EnhancedIntentClassifierService } from '../enhancedIntentClassifier.service.js';
import type { IntentLogRepository } from '../../repositories/intentLog.repository.js';
import type { EnhancedIntentResult, ParentIntent, ChildIntent } from '../../types/intent.types.js';

// ============================================================================
// Helpers
// ============================================================================

const createMockEnhancedResult = (overrides?: Partial<EnhancedIntentResult>): EnhancedIntentResult => ({
  parentIntent: 'greeting',
  childIntent: 'simple_greeting',
  confidence: 0.95,
  confidenceLevel: 'high',
  shouldEscalate: false,
  isFollowUp: false,
  referencesContext: false,
  suggestedContextDepth: 0,
  requiresWebSearch: false,
  requiresComplexReasoning: false,
  canUseCache: true,
  durationMs: 10,
  classificationMethod: 'pattern',
  ...overrides,
});

const createMockLegacyResult = (overrides?: Partial<IntentClassificationResult>): IntentClassificationResult => ({
  intent: 'general_chat',
  confidence: 0.8,
  durationMs: 50,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('IntentRoutingService', () => {
  let service: IntentRoutingService;
  let mockIntentClassifier: Partial<IntentClassifierService>;
  let mockEnhancedClassifier: Partial<EnhancedIntentClassifierService>;
  let mockIntentLogRepo: Partial<IntentLogRepository>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIntentClassifier = {
      classifyIntent: vi.fn().mockResolvedValue(createMockLegacyResult()),
    };

    mockEnhancedClassifier = {
      classifyIntent: vi.fn().mockResolvedValue(createMockEnhancedResult()),
    };

    mockIntentLogRepo = {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    };

    service = new IntentRoutingService(
      mockIntentClassifier as IntentClassifierService,
      mockEnhancedClassifier as EnhancedIntentClassifierService,
      mockIntentLogRepo as IntentLogRepository,
      {
        useEnhancedClassifier: true,
        enableIntentLogging: true,
      }
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // classifyIntent - Enhanced Classifier Success Path
  // ==========================================================================

  describe('classifyIntent - enhanced classifier success', () => {
    it('should use enhanced classifier when enabled', async () => {
      const result = await service.classifyIntent('hello');

      expect(mockEnhancedClassifier.classifyIntent).toHaveBeenCalledWith('hello', undefined);
      expect(mockIntentClassifier.classifyIntent).not.toHaveBeenCalled();
      expect(result.enhancedIntent).toBeDefined();
    });

    it('should pass context text to enhanced classifier', async () => {
      const contextText = 'User: previous message';
      await service.classifyIntent('hello', contextText);

      expect(mockEnhancedClassifier.classifyIntent).toHaveBeenCalledWith('hello', contextText);
    });

    it('should convert enhanced intent to legacy format', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockEnhancedResult({
          parentIntent: 'greeting',
          childIntent: 'simple_greeting',
          confidence: 0.95,
        })
      );

      const result = await service.classifyIntent('hello');

      expect(result.intent).toBe('simple_greeting');
      expect(result.confidence).toBe(0.95);
    });

    it('should include routing decisions from enhanced intent', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockEnhancedResult({
          childIntent: 'simple_greeting',
          canUseCache: true,
        })
      );

      const result = await service.classifyIntent('hello');

      expect(result.useCache).toBe(true);
      expect(result.routeTo).toBe('ollama');
      expect(result.priority).toBe('fast');
    });

    it('should record duration', async () => {
      const result = await service.classifyIntent('hello');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // classifyIntent - Fallback to Legacy Classifier
  // ==========================================================================

  describe('classifyIntent - fallback to legacy', () => {
    it('should fall back to legacy classifier when enhanced fails', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(
        new Error('Enhanced classifier failed')
      );

      const result = await service.classifyIntent('hello');

      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalledWith('hello', undefined);
      expect(result.enhancedIntent).toBeUndefined();
      expect(result.intent).toBe('general_chat');
    });

    it('should use legacy classifier when enhanced is disabled', async () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        mockEnhancedClassifier as EnhancedIntentClassifierService,
        mockIntentLogRepo as IntentLogRepository,
        {
          useEnhancedClassifier: false,
          enableIntentLogging: true,
        }
      );

      const result = await service.classifyIntent('hello');

      expect(mockEnhancedClassifier.classifyIntent).not.toHaveBeenCalled();
      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalled();
    });

    it('should use legacy classifier when enhanced classifier is not provided', async () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        undefined,
        mockIntentLogRepo as IntentLogRepository,
        {
          useEnhancedClassifier: true,
          enableIntentLogging: true,
        }
      );

      const result = await service.classifyIntent('hello');

      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalled();
      expect(result.enhancedIntent).toBeUndefined();
    });

    it('should get routing decision from legacy intent', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(new Error('Failed'));
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'simple_greeting', confidence: 0.9 })
      );

      const result = await service.classifyIntent('hello');

      expect(result.useCache).toBe(true);
      expect(result.routeTo).toBe('ollama');
      expect(result.priority).toBe('fast');
    });
  });

  // ==========================================================================
  // classifyIntent - Both Classifiers Fail
  // ==========================================================================

  describe('classifyIntent - both classifiers fail', () => {
    it('should default to general_chat when both classifiers fail', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(
        new Error('Enhanced failed')
      );
      mockIntentClassifier.classifyIntent = vi.fn().mockRejectedValue(
        new Error('Legacy failed')
      );

      const result = await service.classifyIntent('hello');

      expect(result.intent).toBe('general_chat');
      expect(result.confidence).toBe(0.5);
      expect(result.enhancedIntent).toBeUndefined();
    });

    it('should return normal priority for default general_chat', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(
        new Error('Enhanced failed')
      );
      mockIntentClassifier.classifyIntent = vi.fn().mockRejectedValue(
        new Error('Legacy failed')
      );

      const result = await service.classifyIntent('hello');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('normal');
      expect(result.useCache).toBe(false);
    });
  });

  // ==========================================================================
  // Operational Command Detection
  // ==========================================================================

  describe('operational command detection', () => {
    const operationalCommands = [
      'commit the changes',
      'push to main',
      'restart the server',
      'stop the process',
      'clear the cache',
      'delete the logs',
      'run npm install',
      'execute the script',
      'fix the bug in the code',
      'debug this error',
      'modify the config file',
      'edit the database settings',
      'create a new script',
      'write a function for sorting',
      'check the status',
      'show the logs',
      'talk to claude',
      'ask the AI about this',
    ];

    it.each(operationalCommands)(
      'should route "%s" to Claude',
      async (command) => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'task_request',
            confidence: 0.9,
          })
        );

        const result = await service.classifyIntent(command);

        expect(result.routeTo).toBe('claude');
        expect(result.priority).toBe('complex');
        expect(result.useCache).toBe(false);
      }
    );

    it('should not detect normal messages as operational commands', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockEnhancedResult({
          childIntent: 'simple_greeting',
          confidence: 0.95,
        })
      );

      const result = await service.classifyIntent('hello there');

      expect(result.routeTo).toBe('ollama');
      expect(result.priority).toBe('fast');
    });

    it('should detect operational commands with legacy classifier fallback', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(new Error('Failed'));
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'general_chat', confidence: 0.8 })
      );

      const result = await service.classifyIntent('commit my changes');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('complex');
    });
  });

  // ==========================================================================
  // Routing Decisions - Enhanced Intents
  // ==========================================================================

  describe('routing decisions - enhanced intents', () => {
    describe('greetings route to Ollama', () => {
      const greetingIntents: ChildIntent[] = [
        'simple_greeting',
        'time_greeting',
        'farewell',
        'gratitude',
      ];

      it.each(greetingIntents)(
        'should route %s to Ollama with fast priority',
        async (intent) => {
          mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
            createMockEnhancedResult({
              childIntent: intent,
              canUseCache: true,
              confidence: 0.95,
            })
          );

          const result = await service.classifyIntent('hello');

          expect(result.routeTo).toBe('ollama');
          expect(result.priority).toBe('fast');
          expect(result.useCache).toBe(true);
        }
      );
    });

    describe('high-confidence acknowledgment routes to Ollama', () => {
      it('should route high-confidence acknowledgment to Ollama', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'acknowledgment',
            confidence: 0.85,
            canUseCache: true,
          })
        );

        const result = await service.classifyIntent('ok');

        expect(result.routeTo).toBe('ollama');
        expect(result.priority).toBe('fast');
      });

      it('should route low-confidence acknowledgment to Claude', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'acknowledgment',
            confidence: 0.6,
            canUseCache: false,
          })
        );

        const result = await service.classifyIntent('ok?');

        expect(result.routeTo).toBe('claude');
      });
    });

    describe('personal sharing routes to Claude', () => {
      it('should route personal_sharing to Claude for meaningful engagement', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'personal_sharing',
            confidence: 0.9,
            canUseCache: false,
          })
        );

        const result = await service.classifyIntent('I enjoy hiking in the mountains');

        expect(result.routeTo).toBe('claude');
        expect(result.priority).toBe('normal');
        expect(result.useCache).toBe(false);
      });
    });

    describe('clarification without context routes to Ollama', () => {
      it('should route clarification without context to Ollama', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'clarification',
            referencesContext: false,
            confidence: 0.8,
          })
        );

        const result = await service.classifyIntent('huh?');

        expect(result.routeTo).toBe('ollama');
        expect(result.priority).toBe('fast');
      });

      it('should route clarification with context to Claude', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            childIntent: 'clarification',
            referencesContext: true,
            confidence: 0.8,
            canUseCache: false,
          })
        );

        const result = await service.classifyIntent('what do you mean by that?');

        expect(result.routeTo).toBe('claude');
      });
    });

    describe('complex tasks route to Claude', () => {
      const complexIntents: Array<{ childIntent: ChildIntent; flags?: Partial<EnhancedIntentResult> }> = [
        { childIntent: 'task_request' },
        { childIntent: 'summarization' },
        { childIntent: 'how_to_question' },
        { childIntent: 'factual_question', flags: { requiresComplexReasoning: true } },
        { childIntent: 'web_search_question', flags: { requiresWebSearch: true } },
      ];

      it.each(complexIntents)(
        'should route $childIntent to Claude with complex priority',
        async ({ childIntent, flags }) => {
          mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
            createMockEnhancedResult({
              childIntent,
              canUseCache: false,
              ...flags,
            })
          );

          const result = await service.classifyIntent('write me a function');

          expect(result.routeTo).toBe('claude');
          expect(result.priority).toBe('complex');
          expect(result.useCache).toBe(false);
        }
      );
    });

    describe('default routing', () => {
      it('should default to Claude with normal priority for unmatched intents', async () => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            parentIntent: 'question',
            childIntent: 'opinion_question',
            canUseCache: false,
            requiresComplexReasoning: false,
            requiresWebSearch: false,
          })
        );

        const result = await service.classifyIntent('what do you think?');

        expect(result.routeTo).toBe('claude');
        expect(result.priority).toBe('normal');
      });
    });
  });

  // ==========================================================================
  // Routing Decisions - Plan Intents
  // ==========================================================================

  describe('routing decisions - plan intents', () => {
    const planIntents: ChildIntent[] = [
      'plan_propose',
      'plan_feedback',
      'plan_approve',
      'plan_execute',
      'plan_status',
      'plan_cancel',
      'plan_list',
    ];

    it.each(planIntents)(
      'should route %s to Claude with complex priority',
      async (intent) => {
        mockEnhancedClassifier.classifyIntent = vi.fn().mockResolvedValue(
          createMockEnhancedResult({
            parentIntent: 'plan',
            childIntent: intent,
            canUseCache: false,
          })
        );

        const result = await service.classifyIntent('create a plan to refactor');

        expect(result.routeTo).toBe('claude');
        expect(result.priority).toBe('complex');
        expect(result.useCache).toBe(false);
      }
    );
  });

  // ==========================================================================
  // Routing Decisions - Legacy Intents
  // ==========================================================================

  describe('routing decisions - legacy intents', () => {
    beforeEach(() => {
      // Disable enhanced classifier to test legacy routing
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        undefined,
        mockIntentLogRepo as IntentLogRepository,
        {
          useEnhancedClassifier: false,
          enableIntentLogging: true,
        }
      );
    });

    it('should route simple_greeting to Ollama with caching', async () => {
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'simple_greeting', confidence: 0.95 })
      );

      const result = await service.classifyIntent('hello');

      expect(result.routeTo).toBe('ollama');
      expect(result.priority).toBe('fast');
      expect(result.useCache).toBe(true);
    });

    it('should route needs_web_search to Claude with complex priority', async () => {
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'needs_web_search', confidence: 0.9 })
      );

      const result = await service.classifyIntent('what is the weather today?');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('complex');
      expect(result.useCache).toBe(false);
    });

    it('should route complex_task to Claude with complex priority', async () => {
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'complex_task', confidence: 0.85 })
      );

      const result = await service.classifyIntent('write a sorting algorithm');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('complex');
      expect(result.useCache).toBe(false);
    });

    it('should route general_chat to Claude with normal priority', async () => {
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'general_chat', confidence: 0.8 })
      );

      const result = await service.classifyIntent('I wonder about the universe');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('normal');
      expect(result.useCache).toBe(false);
    });

    it('should route operational commands to Claude even for simple_greeting intent', async () => {
      mockIntentClassifier.classifyIntent = vi.fn().mockResolvedValue(
        createMockLegacyResult({ intent: 'simple_greeting', confidence: 0.5 })
      );

      const result = await service.classifyIntent('push my changes');

      expect(result.routeTo).toBe('claude');
      expect(result.priority).toBe('complex');
    });
  });

  // ==========================================================================
  // toLegacyIntent
  // ==========================================================================

  describe('toLegacyIntent', () => {
    it('should convert simple_greeting to simple_greeting', () => {
      const result = createMockEnhancedResult({ childIntent: 'simple_greeting' });
      expect(service.toLegacyIntent(result)).toBe('simple_greeting');
    });

    it('should convert time_greeting to simple_greeting', () => {
      const result = createMockEnhancedResult({ childIntent: 'time_greeting' });
      expect(service.toLegacyIntent(result)).toBe('simple_greeting');
    });

    it('should convert web_search_question to needs_web_search', () => {
      const result = createMockEnhancedResult({
        childIntent: 'web_search_question',
        requiresWebSearch: true,
      });
      expect(service.toLegacyIntent(result)).toBe('needs_web_search');
    });

    it('should convert search_request to needs_web_search', () => {
      const result = createMockEnhancedResult({
        childIntent: 'search_request',
        requiresWebSearch: true,
      });
      expect(service.toLegacyIntent(result)).toBe('needs_web_search');
    });

    it('should convert intent with requiresWebSearch to needs_web_search', () => {
      const result = createMockEnhancedResult({
        childIntent: 'factual_question',
        requiresWebSearch: true,
      });
      expect(service.toLegacyIntent(result)).toBe('needs_web_search');
    });

    it('should convert task_request to complex_task', () => {
      const result = createMockEnhancedResult({
        childIntent: 'task_request',
        requiresComplexReasoning: true,
      });
      expect(service.toLegacyIntent(result)).toBe('complex_task');
    });

    it('should convert summarization to complex_task', () => {
      const result = createMockEnhancedResult({ childIntent: 'summarization' });
      expect(service.toLegacyIntent(result)).toBe('complex_task');
    });

    it('should convert how_to_question to complex_task', () => {
      const result = createMockEnhancedResult({ childIntent: 'how_to_question' });
      expect(service.toLegacyIntent(result)).toBe('complex_task');
    });

    it('should convert intent with requiresComplexReasoning to complex_task', () => {
      const result = createMockEnhancedResult({
        childIntent: 'factual_question',
        requiresComplexReasoning: true,
      });
      expect(service.toLegacyIntent(result)).toBe('complex_task');
    });

    it('should default to general_chat for other intents', () => {
      const result = createMockEnhancedResult({
        childIntent: 'farewell',
        requiresWebSearch: false,
        requiresComplexReasoning: false,
      });
      expect(service.toLegacyIntent(result)).toBe('general_chat');
    });
  });

  // ==========================================================================
  // logClassification
  // ==========================================================================

  describe('logClassification', () => {
    it('should log classification when enabled', async () => {
      const result = createMockEnhancedResult({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.95,
        confidenceLevel: 'high',
        classificationMethod: 'pattern',
        shouldEscalate: false,
        durationMs: 10,
      });

      await service.logClassification('msg-123', result);

      expect(mockIntentLogRepo.create).toHaveBeenCalledWith({
        messageId: 'msg-123',
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.95,
        confidenceLevel: 'high',
        classificationMethod: 'pattern',
        wasEscalated: false,
        durationMs: 10,
      });
    });

    it('should not log when intent logging is disabled', async () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        mockEnhancedClassifier as EnhancedIntentClassifierService,
        mockIntentLogRepo as IntentLogRepository,
        {
          useEnhancedClassifier: true,
          enableIntentLogging: false,
        }
      );

      const result = createMockEnhancedResult();
      await service.logClassification('msg-123', result);

      expect(mockIntentLogRepo.create).not.toHaveBeenCalled();
    });

    it('should not log when intent log repository is not provided', async () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        mockEnhancedClassifier as EnhancedIntentClassifierService,
        undefined,
        {
          useEnhancedClassifier: true,
          enableIntentLogging: true,
        }
      );

      const result = createMockEnhancedResult();
      await service.logClassification('msg-123', result);

      // No error should be thrown, and nothing should be logged
      expect(mockIntentLogRepo.create).not.toHaveBeenCalled();
    });

    it('should handle logging errors gracefully', async () => {
      mockIntentLogRepo.create = vi.fn().mockRejectedValue(new Error('Database error'));

      const result = createMockEnhancedResult();

      // Should not throw
      await expect(service.logClassification('msg-123', result)).resolves.not.toThrow();
    });

    it('should log with wasEscalated true when shouldEscalate is true', async () => {
      const result = createMockEnhancedResult({
        shouldEscalate: true,
        classificationMethod: 'escalated',
      });

      await service.logClassification('msg-456', result);

      expect(mockIntentLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-456',
          wasEscalated: true,
          classificationMethod: 'escalated',
        })
      );
    });
  });

  // ==========================================================================
  // Configuration
  // ==========================================================================

  describe('configuration', () => {
    it('should use default config when not provided', () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        mockEnhancedClassifier as EnhancedIntentClassifierService,
        mockIntentLogRepo as IntentLogRepository
      );

      // Default is useEnhancedClassifier: true
      expect(mockEnhancedClassifier.classifyIntent).not.toHaveBeenCalled();
    });

    it('should use partial config and fill defaults', async () => {
      service = new IntentRoutingService(
        mockIntentClassifier as IntentClassifierService,
        mockEnhancedClassifier as EnhancedIntentClassifierService,
        mockIntentLogRepo as IntentLogRepository,
        { useEnhancedClassifier: false }
      );

      await service.classifyIntent('hello');

      // Enhanced should not be called due to config
      expect(mockEnhancedClassifier.classifyIntent).not.toHaveBeenCalled();
      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty message', async () => {
      const result = await service.classifyIntent('');

      expect(result).toBeDefined();
      expect(result.intent).toBeDefined();
    });

    it('should handle very long messages', async () => {
      const longMessage = 'a'.repeat(10000);

      const result = await service.classifyIntent(longMessage);

      expect(result).toBeDefined();
      expect(mockEnhancedClassifier.classifyIntent).toHaveBeenCalledWith(longMessage, undefined);
    });

    it('should handle messages with special characters', async () => {
      const specialMessage = '!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./';

      const result = await service.classifyIntent(specialMessage);

      expect(result).toBeDefined();
    });

    it('should handle unicode messages', async () => {
      const unicodeMessage = 'Hello! \u4F60\u597D \uD83D\uDC4B';

      const result = await service.classifyIntent(unicodeMessage);

      expect(result).toBeDefined();
    });

    it('should handle null-like context text', async () => {
      const result = await service.classifyIntent('hello', '');

      expect(result).toBeDefined();
      expect(mockEnhancedClassifier.classifyIntent).toHaveBeenCalledWith('hello', '');
    });
  });

  // ==========================================================================
  // Return Value Structure
  // ==========================================================================

  describe('return value structure', () => {
    it('should return all required fields', async () => {
      const result = await service.classifyIntent('hello');

      expect(result).toMatchObject({
        intent: expect.any(String),
        confidence: expect.any(Number),
        durationMs: expect.any(Number),
        useCache: expect.any(Boolean),
        routeTo: expect.stringMatching(/^(ollama|claude)$/),
        priority: expect.stringMatching(/^(fast|normal|complex)$/),
      });
    });

    it('should include enhancedIntent when available', async () => {
      const result = await service.classifyIntent('hello');

      expect(result.enhancedIntent).toBeDefined();
      expect(result.enhancedIntent?.parentIntent).toBeDefined();
      expect(result.enhancedIntent?.childIntent).toBeDefined();
    });

    it('should not include enhancedIntent when falling back to legacy', async () => {
      mockEnhancedClassifier.classifyIntent = vi.fn().mockRejectedValue(new Error('Failed'));

      const result = await service.classifyIntent('hello');

      expect(result.enhancedIntent).toBeUndefined();
    });
  });
});
