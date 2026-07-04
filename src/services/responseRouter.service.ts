/**
 * ResponseRouterService - Thin Orchestrator
 *
 * Coordinates response generation by delegating to focused services:
 * - IntentRoutingService: Intent classification and routing decisions
 * - ContextBuildingService: Context assembly for LLM interactions
 * - ResponseCacheService: Semantic caching logic
 * - AntiLoopService: Anti-loop detection and override
 * - LLMRouterService: LLM routing between Ollama and Claude
 * - RoutingChain: Strategy pattern handlers for different intents
 *
 * Refactored to use Strategy Pattern for routing decisions.
 */

import type { IResponseRouter, AnalysisResult } from '../interfaces/index.js';
import type { Message, Chat, Sender } from '../types/index.js';
import type { StatusHandlerService } from './statusHandler.service.js';

import {
  IntentRoutingService,
  IntentRoutingResult,
} from './routing/intent-routing.service.js';
import { ContextBuildingService } from './routing/context-building.service.js';
import { ResponseCacheService } from './routing/response-cache.service.js';
import { AntiLoopService, AntiLoopResult } from './routing/anti-loop.service.js';
import { LLMRouterService, LLMRouterResult } from './routing/llm-router.service.js';
import { ResponseValidationService } from './responseValidation.service.js';
import { messageValidationService } from './messageValidation.service.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Strategy pattern handlers
import {
  RoutingChain,
  RoutingContext,
  PlanIntentHandler,
  JokeRequestHandler,
  HealthStatusHandler,
  ForceAgenticHandler,
  WebSearchHandler,
  GreetingHandler,
  AgenticRequestHandler,
  CalendarRequestHandler,
  DefaultClaudeHandler,
} from './routing/handlers/index.js';
import type { ICalendarService } from '../interfaces/services.js';

/**
 * Named constants for configuration
 */
const NON_OWNER_REFUSAL =
  'I can only perform system operations for authorized users. Feel free to chat with me about anything else though!';

const EMPTY_INPUT_RESPONSE = "I didn't catch that. What would you like help with?";

export interface ResponseRouterConfig {
  responseEnabled: boolean;
  contextWindowSize: number;
  enableCache: boolean;
  enableValidation: boolean;
  forceAgenticMode: boolean;
  ownerTelegramId?: string;
}

/**
 * ResponseRouterService - Thin Orchestrator
 *
 * Implements IResponseRouter by coordinating focused services.
 * Uses Strategy Pattern via RoutingChain for intent-based routing.
 */
export class ResponseRouterService implements IResponseRouter {
  private config: ResponseRouterConfig;
  private responseValidator: ResponseValidationService;
  private statusHandler: StatusHandlerService | null = null;
  private calendarService: ICalendarService | null = null;
  private routingChain: RoutingChain;

  constructor(
    private intentRouting: IntentRoutingService,
    private contextBuilding: ContextBuildingService,
    private responseCache: ResponseCacheService,
    private antiLoop: AntiLoopService,
    private llmRouter: LLMRouterService,
    config?: Partial<ResponseRouterConfig>
  ) {
    this.config = {
      responseEnabled: config?.responseEnabled ?? appConfig.response.enabled,
      contextWindowSize: config?.contextWindowSize ?? appConfig.response.contextWindowSize,
      enableCache: config?.enableCache ?? appConfig.cache.enabled,
      enableValidation: config?.enableValidation ?? true,
      forceAgenticMode: config?.forceAgenticMode ?? appConfig.response.forceAgenticMode,
      ownerTelegramId: config?.ownerTelegramId ?? appConfig.security.ownerTelegramId,
    };
    this.responseValidator = new ResponseValidationService();
    this.routingChain = this.createRoutingChain();
  }

  /**
   * Create and configure the routing chain with all handlers
   */
  private createRoutingChain(): RoutingChain {
    const chain = new RoutingChain();

    // Register handlers in priority order (handled by priority field, but explicit here for clarity)
    chain.register(new PlanIntentHandler(this.llmRouter));
    chain.register(new JokeRequestHandler(this.llmRouter));
    chain.register(new HealthStatusHandler(this.statusHandler));
    chain.register(new ForceAgenticHandler(
      this.llmRouter,
      this.contextBuilding,
      this.config.forceAgenticMode
    ));
    chain.register(new WebSearchHandler(
      this.llmRouter,
      this.contextBuilding,
      this.buildContextForHandler.bind(this)
    ));
    // Calendar handler is registered only when a calendar service is wired in.
    if (this.calendarService) {
      chain.register(new CalendarRequestHandler(
        this.llmRouter,
        this.calendarService,
        this.buildContextForHandler.bind(this)
      ));
    }
    chain.register(new GreetingHandler(this.llmRouter, this.contextBuilding));
    chain.register(new AgenticRequestHandler(this.llmRouter));
    chain.register(new DefaultClaudeHandler(
      this.llmRouter,
      this.buildContextForHandler.bind(this)
    ));

    return chain;
  }

