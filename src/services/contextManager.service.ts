import { EmbeddingClient } from '../clients/embedding.client.js';
import { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import { EmbeddingRepository } from '../repositories/embedding.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ConversationSummaryRepository, ConversationSummary } from '../repositories/conversationSummary.repository.js';
import { UserPreferenceService } from './userPreference.service.js';
import { Message, Sender } from '../types/index.js';
import type { IContactService } from '../interfaces/services.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { CHARS_PER_TOKEN } from '../constants/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ContextItem {
  type: 'message' | 'memory' | 'summary' | 'preference';
  content: string;
  score: number;
  metadata: {
    id: string;
    createdAt: Date;
    similarity?: number;
    recencyBoost?: number;
    confidence?: number;
    source?: string;
  };
}

export interface RetrievalDebugInfo {
  query: string;
  totalCandidates: number;
  selectedItems: number;
  tokenBudget: number;
  tokensUsed: number;
  sources: {
    messages: number;
    memories: number;
    summaries: number;
    preferences: number;
    contacts: number;
  };
  timings: {
    embeddingMs: number;
    retrievalMs: number;
    scoringMs: number;
    totalMs: number;
  };
}

export interface ContextResult {
  context: string;
  items: ContextItem[];
  debug: RetrievalDebugInfo;
}

export interface ContextOptions {
  /** Legacy sender ID for preferences/contacts (use userId for memories) */
  senderId?: string | null;
  /** Legacy chat ID for messages/summaries (use conversationId for memories) */
  chatId?: string;
  /** Platform-agnostic user ID from unified identity system */
  userId?: string | null;
  /** Platform-agnostic conversation ID from unified identity system */
  conversationId?: string | null;
  maxTokens?: number;
  includePreferences?: boolean;
  includeMemories?: boolean;
  includeSummaries?: boolean;
  includeRecentMessages?: boolean;
  includeContacts?: boolean;
  recentMessageCount?: number;
  minSimilarity?: number;
  topK?: number;
  /** Enable debug logging for context leak detection */
  enableDebugLogging?: boolean;
  /** Message ID for tracking context boundaries */
  messageId?: string;
}

// ============================================================================
// Named Constants
// ============================================================================

/** Milliseconds in one hour (60 seconds * 60 minutes * 1000 milliseconds) */
const MILLISECONDS_PER_HOUR = 1000 * 60 * 60;

/** Factor for rounding scores to 3 decimal places */
const SCORE_ROUNDING_FACTOR = 1000;

/** Maximum number of memories to retrieve for statistics */
const STATS_MEMORY_LIMIT = 1000;

/** Maximum number of messages to retrieve for statistics */
const STATS_MESSAGE_LIMIT = 1000;

/** Maximum number of summaries to retrieve for statistics */
const STATS_SUMMARY_LIMIT = 100;

/** Maximum characters to truncate query for debug output */
const DEBUG_QUERY_TRUNCATE_LENGTH = 100;

/** Maximum characters to truncate query for log output */
const LOG_QUERY_TRUNCATE_LENGTH = 50;

/** Maximum characters to truncate content for debug breakdown */
const DEBUG_CONTENT_TRUNCATE_LENGTH = 100;

/** Tokens to reserve for formatting when assembling context */
const CONTEXT_FORMATTING_RESERVE_TOKENS = 50;

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate tokens for a string (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a token budget
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= estimatedChars) {
    return text;
  }
  return text.slice(0, estimatedChars - 3) + '...';
}

// ============================================================================
// ContextManagerService
// ============================================================================

export class ContextManagerService {
  constructor(
    private embeddingClient: EmbeddingClient,
    private embeddingRepo: EmbeddingRepository,
    private memoryRepo: MemoryRepository,
    private messageRepo: MessageRepository,
    private summaryRepo: ConversationSummaryRepository,
    private userPreferenceService: UserPreferenceService,
    private contactService: IContactService | null = null
  ) {}

