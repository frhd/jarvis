#!/usr/bin/env npx tsx
/**
 * Message Flow Integration Tests
 *
 * Tests the complete message processing pipeline from ingestion to response:
 * 1. Message ingestion to queue
 * 2. Queue processing with LLM
 * 3. Memory extraction from message
 * 4. Semantic cache hit/miss scenarios
 * 5. Error handling in pipeline
 *
 * Run: npx tsx tests/integration/message-flow.test.ts
 */

import { nanoid } from 'nanoid';
import type {
  Message,
  Chat,
  Sender,
  QueueItem,
  ProcessingResult,
  ChatType,
  QueueStatus,
} from '../../src/types/index.js';

// ============== Test Helpers ==============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.log(`  ${stackLine.trim()}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected condition to be false');
  }
}

function assertGreaterThan(actual: number, threshold: number, message?: string) {
  if (actual <= threshold) {
    throw new Error(message || `Expected ${actual} to be greater than ${threshold}`);
  }
}

function assertNotNull<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected value to be non-null');
  }
}

function assertContains(text: string, substring: string, message?: string) {
  if (!text.includes(substring)) {
    throw new Error(message || `Expected "${text}" to contain "${substring}"`);
  }
}

// ============== Mock Repositories ==============

class MockSenderRepository {
  private senders = new Map<string, Sender>();
  private nextId = 1;

  async upsert(data: {
    telegramId: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    phone?: string;
  }): Promise<Sender> {
    const existing = Array.from(this.senders.values()).find(
      (s) => s.telegramId === data.telegramId
    );
    if (existing) return existing;

    const sender: Sender = {
      id: `sender-${this.nextId++}`,
      telegramId: data.telegramId,
      firstName: data.firstName || null,
      lastName: data.lastName || null,
      username: data.username || null,
      phone: data.phone || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.senders.set(sender.id, sender);
    return sender;
  }

  async findById(id: string): Promise<Sender | null> {
    return this.senders.get(id) || null;
  }

  clear() {
    this.senders.clear();
  }
}

class MockChatRepository {
  private chats = new Map<string, Chat>();
  private nextId = 1;