  /**
   * Set the status handler service
   * Used for wiring up dependencies after construction
   */
  setStatusHandler(handler: import('./statusHandler.service.js').StatusHandlerService | null): void {
    this.statusHandler = handler;
    // Recreate chain with updated status handler
    this.routingChain = this.createRoutingChain();
    logger.info('[Router] Status handler set');
  }

  /**
   * Set the calendar service and register the calendar routing handler.
   * Used for wiring up dependencies after construction.
   */
  setCalendarService(service: ICalendarService | null): void {
    this.calendarService = service;
    this.routingChain = this.createRoutingChain();
    logger.info('[Router] Calendar service set', { enabled: service?.isEnabled() ?? false });
  }

  /**
   * Check if the sender is the system owner.
   * Returns true if no owner is configured (backward compatible) or sender matches.
   */
  private isOwner(sender: Sender | null): boolean {
    if (!this.config.ownerTelegramId) return true; // No restriction configured
    if (!sender?.telegramId) return false;
    return String(sender.telegramId) === this.config.ownerTelegramId;
  }

  /**
   * Generate response for a message
   *
   * Orchestration flow:
   * 1. Check if response generation is enabled
   * 2. Handle empty input
   * 3. Check anti-loop conditions
   * 4. Classify intent
   * 5. Try cache
   * 6. Route through handler chain
   * 7. Validate response
   * 8. Cache if applicable
   */
  async generateResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    conversationHistory: Message[],
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<AnalysisResult> {
    // Check if response generation is enabled
    if (!this.config.responseEnabled) {
      return { success: true, skipped: true, content: 'Response disabled' };
    }

    const startTime = Date.now();
    const messageText = message.text || '';

    // --- 0. EMPTY INPUT HANDLING ---
    const trimmedText = messageText.trim();
    if (!trimmedText) {
      logger.debug('[Router] Empty input received, returning clarification prompt', {
        messageId: message.id,
      });
      return {
        success: true,
        content: EMPTY_INPUT_RESPONSE,
      };
    }

    // --- 1. ANTI-LOOP DETECTION ---
    const isExplicitWebSearch = this.llmRouter.requiresWebSearch(messageText);

    const antiLoopResult = await this.antiLoop.checkForOverride(
      message,
      chat,
      sender,
      conversationHistory
    );

    if (antiLoopResult.shouldExecuteImmediately && !isExplicitWebSearch) {
      if (!this.isOwner(sender)) {
        logger.warn('[Router] Non-owner attempted anti-loop agentic override', {
          messageId: message.id,
          senderId: sender?.telegramId,
        });
        return { success: true, content: NON_OWNER_REFUSAL };
      }

      logger.warn('[Router] Anti-loop override triggered', {
        messageId: message.id,
        frustrationLevel: antiLoopResult.frustrationLevel,
        imperativeConfidence: antiLoopResult.imperativeConfidence,
        loopDetected: antiLoopResult.loopDetected,
        reason: antiLoopResult.reason,
      });

      // Execute agentic request immediately without further analysis
      return this.executeAgenticRequest(message, conversationHistory, sender, startTime);
    }

    if (isExplicitWebSearch && antiLoopResult.shouldExecuteImmediately) {
      logger.info('[Router] Bypassing anti-loop override for explicit web search request', {
        messageId: message.id,
        frustrationLevel: antiLoopResult.frustrationLevel,
        text: messageText.substring(0, 50),
      });
    }

    // --- 2. CLASSIFY INTENT ---
    const contextText = this.contextBuilding.buildClassificationContext(conversationHistory);
    const routingResult = await this.intentRouting.classifyIntent(messageText, contextText);

    // Log classification if we have enhanced intent
    if (routingResult.enhancedIntent) {
      await this.intentRouting.logClassification(message.id, routingResult.enhancedIntent);

      logger.info('[Router] Enhanced intent classified', {
        messageId: message.id,
        parentIntent: routingResult.enhancedIntent.parentIntent,
        childIntent: routingResult.enhancedIntent.childIntent,
        confidence: routingResult.enhancedIntent.confidence,
        confidenceLevel: routingResult.enhancedIntent.confidenceLevel,
        classificationMethod: routingResult.enhancedIntent.classificationMethod,
        durationMs: routingResult.enhancedIntent.durationMs,
      });
    } else {
      logger.info('[Router] Legacy intent classified', {
        messageId: message.id,
        intent: routingResult.intent,
        confidence: routingResult.confidence,
        durationMs: routingResult.durationMs,
      });
    }

    // --- 3. TRY CACHE ---
    if (this.config.enableCache && routingResult.useCache) {
      const userMessages = conversationHistory.filter(m => !m.isBot && m.id !== message.id);
      const isFirstMessage = userMessages.length === 0;

      const cacheResult = await this.responseCache.lookup(
        messageText,
        routingResult.enhancedIntent?.childIntent || routingResult.intent,
        {
          isFirstMessage,
          conversationLength: conversationHistory.length,
        }
      );
      if (cacheResult) {
        logger.info('[Router] Cache hit', {
          messageId: message.id,
          intent: routingResult.intent,
          similarity: cacheResult.similarity,
        });

        return this.buildResult({
          success: true,
          content: cacheResult.response,
          routedTo: 'cache',
          cacheHit: true,
          cacheSimilarity: cacheResult.similarity,
        }, routingResult, startTime);
      }
    }

    // --- 4. ROUTE THROUGH HANDLER CHAIN ---
    const requiresWebSearch = this.determineWebSearchRequired(routingResult, messageText);

    const routingContext: RoutingContext = {
      message,
      chat,
      sender,
      conversationHistory,
      messageText,
      routingResult,
      identityOptions,
      isOwner: this.isOwner(sender),
      requiresWebSearch,
    };

    // Check for plan intent first (requires owner check before chain)
    const isPlanIntent = routingResult.enhancedIntent?.parentIntent === 'plan';
    if (isPlanIntent && !this.isOwner(sender)) {
      logger.warn('[Router] Non-owner attempted plan intent', {
        messageId: message.id,
        senderId: sender?.telegramId,
      });
      return { success: true, content: NON_OWNER_REFUSAL };
    }

    const handlerResult = await this.routingChain.execute(routingContext);

    let llmResult: LLMRouterResult;

    if (handlerResult?.handled && handlerResult.result) {
      llmResult = handlerResult.result;
    } else {
      // Fallback - should not reach here if DefaultClaudeHandler is registered
      logger.warn('[Router] No handler processed request, using Claude fallback', {
        messageId: message.id,
      });
      const context = await this.buildContext(message, conversationHistory, sender, identityOptions);
      llmResult = await this.llmRouter.handleWithClaude(
        message,
        context,
        conversationHistory,
        { isOwner: this.isOwner(sender) }
      );
    }

    // --- 5. VALIDATE RESPONSE ---
    if (this.config.enableValidation && llmResult.success && llmResult.content) {
      llmResult = await this.validateResponse(llmResult, message, routingResult, conversationHistory, sender, identityOptions);
    }

    // --- 6. CACHE IF APPLICABLE ---
    const intentForCache = routingResult.enhancedIntent?.childIntent || routingResult.intent;
    if (llmResult.success && llmResult.content) {
      await this.responseCache.store(
        messageText,
        llmResult.content,
        intentForCache,
        llmResult.routedTo
      );
    }

    return this.buildResult(llmResult, routingResult, startTime);
  }