  /**
   * Build context for a query using RAG pipeline
   *
   * Priority order:
   * 1. User preferences (always included if available)
   * 2. Recent messages (sliding window)
   * 3. Relevant memories (semantic search)
   * 4. Conversation summaries (for long-term context)
   */
  async buildContext(query: string, options: ContextOptions = {}): Promise<ContextResult> {
    const startTime = Date.now();
    const timings = {
      embeddingMs: 0,
      retrievalMs: 0,
      scoringMs: 0,
      totalMs: 0,
    };

    const {
      senderId,
      chatId,
      userId,
      conversationId,
      maxTokens = appConfig.rag.maxContextTokens,
      includePreferences = true,
      includeMemories = appConfig.memory.enabled,
      includeSummaries = true,
      includeRecentMessages = true,
      includeContacts = true,
      recentMessageCount = appConfig.rag.recentMessagesCount,
      minSimilarity = appConfig.rag.similarityThreshold,
      topK = appConfig.rag.topK,
    } = options;

    const allItems: ContextItem[] = [];
    const sources = {
      messages: 0,
      memories: 0,
      summaries: 0,
      preferences: 0,
      contacts: 0,
    };

    // 1. Get user preferences (high priority, always first)
    if (includePreferences && senderId) {
      try {
        const preferenceItems = await this.getPreferenceItems(senderId);
        allItems.push(...preferenceItems);
        sources.preferences = preferenceItems.length;
      } catch (error) {
        logger.debug('[ContextManager] Failed to get preferences', { error });
      }
    }

    // 1.5. Get saved contacts (high priority, after preferences)
    if (includeContacts && senderId && this.contactService) {
      try {
        const contactItems = await this.getContactItems(senderId);
        allItems.push(...contactItems);
        sources.contacts = contactItems.length;
      } catch (error) {
        logger.debug('[ContextManager] Failed to get contacts', { error });
      }
    }

    // 2. Get recent messages (sliding window)
    if (includeRecentMessages && chatId) {
      try {
        const retrievalStart = Date.now();
        const messageItems = await this.getRecentMessageItems(chatId, recentMessageCount, query);
        timings.retrievalMs += Date.now() - retrievalStart;
        allItems.push(...messageItems);
        sources.messages = messageItems.length;
      } catch (error) {
        logger.debug('[ContextManager] Failed to get recent messages', { error });
      }
    }

    // 3. Get relevant memories (semantic search)
    if (includeMemories && appConfig.embedding.enabled) {
      try {
        const embeddingStart = Date.now();
        const memoryItems = await this.getRelevantMemoryItems(query, topK, minSimilarity, userId);
        timings.embeddingMs = Date.now() - embeddingStart;
        allItems.push(...memoryItems);
        sources.memories = memoryItems.length;
      } catch (error) {
        logger.debug('[ContextManager] Failed to get memories', { error });
      }
    }

    // 4. Get conversation summaries
    if (includeSummaries && chatId) {
      try {
        const summaryItems = await this.getSummaryItems(chatId, query);
        allItems.push(...summaryItems);
        sources.summaries = summaryItems.length;
      } catch (error) {
        logger.debug('[ContextManager] Failed to get summaries', { error });
      }
    }

    // Score and rank all items
    const scoringStart = Date.now();
    const rankedItems = this.rankItems(allItems);
    timings.scoringMs = Date.now() - scoringStart;

    // Apply token budget and assemble context
    const { context, selectedItems, tokensUsed } = this.assembleContext(rankedItems, maxTokens);

    timings.totalMs = Date.now() - startTime;

    const debug: RetrievalDebugInfo = {
      query: truncateToTokens(query, LOG_QUERY_TRUNCATE_LENGTH),
      totalCandidates: allItems.length,
      selectedItems: selectedItems.length,
      tokenBudget: maxTokens,
      tokensUsed,
      sources,
      timings,
    };

    const logLevel = options.enableDebugLogging ? 'info' : 'debug';
    logger[logLevel]('[ContextManager] Built context', {
      query: query.slice(0, LOG_QUERY_TRUNCATE_LENGTH),
      candidates: allItems.length,
      selected: selectedItems.length,
      tokensUsed,
      totalMs: timings.totalMs,
      chatId: options.chatId,
      senderId: options.senderId,
      userId: options.userId,
      conversationId: options.conversationId,
      messageId: options.messageId,
      ...sources,
    });

    // Log detailed context breakdown for debugging
    if (options.enableDebugLogging) {
      logger.info('[ContextManager] Context breakdown', {
        messageId: options.messageId,
        chatId: options.chatId,
        query: query.slice(0, DEBUG_QUERY_TRUNCATE_LENGTH),
        items: selectedItems.map(item => ({
          type: item.type,
          id: item.metadata.id,
          score: Math.round(item.score * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR,
          createdAt: item.metadata.createdAt.toISOString(),
          source: item.metadata.source,
        })),
      });
    }

    return {
      context,
      items: selectedItems,
      debug,
    };
  }

  /**
   * Get user preference items with high priority score
   */
  private async getPreferenceItems(senderId: string): Promise<ContextItem[]> {
    const contextString = await this.userPreferenceService.buildContextString(senderId);

    if (!contextString || contextString.trim().length === 0) {
      return [];
    }

    return [{
      type: 'preference',
      content: contextString,
      score: 1.0, // Preferences always have highest priority
      metadata: {
        id: `pref-${senderId}`,
        createdAt: new Date(),
        source: 'preferences',
      },
    }];
  }

  /**
   * Get contact items with high priority score
   */
  private async getContactItems(senderId: string): Promise<ContextItem[]> {
    if (!this.contactService) {
      return [];
    }

    const contextString = await this.contactService.buildContextString(senderId);

    if (!contextString || contextString.trim().length === 0) {
      return [];
    }

    return [{
      type: 'preference', // Contacts are treated as preferences for context
      content: contextString,
      score: 0.95, // Contacts have high priority but slightly lower than core preferences
      metadata: {
        id: `contacts-${senderId}`,
        createdAt: new Date(),
        source: 'contacts',
      },
    }];
  }

  /**
   * Get recent messages with relevance scoring
   */
  private async getRecentMessageItems(
    chatId: string,
    limit: number,
    query: string
  ): Promise<ContextItem[]> {
    const messages = await this.messageRepo.findRecentByChatId(chatId, limit);

    if (messages.length === 0) {
      return [];
    }

    // Score messages by recency and basic relevance
    const items: ContextItem[] = [];
    const now = Date.now();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.text) continue;

      // Recency score: most recent gets highest score
      const recencyScore = 1 - (i / messages.length) * 0.5;

      // Basic relevance: check for keyword overlap
      const relevanceScore = this.calculateBasicRelevance(msg.text, query);

      // Combined score
      const score = recencyScore * 0.6 + relevanceScore * 0.4;

      items.push({
        type: 'message',
        content: `${msg.isBot ? 'Assistant' : 'User'}: ${msg.text}`,
        score,
        metadata: {
          id: msg.id,
          createdAt: msg.createdAt,
          recencyBoost: recencyScore,
          similarity: relevanceScore,
        },
      });
    }

