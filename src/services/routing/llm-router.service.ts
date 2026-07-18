import type { Message, Sender, Chat } from '../../types/index.js';
import type { EnhancedIntentResult, PlanIntent } from '../../types/intent.types.js';
import type { IMemoryService } from '../../interfaces/index.js';
import type { IChatRepository } from '../../interfaces/repositories.js';
import type { ComicGeneratorService } from '../comic/comic-generator.service.js';
import type { BrowserService } from '../tools/browser.service.js';
import { LLMClient, ChatMessage } from '../../clients/llm.client.js';
import { ClaudeClient } from '../../clients/claude.client.js';
import { LLMResponseRepository } from '../../repositories/llmResponse.repository.js';
import { CircuitBreakerService, CircuitOpenError } from '../circuitBreaker.service.js';
import { logger } from '../../utils/logger.js';
import { isBrowserMCPEnabled } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
import { PlanIntentHandlerService } from '../planIntentHandler.service.js';
import { languagePreferenceService } from '../languagePreference.service.js';
import { capabilityManifest } from '../../config/capabilities.js';
import {
  AGENTIC_TIMEOUT_MS,
  AGENTIC_MEMORY_LIMIT,
  LAST_RESORT_RESPONSES,
  GREETING_RESPONSES,
} from './llm-router.constants.js';
import { isAgenticRequest, requiresWebSearch } from './llm-router.detection.js';
import {
  buildAgenticContext,
  constructAgenticPrompt,
  buildConversationMessages,
  prependSafetyContext,
} from './llm-router.prompts.js';
import { handleWebSearchRequest } from './llm-router.web-search.js';
import {
  handleLanguageDetection,
  getLanguagePreference,
  setLanguagePreference,
} from './llm-router.language.js';

// Re-export shared types so existing importers keep a stable public API.
export type { LLMRouterConfig, LLMRouterResult } from './llm-router.constants.js';
import type { LLMRouterConfig, LLMRouterResult } from './llm-router.constants.js';

/**
 * LLM Router Service
 *
 * Extracts LLM routing logic from ResponseRouterService.
 * Handles routing between Ollama (for simple/fast responses) and Claude (for complex tasks).
 *
 * Key responsibilities:
 * - Simple greeting handling via Ollama
 * - Complex response generation via Claude
 * - Agentic task handling (file operations, multi-step reasoning)
 * - Fallback to Ollama when Claude is unavailable
 * - Circuit breaker integration for resilience
 */
export class LLMRouterService {
  private config: LLMRouterConfig;
  private ollamaCircuitBreaker: CircuitBreakerService | null = null;
  private claudeCircuitBreaker: CircuitBreakerService | null = null;
  private planIntentHandler: PlanIntentHandlerService;
  private memoryService: IMemoryService | null = null;
  private comicGeneratorService: ComicGeneratorService | null = null;
  private browserService: BrowserService | null = null;
  private chatLanguagePreferences: Map<string, string> = new Map(); // Track per-chat language preferences (in-memory cache)
  private chatRepository: IChatRepository | null = null;

  constructor(
    private ollamaClient: LLMClient,
    private claudeClient: ClaudeClient,
    private llmResponseRepo: LLMResponseRepository,
    config: LLMRouterConfig
  ) {
    this.config = config;
    this.planIntentHandler = new PlanIntentHandlerService(claudeClient);
  }

  /**
   * Set circuit breaker for Ollama calls
   */
  setOllamaCircuitBreaker(circuitBreaker: CircuitBreakerService): void {
    this.ollamaCircuitBreaker = circuitBreaker;
  }

  /**
   * Set circuit breaker for Claude calls
   */
  setClaudeCircuitBreaker(circuitBreaker: CircuitBreakerService): void {
    this.claudeCircuitBreaker = circuitBreaker;
  }

  /**
   * Set memory service for agentic request context enrichment
   */
  setMemoryService(memoryService: IMemoryService): void {
    this.memoryService = memoryService;
  }

  /**
   * Set comic generator service for joke requests
   */
  setComicGeneratorService(comicGeneratorService: ComicGeneratorService): void {
    this.comicGeneratorService = comicGeneratorService;
  }

