import { LLMClient, ChatMessage } from '../clients/llm.client.js';
import { EmbeddingClient } from '../clients/embedding.client.js';
import { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import { EmbeddingRepository, SimilarityResult } from '../repositories/embedding.repository.js';
import {
  ConversationSummaryRepository,
  ConversationSummary,
} from '../repositories/conversationSummary.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { Message } from '../types/index.js';
import { appConfig } from '../config/index.js';
import {
  CONSOLIDATION_MEMORY_FETCH_LIMIT,
  CONSOLIDATION_QUERY_LIMIT,
  CONSOLIDATION_MIN_LENGTH,
  CONSOLIDATION_JOB_MESSAGE_LIMIT,
  CONSOLIDATION_MEMORY_THRESHOLD,
  CONSOLIDATION_FACT_LIMIT,
} from '../config/constants.js';
import { logger } from '../utils/logger.js';

const CONSOLIDATION_PROMPT = `You are analyzing a set of related memories about a user. Your task is to consolidate them into a single, coherent memory that preserves all important information.

Memories to consolidate:
{memories}

Create a single consolidated memory that:
1. Combines all information without losing details
2. Removes redundancy
3. Uses clear, concise language
4. Maintains the most confident assertions

Return ONLY the consolidated memory text, nothing else.`;

const SUMMARIZATION_PROMPT = `Summarize this conversation, focusing on:
1. Main topics discussed
2. Key decisions or conclusions reached
3. Important information shared by the user
4. Any action items or follow-ups mentioned

Conversation:
{messages}

Return a JSON object with this exact structure:
{
  "summary": "Concise summary of the conversation (2-4 sentences)",
  "keyTopics": ["topic1", "topic2", "topic3"]
}`;

interface SummarizationResult {
  summary: string;
  keyTopics: string[];
}

export class ConsolidationService {
  constructor(
    private llmClient: LLMClient,
    private embeddingClient: EmbeddingClient,
    private memoryRepo: MemoryRepository,
    private embeddingRepo: EmbeddingRepository,
    private summaryRepo: ConversationSummaryRepository,
    private messageRepo: MessageRepository
  ) {}

  async consolidateSimilarMemories(
    senderId: string,
    similarityThreshold: number = 0.75
  ): Promise<number> {
    if (!appConfig.memory.enabled || !appConfig.embedding.enabled) {
      return 0;
    }

    try {
      const memories = await this.memoryRepo.findActiveForSender(senderId, CONSOLIDATION_MEMORY_FETCH_LIMIT);

      if (memories.length < 2) {
        return 0;
      }

      const groups = await this.groupSimilarMemories(memories, similarityThreshold);

      let consolidatedCount = 0;

      for (const group of groups) {
        if (group.length < 2) continue;

        const consolidated = await this.consolidateGroup(group);
        if (consolidated) {
          consolidatedCount++;
          logger.info('[Consolidation] Consolidated memory group', {
            originalCount: group.length,
            consolidatedId: consolidated.id,
          });
        }
      }

      return consolidatedCount;
    } catch (error) {
      logger.error('[Consolidation] Failed to consolidate memories', {
        senderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  private async groupSimilarMemories(
    memories: Memory[],
    threshold: number
  ): Promise<Memory[][]> {
    const groups: Memory[][] = [];
    const assigned = new Set<string>();

    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;

      const embedding = await this.embeddingRepo.findBySource('memory', memory.id);
      if (!embedding) {
        assigned.add(memory.id);
        continue;
      }

      const embeddingVector = JSON.parse(embedding.embedding);
      const similar = await this.embeddingRepo.findSimilar(embeddingVector, {
        limit: CONSOLIDATION_QUERY_LIMIT,
        sourceType: 'memory',
        minSimilarity: threshold,
      });

      const group: Memory[] = [memory];
      assigned.add(memory.id);

      for (const match of similar) {
        if (match.sourceId === memory.id) continue;
        if (assigned.has(match.sourceId)) continue;

        const matchMemory = memories.find((m) => m.id === match.sourceId);
        if (matchMemory && matchMemory.senderId === memory.senderId) {
          group.push(matchMemory);
          assigned.add(match.sourceId);
        }
      }

      if (group.length > 0) {
        groups.push(group);
      }
    }

    return groups.filter((g) => g.length > 1);
  }

  private async consolidateGroup(memories: Memory[]): Promise<Memory | null> {
    try {
      const memoriesText = memories
        .map((m, i) => `${i + 1}. [${m.memoryType}] ${m.content}`)
        .join('\n');

      const prompt = CONSOLIDATION_PROMPT.replace('{memories}', memoriesText);

      const messages: ChatMessage[] = [
        { role: 'user', content: prompt },
      ];

      const response = await this.llmClient.chat(messages);
      const consolidatedContent = response.content.trim();

      if (!consolidatedContent || consolidatedContent.length < CONSOLIDATION_MIN_LENGTH) {
        return null;
      }

      const avgConfidence = Math.round(
        memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length
      );

      const allSourceIds = new Set<string>();
      for (const memory of memories) {
        if (memory.sourceMessageIds) {
          const ids = JSON.parse(memory.sourceMessageIds);
          ids.forEach((id: string) => allSourceIds.add(id));
        }
      }

      const consolidated = await this.memoryRepo.create({
        senderId: memories[0].senderId,
        chatId: memories[0].chatId,
        memoryType: memories[0].memoryType,
        content: consolidatedContent,
        confidence: avgConfidence,
        sourceMessageIds: JSON.stringify([...allSourceIds]),
      });

      const embeddingResponse = await this.embeddingClient.embed(consolidatedContent);
      await this.embeddingRepo.create({
        sourceType: 'memory',
        sourceId: consolidated.id,
        content: consolidatedContent,
        embedding: JSON.stringify(embeddingResponse.embedding),
        model: embeddingResponse.model,
        dimensions: embeddingResponse.embedding.length,
      });

      for (const memory of memories) {
        await this.memoryRepo.archive(memory.id);
      }

      return consolidated;
    } catch (error) {
      logger.error('[Consolidation] Failed to consolidate group', {
        memoryIds: memories.map((m) => m.id),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async summarizeConversation(
    chatId: string,
    messageLimit: number = CONSOLIDATION_JOB_MESSAGE_LIMIT
  ): Promise<ConversationSummary | null> {
    if (!appConfig.memory.enabled) {
      return null;
    }

    try {
      const messages = await this.messageRepo.findRecentByChatId(chatId, messageLimit);

      if (messages.length < 5) {
        return null;
      }

      const latestSummary = await this.summaryRepo.findLatestByChatId(chatId);
      if (latestSummary) {
        const oldestNewMessage = messages[messages.length - 1];
        if (latestSummary.endMessageId === oldestNewMessage.id) {
          return latestSummary;
        }
      }

      const messagesText = messages
        .map((m) => `${m.isBot ? 'Assistant' : 'User'}: ${m.text || '[media]'}`)
        .join('\n');

      const result = await this.generateSummary(messagesText);

      if (!result) {
        return null;
      }

      const summary = await this.summaryRepo.create({
        chatId,
        startMessageId: messages[messages.length - 1].id,
        endMessageId: messages[0].id,
        messageCount: messages.length,
        summary: result.summary,
        keyTopics: JSON.stringify(result.keyTopics),
      });

      logger.info('[Consolidation] Created conversation summary', {
        chatId,
        messageCount: messages.length,
        topicsCount: result.keyTopics.length,
      });

      return summary;
    } catch (error) {
      logger.error('[Consolidation] Failed to summarize conversation', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private async generateSummary(messagesText: string): Promise<SummarizationResult | null> {
    try {
      const prompt = SUMMARIZATION_PROMPT.replace('{messages}', messagesText);

      const messages: ChatMessage[] = [
        { role: 'user', content: prompt },
      ];

      const response = await this.llmClient.chat(messages);

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[Consolidation] No JSON found in summarization response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.summary || typeof parsed.summary !== 'string') {
        return null;
      }

      return {
        summary: parsed.summary.trim(),
        keyTopics: Array.isArray(parsed.keyTopics)
          ? parsed.keyTopics.filter((t: unknown) => typeof t === 'string')
          : [],
      };
    } catch (error) {
      logger.error('[Consolidation] Failed to generate summary', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async runConsolidationJob(memoryThreshold: number = CONSOLIDATION_MEMORY_THRESHOLD): Promise<{
    sendersProcessed: number;
    memoriesConsolidated: number;
  }> {
    // This would typically be run as a background job
    logger.info('[Consolidation] Starting consolidation job');

    let sendersProcessed = 0;
    let memoriesConsolidated = 0;

    try {
      // Get all senders with active memories
      // For now, we'll process memories by type to find senders
      const factMemories = await this.memoryRepo.findByType('fact', CONSOLIDATION_FACT_LIMIT);

      const senderIds = new Set<string>();
      for (const memory of factMemories) {
        if (memory.senderId) {
          senderIds.add(memory.senderId);
        }
      }

      for (const senderId of senderIds) {
        const memories = await this.memoryRepo.findActiveForSender(senderId, CONSOLIDATION_MEMORY_FETCH_LIMIT);

        if (memories.length >= memoryThreshold) {
          const consolidated = await this.consolidateSimilarMemories(senderId);
          if (consolidated > 0) {
            memoriesConsolidated += consolidated;
            sendersProcessed++;
          }
        }
      }

      logger.info('[Consolidation] Consolidation job complete', {
        sendersProcessed,
        memoriesConsolidated,
      });
    } catch (error) {
      logger.error('[Consolidation] Consolidation job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return { sendersProcessed, memoriesConsolidated };
  }
}