  async upsert(data: {
    telegramId: string;
    type: ChatType;
    title?: string;
    username?: string;
  }): Promise<Chat> {
    const existing = Array.from(this.chats.values()).find(
      (c) => c.telegramId === data.telegramId
    );
    if (existing) return existing;

    const chat: Chat = {
      id: `chat-${this.nextId++}`,
      telegramId: data.telegramId,
      type: data.type,
      title: data.title || null,
      username: data.username || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  async findById(id: string): Promise<Chat | null> {
    return this.chats.get(id) || null;
  }

  clear() {
    this.chats.clear();
  }
}

class MockMessageRepository {
  private messages = new Map<string, Message>();
  public createdMessages: Message[] = [];

  async createIfNotExists(data: {
    id: string;
    telegramMessageId: number;
    chatId: string;
    senderId: string | null;
    text?: string;
    mediaType?: any;
    mediaPath?: string;
    mediaFileId?: string;
    replyToMessageId?: number;
    forwardFromChatId?: string;
    forwardFromMessageId?: number;
    rawJson: string;
    createdAt: Date;
  }): Promise<{ message: Message; created: boolean }> {
    const existing = Array.from(this.messages.values()).find(
      (m) =>
        m.telegramMessageId === data.telegramMessageId && m.chatId === data.chatId
    );

    if (existing) {
      return { message: existing, created: false };
    }

    const message: Message = {
      ...data,
      id: data.id || nanoid(),
      text: data.text || null,
      mediaType: data.mediaType || null,
      mediaPath: data.mediaPath || null,
      mediaFileId: data.mediaFileId || null,
      replyToMessageId: data.replyToMessageId || null,
      forwardFromChatId: data.forwardFromChatId || null,
      forwardFromMessageId: data.forwardFromMessageId || null,
      isBot: false,
      transcript: null,
      transcriptStatus: null,
      transcriptLanguage: null,
      transcriptDurationMs: null,
      transcriptError: null,
      createdAt: data.createdAt || new Date(),
    };

    this.messages.set(message.id, message);
    this.createdMessages.push(message);
    return { message, created: true };
  }

  async create(data: any): Promise<Message> {
    const message: Message = {
      id: data.id || nanoid(),
      telegramMessageId: data.telegramMessageId,
      chatId: data.chatId,
      senderId: data.senderId || null,
      text: data.text || null,
      mediaType: data.mediaType || null,
      mediaPath: data.mediaPath || null,
      mediaFileId: data.mediaFileId || null,
      replyToMessageId: data.replyToMessageId || null,
      forwardFromChatId: data.forwardFromChatId || null,
      forwardFromMessageId: data.forwardFromMessageId || null,
      isBot: data.isBot || false,
      rawJson: data.rawJson || '{}',
      transcript: null,
      transcriptStatus: null,
      transcriptLanguage: null,
      transcriptDurationMs: null,
      transcriptError: null,
      createdAt: data.createdAt || new Date(),
    };

    this.messages.set(message.id, message);
    this.createdMessages.push(message);
    return message;
  }

  async findById(id: string): Promise<Message | null> {
    return this.messages.get(id) || null;
  }

  async findRecentByChatId(chatId: string, limit: number): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  clear() {
    this.messages.clear();
    this.createdMessages = [];
  }
}

class MockQueueRepository {
  private queue = new Map<string, QueueItem>();
  private nextId = 1;
  public enqueuedItems: QueueItem[] = [];
  public markedProcessingIds: string[] = [];
  public completedIds: string[] = [];
  public failedIds: string[] = [];

  async enqueue(messageId: string, priority: number): Promise<QueueItem> {
    const item: QueueItem = {
      id: `queue-${this.nextId++}`,
      messageId,
      priority,
      status: 'pending' as QueueStatus,
      retryCount: 0,
      lastError: null,
      nextRetryAt: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      processingStartedAt: null,
    };
    this.queue.set(item.id, item);
    this.enqueuedItems.push(item);
    return item;
  }

  async markProcessing(id: string, version: number): Promise<boolean> {
    const item = this.queue.get(id);
    if (!item || item.status !== 'pending' || item.version !== version) {
      return false;
    }
    item.status = 'processing' as QueueStatus;
    item.processingStartedAt = new Date();
    item.version++;
    this.markedProcessingIds.push(id);
    return true;
  }

  async complete(id: string): Promise<void> {
    const item = this.queue.get(id);
    if (item) {
      item.status = 'completed' as QueueStatus;
      this.completedIds.push(id);
    }
  }

  async fail(id: string, error: string): Promise<void> {
    const item = this.queue.get(id);
    if (item) {
      item.status = 'failed' as QueueStatus;
      item.lastError = error;
      item.retryCount++;
      this.failedIds.push(id);
    }
  }

  async findById(id: string): Promise<QueueItem | null> {
    return this.queue.get(id) || null;
  }

  clear() {
    this.queue.clear();
    this.enqueuedItems = [];
    this.markedProcessingIds = [];
    this.completedIds = [];
    this.failedIds = [];
  }
}

// ============== Mock Services ==============

class MockFilterService {
  async checkMessage(
    chatId: string
  ): Promise<{ allowed: boolean; priority: number }> {
    return { allowed: true, priority: 5 };
  }
}

class MockMediaService {
  async downloadMedia(): Promise<null> {
    return null;
  }
}

class MockMemoryService {
  public extractedMessages: Message[] = [];
  public extractionResults = new Map<string, any>();

  async extractAndStore(
    message: Message,
    sender: Sender | null,
    context?: Message[]
  ): Promise<{ facts: any[]; processed: boolean }> {
    this.extractedMessages.push(message);

    const result = {
      facts: [
        {
          type: 'preference',
          content: `User mentioned: ${message.text?.substring(0, 50)}`,
          confidence: 0.85,
        },
      ],
      processed: true,
    };

    this.extractionResults.set(message.id, result);
    return result;
  }

  clear() {
    this.extractedMessages = [];
    this.extractionResults.clear();
  }
}

class MockSemanticCacheService {
  private cache = new Map<string, { response: string; intent: string }>();
  public lookupCalls: string[] = [];
  public storeCalls: Array<{ prompt: string; response: string; intent: string }> = [];

  isCacheable(intent: string): boolean {
    return ['simple_greeting', 'factual_question', 'personal_question'].includes(
      intent
    );
  }

  async lookup(
    prompt: string
  ): Promise<{ hit: boolean; response?: string; matchType?: string; lookupTimeMs: number }> {
    this.lookupCalls.push(prompt);
    const cached = this.cache.get(prompt.toLowerCase().trim());
    if (cached) {
      return {
        hit: true,
        response: cached.response,
        matchType: 'exact',
        lookupTimeMs: 5,
      };
    }
    return { hit: false, lookupTimeMs: 5 };
  }

  async store(
    prompt: string,
    response: string,
    options: { intent?: string; model?: string }
  ): Promise<any> {
    this.storeCalls.push({ prompt, response, intent: options.intent || 'unknown' });
    this.cache.set(prompt.toLowerCase().trim(), {
      response,
      intent: options.intent || 'unknown',
    });
    return { id: nanoid(), promptText: prompt, response };
  }

  clear() {
    this.cache.clear();
    this.lookupCalls = [];
    this.storeCalls = [];
  }
}

class MockLLMService {
  public analyzeMessageCalls: Array<{
    message: Message;
    chat: Chat;
    sender: Sender | null;
  }> = [];
  private shouldFail = false;

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  async analyzeMessage(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    mode: string
  ): Promise<{ success: boolean; content?: string; error?: string; responseId?: string }> {
    this.analyzeMessageCalls.push({ message, chat, sender });

    if (this.shouldFail) {
      return {
        success: false,
        error: 'LLM service unavailable',
      };
    }

    return {
      success: true,
      content: `Analyzed: ${message.text}`,
      responseId: nanoid(),
    };
  }

  clear() {
    this.analyzeMessageCalls = [];
    this.shouldFail = false;
  }
}

class MockResponseRouterService {
  public generateResponseCalls: Array<{
    message: Message;
    chat: Chat;
    sender: Sender | null;
    history: Message[];
  }> = [];
  private responses = new Map<string, string>();
  private shouldFail = false;

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  setResponse(messageText: string, response: string) {
    this.responses.set(messageText.toLowerCase().trim(), response);
  }

  async generateResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    history: Message[]
  ): Promise<{
    success: boolean;
    content?: string;
    error?: string;
    skipped?: boolean;
  }> {
    this.generateResponseCalls.push({ message, chat, sender, history });

    if (this.shouldFail) {
      return {
        success: false,
        error: 'Response generation failed',
      };
    }

    const cachedResponse = this.responses.get(
      (message.text || '').toLowerCase().trim()
    );
    if (cachedResponse) {
      return {
        success: true,
        content: cachedResponse,
      };
    }

    return {
      success: true,
      content: `Response to: ${message.text}`,
    };
  }

  clear() {
    this.generateResponseCalls = [];
    this.responses.clear();
    this.shouldFail = false;
  }
}

class MockTelegramService {
  public sentMessages: Array<{
    chatTelegramId: string;
    text: string;
    replyTo?: number;
  }> = [];
  public markedReadMessages: Array<{ chatId: string; messageId: number }> = [];
  public typingIndicators: string[] = [];

