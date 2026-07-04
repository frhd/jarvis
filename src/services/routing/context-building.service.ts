import type { Message, Sender } from '../../types/index.js';
import type { ChatMessage } from '../../clients/llm.client.js';
import type { ContextResult, ContextOptions } from '../contextManager.service.js';
import { ContextManagerService } from '../contextManager.service.js';
import { UserPreferenceService } from '../userPreference.service.js';
import type { ContactService } from '../contact.service.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Number of recent messages to include in intent classification context */
const CLASSIFICATION_CONTEXT_WINDOW_SIZE = 5;

// ============================================================================
// Types
// ============================================================================

export interface RAGContextOptions {
  /** @deprecated Use userId instead. Will be removed in Phase 10. */
  senderId?: string | null;
  /** @deprecated Use conversationId instead. Will be removed in Phase 10. */
  chatId?: string;
  /** Platform-agnostic user ID from unified identity system */
  userId?: string | null;
  /** Platform-agnostic conversation ID from unified identity system */
  conversationId?: string | null;
  maxTokens?: number;
  recentMessageCount?: number;
  /** Message ID for context tracking and debugging */
  messageId?: string;
  /** Enable detailed debug logging for context leak detection */
  enableDebugLogging?: boolean;
}

// ============================================================================
// ContextBuildingService
// ============================================================================

/**
 * Service responsible for building context strings for LLM interactions.
 * Extracts context building logic from ResponseRouterService.
 *
 * Supports multiple context types:
 * - Simple context: Recent messages + user preferences + contacts (fallback)
 * - Classification context: Last 3-5 messages for intent classification
 * - RAG context: Full RAG pipeline with preferences, memories, summaries, contacts
 * - Chat messages: Formatted message array for LLM chat API
 */
export class ContextBuildingService {
  constructor(
    private contextManager: ContextManagerService | null = null,
    private userPreferenceService: UserPreferenceService | null = null,
    private contactService: ContactService | null = null
  ) {}

  /**
   * Build context for intent classification
   * Takes last 3-5 messages for lightweight context
   */
  buildClassificationContext(history: Message[]): string {
    // Take last N messages for context
    const recent = history.slice(0, CLASSIFICATION_CONTEXT_WINDOW_SIZE).reverse();
    if (recent.length === 0) return '';

    return recent
      .map((m) => {
        // Use transcript for voice messages if available
        const messageText = m.transcript && m.mediaType === 'voice'
          ? `[Voice: ${m.transcript}]`
          : (m.text || '[no text]');
        return `${m.isBot ? 'Assistant' : 'User'}: ${messageText}`;
      })
      .join('\n');
  }

  /**
   * Build full conversation context with user preferences and contacts
   * Used for Claude chat and other conversational interactions
   *
   * @param history - Conversation history (descending order, newest first)
   * @param sender - Sender information for personalization
   * @param contextWindowSize - Number of messages to include (default: 10)
   */
  async buildConversationContext(
    history: Message[],
    sender: Sender | null,
    contextWindowSize: number = 10
  ): Promise<string> {
    // Build conversation context string
    let context = this.buildContextForDisplay(history, contextWindowSize);

    // Add user preferences for personalization
    const personalizationParts: string[] = [];
    if (sender && this.userPreferenceService) {
      try {
        const personalizationContext = await this.userPreferenceService.buildContextString(sender.id);
        if (personalizationContext) {
          personalizationParts.push(personalizationContext);
        }
      } catch (error) {
        logger.debug('[ContextBuilder] Failed to get preferences for context', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Add saved contacts to context
    if (sender && this.contactService) {
      try {
        const contactsContext = await this.contactService.buildContextString(sender.id);
        if (contactsContext) {
          personalizationParts.push(contactsContext);
        }
      } catch (error) {
        logger.debug('[ContextBuilder] Failed to get contacts for context', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Combine all personalization context parts
    if (personalizationParts.length > 0) {
      context = personalizationParts.join('\n\n') + '\n\n' + context;
    }

    return context;
  }

  /**
   * Build RAG-based context using semantic search and multi-tier retrieval
   * Returns null if RAG is not available (contextManager is null)
   *
   * @param query - The query to build context for
   * @param options - RAG retrieval options
   */
  async buildRAGContext(query: string, options: RAGContextOptions): Promise<ContextResult | null> {
    if (!this.contextManager) {
      return null;
    }

    const contextOptions: ContextOptions = {
      senderId: options.senderId,
      chatId: options.chatId,
      userId: options.userId,
      conversationId: options.conversationId,
      maxTokens: options.maxTokens,
      recentMessageCount: options.recentMessageCount,
      messageId: options.messageId,
      enableDebugLogging: options.enableDebugLogging,
    };

    try {
      const result = await this.contextManager.buildContext(query, contextOptions);
      logger.debug('[ContextBuilder] Built RAG context', {
        messageId: options.messageId,
        chatId: options.chatId,
        candidates: result.debug.totalCandidates,
        selected: result.debug.selectedItems,
        tokensUsed: result.debug.tokensUsed,
        sources: result.debug.sources,
      });
      return result;
    } catch (error) {
      logger.warn('[ContextBuilder] RAG context failed', {
        messageId: options.messageId,
        chatId: options.chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Build chat messages array for LLM chat API
   * Includes system prompt, conversation history, and current message
   *
   * @param history - Conversation history (descending order, newest first)
   * @param currentMessage - The current message to add
   * @param sender - Sender information for personalization
   * @param systemPrompt - Base system prompt
   * @param contextWindowSize - Number of history messages to include (default: 10)
   */
  async buildChatMessages(
    history: Message[],
    currentMessage: Message,
    sender: Sender | null,
    systemPrompt: string,
    contextWindowSize: number = 10
  ): Promise<ChatMessage[]> {
    // Build personalized system prompt with preferences and contacts
    let enhancedSystemPrompt = systemPrompt;
    const personalizationParts: string[] = [];
    if (sender) {
      // Add user preferences
      if (this.userPreferenceService) {
        try {
          const personalizationContext = await this.userPreferenceService.buildContextString(sender.id);
          if (personalizationContext) {
            personalizationParts.push(personalizationContext);
          }
        } catch (error) {
          logger.debug('[ContextBuilder] Failed to get preferences for messages', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Add saved contacts
      if (this.contactService) {
        try {
          const contactsContext = await this.contactService.buildContextString(sender.id);
          if (contactsContext) {
            personalizationParts.push(contactsContext);
          }
        } catch (error) {
          logger.debug('[ContextBuilder] Failed to get contacts for messages', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    if (personalizationParts.length > 0) {
      enhancedSystemPrompt += `\n\n${personalizationParts.join('\n\n')}`;
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: enhancedSystemPrompt,
      },
    ];

    // Add conversation history (reversed to chronological order)
    const recent = history.slice(0, contextWindowSize).reverse();

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
   * Build simple context for display (Claude format)
   * Internal helper for building conversation context strings
   */
  private buildContextForDisplay(history: Message[], contextWindowSize: number): string {
    const recent = history.slice(0, contextWindowSize).reverse();

    if (recent.length === 0) return '';

    return recent
      .map((m) => {
        // Use transcript for voice messages if available
        const messageText = m.transcript && m.mediaType === 'voice'
          ? `[Voice: ${m.transcript}]`
          : (m.text || '[no text]');
        return `${m.isBot ? 'Assistant' : 'User'}: ${messageText}`;
      })
      .join('\n\n');
  }
}
