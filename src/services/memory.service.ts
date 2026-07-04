import { LLMClient, ChatMessage } from '../clients/llm.client.js';
import { EmbeddingClient } from '../clients/embedding.client.js';
import { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import { EmbeddingRepository, SimilarityResult } from '../repositories/embedding.repository.js';
import { Message } from '../types/index.js';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getRecentMessages } from '../utils/index.js';
import type { IMemoryService, ExtractionResult, RetrievalOptions, RetrievalResult, MemoryStats, ExtractedFact } from '../interfaces/index.js';

// Re-export types for backward compatibility
export type { ExtractionResult, RetrievalOptions, RetrievalResult, MemoryStats, ExtractedFact };

interface ExtractedData {
  facts?: Array<{ type: string; content: string; confidence: number }>;
}

/** Similarity threshold for considering two memories as duplicates (0-1 scale) */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

/** Minimum confidence for "high confidence" classification (0-1 scale) */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

/** Minimum confidence for "medium confidence" classification (0-1 scale) */
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;

/** Milliseconds in one hour (60 seconds * 60 minutes * 1000 milliseconds) */
const MILLISECONDS_PER_HOUR = 1000 * 60 * 60;

/** Maximum number of memories to retrieve for statistics */
const STATS_MEMORY_LIMIT = 1000;

const EXTRACTION_PROMPT = `Analyze this conversation and extract important facts, preferences, events, or relationships mentioned by the user.

Categories to extract:
- Personal facts: name, location, occupation, background, family, hobbies
- Preferences: likes, dislikes, communication style, technical preferences
- Events: life changes, milestones, upcoming plans, past experiences
- Relationships: people mentioned, their roles (friend, colleague, family)
- Technical: coding preferences, tools used, project context, tech stack choices
- Capabilities: user corrections about what Jarvis can/cannot do (e.g., "you CAN send Telegram messages")
- Contact information: phone numbers, emails, addresses with normalization notes

Confidence scoring guide:
- 0.8-1.0: Explicitly stated facts ("I'm a software engineer", "I prefer TypeScript", "you can send Telegram messages")
- 0.5-0.79: Strongly implied ("Been doing this for years" → experienced)
- 0.3-0.49: Reasonably inferred from context

Rules:
- Extract both explicit AND implied information
- Focus on information useful for future conversations
- Skip only clearly temporary states ("I'm eating lunch", "brb")
- Include recurring topics or interests even if not explicitly stated
- CRITICAL: When user corrects Jarvis about capabilities (e.g., "you CAN send messages", "you know you can do X"), extract this as a high-confidence fact
- Extract contact information with full details (name + number + preferred format)

Return a JSON object with this exact structure:
{
  "facts": [
    {"type": "fact|preference|event|relationship|capability", "content": "...", "confidence": 0.0-1.0}
  ]
}

If no meaningful facts to extract, return: {"facts": []}

User message:`;

export class MemoryService implements IMemoryService {
  private llmClient: LLMClient;
  private embeddingClient: EmbeddingClient;
  private memoryRepo: MemoryRepository;
  private embeddingRepo: EmbeddingRepository;

  constructor(
    llmClient: LLMClient,
    embeddingClient: EmbeddingClient,
    memoryRepo: MemoryRepository,
    embeddingRepo: EmbeddingRepository
  ) {
    this.llmClient = llmClient;
    this.embeddingClient = embeddingClient;
    this.memoryRepo = memoryRepo;
    this.embeddingRepo = embeddingRepo;
  }