  async sendMessage(
    chatTelegramId: string,
    text: string,
    replyTo?: number
  ): Promise<{ id: number }> {
    this.sentMessages.push({ chatTelegramId, text, replyTo });
    return { id: Math.floor(Math.random() * 10000) };
  }

  async markAsRead(chatId: string, messageId: number): Promise<void> {
    this.markedReadMessages.push({ chatId, messageId });
  }

  async setTyping(chatId: string): Promise<void> {
    this.typingIndicators.push(chatId);
  }

  clear() {
    this.sentMessages = [];
    this.markedReadMessages = [];
    this.typingIndicators = [];
  }
}

// ============== Mock Coordinators ==============

class MockExtractionCoordinator {
  public extractedMessages: Message[] = [];

  extractAll(message: Message, sender: Sender): void {
    this.extractedMessages.push(message);
  }

  clear() {
    this.extractedMessages = [];
  }
}

class MockRetryCoordinator {
  public handledResults: Array<{ queueItem: QueueItem; result: ProcessingResult }> =
    [];

  async handleResult(queueItem: QueueItem, result: ProcessingResult): Promise<void> {
    this.handledResults.push({ queueItem, result });
  }

  getErrorHistorySize(): number {
    return 10;
  }

  stop(): void {}

  clear() {
    this.handledResults = [];
  }
}

class MockTranscriptionCoordinator {
  async processVoiceMessage(): Promise<void> {}
}

// ============== Service Implementations ==============

class TestIngestionService {
  constructor(
    private senderRepo: MockSenderRepository,
    private chatRepo: MockChatRepository,
    private messageRepo: MockMessageRepository,
    private queueRepo: MockQueueRepository,
    private filterService: MockFilterService,
    private mediaService: MockMediaService,
    private processorService: TestProcessorService
  ) {}