  /**
   * Determine if web search is required based on routing result and message content
   */
  private determineWebSearchRequired(routingResult: IntentRoutingResult, messageText: string): boolean {
    return (
      routingResult.enhancedIntent?.requiresWebSearch ||
      routingResult.enhancedIntent?.childIntent === 'web_search_question' ||
      routingResult.enhancedIntent?.childIntent === 'search_request' ||
      this.llmRouter.requiresWebSearch(messageText)
    );
  }

  /**
   * Validate response content for hallucinations and issues
   */
  private async validateResponse(
    llmResult: LLMRouterResult,
    message: Message,
    routingResult: IntentRoutingResult,
    conversationHistory: Message[],
    sender: Sender | null,
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<LLMRouterResult> {
    let result = { ...llmResult };

    // Check for phone sending hallucinations (all models)
    if (messageValidationService.containsPhoneSendingClaim(result.content!)) {
      const phoneValidation = messageValidationService.validateResponse(result.content!);
      logger.warn('[Router] Phone sending hallucination detected', {
        messageId: message.id,
        routedTo: result.routedTo,
        issues: phoneValidation.issues,
      });
      messageValidationService.logValidationIssues(phoneValidation.issues, message.id);

      if (phoneValidation.sanitizedContent) {
        result.content = phoneValidation.sanitizedContent;
      }
    }

    // Additional validation for Ollama responses
    if (result.routedTo === 'ollama') {
      const validation = this.responseValidator.validate(result.content!, {
        model: result.routedTo,
        intent: routingResult.enhancedIntent?.childIntent || routingResult.intent,
      });

      if (!validation.isValid) {
        logger.warn('[Router] Hallucination detected in response', {
          messageId: message.id,
          issues: validation.issues.map(i => ({ type: i.type, severity: i.severity })),
          shouldReject: validation.shouldReject,
          routedTo: result.routedTo,
        });

        if (validation.shouldReject) {
          logger.info('[Router] Re-routing to Claude due to severe hallucination', {
            messageId: message.id,
            issueCount: validation.issues.length,
          });

          const context = await this.buildContext(message, conversationHistory, sender, identityOptions);
          result = await this.llmRouter.handleWithClaude(
            message,
            context,
            conversationHistory,
            { isOwner: this.isOwner(sender) }
          );
        } else if (validation.sanitizedContent) {
          result.content = validation.sanitizedContent;
        }
      }
    }

    return result;
  }

  /**
   * Build context for LLM interaction
   */
  private async buildContext(
    message: Message,
    conversationHistory: Message[],
    sender: Sender | null,
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<string> {
    // Try RAG context first
    if (appConfig.rag.enabled) {
      const ragResult = await this.contextBuilding.buildRAGContext(message.text || '', {
        senderId: sender?.id,
        chatId: message.chatId,
        userId: identityOptions?.userId,
        conversationId: identityOptions?.conversationId,
        maxTokens: appConfig.rag.maxContextTokens,
        recentMessageCount: this.config.contextWindowSize,
        messageId: message.id,
        enableDebugLogging: true,
      });

      if (ragResult) {
        logger.info('[Router] Built RAG context', {
          messageId: message.id,
          chatId: message.chatId,
          candidates: ragResult.debug.totalCandidates,
          selected: ragResult.debug.selectedItems,
          tokensUsed: ragResult.debug.tokensUsed,
          sources: ragResult.debug.sources,
          totalMs: ragResult.debug.timings.totalMs,
        });
        return ragResult.context;
      }
    }

    // Fallback to simple context
    const simpleContext = await this.contextBuilding.buildConversationContext(
      conversationHistory,
      sender,
      this.config.contextWindowSize
    );

    logger.debug('[Router] Built simple context', {
      messageId: message.id,
      chatId: message.chatId,
      contextWindowSize: this.config.contextWindowSize,
      contextLength: simpleContext.length,
    });

    return simpleContext;
  }

  /**
   * Build context for handler - wrapper for use in handlers
   */
  private async buildContextForHandler(context: RoutingContext): Promise<string> {
    return this.buildContext(
      context.message,
      context.conversationHistory,
      context.sender,
      context.identityOptions
    );
  }

  /**
   * Execute agentic request (anti-loop override path)
   */
  private async executeAgenticRequest(
    message: Message,
    conversationHistory: Message[],
    sender: Sender | null,
    startTime: number
  ): Promise<AnalysisResult> {
    const result = await this.llmRouter.handleAgenticRequest(message, conversationHistory, sender);
    return this.buildResult({
      success: result.success,
      content: result.content,
      error: result.error,
      responseId: result.responseId,
      routedTo: result.routedTo,
    }, { intent: 'complex_task', confidence: 1.0, durationMs: 0, useCache: false, routeTo: 'claude', priority: 'complex' }, startTime);
  }

  /**
   * Build final result with intent and timing info
   */
  private buildResult(
    llmResult: LLMRouterResult | { success: boolean; content?: string; routedTo: 'ollama' | 'claude' | 'cache'; cacheHit?: boolean; cacheSimilarity?: number },
    routingResult: IntentRoutingResult,
    startTime: number
  ): AnalysisResult {
    const totalDurationMs = Date.now() - startTime;

    const result: AnalysisResult = {
      success: llmResult.success,
      content: llmResult.content,
      routedTo: llmResult.routedTo as 'ollama' | 'claude' | 'cache',
      intent: routingResult.intent,
      intentConfidence: routingResult.confidence,
      enhancedIntent: routingResult.enhancedIntent,
    };

    if ('cacheHit' in llmResult) {
      result.cacheHit = llmResult.cacheHit;
      result.cacheSimilarity = llmResult.cacheSimilarity;
    }

    if ('responseId' in llmResult) {
      result.responseId = llmResult.responseId;
    }

    if ('error' in llmResult) {
      result.error = llmResult.error;
    }

    logger.info('[Router] Response generated', {
      intent: routingResult.intent,
      routedTo: result.routedTo,
      success: result.success,
      totalDurationMs,
      enhanced: !!routingResult.enhancedIntent,
      cacheHit: result.cacheHit || false,
      cacheSimilarity: result.cacheSimilarity,
    });

    return result;
  }
}