  /**
   * Set browser service for web search content enrichment
   */
  setBrowserService(service: BrowserService): void {
    this.browserService = service;
  }

  /**
   * Set chat repository for persisting language preferences
   */
  setChatRepository(chatRepository: IChatRepository): void {
    this.chatRepository = chatRepository;
  }

  /**
   * Handle greeting messages with Ollama for fast response
   *
   * @param message - The message to respond to
   * @param sender - The sender of the message (for personalization)
   * @param personalizationContext - User preference context string
   * @param chat - The chat context (for language preference)
   * @returns LLMRouterResult with the generated greeting
   */
  async handleGreeting(
    message: Message,
    sender: Sender | null,
    personalizationContext: string = '',
    chat?: Chat
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();

    try {
      // Build personalized system prompt with capabilities
      const capabilityPrompt = capabilityManifest.generateCapabilityPrompt();

      let systemPrompt = `You're Jarvis, a friendly and chill assistant. Keep responses short, 1-2 sentences max. Keep responses under 3500 characters. Respond in plain text - do not use markdown formatting.

${capabilityPrompt}

For greetings: Respond warmly but casually.
For unclear/minimal input (like "???" or "huh"): Politely ask what they need help with. Don't assume they're greeting you.
For gratitude (like "thanks" or "ok thanks"): Respond warmly: "You're welcome! Happy to help.", "Glad I could help!", "Anytime!", "No worries!". Keep friendly, no follow-up questions.`;

      // Add language preference to system prompt if available
      if (chat && chat.preferredLanguage) {
        const languageContext = languagePreferenceService.getLanguageContext(chat.preferredLanguage);
        systemPrompt += `\n\n${languageContext}`;
      }

      if (personalizationContext) {
        systemPrompt += `\n\n${personalizationContext}`;
      }

      // Use Ollama for fast greeting responses
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: message.text || 'Hello',
        },
      ];

      // Use circuit breaker if available
      const response = this.ollamaCircuitBreaker
        ? await this.ollamaCircuitBreaker.execute(() =>
            this.ollamaClient.chat(messages, `greeting-${message.id}`)
          )
        : await this.ollamaClient.chat(messages, `greeting-${message.id}`);
      const durationMs = Date.now() - startTime;

