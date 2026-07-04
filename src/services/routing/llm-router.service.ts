import type { Message, Sender, Chat } from '../../types/index.js';
import type { EnhancedIntentResult, PlanIntent } from '../../types/intent.types.js';
import type { IMemoryService } from '../../interfaces/index.js';
import type { IChatRepository } from '../../interfaces/repositories.js';
import type { ComicGeneratorService } from '../comic/comic-generator.service.js';
import type { BrowserService, PageFetchResult } from '../tools/browser.service.js';
import { LLMClient, ChatMessage } from '../../clients/llm.client.js';
import { ClaudeClient } from '../../clients/claude.client.js';
import { LLMResponseRepository } from '../../repositories/llmResponse.repository.js';
import { CircuitBreakerService, CircuitOpenError } from '../circuitBreaker.service.js';
import { logger } from '../../utils/logger.js';
import { getRecentMessages } from '../../utils/index.js';
import { WebSearchTool, webSearchTool } from '../tools/web-search.tool.js';
import { isWebSearchEnabled, isBrowserMCPEnabled } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
import { PlanIntentHandlerService } from '../planIntentHandler.service.js';
import { languagePreferenceService } from '../languagePreference.service.js';
import { capabilityManifest } from '../../config/capabilities.js';

// ============================================================================
// Named Constants
// ============================================================================

/** Timeout for agentic tasks (2 minutes in milliseconds) */
const AGENTIC_TIMEOUT_MS = 120_000;

/** Maximum search query length for search API */
const MAX_SEARCH_QUERY_LENGTH = 200;

/** Minimum search query length before using original text */
const MIN_SEARCH_QUERY_LENGTH = 5;

/** Static fallback responses when both Claude and Ollama are unavailable */
const LAST_RESORT_RESPONSES = [
  "Hey, I'm having a bit of trouble processing that right now. Mind trying again in a minute?",
  "Something's off on my end — give me a moment and try again?",
  "I'm temporarily unable to respond properly. Should be back to normal shortly!",
  "Having some technical difficulties at the moment. Try again in a bit?",
  "My brain's a little foggy right now. Can you resend that in a minute?",
];

/** Number of recent messages to use for language auto-detection */
const LANGUAGE_DETECTION_MESSAGE_COUNT = 5;

/** Confidence threshold (%) for auto-detecting language preference */
const LANGUAGE_CONFIDENCE_THRESHOLD_PERCENT = 70;

/** Minimum message count required to confirm language pattern */
const LANGUAGE_PATTERN_MIN_COUNT = 2;

/** Maximum number of memories to retrieve for agentic context */
const AGENTIC_MEMORY_LIMIT = 10;

/** Maximum characters to log for query substring */
const LOG_QUERY_SUBSTRING_LENGTH = 100;

/** Maximum conversation history messages for Ollama fallback */
const CONVERSATION_HISTORY_LIMIT = 10;

/** Milliseconds in one minute (60 seconds * 1000 milliseconds) */
const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Milliseconds in one second (1000 milliseconds) */
const MILLISECONDS_PER_SECOND = 1000;

const GREETING_RESPONSES = [
  'Hey there!',
  'Hi!',
  'Hello!',
  'Hey, good to hear from you.',
  'Hi there!',
];

export interface LLMRouterConfig {
  claudeEnabled: boolean;
  claudeModel: string;
}