    return items;
  }

  /**
   * Get relevant memories using semantic search
   */
  private async getRelevantMemoryItems(
    query: string,
    topK: number,
    minSimilarity: number,
    userId?: string | null
  ): Promise<ContextItem[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddingClient.embed(query);

    // Search for similar memories
    const similar = await this.embeddingRepo.findSimilar(queryEmbedding.embedding, {
      limit: topK * 2, // Fetch more to filter
      sourceType: 'memory',
      minSimilarity,
    });

    if (similar.length === 0) {
      return [];
    }

    const items: ContextItem[] = [];

    for (const match of similar) {
      const memory = await this.memoryRepo.findById(match.sourceId);
      if (!memory) continue;
      if (memory.isArchived) continue;

      // Filter by userId when provided
      if (userId && memory.userId && memory.userId !== userId) continue;

      // Calculate recency boost
      const recencyBoost = this.calculateRecencyBoost(memory.createdAt);

      // Final score: similarity * recency * confidence
      const score = match.similarity * recencyBoost * (memory.confidence / 100);

      items.push({
        type: 'memory',
        content: `[Memory] ${memory.content}`,
        score,
        metadata: {
          id: memory.id,
          createdAt: memory.createdAt,
          similarity: match.similarity,
          recencyBoost,
          confidence: memory.confidence,
        },
      });

      if (items.length >= topK) break;
    }

    return items;
  }

  /**
   * Get conversation summaries
   */
  private async getSummaryItems(chatId: string, query: string): Promise<ContextItem[]> {
    const summaries = await this.summaryRepo.findByChatId(chatId, 3);

    if (summaries.length === 0) {
      return [];
    }

    return summaries.map((summary, i) => {
      // More recent summaries get higher scores
      const recencyScore = 1 - (i / summaries.length) * 0.3;
      const relevanceScore = this.calculateBasicRelevance(summary.summary, query);
      const score = recencyScore * 0.5 + relevanceScore * 0.5;

      const keyTopics = summary.keyTopics ? JSON.parse(summary.keyTopics) : [];
      const topicsText = keyTopics.length > 0 ? ` (Topics: ${keyTopics.join(', ')})` : '';

      return {
        type: 'summary' as const,
        content: `[Previous conversation summary]${topicsText}\n${summary.summary}`,
        score: score * 0.8, // Slightly lower priority than direct messages/memories
        metadata: {
          id: summary.id,
          createdAt: summary.createdAt,
          recencyBoost: recencyScore,
          similarity: relevanceScore,
        },
      };
    });
  }

  /**
   * Calculate basic keyword relevance
   */
  private calculateBasicRelevance(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    if (queryWords.length === 0) return 0;

    let matches = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matches++;
      }
    }

    return matches / queryWords.length;
  }

  /**
   * Calculate recency boost (exponential decay)
   */
  private calculateRecencyBoost(createdAt: Date): number {
    const ageHours = (Date.now() - createdAt.getTime()) / MILLISECONDS_PER_HOUR;
    const decayHours = appConfig.rag.recencyDecayHours;
    return Math.exp(-ageHours / decayHours);
  }

  /**
   * Rank items by score
   */
  private rankItems(items: ContextItem[]): ContextItem[] {
    // Sort by type priority first, then by score
    const typePriority: Record<ContextItem['type'], number> = {
      preference: 5,  // Always include preferences and contacts first
      message: 3,     // Recent conversation is important
      memory: 2,      // Memories provide long-term context
      summary: 1,     // Summaries fill in gaps
    };

    return [...items].sort((a, b) => {
      // First sort by type priority (higher = more important)
      const typeDiff = typePriority[b.type] - typePriority[a.type];
      if (typeDiff !== 0) return typeDiff;

      // Then by score within same type
      return b.score - a.score;
    });
  }

  /**
   * Assemble final context string within token budget
   */
  private assembleContext(
    items: ContextItem[],
    maxTokens: number
  ): { context: string; selectedItems: ContextItem[]; tokensUsed: number } {
    const selectedItems: ContextItem[] = [];
    const parts: string[] = [];
    let tokensUsed = 0;

    // Reserve some tokens for formatting
    const effectiveMax = maxTokens - CONTEXT_FORMATTING_RESERVE_TOKENS;

    for (const item of items) {
      const itemTokens = estimateTokens(item.content);

      if (tokensUsed + itemTokens > effectiveMax) {
        // Try to fit a truncated version
        const remainingTokens = effectiveMax - tokensUsed;
        if (remainingTokens > 50) {
          const truncated = truncateToTokens(item.content, remainingTokens);
          parts.push(truncated);
          tokensUsed += estimateTokens(truncated);
          selectedItems.push({ ...item, content: truncated });
        }
        break;
      }

      parts.push(item.content);
      tokensUsed += itemTokens;
      selectedItems.push(item);
    }

    // Format context with sections
    const context = this.formatContext(selectedItems);

    return {
      context,
      selectedItems,
      tokensUsed: estimateTokens(context),
    };
  }

  /**
   * Format context items into a readable string
   */
  private formatContext(items: ContextItem[]): string {
    if (items.length === 0) return '';

    const sections: string[] = [];

    // Group by type - contacts are included in preferences for context
    const preferences = items.filter(i => i.type === 'preference' && !i.metadata.source?.includes('contacts'));
    const contacts = items.filter(i => i.type === 'preference' && i.metadata.source?.includes('contacts'));
    const messages = items.filter(i => i.type === 'message');
    const memories = items.filter(i => i.type === 'memory');
    const summaries = items.filter(i => i.type === 'summary');

    // Add contacts first (important for messaging)
    if (contacts.length > 0) {
      sections.push(contacts.map(i => i.content).join('\n'));
    }

    // Add user preferences (without header, it's usually formatted already)
    if (preferences.length > 0) {
      sections.push(preferences.map(i => i.content).join('\n'));
    }

    // Add summaries for background context
    if (summaries.length > 0) {
      sections.push(summaries.map(i => i.content).join('\n'));
    }

    // Add relevant memories
    if (memories.length > 0) {
      sections.push(memories.map(i => i.content).join('\n'));
    }

    // Add recent conversation (most important for response generation)
    if (messages.length > 0) {
      sections.push('Recent conversation:\n' + messages.map(i => i.content).join('\n'));
    }

    return sections.join('\n\n');
  }

  /**
   * Debug method: Inspect context retrieval
   */
  async inspectContext(
    query: string,
    options: ContextOptions = {}
  ): Promise<{
    result: ContextResult;
    breakdown: {
      type: string;
      count: number;
      totalScore: number;
      items: Array<{ content: string; score: number; selected: boolean }>;
    }[];
  }> {
    // Build context with all options enabled for inspection
    const result = await this.buildContext(query, {
      ...options,
      includePreferences: options.includePreferences ?? true,
      includeMemories: options.includeMemories ?? true,
      includeSummaries: options.includeSummaries ?? true,
      includeRecentMessages: options.includeRecentMessages ?? true,
    });

    // Create breakdown by type
    const byType = new Map<string, ContextItem[]>();
    for (const item of result.items) {
      const existing = byType.get(item.type) || [];
      existing.push(item);
      byType.set(item.type, existing);
    }

    const breakdown = Array.from(byType.entries()).map(([type, items]) => ({
      type,
      count: items.length,
      totalScore: items.reduce((sum, i) => sum + i.score, 0),
      items: items.map(i => ({
        content: truncateToTokens(i.content, DEBUG_CONTENT_TRUNCATE_LENGTH),
        score: Math.round(i.score * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR,
        selected: true,
      })),
    }));

    return { result, breakdown };
  }

  /**
   * Get context statistics for a chat/sender
   * @param chatId - Legacy chat ID for messages/summaries
   * @param senderId - Legacy sender ID for preferences
   * @param userId - Unified user ID for memories
   */
  async getContextStats(chatId?: string, senderId?: string, userId?: string): Promise<{
    totalMemories: number;
    totalMessages: number;
    totalSummaries: number;
    hasPreferences: boolean;
    oldestContext: Date | null;
    newestContext: Date | null;
  }> {
    let totalMemories = 0;
    let totalMessages = 0;
    let totalSummaries = 0;
    let hasPreferences = false;
    let oldestContext: Date | null = null;
    let newestContext: Date | null = null;

    // Count memories by unified userId
    if (userId) {
      const memories = await this.memoryRepo.findActiveForUser(userId, STATS_MEMORY_LIMIT);
      totalMemories = memories.length;

      for (const mem of memories) {
        if (!oldestContext || mem.createdAt < oldestContext) oldestContext = mem.createdAt;
        if (!newestContext || mem.createdAt > newestContext) newestContext = mem.createdAt;
      }
    }

    // Check preferences (uses senderId until preference system is migrated)
    if (senderId) {
      const prefs = await this.userPreferenceService.buildContextString(senderId);
      hasPreferences = prefs.length > 0;
    }

    // Count messages
    if (chatId) {
      const messages = await this.messageRepo.findRecentByChatId(chatId, STATS_MESSAGE_LIMIT);
      totalMessages = messages.length;

      for (const msg of messages) {
        if (!oldestContext || msg.createdAt < oldestContext) oldestContext = msg.createdAt;
        if (!newestContext || msg.createdAt > newestContext) newestContext = msg.createdAt;
      }

      // Count summaries
      const summaries = await this.summaryRepo.findByChatId(chatId, STATS_SUMMARY_LIMIT);
      totalSummaries = summaries.length;
    }

    return {
      totalMemories,
      totalMessages,
      totalSummaries,
      hasPreferences,
      oldestContext,
      newestContext,
    };
  }
}