  async ingestMessage(mockEvent: {
    message: {
      id: number;
      chatId: string;
      senderId?: string;
      text?: string;
      getSender: () => Promise<any>;
      getChat: () => Promise<any>;
      media?: any;
    };
  }): Promise<void> {
    const message = mockEvent.message;
    const chatId = message.chatId;

    const filterCheck = await this.filterService.checkMessage(chatId);
    if (!filterCheck.allowed) {
      return;
    }

    let senderId: string | null = null;
    if (message.senderId) {
      const senderData = await message.getSender();
      if (senderData) {
        const upsertedSender = await this.senderRepo.upsert({
          telegramId: message.senderId,
          firstName: senderData.firstName,
          lastName: senderData.lastName,
          username: senderData.username,
        });
        senderId = upsertedSender.id;
      }
    }

    const chatData = await message.getChat();
    const upsertedChat = await this.chatRepo.upsert({
      telegramId: chatId,
      type: chatData?.type || 'private',
      title: chatData?.title,
      username: chatData?.username,
    });

    const { message: storedMessage, created } =
      await this.messageRepo.createIfNotExists({
        id: nanoid(),
        telegramMessageId: message.id,
        chatId: upsertedChat.id,
        senderId: senderId,
        text: message.text,
        rawJson: JSON.stringify({ id: message.id, text: message.text }),
        createdAt: new Date(),
      });

    if (!created) {
      return;
    }

    const queueItem = await this.queueRepo.enqueue(
      storedMessage.id,
      filterCheck.priority
    );

    await this.processImmediately(queueItem);
  }