      // Store the response
      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({ type: 'greeting', messages }),
        response: response.content,
        model: response.model,
        durationMs,
        promptTokens: response.promptEvalCount ?? null,
        completionTokens: response.evalCount ?? null,
        error: null,
      });

      logger.info('[LLMRouter] Greeting handled via Ollama', {
        messageId: message.id,
        durationMs,
      });

      return {
        success: true,
        content: response.content,
        responseId: stored.id,
        routedTo: 'ollama',
      };
    } catch (error) {
      const isCircuitOpen = error instanceof CircuitOpenError;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Ollama greeting failed', {
        messageId: message.id,
        error: errorMessage,
        circuitOpen: isCircuitOpen,
      });

      // Fallback to a random pre-canned response
      const fallbackResponse =
        GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];

      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({ type: 'greeting_fallback' }),
        response: fallbackResponse,
        model: 'fallback',
        durationMs: Date.now() - startTime,
        promptTokens: null,
        completionTokens: null,
        error: errorMessage,
      });

      return {
        success: true,
        content: fallbackResponse,
        responseId: stored.id,
        routedTo: 'ollama',
      };
    }
  }

  /**
   * Handle complex messages with Claude
   *
   * @param message - The message to respond to
   * @param context - RAG context string with user preferences, memories, etc.
   * @param conversationHistory - Recent conversation history
   * @param options - Optional flags (isOwner, chat)
   * @returns LLMRouterResult with the generated response
   */
  async handleWithClaude(
    message: Message,
    context: string,
    conversationHistory: Message[],
    options?: { isOwner?: boolean; chat?: Chat }
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();

    // Prepare context with safety instructions and language preferences
    const preparedContext = prependSafetyContext(context, options?.isOwner, options?.chat);

    // Handle language detection and preference updates
    await handleLanguageDetection(
      { chatRepository: this.chatRepository, cache: this.chatLanguagePreferences },
      message,
      options?.chat,
      conversationHistory
    );

    // Check if Claude is enabled
    if (!this.config.claudeEnabled) {
      logger.info('[LLMRouter] Claude disabled, falling back to Ollama', {
        messageId: message.id,
      });
      return this.fallbackToOllama(message, conversationHistory);
    }

    // Check if Claude circuit breaker is open, fallback to Ollama
    if (this.claudeCircuitBreaker?.isOpen()) {
      logger.warn('[LLMRouter] Claude circuit breaker is open, falling back to Ollama', {
        messageId: message.id,
      });
      return this.fallbackToOllama(message, conversationHistory);
    }

    try {
      // Use circuit breaker if available
      const response = this.claudeCircuitBreaker
        ? await this.claudeCircuitBreaker.execute(() =>
            this.claudeClient.chat(message.text || '', preparedContext)
          )
        : await this.claudeClient.chat(message.text || '', preparedContext);
      const durationMs = Date.now() - startTime;

      if (!response.success) {
        logger.warn('[LLMRouter] Claude failed, falling back to Ollama', {
          messageId: message.id,
          error: response.error,
        });
        return this.fallbackToOllama(message, conversationHistory);
      }

      // Store the response
      const responseId = await this.storeClaudeResponse(message, preparedContext, response.content, durationMs);

      logger.info('[LLMRouter] Response generated via Claude', {
        messageId: message.id,
        durationMs,
        model: this.config.claudeModel,
      });

      return {
        success: true,
        content: response.content,
        responseId,
        routedTo: 'claude',
      };
    } catch (error) {
      const isCircuitOpen = error instanceof CircuitOpenError;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Claude error, falling back to Ollama', {
        messageId: message.id,
        error: errorMessage,
        circuitOpen: isCircuitOpen,
      });

      return this.fallbackToOllama(message, conversationHistory);
    }
  }

  /**
   * Store Claude response in the database
   *
   * @param message - The message being responded to
   * @param context - The context used for generation
   * @param response - The generated response content
   * @param durationMs - Time taken to generate response
   * @returns The ID of the stored response
   */
  private async storeClaudeResponse(
    message: Message,
    context: string,
    response: string,
    durationMs: number
  ): Promise<string> {
    const stored = await this.llmResponseRepo.create({
      messageId: message.id,
      promptType: 'response',
      prompt: JSON.stringify({
        type: 'claude',
        context,
        message: message.text,
      }),
      response,
      model: `claude-${this.config.claudeModel}`,
      durationMs,
      promptTokens: null,
      completionTokens: null,
      error: null,
    });

    return stored.id;
  }

  /**
   * Retrieve relevant memories and append them to the context
   *
   * @param context - Existing context string to append memories to
   * @param messageText - The message text to search for relevant memories
   * @param messageId - Message ID for logging
   * @returns Context string with memories appended (if any found)
   */
  private async retrieveAgenticMemories(
    context: string,
    messageText: string,
    messageId: string
  ): Promise<string> {
    if (!this.memoryService || !messageText) {
      return context;
    }

    try {
      const memoryResult = await this.memoryService.retrieveRelevant(
        messageText,
        { limit: AGENTIC_MEMORY_LIMIT }
      );

      if (memoryResult.memories.length > 0) {
        let contextWithMemories = context;
        contextWithMemories += '\n\nRelevant memories:\n';
        for (const memory of memoryResult.memories) {
          contextWithMemories += `- ${memory.content}\n`;
        }
        logger.debug('[LLMRouter] Added memories to agentic context', {
          messageId,
          memoryCount: memoryResult.memories.length,
        });
        return contextWithMemories;
      }
    } catch (error) {
      logger.warn('[LLMRouter] Failed to retrieve memories for agentic task', {
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return context;
  }

  /**
   * Execute agentic tools via Claude client with circuit breaker
   *
   * @param taskPrompt - The complete task prompt
   * @returns Response from Claude agent execution
   */
  private async executeAgenticTools(
    taskPrompt: string
  ): Promise<Awaited<ReturnType<typeof this.claudeClient.runAgent>>> {
    const agentOptions = {
      timeoutMs: AGENTIC_TIMEOUT_MS,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      mcpConfigPath: isBrowserMCPEnabled() ? appConfig.browser.mcpConfigPath : undefined,
    };

    // Use circuit breaker if available
    if (this.claudeCircuitBreaker) {
      return this.claudeCircuitBreaker.execute(() =>
        this.claudeClient.runAgent(taskPrompt, agentOptions)
      );
    }

    return this.claudeClient.runAgent(taskPrompt, agentOptions);
  }

  /**
   * Handle agentic requests that require Claude to use tools
   *
   * Uses runAgent instead of chat, allowing full tool access for file operations,
   * multi-step reasoning, and complex tasks.
   *
   * @param message - The message with agentic request
   * @param conversationHistory - Recent conversation history for context
   * @param sender - The sender of the message (for context)
   * @returns LLMRouterResult with the agentic task result
   */
  async handleAgenticRequest(
    message: Message,
    conversationHistory: Message[],
    sender: Sender | null
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();

    try {
      // Build context for the agentic task
      let context = buildAgenticContext(sender, conversationHistory);

      // Retrieve relevant memories for the request
      context = await this.retrieveAgenticMemories(context, message.text || '', message.id);

      // Build the agentic task prompt with capabilities
      const taskPrompt = constructAgenticPrompt(context, message.text || '');

      logger.info('[LLMRouter] Running agentic task', {
        messageId: message.id,
        taskLength: taskPrompt.length,
      });

      // Execute agentic tools
      const response = await this.executeAgenticTools(taskPrompt);

      const durationMs = Date.now() - startTime;

      if (!response.success) {
        // Don't fall back to Ollama for agentic tasks - the task may have had side effects
        // (like sending messages) that Ollama doesn't know about, leading to incorrect responses
        logger.error('[LLMRouter] Agentic task failed, NOT falling back to Ollama to avoid inconsistent state', {
          messageId: message.id,
          error: response.error,
        });
        const isTimeout = response.error?.includes('timed out') || response.error?.includes('timeout');
        return {
          success: false,
          error: response.error,
          content: isTimeout
            ? 'Die Aufgabe hat zu lange gedauert. Sie wurde möglicherweise teilweise ausgeführt. Bitte überprüfe den Status und versuche es bei Bedarf erneut.'
            : `Ein Fehler ist aufgetreten: ${response.error}`,
          routedTo: 'claude',
        };
      }

      // Store the response
      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({
          type: 'claude_agent',
          task: taskPrompt,
        }),
        response: response.content,
        model: `claude-agent-${this.config.claudeModel}`,
        durationMs,
        promptTokens: null,
        completionTokens: null,
        error: null,
      });

      logger.info('[LLMRouter] Agentic task completed', {
        messageId: message.id,
        durationMs,
        responseLength: response.content.length,
      });

      return {
        success: true,
        content: response.content,
        responseId: stored.id,
        routedTo: 'claude',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Don't fall back to Ollama for agentic tasks - the task may have had side effects
      logger.error('[LLMRouter] Agentic task threw an error, NOT falling back to Ollama to avoid inconsistent state', {
        messageId: message.id,
        error: errorMessage,
      });
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
      return {
        success: false,
        error: errorMessage,
        content: isTimeout
          ? 'Die Aufgabe hat zu lange gedauert. Sie wurde möglicherweise teilweise ausgeführt. Bitte überprüfe den Status und versuche es bei Bedarf erneut.'
          : `Ein Fehler ist aufgetreten: ${errorMessage}`,
        routedTo: 'claude',
      };
    }
  }

  /**
   * Handle web search requests
   *
   * Executes web search and includes results in the context for Claude to use.
   * This implements a pre-processing agentic pattern where tool results are
   * gathered before the main LLM call.
   *
   * @param message - The message requiring web search
   * @param context - RAG context string with user preferences, memories, etc.
   * @param conversationHistory - Recent conversation history
   * @returns LLMRouterResult with web-enhanced response
   */
  async handleWebSearchRequest(
    message: Message,
    context: string,
    conversationHistory: Message[]
  ): Promise<LLMRouterResult> {
    return handleWebSearchRequest(
      {
        browserService: this.browserService,
        handleWithClaude: (m, c, h) => this.handleWithClaude(m, c, h),
      },
      message,
      context,
      conversationHistory
    );
  }

  /**
   * Handle plan workflow intents
   *
   * Routes plan-related intents (propose, feedback, approve, execute, status, cancel, list)
   * to the PlanIntentHandlerService for processing.
   *
   * @param message - The message with plan intent
   * @param chat - The chat context
   * @param sender - The sender of the message
   * @param enhancedIntent - The classified enhanced intent
   * @returns LLMRouterResult with the plan operation result
   */
  async handlePlanIntent(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    enhancedIntent: EnhancedIntentResult
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();
    const childIntent = enhancedIntent.childIntent as PlanIntent;

    logger.info('[LLMRouter] Handling plan intent', {
      messageId: message.id,
      chatId: chat.id,
      childIntent,
    });

    try {
      const result = await this.planIntentHandler.handlePlanIntent(childIntent, {
        message,
        chat,
        sender,
        messageText: message.text || '',
      });

      const durationMs = Date.now() - startTime;

      // Store the response
      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({
          type: 'plan_intent',
          intent: childIntent,
          messageText: message.text,
        }),
        response: result.response,
        model: 'claude-plan-handler',
        durationMs,
        promptTokens: null,
        completionTokens: null,
        error: result.success ? null : result.response,
      });

      logger.info('[LLMRouter] Plan intent handled', {
        messageId: message.id,
        childIntent,
        success: result.success,
        durationMs,
        planId: result.plan?.id,
      });

      return {
        success: result.success,
        content: result.response,
        responseId: stored.id,
        routedTo: 'claude',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Plan intent handling failed', {
        messageId: message.id,
        childIntent,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        content: `I encountered an error handling your plan request: ${errorMessage}`,
        routedTo: 'claude',
      };
    }
  }

  /**
   * Handle joke requests with personalized, anti-repetition humor
   *
   * Uses ComicGeneratorService to generate high-quality jokes via Claude,
   * with style detection and anti-repetition tracking.
   *
   * @param message - The message requesting a joke
   * @param sender - The sender of the message (for personalization)
   * @param chat - The chat context
   * @returns LLMRouterResult with the generated joke
   */
  async handleJokeRequest(
    message: Message,
    sender: Sender | null,
    chat: Chat
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();

    logger.info('[LLMRouter] Handling joke request', {
      messageId: message.id,
      chatId: chat.id,
      senderId: sender?.id,
    });

    // Check if comic generator is available
    if (!this.comicGeneratorService) {
      logger.warn('[LLMRouter] ComicGeneratorService not available, using fallback');
      return this.fallbackToOllama(message, []);
    }

    try {
      // Generate the joke
      const result = await this.comicGeneratorService.generateJoke(message, sender, {
        senderId: sender?.id ?? null,
        chatId: chat.id,
        senderName: sender?.firstName ?? undefined,
      });

      const durationMs = Date.now() - startTime;

      if (!result.success) {
        logger.error('[LLMRouter] Joke generation failed', {
          messageId: message.id,
          error: result.error,
        });
        return {
          success: false,
          error: result.error,
          content: "I'm having trouble coming up with a joke right now. Try again in a moment!",
          routedTo: 'claude',
        };
      }

      // Store the response
      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({
          type: 'joke_request',
          style: result.style,
          category: result.category,
          jokeHash: result.jokeHash,
        }),
        response: result.joke!,
        model: 'claude-comic',
        durationMs,
        promptTokens: null,
        completionTokens: null,
        error: null,
      });

      logger.info('[LLMRouter] Joke generated successfully', {
        messageId: message.id,
        style: result.style,
        category: result.category,
        durationMs,
        jokeLength: result.joke?.length,
      });

      return {
        success: true,
        content: result.joke,
        responseId: stored.id,
        routedTo: 'claude',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Joke request handling failed', {
        messageId: message.id,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        content: "I'm having trouble coming up with a joke right now. Try again in a moment!",
        routedTo: 'claude',
      };
    }
  }

  /**
   * Check if a message requires web search
   *
   * @param text - Message text to analyze
   * @returns True if web search should be triggered
   */
  requiresWebSearch(text: string): boolean {
    return requiresWebSearch(text);
  }

  /**
   * Fallback to Ollama when Claude is unavailable or fails
   *
   * @param message - The message to respond to
   * @param conversationHistory - Recent conversation history
   * @returns LLMRouterResult with Ollama-generated response
   */
  async fallbackToOllama(
    message: Message,
    conversationHistory: Message[]
  ): Promise<LLMRouterResult> {
    const startTime = Date.now();

    try {
      const chatMessages = buildConversationMessages(conversationHistory, message);

      // Use circuit breaker if available
      const response = this.ollamaCircuitBreaker
        ? await this.ollamaCircuitBreaker.execute(() =>
            this.ollamaClient.chat(chatMessages, `fallback-${message.id}`)
          )
        : await this.ollamaClient.chat(chatMessages, `fallback-${message.id}`);
      const durationMs = Date.now() - startTime;

      // Store the response
      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({ type: 'ollama_fallback', messages: chatMessages }),
        response: response.content,
        model: response.model,
        durationMs,
        promptTokens: response.promptEvalCount ?? null,
        completionTokens: response.evalCount ?? null,
        error: null,
      });

      logger.info('[LLMRouter] Fallback response generated via Ollama', {
        messageId: message.id,
        durationMs,
      });

      return {
        success: true,
        content: response.content,
        responseId: stored.id,
        routedTo: 'ollama',
      };
    } catch (error) {
      const isCircuitOpen = error instanceof CircuitOpenError;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Ollama fallback also failed', {
        messageId: message.id,
        error: errorMessage,
        circuitOpen: isCircuitOpen,
      });

      // Store the failed attempt
      await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify({ type: 'ollama_fallback_failed' }),
        response: '',
        model: 'ollama',
        durationMs: Date.now() - startTime,
        promptTokens: null,
        completionTokens: null,
        error: errorMessage,
      });

      // Instead of dropping the message silently, return a static last-resort response
      const lastResortResponse = LAST_RESORT_RESPONSES[Math.floor(Math.random() * LAST_RESORT_RESPONSES.length)];
      logger.warn('[LLMRouter] Returning last-resort static response', {
        messageId: message.id,
      });

      return {
        success: true,
        content: lastResortResponse,
        routedTo: 'last_resort',
      };
    }
  }

  /**
   * Detect if a message requests an agentic task
   *
   * Checks for patterns like:
   * - "create a file"
   * - "write to file"
   * - "implement X.ts"
   * - "draw up a plan"
   *
   * Also checks conversation history for follow-up patterns like:
   * - "try again"
   * - "do it"
   * - "go ahead"
   *
   * @param text - The message text to analyze
   * @param conversationHistory - Optional conversation history for follow-up detection
   * @returns True if this is an agentic request
   */
  isAgenticRequest(text: string, conversationHistory?: Message[]): boolean {
    return isAgenticRequest(text, conversationHistory);
  }

  /**
   * Get language preference for a chat
   * Returns stored preference or 'en' as default
   * First checks in-memory cache, then database
   */
  async getLanguagePreference(chatId: string): Promise<string> {
    return getLanguagePreference(
      { chatRepository: this.chatRepository, cache: this.chatLanguagePreferences },
      chatId
    );
  }

  /**
   * Update language preference for a chat
   * Persists to database and updates in-memory cache
   */
  async setLanguagePreference(chatId: string, language: string): Promise<void> {
    return setLanguagePreference(
      { chatRepository: this.chatRepository, cache: this.chatLanguagePreferences },
      chatId,
      language
    );
  }

  /**
   * Check if a message contains a language switch request
   */
  detectLanguageSwitch(messageText: string): { detected: boolean; language: string } | null {
    return languagePreferenceService.detectLanguageSwitch(messageText);
  }
}