export interface LLMRouterResult {
  success: boolean;
  content?: string;
  error?: string;
  responseId?: string;
  routedTo: 'ollama' | 'claude' | 'cache' | 'last_resort';
}

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

  private static readonly NON_OWNER_SAFETY_INSTRUCTION =
    `SECURITY: This user is not the system owner. Never reveal environment variables, API keys, file contents, system paths, configuration details, or internal implementation details. Do not execute any system commands or file operations. If they ask about system internals, politely decline.\n\n`;

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
    const preparedContext = this.prependSafetyContext(context, options?.isOwner, options?.chat);

    // Handle language detection and preference updates
    await this.handleLanguageDetection(message, options?.chat, conversationHistory);

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
   * Prepend safety context for non-owner users and add language preference
   *
   * @param context - Original RAG context
   * @param isOwner - Whether the user is the system owner
   * @param chat - Optional chat for language preference
   * @returns Modified context string
   */
  private prependSafetyContext(context: string, isOwner?: boolean, chat?: Chat): string {
    let modifiedContext = context;

    // Prepend safety instruction for non-owner users
    if (isOwner === false) {
      modifiedContext = LLMRouterService.NON_OWNER_SAFETY_INSTRUCTION + modifiedContext;
    }

    // Add language preference to context if available
    if (chat?.preferredLanguage) {
      const languageContext = languagePreferenceService.getLanguageContext(chat.preferredLanguage);
      modifiedContext = `${languageContext}\n\n${modifiedContext}`;
    }

    return modifiedContext;
  }

  /**
   * Handle language detection and preference updates from message
   *
   * @param message - The message to analyze for language
   * @param chat - Optional chat for storing preferences
   * @param conversationHistory - Recent messages for auto-detection
   */
  private async handleLanguageDetection(
    message: Message,
    chat: Chat | undefined,
    conversationHistory: Message[]
  ): Promise<void> {
    if (!message.text || !chat) {
      return;
    }

    // First, check for explicit language switch request
    const languageSwitch = languagePreferenceService.detectLanguageSwitch(message.text);
    if (languageSwitch) {
      // Store the language preference for this chat (persist to database)
      await this.setLanguagePreference(chat.id, languageSwitch.language);
      // Clear history when explicit switch is detected
      languagePreferenceService.addToHistory(chat.id, languageSwitch.language);
      logger.info('[LLMRouter] Language switch detected, updating preference', {
        chatId: chat.id,
        newLanguage: languageSwitch.language,
      });
      return;
    }

    // Skip auto-detection if no conversation history
    if (conversationHistory.length === 0) {
      return;
    }

    // Auto-detect language from recent messages (including current)
    const recentMessages = conversationHistory
      .filter(m => m.text && m.text.trim().length > MIN_SEARCH_QUERY_LENGTH)
      .slice(0, LANGUAGE_DETECTION_MESSAGE_COUNT)
      .map(m => m.text!);

    const autoDetect = languagePreferenceService.detectLanguageFromMessages(recentMessages);

    // Add to history
    languagePreferenceService.addToHistory(chat.id, autoDetect.language);

    // Check if we have enough history to make a confident decision
    if (autoDetect.confidence <= LANGUAGE_CONFIDENCE_THRESHOLD_PERCENT) {
      return;
    }

    // Get most detected language from history
    const mostDetected = languagePreferenceService.getMostDetectedLanguage(chat.id);
    if (!mostDetected || mostDetected.count < LANGUAGE_PATTERN_MIN_COUNT) {
      return;
    }

    // Only update if there's a clear pattern and different from current
    const currentPref = chat.preferredLanguage || 'unknown';
    if (currentPref !== mostDetected.language) {
      await this.setLanguagePreference(chat.id, mostDetected.language);
      logger.info('[LLMRouter] Auto-detected language preference, updating', {
        chatId: chat.id,
        detectedLanguage: mostDetected.language,
        count: mostDetected.count,
        confidence: autoDetect.confidence,
      });
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
   * Build context for agentic tasks including user info and recent conversation
   *
   * @param sender - The sender of the message (for context)
   * @param conversationHistory - Recent conversation history for context
   * @returns Context string with user info and recent messages
   */
  private buildAgenticContext(
    sender: Sender | null,
    conversationHistory: Message[]
  ): string {
    let context = '';

    // Add user information
    if (sender) {
      context += `User: ${sender.firstName || 'User'}`;
      if (sender.username) context += ` (@${sender.username})`;
      context += '\n';
    }

    // Add recent conversation for context (messages are in descending order)
    const recentMessages = getRecentMessages(conversationHistory, LANGUAGE_DETECTION_MESSAGE_COUNT);
    if (recentMessages.length > 0) {
      context += '\nRecent conversation:\n';
      for (const msg of recentMessages) {
        const role = msg.senderId === sender?.id ? 'User' : 'Jarvis';
        context += `${role}: ${msg.text?.substring(0, 200) || '[no text]'}\n`;
      }
    }

    return context;
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
   * Construct the full agentic task prompt with capabilities and instructions
   *
   * @param context - Context string with user info and memories
   * @param messageText - The current request text
   * @returns Complete task prompt for the agentic LLM
   */
  private constructAgenticPrompt(context: string, messageText: string): string {
    const capabilityPrompt = capabilityManifest.generateCapabilityPrompt();

    return `${context}\n\nCurrent request: ${messageText}\n\nYou are Jarvis, a helpful personal assistant running as a Telegram bot. You are responding to the user via Telegram.

${capabilityPrompt}

- Keep responses short and casual. You're a chill friend, not a corporate assistant.
- The user is in Germany. Use metric units (Celsius, kilometers, etc.).

STORING MEMORIES:
- To store a new memory, use: sqlite3 data/jarvis.db "INSERT INTO memories (id, senderId, memoryType, content, confidence, isArchived, accessCount, sourceMessageIds, createdAt, updatedAt, lastAccessedAt) VALUES ('<nanoid>', '<senderId>', '<type>', '<content>', <confidence>, 0, 0, '[]', unixepoch(), unixepoch(), unixepoch());"
- IMPORTANT: After inserting a memory, you MUST also create an embedding for RAG to work:
  1. First get the embedding from Ollama: curl -s http://localhost:11434/api/embeddings -d '{"model": "nomic-embed-text", "prompt": "<content>"}' | jq -r '.embedding'
  2. Then insert it: sqlite3 data/jarvis.db "INSERT INTO embeddings (id, sourceType, sourceId, content, embedding, model, dimensions, createdAt) VALUES ('<nanoid>', 'memory', '<memory_id>', '<content>', '<embedding_json>', 'nomic-embed-text', 768, unixepoch());"
- Memory types: fact, preference, event, relationship`;
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
      let context = this.buildAgenticContext(sender, conversationHistory);

      // Retrieve relevant memories for the request
      context = await this.retrieveAgenticMemories(context, message.text || '', message.id);

      // Build the agentic task prompt with capabilities
      const taskPrompt = this.constructAgenticPrompt(context, message.text || '');

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
    const startTime = Date.now();
    const messageText = message.text || '';

    // Guard: Check if web search is enabled
    if (!isWebSearchEnabled()) {
      logger.info('[LLMRouter] Web search disabled, falling back to standard handling', {
        messageId: message.id,
      });
      return this.handleWithClaude(message, context, conversationHistory);
    }

    logger.info('[LLMRouter] Handling web search request', {
      messageId: message.id,
      query: messageText.substring(0, LOG_QUERY_SUBSTRING_LENGTH),
    });

    try {
      // Extract search query from message
      const searchQuery = this.extractSearchQuery(messageText);

      // Execute web search
      const searchResult = await webSearchTool.execute(searchQuery);
      const searchDurationMs = Date.now() - startTime;

      // Guard: Handle failed search with fallback context
      if (!searchResult.success) {
        return this.handleFailedWebSearch(message, context, conversationHistory, searchQuery, searchResult);
      }

      // Format search results for LLM context
      const searchContext = webSearchTool.formatForLLM(searchResult);

      // Enrich search results with full page content via browser
      let browserContent = '';
      if (this.browserService && searchResult.results.length > 0) {
        try {
          const urlsToFetch = searchResult.results
            .slice(0, appConfig.browser.fetchTopN)
            .map(r => r.url);

          const pageResults = await this.browserService.fetchMultiplePages(urlsToFetch);
          const successfulPages = pageResults.filter(r => r.success && r.content);

          if (successfulPages.length > 0) {
            browserContent = '\n\n[Full Page Content]:\n' +
              successfulPages
                .map(r => `--- ${r.url} ---\n${r.content}`)
                .join('\n\n');

            logger.info('[LLMRouter] Browser content enrichment succeeded', {
              messageId: message.id,
              fetchedPages: successfulPages.length,
              totalPages: urlsToFetch.length,
            });
          }
        } catch (error) {
          logger.warn('[LLMRouter] Browser content enrichment failed, using snippets only', {
            messageId: message.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Build enhanced context with web results
      const enhancedContext = `${context}\n\n[Web Search Results - Retrieved ${new Date().toISOString()}]:\n${searchContext}${browserContent}\n\n[Instructions]: Use the above search results to provide accurate, current information. Cite sources where appropriate.`;

      logger.info('[LLMRouter] Web search completed, routing to Claude', {
        messageId: message.id,
        searchDurationMs,
        resultCount: searchResult.results.length,
      });

      // Now route to Claude with enhanced context
      const result = await this.handleWithClaude(message, enhancedContext, conversationHistory);

      // Log combined metrics
      const totalDurationMs = Date.now() - startTime;
      logger.info('[LLMRouter] Web search request completed', {
        messageId: message.id,
        searchDurationMs,
        totalDurationMs,
        routedTo: result.routedTo,
        success: result.success,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLMRouter] Web search request failed', {
        messageId: message.id,
        error: errorMessage,
      });

      // Fallback to standard handling
      return this.handleWithClaude(message, context, conversationHistory);
    }
  }

  /**
   * Handle failed web search by building appropriate fallback context
   *
   * @param message - The original message
   * @param context - Original RAG context
   * @param conversationHistory - Conversation history
   * @param searchQuery - The search query that failed
   * @param searchResult - The failed search result
   * @returns LLMRouterResult with fallback context
   */
  private async handleFailedWebSearch(
    message: Message,
    context: string,
    conversationHistory: Message[],
    searchQuery: string,
    searchResult: Awaited<ReturnType<typeof webSearchTool.execute>>
  ): Promise<LLMRouterResult> {
    logger.warn('[LLMRouter] Web search failed, proceeding without results', {
      messageId: message.id,
      error: searchResult.error,
      retryCount: searchResult.retryCount,
    });

    // Try to get cached results as fallback
    const cachedResults = webSearchTool.getCachedResults(searchQuery);

    // Build appropriate search context based on failure type
    const searchContext = this.buildFailedSearchContext(searchResult, cachedResults);

    // Proceed without web results (or with cached results), but inform the LLM
    const enhancedContext = `${context}\n\n${searchContext}`;
    return this.handleWithClaude(message, enhancedContext, conversationHistory);
  }

  /**
   * Build context string for failed web searches
   *
   * @param searchResult - The failed search result
   * @param cachedResults - Any cached results available
   * @returns Context string for the LLM
   */
  private buildFailedSearchContext(
    searchResult: Awaited<ReturnType<typeof webSearchTool.execute>>,
    cachedResults: ReturnType<typeof webSearchTool.getCachedResults>
  ): string {
    // Handle rate limiting with cached results
    if (searchResult.rateLimitedUntil) {
      return this.buildRateLimitedContext(searchResult.rateLimitedUntil, cachedResults);
    }

    // Generic search failure — don't expose error details to the LLM
    return `[System: Web search is temporarily unavailable. Answer the user's question using your own knowledge. Do NOT mention that web search failed or is unavailable — just answer naturally. If your information might be outdated, briefly note that.]`;
  }

  /**
   * Build context string for rate-limited searches
   *
   * @param rateLimitedUntil - When the rate limit expires
   * @param cachedResults - Any cached results available
   * @returns Context string for the LLM
   */
  private buildRateLimitedContext(
    rateLimitedUntil: Date,
    cachedResults: ReturnType<typeof webSearchTool.getCachedResults>
  ): string {
    const waitTimeMs = rateLimitedUntil.getTime() - Date.now();
    const waitTimeReadable = waitTimeMs < MILLISECONDS_PER_MINUTE
      ? `${Math.round(waitTimeMs / MILLISECONDS_PER_SECOND)} seconds`
      : `${Math.round(waitTimeMs / MILLISECONDS_PER_MINUTE)} minutes`;

    // Use cached results if available
    if (cachedResults && cachedResults.length > 0) {
      const cachedResultsText = cachedResults
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`)
        .join('\n\n');

      return `[System: Web search is temporarily unavailable. Use these cached results to answer the user's question.]\n\n${cachedResultsText}`;
    }

    // No cached results - instruct LLM to use its knowledge without exposing rate limit details
    return `[System: Web search is temporarily unavailable. Answer the user's question using your own knowledge. Do NOT mention that web search failed or is unavailable — just answer naturally. If your information might be outdated, briefly note that.]`;
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
   * Extract a search-optimized query from user message
   *
   * @param text - User message text
   * @returns Optimized search query
   */
  private extractSearchQuery(text: string): string {
    // Remove common prefixes that don't add search value
    let query = text
      .replace(/^(search|google|look\s*up|find)\s*(for|me)?\s*/i, '')
      .replace(/^(what'?s?\s*(the\s*)?|tell\s*me\s*(about\s*)?)/i, '')
      .replace(/^(can\s*you\s*(find|search|tell\s*me))\s*/i, '')
      .trim();

    // If query is too short after cleanup, use original
    if (query.length < MIN_SEARCH_QUERY_LENGTH) {
      query = text;
    }

    // Limit query length for search API
    if (query.length > MAX_SEARCH_QUERY_LENGTH) {
      query = query.substring(0, MAX_SEARCH_QUERY_LENGTH);
    }

    return query;
  }

  /**
   * Check if a message requires web search
   *
   * @param text - Message text to analyze
   * @returns True if web search should be triggered
   */
  requiresWebSearch(text: string): boolean {
    if (!text || !isWebSearchEnabled()) {
      return false;
    }

    const webSearchPatterns = [
      // Weather
      /\b(weather|forecast|temperature)\s*(in|for|at)?\b/i,
      // Current events/news
      /\b(current|today'?s?|latest|recent)\s*(news|price|stock|score)\b/i,
      /\bwho\s*won\s*(the|last|yesterday)/i,
      /\bwhat\s*time\s*is\s*it\s*in\b/i,
      // News patterns
      /\bwhat'?s?\s*(going\s*on|happening)\s*(in|with|around)?\s*(the\s*)?(world|news|today)?/i,
      /\b(news|headlines)\s*(about|on|from|in|for)\s+/i,
      /\bwhat'?s?\s*(the\s*)?(latest|new|news)\s*(in|on|about|with)?\b/i,
      /\bwhat'?s?\s*new\s*(in|with|on)\s+/i,
      /\b(tell|give)\s*me\s*(the\s*)?(news|headlines|updates)/i,
      /\b(update|updates)\s*(on|about|from)\s+/i,
      /\b(happened|happening)\s*(in|to|with|at)\s+/i,
      // Explicit search
      /^(search|google|look\s*up|find)\s*(for|me)?\s+/i,
      // Prices and market data
      /\b(price|cost)\s*(of|for)\s+/i,
      /\b(stock|crypto|bitcoin|ethereum)\s*(price|value|worth)/i,
      // Sports
      /\b(score|result)\s*(of|for|from)\s+/i,
      /\bwho\s*(is\s*)?(playing|won|lost)/i,
    ];

    return webSearchPatterns.some((pattern) => pattern.test(text));
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
      const chatMessages = this.buildConversationMessages(conversationHistory, message);

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
    const agenticPatterns = [
      // File operations
      /create\s+(a\s+)?file/i,
      /write\s+(to\s+)?file/i,
      /save\s+(to|in|into)\s+/i,
      /put\s+(it\s+)?(inside|in|into)\s+/i,
      /implement\s+.*\.(ts|js|md|txt|json)/i,
      /generate\s+.*\.(ts|js|md|txt|json)/i,
      /\.(md|txt|ts|js|json)\s+(file|in\s+the)/i,
      /impl\.md/i,
      /draw\s+up\s+a\s+plan/i,
      /write\s+(code|implementation)/i,
      // Shell/script operations
      /run\s+(the\s+)?(script|command|bash|shell)/i,
      /execute\s+(the\s+)?(script|command|bash|shell)/i,
      /start\s+(the\s+)?(script|server|service|process)/i,
      /stop\s+(the\s+)?(script|server|service|process)/i,
      /restart\s+(the\s+)?(script|server|service|process)/i,
      /kick\s+(off|it\s+off)/i,
      /launch\s+(the\s+)?/i,
      /\.sh\b/i,  // Any .sh file reference
      /check\s+(if\s+)?(it'?s?\s+)?running/i,
      /is\s+(it\s+)?running/i,
      /ps\s+aux/i,
      /process(es)?\s+(list|status|running)/i,
      // System operations
      /install\s+(the\s+)?/i,
      /deploy\s+/i,
      /build\s+(the\s+)?(project|app|code)/i,
      /npm\s+(run|install|start|test)/i,
      /git\s+(status|pull|push|commit|clone)/i,
      // German equivalents
      /speicher(e|n)\s+/i,  // speichere/speichern (save/store)
      /erstell(e|en)\s+/i,  // erstelle/erstellen (create)
      /schreib(e|en)\s+(in|auf|zu)\s+/i,  // schreibe in (write to)
      /schick(e|en)\s+/i,   // schicke/schicken (send)
      /send(e|en)\s+/i,     // sende/senden (send)
      /führ(e|en)\s+.*aus/i, // führe ... aus (execute)
      /starte\s+/i,         // starte (start)
      /stopp(e|en)\s+/i,    // stoppe/stoppen (stop)
    ];

    // Check current message
    if (agenticPatterns.some((pattern) => pattern.test(text))) {
      return true;
    }

    // Check if this is a follow-up to an agentic request (e.g., "try again", "do it")
    const followUpPatterns = [
      /try\s+.{0,10}(again|more)/i,  // "try [typos] again/more"
      /do\s+it/i,
      /go\s+(ahead|for\s+it)/i,
      /please\s*(do|try)/i,
      /yes\s*(please)?/i,
      /ok\s*(do\s+it)?/i,
      /one\s*more\s*time/i,
      /again\s*please/i,
      /retry/i,
      /more\s*plea/i,  // "more please" with typos
    ];

    if (followUpPatterns.some((pattern) => pattern.test(text)) && conversationHistory?.length) {
      // Check last 5 messages for agentic request (messages are in descending order)
      const recentMessages = getRecentMessages(conversationHistory, 5);
      for (const msg of recentMessages) {
        if (msg.text && agenticPatterns.some((pattern) => pattern.test(msg.text!))) {
          logger.debug('[LLMRouter] Follow-up to agentic request detected', {
            currentMessage: text.substring(0, 50),
            originalRequest: msg.text.substring(0, 100),
          });
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build conversation messages for Ollama chat API
   *
   * @param history - Conversation history
   * @param currentMessage - Current message to respond to
   * @returns Array of chat messages
   */
  private buildConversationMessages(
    history: Message[],
    currentMessage: Message
  ): ChatMessage[] {
    // Use capability manifest for system prompt
    const capabilityPrompt = capabilityManifest.generateCapabilityPrompt();

    const systemPrompt = `You're Jarvis, a friendly and chill assistant. Keep responses under 3500 characters.

${capabilityPrompt}

You have full access to the local machine - you can read/write files, execute shell commands, browse the filesystem, and interact with system services.`;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    // Add conversation history (last N messages, in chronological order)
    const recent = history.slice(0, CONVERSATION_HISTORY_LIMIT).reverse();

    for (const msg of recent) {
      if (!msg.text) continue;
      messages.push({
        role: msg.isBot ? 'assistant' : 'user',
        content: msg.text,
      });
    }

    // Add current message
    if (currentMessage.text) {
      messages.push({
        role: 'user',
        content: currentMessage.text,
      });
    }

    return messages;
  }

  /**
   * Get language preference for a chat
   * Returns stored preference or 'en' as default
   * First checks in-memory cache, then database
   */
  async getLanguagePreference(chatId: string): Promise<string> {
    // Check in-memory cache first
    if (this.chatLanguagePreferences.has(chatId)) {
      return this.chatLanguagePreferences.get(chatId)!;
    }

    // Fall back to database
    if (this.chatRepository) {
      try {
        const chat = await this.chatRepository.findById(chatId);
        if (chat && chat.preferredLanguage) {
          // Cache the result
          this.chatLanguagePreferences.set(chatId, chat.preferredLanguage);
          return chat.preferredLanguage;
        }
      } catch (error) {
        logger.warn('[LLMRouter] Failed to fetch language preference from database', {
          chatId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return 'en'; // Default to English
  }

  /**
   * Update language preference for a chat
   * Persists to database and updates in-memory cache
   */
  async setLanguagePreference(chatId: string, language: string): Promise<void> {
    // Update in-memory cache
    this.chatLanguagePreferences.set(chatId, language);

    // Persist to database
    if (this.chatRepository) {
      try {
        await this.chatRepository.updatePreferredLanguage(chatId, language);
        logger.info('[LLMRouter] Language preference persisted to database', {
          chatId,
          language,
        });
      } catch (error) {
        logger.warn('[LLMRouter] Failed to persist language preference to database', {
          chatId,
          language,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Check if a message contains a language switch request
   */
  detectLanguageSwitch(messageText: string): { detected: boolean; language: string } | null {
    return languagePreferenceService.detectLanguageSwitch(messageText);
  }
}