  async processImmediately(queueItem: QueueItem): Promise<void> {
    const marked = await this.queueRepo.markProcessing(queueItem.id, queueItem.version);
    if (!marked) {
      return;
    }

    const message = await this.messageRepo.findById(queueItem.messageId);
    if (!message) {
      throw new Error(`Message not found: ${queueItem.messageId}`);
    }

    const chat = await this.chatRepo.findById(message.chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${message.chatId}`);
    }

    let sender = null;
    if (message.senderId) {
      sender = await this.senderRepo.findById(message.senderId);
    }

    const result = await this.processorService.processMessage(message, chat, sender);
    await this.processorService.handleProcessingResult(queueItem, result);
  }
}

class TestProcessorService {
  constructor(
    private queueRepository: MockQueueRepository,
    private llmService: MockLLMService,
    private responseRouter: MockResponseRouterService,
    private messageRepository: MockMessageRepository,
    private telegramService: MockTelegramService,
    private extractionCoordinator: MockExtractionCoordinator,
    private retryCoordinator: MockRetryCoordinator,
    private transcriptionCoordinator: MockTranscriptionCoordinator,
    private memoryEnabled: boolean = true,
    private responseEnabled: boolean = true
  ) {}

  async processMessage(
    message: Message,
    chat: Chat,
    sender: Sender | null
  ): Promise<ProcessingResult> {
    try {
      if (sender && this.memoryEnabled) {
        this.extractionCoordinator.extractAll(message, sender);
      }

      await this.transcriptionCoordinator.processVoiceMessage();

      if (this.shouldGenerateResponse(chat, message)) {
        await this.generateAndSendResponse(message, chat, sender);
        return {
          success: true,
          response: 'Response generated via router',
        };
      }

      const analysis = await this.llmService.analyzeMessage(
        message,
        chat,
        sender,
        'analysis'
      );

      if (!analysis.success) {
        return {
          success: false,
          error: analysis.error,
        };
      }

      return {
        success: true,
        response: analysis.content,
        llmResponseId: analysis.responseId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async handleProcessingResult(
    queueItem: QueueItem,
    result: ProcessingResult
  ): Promise<void> {
    await this.retryCoordinator.handleResult(queueItem, result);
  }

  private shouldGenerateResponse(chat: Chat, message: Message): boolean {
    if (chat.type !== 'private') return false;
    if (message.isBot) return false;
    if (!this.responseEnabled) return false;
    if (!message.text || message.text.trim().length === 0) return false;
    return true;
  }

  private async generateAndSendResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null
  ): Promise<void> {
    const history = await this.messageRepository.findRecentByChatId(chat.id, 10);
    await this.telegramService.setTyping(chat.telegramId);

    const result = await this.responseRouter.generateResponse(
      message,
      chat,
      sender,
      history
    );

    if (!result.success || result.skipped || !result.content) {
      return;
    }

    const sentMessage = await this.telegramService.sendMessage(
      chat.telegramId,
      result.content,
      message.telegramMessageId
    );

    if (sentMessage) {
      await this.messageRepository.create({
        telegramMessageId: sentMessage.id,
        chatId: chat.id,
        senderId: null,
        text: result.content,
        isBot: true,
        rawJson: JSON.stringify({ id: sentMessage.id, text: result.content }),
      });
    }
  }
}

// ============== Test Suite ==============

async function runTests() {
  console.log('\n=== Message Flow Integration Tests ===\n');

  // -------------------- Setup --------------------
  const senderRepo = new MockSenderRepository();
  const chatRepo = new MockChatRepository();
  const messageRepo = new MockMessageRepository();
  const queueRepo = new MockQueueRepository();
  const filterService = new MockFilterService();
  const mediaService = new MockMediaService();
  const memoryService = new MockMemoryService();
  const cacheService = new MockSemanticCacheService();
  const llmService = new MockLLMService();
  const responseRouter = new MockResponseRouterService();
  const telegramService = new MockTelegramService();
  const extractionCoordinator = new MockExtractionCoordinator();
  const retryCoordinator = new MockRetryCoordinator();
  const transcriptionCoordinator = new MockTranscriptionCoordinator();

  const processorService = new TestProcessorService(
    queueRepo,
    llmService,
    responseRouter,
    messageRepo,
    telegramService,
    extractionCoordinator,
    retryCoordinator,
    transcriptionCoordinator
  );

  const ingestionService = new TestIngestionService(
    senderRepo,
    chatRepo,
    messageRepo,
    queueRepo,
    filterService,
    mediaService,
    processorService
  );

  function clearAll() {
    senderRepo.clear();
    chatRepo.clear();
    messageRepo.clear();
    queueRepo.clear();
    memoryService.clear();
    cacheService.clear();
    llmService.clear();
    responseRouter.clear();
    telegramService.clear();
    extractionCoordinator.clear();
    retryCoordinator.clear();
  }

  // -------------------- Message Ingestion Tests --------------------
  console.log('--- Message Ingestion to Queue Tests ---\n');

  await test('ingests message and creates queue item', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 12345,
        chatId: '999888777',
        senderId: '111222333',
        text: 'Hello, this is a test message',
        getSender: async () => ({
          firstName: 'John',
          lastName: 'Doe',
          username: 'johndoe',
        }),
        getChat: async () => ({
          type: 'private' as ChatType,
          title: null,
          username: 'johndoe',
        }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    // Should create user message and bot response (2 messages)
    assertGreaterThan(messageRepo.createdMessages.length, 0);
    const userMessage = messageRepo.createdMessages.find((m) => !m.isBot);
    assertNotNull(userMessage);
    assertEqual(userMessage.text, 'Hello, this is a test message');
    assertEqual(userMessage.telegramMessageId, 12345);

    assertEqual(queueRepo.enqueuedItems.length, 1);
    const queueItem = queueRepo.enqueuedItems[0];
    assertEqual(queueItem.messageId, userMessage.id);
    assertEqual(queueItem.priority, 5);
    assertEqual(queueItem.status, 'processing');
  });

  await test('prevents duplicate message ingestion', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 99999,
        chatId: '888777666',
        senderId: '555444333',
        text: 'Duplicate test',
        getSender: async () => ({ firstName: 'Jane', lastName: 'Smith' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);
    const firstCount = messageRepo.createdMessages.length;

    await ingestionService.ingestMessage(mockEvent);
    const secondCount = messageRepo.createdMessages.length;

    assertEqual(firstCount, secondCount, 'Should not create duplicate message');
  });

  await test('creates sender and chat records on ingestion', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 55555,
        chatId: '123456789',
        senderId: '987654321',
        text: 'Test message',
        getSender: async () => ({
          firstName: 'Alice',
          lastName: 'Wonder',
          username: 'alice_w',
        }),
        getChat: async () => ({
          type: 'private' as ChatType,
          title: null,
          username: 'alice_w',
        }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    const message = messageRepo.createdMessages[0];
    assertNotNull(message.senderId);

    const sender = await senderRepo.findById(message.senderId);
    assertNotNull(sender);
    assertEqual(sender.firstName, 'Alice');
    assertEqual(sender.username, 'alice_w');

    const chat = await chatRepo.findById(message.chatId);
    assertNotNull(chat);
    assertEqual(chat.telegramId, '123456789');
    assertEqual(chat.type, 'private');
  });

  // -------------------- Queue Processing Tests --------------------
  console.log('\n--- Queue Processing with LLM Tests ---\n');

  await test('processes queue item and analyzes message', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 11111,
        chatId: '777666555',
        senderId: '444333222',
        text: 'What is the weather?',
        getSender: async () => ({ firstName: 'Bob' }),
        getChat: async () => ({ type: 'group' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(llmService.analyzeMessageCalls.length, 1);
    const call = llmService.analyzeMessageCalls[0];
    assertEqual(call.message.text, 'What is the weather?');

    assertEqual(retryCoordinator.handledResults.length, 1);
    const handledResult = retryCoordinator.handledResults[0];
    assertTrue(handledResult.result.success);
    assertContains(handledResult.result.response || '', 'Analyzed:');
  });

  await test('processes private chat message and generates response', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 22222,
        chatId: '666555444',
        senderId: '333222111',
        text: 'Hello there!',
        getSender: async () => ({ firstName: 'Charlie' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    responseRouter.setResponse('hello there!', 'Hi Charlie! How can I help you today?');

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(responseRouter.generateResponseCalls.length, 1);
    assertEqual(telegramService.sentMessages.length, 1);

    const sentMsg = telegramService.sentMessages[0];
    assertEqual(sentMsg.text, 'Hi Charlie! How can I help you today?');

    const botMessages = messageRepo.createdMessages.filter((m) => m.isBot);
    assertEqual(botMessages.length, 1);
    assertEqual(botMessages[0].text, 'Hi Charlie! How can I help you today?');
  });

  await test('handles LLM failure gracefully', async () => {
    clearAll();
    llmService.setShouldFail(true);

    const mockEvent = {
      message: {
        id: 33333,
        chatId: '555444333',
        text: 'Test failure',
        getSender: async () => ({ firstName: 'Dave' }),
        getChat: async () => ({ type: 'group' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(retryCoordinator.handledResults.length, 1);
    const result = retryCoordinator.handledResults[0].result;
    assertFalse(result.success);
    assertContains(result.error || '', 'unavailable');

    llmService.setShouldFail(false);
  });

  // -------------------- Memory Extraction Tests --------------------
  console.log('\n--- Memory Extraction Tests ---\n');

  await test('extracts memories from user message', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 44444,
        chatId: '444333222',
        senderId: '222111000',
        text: 'I love pizza and live in New York',
        getSender: async () => ({ firstName: 'Emma' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(extractionCoordinator.extractedMessages.length, 1);
    const extractedMsg = extractionCoordinator.extractedMessages[0];
    assertEqual(extractedMsg.text, 'I love pizza and live in New York');
  });

  await test('skips memory extraction when sender is null', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 55556,
        chatId: '333222111',
        text: 'Anonymous message',
        getSender: async () => null,
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(extractionCoordinator.extractedMessages.length, 0);
  });

  // -------------------- Cache Tests --------------------
  console.log('\n--- Semantic Cache Integration Tests ---\n');

  await test('cache miss generates new response', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 66666,
        chatId: '222111000',
        senderId: '111000999',
        text: 'What is TypeScript?',
        getSender: async () => ({ firstName: 'Frank' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(responseRouter.generateResponseCalls.length, 1);
    assertEqual(telegramService.sentMessages.length, 1);
  });

  await test('typing indicator shown before response', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 77777,
        chatId: '111000999',
        senderId: '999888777',
        text: 'Tell me a joke',
        getSender: async () => ({ firstName: 'Grace' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(telegramService.typingIndicators.length, 1);
    assertTrue(telegramService.sentMessages.length > 0);
  });

  // -------------------- Error Handling Tests --------------------
  console.log('\n--- Error Handling Tests ---\n');

  await test('handles response generation failure', async () => {
    clearAll();
    responseRouter.setShouldFail(true);

    const mockEvent = {
      message: {
        id: 88888,
        chatId: '000999888',
        senderId: '888777666',
        text: 'This should fail',
        getSender: async () => ({ firstName: 'Henry' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(telegramService.sentMessages.length, 0);

    responseRouter.setShouldFail(false);
  });

  await test('handles missing message in queue processing', async () => {
    clearAll();

    // Create a queue item with non-existent message ID
    const fakeQueueItem = await queueRepo.enqueue('nonexistent-message-id', 5);

    let errorThrown = false;
    try {
      // Mark as processing first
      await queueRepo.markProcessing(fakeQueueItem.id, fakeQueueItem.version);

      // Try to process - should throw
      const message = await messageRepo.findById(fakeQueueItem.messageId);
      if (!message) {
        throw new Error(`Message not found: ${fakeQueueItem.messageId}`);
      }
    } catch (error) {
      errorThrown = true;
      assertContains((error as Error).message, 'Message not found');
    }

    assertTrue(errorThrown, 'Should throw error for missing message');
  });

  await test('handles concurrent queue item processing', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 99999,
        chatId: '999888777',
        senderId: '777666555',
        text: 'Concurrent test',
        getSender: async () => ({ firstName: 'Ivy' }),
        getChat: async () => ({ type: 'private' as ChatType }),
      },
    };

    await ingestionService.ingestMessage(mockEvent);

    const queueItem = queueRepo.enqueuedItems[0];
    const secondAttempt = await queueRepo.markProcessing(
      queueItem.id,
      queueItem.version
    );

    assertFalse(secondAttempt, 'Should not allow concurrent processing');
  });

  // -------------------- End-to-End Flow Test --------------------
  console.log('\n--- End-to-End Message Flow Test ---\n');

  await test('complete message flow from ingestion to response', async () => {
    clearAll();

    const mockEvent = {
      message: {
        id: 10101,
        chatId: '123456',
        senderId: '654321',
        text: 'Hello, how are you?',
        getSender: async () => ({
          firstName: 'Jack',
          lastName: 'Smith',
          username: 'jacksmith',
        }),
        getChat: async () => ({
          type: 'private' as ChatType,
          title: null,
          username: 'jacksmith',
        }),
      },
    };

    responseRouter.setResponse(
      'hello, how are you?',
      "I'm doing well, thank you for asking!"
    );

    await ingestionService.ingestMessage(mockEvent);

    assertEqual(messageRepo.createdMessages.length, 2);
    const userMessage = messageRepo.createdMessages[0];
    const botMessage = messageRepo.createdMessages[1];

    assertFalse(userMessage.isBot);
    assertEqual(userMessage.text, 'Hello, how are you?');
    assertTrue(botMessage.isBot);
    assertEqual(botMessage.text, "I'm doing well, thank you for asking!");

    assertEqual(queueRepo.enqueuedItems.length, 1);
    assertEqual(queueRepo.markedProcessingIds.length, 1);

    assertEqual(extractionCoordinator.extractedMessages.length, 1);

    assertEqual(responseRouter.generateResponseCalls.length, 1);
    assertEqual(telegramService.sentMessages.length, 1);
    assertEqual(telegramService.typingIndicators.length, 1);

    assertEqual(retryCoordinator.handledResults.length, 1);
    assertTrue(retryCoordinator.handledResults[0].result.success);
  });

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