  /**
   * Extract facts from a message and store them as memories.
   * @param message The message to extract from
   * @param conversationContext Recent conversation messages for context
   * @param options Unified identity params (userId, conversationId)
   */
  async extractAndStore(
    message: Message,
    conversationContext?: Message[],
    options?: { userId?: string; conversationId?: string }
  ): Promise<ExtractionResult> {
    if (!appConfig.memory.enabled || !appConfig.embedding.enabled) {
      return { facts: [], processed: false };
    }

    if (!message.text || message.text.trim().length === 0) {
      return { facts: [], processed: false };
    }

    try {
      // Build context from recent messages if available (messages are in descending order)
      let contextText = '';
      if (conversationContext && conversationContext.length > 0) {
        const recentMessages = getRecentMessages(conversationContext, 5);
        contextText = recentMessages
          .map((m) => `${m.isBot ? 'Assistant' : 'User'}: ${m.text}`)
          .join('\n');
        contextText += '\n';
      }

      const extractedFacts = await this.extractFacts(contextText + `User: ${message.text}`);

      if (extractedFacts.length === 0) {
        return { facts: [], processed: true };
      }

      // Normalize threshold: config is 0-100, LLM confidence is 0-1
      const normalizedThreshold = appConfig.memory.minConfidence / 100;
      const confidentFacts = extractedFacts.filter(
        (f) => f.confidence >= normalizedThreshold
      );

      if (confidentFacts.length === 0) {
        return { facts: extractedFacts, processed: true };
      }

      // Metrics tracking
      let duplicateCount = 0;
      let storedCount = 0;
      let errorCount = 0;
      const confidenceDistribution = {
        high: 0,    // >= 0.8
        medium: 0,  // 0.5-0.79
        low: 0,     // 0.3-0.49
      };

      // Categorize confidence distribution
      for (const fact of extractedFacts) {
        if (fact.confidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceDistribution.high++;
        else if (fact.confidence >= MEDIUM_CONFIDENCE_THRESHOLD) confidenceDistribution.medium++;
        else confidenceDistribution.low++;
      }

      const storedFacts: ExtractedFact[] = [];
      for (const fact of confidentFacts) {
        try {
          // Generate embedding ONCE - reuse for both duplicate check and storage
          const embeddingResponse = await this.embeddingClient.embed(fact.content);

          // Check for duplicates using the pre-generated embedding
          const isDuplicate = await this.checkDuplicateWithEmbedding(
            embeddingResponse.embedding,
            options?.userId
          );
          if (isDuplicate) {
            duplicateCount++;
            logger.debug('[Memory] Skipping duplicate memory', { content: fact.content });
            continue;
          }

          const memory = await this.memoryRepo.create({
            senderId: null,
            chatId: null,
            userId: options?.userId ?? null,
            conversationId: options?.conversationId ?? null,
            memoryType: fact.type,
            content: fact.content,
            confidence: Math.round(fact.confidence * 100),
            sourceMessageIds: JSON.stringify([message.id]),
          });

          // Reuse the same embedding for storage
          await this.embeddingRepo.create({
            sourceType: 'memory',
            sourceId: memory.id,
            content: memory.content,
            embedding: JSON.stringify(embeddingResponse.embedding),
            model: appConfig.embedding.model,
            dimensions: appConfig.embedding.dimensions,
          });

          storedFacts.push(fact);
          storedCount++;
          logger.info('[Memory] Stored new memory', {
            memoryId: memory.id,
            type: fact.type,
            confidence: fact.confidence,
          });
        } catch (error) {
          errorCount++;
          logger.error('[Memory] Failed to store fact', {
            fact,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Log extraction metrics
      logger.info('[Memory] Extraction metrics', {
        messageId: message.id,
        factsExtracted: extractedFacts.length,
        factsAboveThreshold: confidentFacts.length,
        factsFiltered: extractedFacts.length - confidentFacts.length,
        duplicatesSkipped: duplicateCount,
        factsStored: storedCount,
        errors: errorCount,
        confidenceDistribution,
        threshold: normalizedThreshold,
      });

      return { facts: storedFacts, processed: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Memory] Extraction failed', { error: errorMessage });
      return { facts: [], processed: false, error: errorMessage };
    }
  }

  private async extractFacts(text: string): Promise<ExtractedFact[]> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: EXTRACTION_PROMPT,
      },
      {
        role: 'user',
        content: text,
      },
    ];

    const response = await this.llmClient.chat(messages, undefined, {
      maxTokens: appConfig.llm.extractionMaxTokens,
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[Memory] No JSON found in extraction response');
        return [];
      }

      const parsed: ExtractedData = JSON.parse(jsonMatch[0]);

      if (!parsed.facts || !Array.isArray(parsed.facts)) {
        return [];
      }

      return parsed.facts
        .filter(
          (f) =>
            f &&
            typeof f.content === 'string' &&
            f.content.trim().length > 0 &&
            ['fact', 'preference', 'event', 'relationship', 'capability'].includes(f.type)
        )
        .map((f) => ({
          type: f.type as ExtractedFact['type'],
          content: f.content.trim(),
          confidence: Math.max(0, Math.min(1, f.confidence || 0.5)),
        }));
    } catch (error) {
      logger.error('[Memory] Failed to parse extraction response', {
        response: response.content,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Try partial recovery from truncated JSON
      const recovered = this.tryRecoverPartialFacts(response.content);
      if (recovered.length > 0) {
        logger.info('[Memory] Recovered partial facts from truncated response', {
          recoveredCount: recovered.length,
        });
      }
      return recovered;
    }
  }

  /**
   * Attempt to recover partial facts from a truncated JSON response.
   * This handles cases where LLM responses are cut off due to token limits.
   */
  private tryRecoverPartialFacts(content: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    try {
      // Pattern to match individual fact objects even in truncated JSON
      // Matches: {"type": "...", "content": "...", "confidence": 0.x}
      const factPattern = /\{\s*"type"\s*:\s*"(\w+)"\s*,\s*"content"\s*:\s*"([^"]*(?:\\"[^"]*"[^"]*)*)"\s*,\s*"confidence"\s*:\s*([\d.]+)\s*\}/g;

      let match;
      while ((match = factPattern.exec(content)) !== null) {
        const [, type, contentRaw, confidenceRaw] = match;
        const validTypes = ['fact', 'preference', 'event', 'relationship', 'capability'];

        if (validTypes.includes(type) && contentRaw && contentRaw.trim().length > 0) {
          facts.push({
            type: type as ExtractedFact['type'],
            content: contentRaw.replace(/\\"/g, '"'),
            confidence: Math.max(0, Math.min(1, parseFloat(confidenceRaw) || 0.5)),
          });
        }
      }

      return facts;
    } catch (error) {
      logger.warn('[Memory] Partial fact recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Check for duplicate memories using a pre-generated embedding.
   * This avoids generating the embedding twice (once for check, once for storage).
   */
  private async checkDuplicateWithEmbedding(
    embedding: number[],
    userId?: string | null
  ): Promise<boolean> {
    try {
      const similar = await this.embeddingRepo.findSimilar(embedding, {
        limit: 5,
        sourceType: 'memory',
        minSimilarity: DUPLICATE_SIMILARITY_THRESHOLD,
      });

      if (similar.length === 0) {
        return false;
      }

      for (const match of similar) {
        const memory = await this.memoryRepo.findById(match.sourceId);
        if (!memory) continue;

        // Filter by userId when provided
        if (userId && memory.userId === userId) return true;
      }

      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Memory] Duplicate check failed', {
        error: errorMessage,
        embeddingLength: embedding.length,
        userId: userId ?? 'not provided',
      });
      // Log embedding preview for debugging if possible
      if (embedding.length > 0) {
        logger.debug('[Memory] Embedding preview', {
          preview: embedding.slice(0, 3),
          actualLength: embedding.length,
        });
      }
      // On error, allow memory to be stored (fallback behavior)
      // This prevents memory loss due to duplicate check failures
      return false;
    }
  }

  private async generateAndStoreEmbedding(memory: Memory): Promise<void> {
    const embeddingResponse = await this.embeddingClient.embed(memory.content);

    await this.embeddingRepo.create({
      sourceType: 'memory',
      sourceId: memory.id,
      content: memory.content,
      embedding: JSON.stringify(embeddingResponse.embedding),
      model: embeddingResponse.model,
      dimensions: embeddingResponse.embedding.length,
    });
  }

  /**
   * Retrieve relevant memories for a query.
   * @param query The search query
   * @param options Retrieval options including userId/conversationId for filtering
   */
  async retrieveRelevant(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult> {
    const { limit = appConfig.rag.topK, minSimilarity = appConfig.rag.similarityThreshold } = options;

    if (!appConfig.memory.enabled || !appConfig.embedding.enabled) {
      return { memories: [], totalFound: 0 };
    }

    try {
      const queryEmbedding = await this.embeddingClient.embed(query);

      const similar = await this.embeddingRepo.findSimilar(queryEmbedding.embedding, {
        limit: limit * 2, // Fetch more to filter later
        sourceType: 'memory',
        minSimilarity,
      });

      if (similar.length === 0) {
        return { memories: [], totalFound: 0 };
      }

      const scoredMemories: Array<Memory & { similarity: number; recencyBoost: number; score: number }> = [];

      for (const match of similar) {
        const memory = await this.memoryRepo.findById(match.sourceId);
        if (!memory) continue;

        if (memory.isArchived && !options.includeArchived) continue;

        // Filter by userId when provided
        if (options.userId && memory.userId && memory.userId !== options.userId) continue;

        // Filter by conversationId when provided
        if (options.conversationId && memory.conversationId && memory.conversationId !== options.conversationId) continue;

        const recencyBoost = this.calculateRecencyBoost(memory.createdAt);

        const score = match.similarity * recencyBoost * (memory.confidence / 100);

        scoredMemories.push({
          ...memory,
          similarity: match.similarity,
          recencyBoost,
          score,
        });

        // Record access for LRU tracking
        await this.memoryRepo.recordAccess(memory.id);
      }

      scoredMemories.sort((a, b) => b.score - a.score);
      const limitedMemories = scoredMemories.slice(0, limit);

      return {
        memories: limitedMemories,
        totalFound: similar.length,
      };
    } catch (error) {
      logger.error('[Memory] Retrieval failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { memories: [], totalFound: 0 };
    }
  }

  private calculateRecencyBoost(createdAt: Date): number {
    const ageHours = (Date.now() - createdAt.getTime()) / MILLISECONDS_PER_HOUR;
    const decayHours = appConfig.rag.recencyDecayHours;
    return Math.exp(-ageHours / decayHours);
  }

  async updateMemory(
    memoryId: string,
    updates: {
      content?: string;
      confidence?: number;
      addSourceMessageId?: string;
    }
  ): Promise<Memory | null> {
    const memory = await this.memoryRepo.findById(memoryId);
    if (!memory) return null;

    const updateData: Partial<Memory> = {};

    if (updates.content && updates.content !== memory.content) {
      updateData.content = updates.content;

      await this.embeddingRepo.deleteBySource('memory', memoryId);
      const embeddingResponse = await this.embeddingClient.embed(updates.content);
      await this.embeddingRepo.create({
        sourceType: 'memory',
        sourceId: memoryId,
        content: updates.content,
        embedding: JSON.stringify(embeddingResponse.embedding),
        model: embeddingResponse.model,
        dimensions: embeddingResponse.embedding.length,
      });
    }

    if (updates.confidence !== undefined) {
      updateData.confidence = updates.confidence;
    }

    if (updates.addSourceMessageId) {
      const sourceIds = memory.sourceMessageIds
        ? JSON.parse(memory.sourceMessageIds)
        : [];
      if (!sourceIds.includes(updates.addSourceMessageId)) {
        sourceIds.push(updates.addSourceMessageId);
        updateData.sourceMessageIds = JSON.stringify(sourceIds);
      }
    }

    if (Object.keys(updateData).length === 0) {
      return memory;
    }

    return await this.memoryRepo.update(memoryId, updateData);
  }

  async consolidateMemories(
    memoryIds: string[],
    consolidatedContent: string,
    confidence: number = 100
  ): Promise<Memory | null> {
    if (memoryIds.length < 2) return null;

    const memories = await Promise.all(memoryIds.map((id) => this.memoryRepo.findById(id)));
    const validMemories = memories.filter((m): m is Memory => m !== null);

    if (validMemories.length < 2) return null;

    const allSourceIds = new Set<string>();
    for (const memory of validMemories) {
      if (memory.sourceMessageIds) {
        const ids = JSON.parse(memory.sourceMessageIds);
        ids.forEach((id: string) => allSourceIds.add(id));
      }
    }

    const firstMemory = validMemories[0];

    const consolidated = await this.memoryRepo.create({
      senderId: firstMemory.senderId,
      chatId: firstMemory.chatId,
      userId: firstMemory.userId,
      conversationId: firstMemory.conversationId,
      memoryType: firstMemory.memoryType,
      content: consolidatedContent,
      confidence,
      sourceMessageIds: JSON.stringify([...allSourceIds]),
    });

    await this.generateAndStoreEmbedding(consolidated);

    for (const memory of validMemories) {
      await this.memoryRepo.archive(memory.id);
    }

    logger.info('[Memory] Consolidated memories', {
      originalCount: validMemories.length,
      consolidatedId: consolidated.id,
    });

    return consolidated;
  }

  async pruneOldMemories(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - appConfig.memory.archiveAfterDays);

    const archivedCount = await this.memoryRepo.archiveOlderThan(cutoffDate);

    if (archivedCount > 0) {
      logger.info('[Memory] Archived old memories', { count: archivedCount });
    }

    return archivedCount;
  }

  async getStats(userId?: string): Promise<{
    totalMemories: number;
    activeMemories: number;
    byType: Record<string, number>;
  }> {
    // If userId is provided, filter by user; otherwise get all memories
    const allMemories = userId
      ? await this.memoryRepo.findByUserId(userId, STATS_MEMORY_LIMIT)
      : await this.memoryRepo.findAll(STATS_MEMORY_LIMIT);
    const activeMemories = allMemories.filter((m) => !m.isArchived);

    const byType: Record<string, number> = {};
    for (const memory of activeMemories) {
      byType[memory.memoryType] = (byType[memory.memoryType] || 0) + 1;
    }

    return {
      totalMemories: allMemories.length,
      activeMemories: activeMemories.length,
      byType,
    };
  }

  /**
   * Backfill embeddings for memories that don't have them.
   * This fixes orphaned memories created by direct DB inserts (e.g., agentic tasks).
   *
   * @returns Number of embeddings created
   */
  /**
   * Get memory statistics for monitoring memory usage and pressure
   */
  async getMemoryStats(): Promise<{
    totalMemories: number;
    totalEmbeddings: number;
    activeMemories: number;
    archivedMemories: number;
  }> {
    return {
      totalMemories: await this.memoryRepo.getCount(),
      totalEmbeddings: await this.embeddingRepo.getCount(),
      activeMemories: await this.memoryRepo.getActiveCount(),
      archivedMemories: await this.memoryRepo.getArchivedCount(),
    };
  }

  /**
   * Log memory pressure warning if thresholds exceeded
   */
  async logMemoryPressureIfNeeded(): Promise<void> {
    const stats = await this.getMemoryStats();
    const activeMemoriesRatio = stats.totalMemories > 0
      ? (stats.activeMemories / stats.totalMemories) * 100
      : 0;

    if (activeMemoriesRatio > 90) {
      logger.warn('[Memory] High memory pressure detected', {
        activeMemories: stats.activeMemories,
        totalMemories: stats.totalMemories,
        activeRatio: activeMemoriesRatio.toFixed(1),
        totalEmbeddings: stats.totalEmbeddings,
        recommended: 'Consider running memory cleanup or increasing archive threshold',
      });
    }
  }

  async backfillMissingEmbeddings(): Promise<number> {
    if (!appConfig.embedding.enabled) {
      return 0;
    }

    try {
      // Get all embeddings for memories and all memories
      const embeddings = await this.embeddingRepo.findBySourceType('memory');
      const embeddedMemoryIds = new Set(embeddings.map((e) => e.sourceId));

      // Get all non-archived memories
      const allMemories = await this.memoryRepo.findAll();
      const orphanedMemories = allMemories.filter(
        (m) => !m.isArchived && !embeddedMemoryIds.has(m.id)
      );

      if (orphanedMemories.length === 0) {
        return 0;
      }

      logger.info('[Memory] Found memories without embeddings, backfilling...', {
        count: orphanedMemories.length,
      });

      let totalCreated = 0;
      for (const memory of orphanedMemories) {
        try {
          await this.generateAndStoreEmbedding(memory);
          totalCreated++;
          logger.debug('[Memory] Created missing embedding', { memoryId: memory.id });
        } catch (error) {
          logger.error('[Memory] Failed to create embedding for memory', {
            memoryId: memory.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      if (totalCreated > 0) {
        logger.info('[Memory] Backfilled missing embeddings', { totalCreated });
      }

      return totalCreated;
    } catch (error) {
      logger.error('[Memory] Failed to backfill embeddings', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}
