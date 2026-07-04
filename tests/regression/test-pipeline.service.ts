/**
 * Test Pipeline Service
 *
 * Injects test messages through the real processing pipeline and captures responses.
 * Creates isolated test user/chat with TEST_ prefix for clean test data management.
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { Chat, Message, Sender } from '../../src/types/index.js';
import type { PipelineResponse, PerformanceMetrics } from './types.js';
import { TEST_DATA_PREFIX } from './config.js';
import { db } from '../../src/db/client.js';
import {
  memories,
  userPreferences,
  conversationSummaries,
  intentClassificationLogs,
  queue,
  llmResponses,
  messages as messagesTable,
  deadLetterQueue,
  loopDetections,
  semanticCache,
  embeddings,
} from '../../src/db/schema.js';

// Service types
import type { ResponseRouterService } from '../../src/services/responseRouter.service.js';
import type { ChatRepository } from '../../src/repositories/chat.repository.js';
import type { SenderRepository } from '../../src/repositories/sender.repository.js';
import type { MessageRepository } from '../../src/repositories/message.repository.js';

export interface TestPipelineConfig {
  runId?: string;
  verbose?: boolean;
}

export interface TestPipelineDependencies {
  responseRouter: ResponseRouterService;
  chatRepository: ChatRepository;
  senderRepository: SenderRepository;
  messageRepository: MessageRepository;
}

interface StoredMessage {
  id: string;
  text: string;
  isBot: boolean;
  createdAt: Date;
}

export class TestPipelineService {
  private readonly runId: string;
  private readonly verbose: boolean;
  private readonly deps: TestPipelineDependencies;

  private testSender: Sender | null = null;
  private testChat: Chat | null = null;
  private messageHistory: StoredMessage[] = [];
  private initialized = false;

  constructor(deps: TestPipelineDependencies, config: TestPipelineConfig = {}) {
    this.deps = deps;
    this.runId = config.runId ?? nanoid(8);
    this.verbose = config.verbose ?? false;
  }

  /**
   * Initialize the test pipeline by creating a test user and chat.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const testPrefix = TEST_DATA_PREFIX;
    const senderTelegramId = `${testPrefix}user_${this.runId}`;
    const chatTelegramId = `${testPrefix}chat_${this.runId}`;

    if (this.verbose) {
      console.log(`[TestPipeline] Creating test sender: ${senderTelegramId}`);
      console.log(`[TestPipeline] Creating test chat: ${chatTelegramId}`);
    }

    // Create test sender
    this.testSender = await this.deps.senderRepository.upsert({
      telegramId: senderTelegramId,
      firstName: 'Test',
      lastName: 'User',
      username: `test_user_${this.runId}`,
    });

    // Create test chat
    this.testChat = await this.deps.chatRepository.upsert({
      telegramId: chatTelegramId,
      type: 'private',
      title: `Test Chat ${this.runId}`,
    });

    this.initialized = true;

    if (this.verbose) {
      console.log(`[TestPipeline] Initialized with sender=${this.testSender.id}, chat=${this.testChat.id}`);
    }
  }

  /**
   * Send a message through the pipeline and capture the response.
   */
  async sendMessage(text: string): Promise<PipelineResponse> {
    if (!this.initialized || !this.testSender || !this.testChat) {
      throw new Error('TestPipelineService not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    const telegramMessageId = this.messageHistory.length + 1;

    // Create message record in database
    const { message: userMessage } = await this.deps.messageRepository.createIfNotExists({
      chatId: this.testChat.id,
      senderId: this.testSender.id,
      telegramMessageId,
      text,
      rawJson: JSON.stringify({
        message_id: telegramMessageId,
        from: {
          id: this.testSender.telegramId,
          first_name: this.testSender.firstName,
          last_name: this.testSender.lastName,
          username: this.testSender.username,
        },
        chat: {
          id: this.testChat.telegramId,
          type: this.testChat.type,
        },
        text,
        date: Math.floor(Date.now() / 1000),
      }),
      isBot: false,
    });

    // Track user message
    this.messageHistory.push({
      id: userMessage.id,
      text,
      isBot: false,
      createdAt: new Date(),
    });

    // Build conversation history for context
    const conversationHistory = await this.buildConversationHistory();

    // Call ResponseRouterService
    const routerStartTime = Date.now();
    const result = await this.deps.responseRouter.generateResponse(
      userMessage,
      this.testChat,
      this.testSender,
      conversationHistory
    );
    const routerEndTime = Date.now();

    const totalLatency = Date.now() - startTime;

    // Store bot response in history if we got one
    if (result.success && result.content) {
      const botMessageId = this.messageHistory.length + 1;

      // Create bot message record
      const { message: botMessage } = await this.deps.messageRepository.createIfNotExists({
        chatId: this.testChat.id,
        telegramMessageId: botMessageId,
        text: result.content,
        rawJson: JSON.stringify({
          message_id: botMessageId,
          from: { id: 'bot', is_bot: true },
          chat: { id: this.testChat.telegramId },
          text: result.content,
          date: Math.floor(Date.now() / 1000),
        }),
        isBot: true,
      });

      this.messageHistory.push({
        id: botMessage.id,
        text: result.content,
        isBot: true,
        createdAt: new Date(),
      });
    }

    // Build metrics
    const metrics: PerformanceMetrics = {
      latencyMs: totalLatency,
      llmGenerationMs: routerEndTime - routerStartTime,
    };

    // Map route
    let routedTo: PipelineResponse['routedTo'] = 'unknown';
    if (result.routedTo === 'ollama' || result.routedTo === 'claude' || result.routedTo === 'cache') {
      routedTo = result.routedTo;
    }

    if (this.verbose) {
      console.log(`[TestPipeline] Message: "${text.substring(0, 50)}..." → ${routedTo} (${totalLatency}ms)`);
    }

    return {
      response: result.content,
      routedTo,
      intent: result.enhancedIntent,
      metrics,
    };
  }

  /**
   * Build conversation history from stored messages.
   */
  private async buildConversationHistory(): Promise<Message[]> {
    if (!this.testChat) {
      return [];
    }

    // Fetch all messages for this test chat
    const messages = await this.deps.messageRepository.findByChatId(
      this.testChat.id,
      100 // Limit to last 100 messages
    );

    return messages;
  }

  /**
   * Get the conversation history.
   */
  getHistory(): StoredMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Get the run ID for this test pipeline instance.
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get the test chat if initialized.
   */
  getTestChat(): Chat | null {
    return this.testChat;
  }

  /**
   * Get the test sender if initialized.
   */
  getTestSender(): Sender | null {
    return this.testSender;
  }

  /**
   * Clean up test data from the database.
   * Deletes in reverse dependency order to avoid foreign key violations.
   */
  async cleanup(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    if (this.verbose) {
      console.log(`[TestPipeline] Cleaning up test data for run ${this.runId}...`);
    }

    try {
      // Get message IDs and queue IDs for this chat to clean up related records
      const chatMessageIds: string[] = [];
      const queueIds: string[] = [];
      if (this.testChat) {
        const chatMessages = await db
          .select({ id: messagesTable.id })
          .from(messagesTable)
          .where(eq(messagesTable.chatId, this.testChat.id));
        chatMessageIds.push(...chatMessages.map((m) => m.id));

        // Get queue IDs for dead letter queue cleanup
        for (const messageId of chatMessageIds) {
          const queueRecords = await db
            .select({ id: queue.id })
            .from(queue)
            .where(eq(queue.messageId, messageId));
          queueIds.push(...queueRecords.map((q) => q.id));
        }
      }

      // 1. Delete dead letter queue entries (references queue and messages)
      for (const queueId of queueIds) {
        await db.delete(deadLetterQueue).where(eq(deadLetterQueue.originalQueueId, queueId));
      }
      for (const messageId of chatMessageIds) {
        await db.delete(deadLetterQueue).where(eq(deadLetterQueue.messageId, messageId));
      }

      // 2. Delete records that reference messages
      for (const messageId of chatMessageIds) {
        await db.delete(queue).where(eq(queue.messageId, messageId));
        await db.delete(llmResponses).where(eq(llmResponses.messageId, messageId));
        await db.delete(intentClassificationLogs).where(eq(intentClassificationLogs.messageId, messageId));
      }

      // 3. Delete conversation summaries (before messages, as it references startMessageId/endMessageId)
      if (this.testChat) {
        await db.delete(conversationSummaries).where(eq(conversationSummaries.chatId, this.testChat.id));
      }

      // 4. Delete loop detections (references chat and sender)
      if (this.testChat) {
        await db.delete(loopDetections).where(eq(loopDetections.chatId, this.testChat.id));
      }

      // 5. Delete sender-related data (in reverse dependency order)
      if (this.testSender) {
        // Delete user preferences for test sender
        await db.delete(userPreferences).where(eq(userPreferences.senderId, this.testSender.id));

        // Delete memories for test sender
        await db.delete(memories).where(eq(memories.senderId, this.testSender.id));

        // Delete loop detections by sender
        await db.delete(loopDetections).where(eq(loopDetections.senderId, this.testSender.id));
      }

      // 6. Delete memories that reference the chat (in case they only have chatId, not senderId)
      if (this.testChat) {
        await db.delete(memories).where(eq(memories.chatId, this.testChat.id));
      }

      // 7. Clear semantic cache and related embeddings for test isolation
      await db.delete(semanticCache);
      await db.delete(embeddings).where(eq(embeddings.sourceType, 'cache'));

      // 8. Delete messages for test chat
      if (this.testChat) {
        await this.deps.messageRepository.deleteByChatId(this.testChat.id);

        // Delete test chat
        await this.deps.chatRepository.delete(this.testChat.id);
      }

      // 9. Delete test sender
      if (this.testSender) {
        await this.deps.senderRepository.delete(this.testSender.id);
      }

      this.messageHistory = [];
      this.testSender = null;
      this.testChat = null;
      this.initialized = false;

      if (this.verbose) {
        console.log(`[TestPipeline] Cleanup complete`);
      }
    } catch (error) {
      console.error(`[TestPipeline] Cleanup failed:`, error);
      throw error;
    }
  }

  /**
   * Reset conversation state without full cleanup.
   * Useful for running multiple scenarios with the same test user/chat.
   */
  async resetConversation(): Promise<void> {
    if (!this.initialized || !this.testChat) {
      return;
    }

    // Get message IDs and queue IDs to clean up related records
    const chatMessages = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.chatId, this.testChat.id));

    const queueIds: string[] = [];
    for (const msg of chatMessages) {
      const queueRecords = await db
        .select({ id: queue.id })
        .from(queue)
        .where(eq(queue.messageId, msg.id));
      queueIds.push(...queueRecords.map((q) => q.id));
    }

    // Delete dead letter queue entries first
    for (const queueId of queueIds) {
      await db.delete(deadLetterQueue).where(eq(deadLetterQueue.originalQueueId, queueId));
    }
    for (const msg of chatMessages) {
      await db.delete(deadLetterQueue).where(eq(deadLetterQueue.messageId, msg.id));
    }

    // Delete records that reference messages (in correct FK order)
    for (const msg of chatMessages) {
      await db.delete(queue).where(eq(queue.messageId, msg.id));
      await db.delete(llmResponses).where(eq(llmResponses.messageId, msg.id));
      await db.delete(intentClassificationLogs).where(eq(intentClassificationLogs.messageId, msg.id));
    }

    // Delete conversation summaries (references startMessageId/endMessageId)
    await db.delete(conversationSummaries).where(eq(conversationSummaries.chatId, this.testChat.id));

    // Clear semantic cache for test isolation between scenarios
    await db.delete(semanticCache);
    await db.delete(embeddings).where(eq(embeddings.sourceType, 'cache'));

    // Now delete the messages
    await this.deps.messageRepository.deleteByChatId(this.testChat.id);
    this.messageHistory = [];

    if (this.verbose) {
      console.log(`[TestPipeline] Conversation reset`);
    }
  }
}

/**
 * Factory function to create a TestPipelineService with all dependencies.
 */
export async function createTestPipeline(
  config: TestPipelineConfig = {}
): Promise<TestPipelineService> {
  // Import services dynamically to avoid circular dependencies
  const { responseRouter } = await import('../../src/services/index.js');
  const {
    chatRepository,
    senderRepository,
    messageRepository,
  } = await import('../../src/repositories/index.js');

  const pipeline = new TestPipelineService(
    {
      responseRouter,
      chatRepository,
      senderRepository,
      messageRepository,
    },
    config
  );

  return pipeline;
}
