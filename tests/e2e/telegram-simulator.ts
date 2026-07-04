/**
 * Telegram Simulator for E2E Testing
 *
 * Simulates Telegram message flow without real Telegram connection.
 * Injects into the processing pipeline and captures outgoing responses.
 */

import { ResponseRouterService, AnalysisResult } from '../../src/services/responseRouter.service';
import {
  IntentClassifierService,
  IntentClassificationResult,
  IntentCategory,
} from '../../src/services/intentClassifier.service';
import { LLMClient, ChatMessage, LLMResponse } from '../../src/clients/llm.client';
import { ClaudeClient, ClaudeResponse } from '../../src/clients/claude.client';
import { LLMResponseRepository } from '../../src/repositories/llmResponse.repository';
import { Message, Chat, Sender, LLMResponseRecord } from '../../src/types';

// ============== Types ==============

export interface SimulatedMessage {
  text: string;
  senderId: string;
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  timestamp: Date;
}

export interface SimulatedResponse {
  text: string;
  replyToMessageId?: number;
  timestamp: Date;
  routedTo: 'ollama' | 'claude';
  intent: IntentCategory;
  intentConfidence: number;
  durationMs: number;
}

export interface SimulatorConfig {
  claudeEnabled?: boolean;
  responseEnabled?: boolean;
  contextWindowSize?: number;
  systemPrompt?: string;
}

// ============== Mock Classes ==============

export class MockIntentClassifier {
  private intentOverride?: IntentClassificationResult;
  private shouldFail = false;
  private latencyMs = 50;
  public classifyCallCount = 0;
  public lastMessage = '';
  public lastContext = '';

  async classifyIntent(message: string, context?: string): Promise<IntentClassificationResult> {
    this.classifyCallCount++;
    this.lastMessage = message;
    this.lastContext = context || '';

    // Simulate latency
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    if (this.shouldFail) {
      throw new Error('Intent classification timeout');
    }

    if (this.intentOverride) {
      return this.intentOverride;
    }

    // Realistic intent classification based on message content
    const lowerMessage = message.toLowerCase().trim();

    // Simple greeting detection
    const greetingPatterns = [
      /^(hi|hello|hey|howdy|hola|yo|sup)$/i,
      /^(hi|hello|hey|good\s*(morning|afternoon|evening))[\s!.]*$/i,
      /^(hi|hello|hey)\s*(there|everyone|all|folks)?[\s!.]*$/i,
      /^what'?s?\s*up[\s!?]*$/i,
    ];
    if (greetingPatterns.some((p) => p.test(lowerMessage))) {
      return { intent: 'simple_greeting', confidence: 0.95, durationMs: this.latencyMs };
    }

    // Web search detection
    const webSearchPatterns = [
      /weather/i,
      /news/i,
      /stock\s*price/i,
      /what\s*time.*in/i,
      /score.*game/i,
      /latest/i,
      /today/i,
      /current/i,
    ];
    if (webSearchPatterns.some((p) => p.test(lowerMessage))) {
      return { intent: 'needs_web_search', confidence: 0.88, durationMs: this.latencyMs };
    }

    // Complex task detection
    const complexPatterns = [
      /write\s*(a|some|the)?\s*(code|function|script|program)/i,
      /explain\s*(how|the|what)/i,
      /implement/i,
      /create\s*(a|an)/i,
      /analyze/i,
      /compare/i,
      /difference\s*between/i,
    ];
    if (complexPatterns.some((p) => p.test(lowerMessage))) {
      return { intent: 'complex_task', confidence: 0.85, durationMs: this.latencyMs };
    }

    // Default to general chat
    return { intent: 'general_chat', confidence: 0.75, durationMs: this.latencyMs };
  }

  setIntentOverride(intent: IntentClassificationResult | undefined) {
    this.intentOverride = intent;
  }

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  reset() {
    this.intentOverride = undefined;
    this.shouldFail = false;
    this.latencyMs = 50;
    this.classifyCallCount = 0;
    this.lastMessage = '';
    this.lastContext = '';
  }
}

export class MockOllamaClient {
  private responseOverride?: LLMResponse;
  private shouldFail = false;
  private latencyMs = 100;
  public chatCallCount = 0;
  public lastMessages: ChatMessage[] = [];

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCallCount++;
    this.lastMessages = messages;

    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    if (this.shouldFail) {
      throw new Error('Ollama API error');
    }

    if (this.responseOverride) {
      return this.responseOverride;
    }

    // Generate a realistic response based on the last message
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    const content = this.generateResponse(lastUserMessage?.content || '');

    return {
      content,
      model: 'llama3.2:3b',
      promptEvalCount: 50,
      evalCount: 30,
    };
  }

  private generateResponse(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (/^(hi|hello|hey)/.test(lowerMessage)) {
      return 'Hello! How can I help you today?';
    }
    if (/how are you/i.test(lowerMessage)) {
      return "I'm doing great, thanks for asking! How can I assist you?";
    }
    if (/name/i.test(lowerMessage) && /your/i.test(lowerMessage)) {
      return "I'm Jarvis, your helpful assistant!";
    }

    return "I'd be happy to help with that. What would you like to know more about?";
  }

  setResponseOverride(response: LLMResponse | undefined) {
    this.responseOverride = response;
  }

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  reset() {
    this.responseOverride = undefined;
    this.shouldFail = false;
    this.latencyMs = 100;
    this.chatCallCount = 0;
    this.lastMessages = [];
  }
}

export class MockClaudeClient {
  private responseOverride?: ClaudeResponse;
  private shouldFail = false;
  private latencyMs = 500;
  public chatCallCount = 0;
  public lastMessage = '';
  public lastContext = '';

  async chat(message: string, context?: string): Promise<ClaudeResponse> {
    this.chatCallCount++;
    this.lastMessage = message;
    this.lastContext = context || '';

    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    if (this.shouldFail) {
      return {
        success: false,
        content: '',
        error: 'Claude CLI failed',
        durationMs: this.latencyMs,
      };
    }

    if (this.responseOverride) {
      return this.responseOverride;
    }

    // Generate a realistic Claude response
    const content = this.generateResponse(message, context);

    return {
      success: true,
      content,
      durationMs: this.latencyMs,
    };
  }

  private generateResponse(message: string, context?: string): string {
    const lowerMessage = message.toLowerCase();

    // Web search queries
    if (/weather/i.test(lowerMessage)) {
      return "Based on my web search, the current weather shows mild conditions with partly cloudy skies. Temperatures are around 65°F (18°C).";
    }
    if (/news/i.test(lowerMessage)) {
      return "Here are the latest headlines I found: Several major tech companies announced new AI initiatives today. Global markets are showing mixed results.";
    }
    if (/stock/i.test(lowerMessage)) {
      return "Based on my search, the stock markets are showing mixed performance today with tech sector leading gains.";
    }

    // Complex tasks
    if (/explain.*tcp.*udp/i.test(lowerMessage) || /difference.*tcp.*udp/i.test(lowerMessage)) {
      return "TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) are both transport layer protocols.\n\nTCP provides reliable, ordered delivery with connection establishment and error checking. It's ideal for applications where data integrity is critical like web browsing and email.\n\nUDP offers faster, connectionless transmission without guarantees. It's better for real-time applications like video streaming and gaming where speed matters more than perfect delivery.";
    }
    if (/write.*function|code|implement/i.test(lowerMessage)) {
      return "Here's an implementation:\n\n```typescript\nfunction example(): void {\n  console.log('Hello, World!');\n}\n```\n\nThis function demonstrates a basic implementation. Let me know if you need modifications!";
    }

    // Context-aware responses
    if (context && /alice/i.test(context) && /name/i.test(lowerMessage)) {
      return "Your name is Alice, as you mentioned earlier in our conversation!";
    }

    // General conversation
    if (/think.*ai/i.test(lowerMessage)) {
      return "AI is a fascinating and rapidly evolving field. It has tremendous potential to help solve complex problems, but it also raises important questions about ethics, safety, and societal impact that we need to carefully consider.";
    }

    return "I understand your question. Let me provide a helpful response based on my knowledge and capabilities.";
  }

  setResponseOverride(response: ClaudeResponse | undefined) {
    this.responseOverride = response;
  }

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  reset() {
    this.responseOverride = undefined;
    this.shouldFail = false;
    this.latencyMs = 500;
    this.chatCallCount = 0;
    this.lastMessage = '';
    this.lastContext = '';
  }
}

export class MockLLMResponseRepository {
  public createdResponses: Array<Omit<LLMResponseRecord, 'id' | 'createdAt'> & { id: string }> = [];

  async create(
    data: Omit<LLMResponseRecord, 'id' | 'createdAt'>
  ): Promise<LLMResponseRecord> {
    const record = {
      ...data,
      id: `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
    } as LLMResponseRecord;
    this.createdResponses.push({ ...data, id: record.id });
    return record;
  }

  getLastResponse() {
    return this.createdResponses[this.createdResponses.length - 1];
  }

  getResponseCount() {
    return this.createdResponses.length;
  }

  reset() {
    this.createdResponses = [];
  }
}

// ============== Test Fixtures ==============

export function createMockMessage(overrides: Partial<Message> = {}): Message {
  const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return {
    id,
    chatId: overrides.chatId || 'chat-456',
    senderId: overrides.senderId || 'sender-789',
    telegramMessageId: Math.floor(Math.random() * 100000),
    text: overrides.text || 'Hello there!',
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    isBot: overrides.isBot ?? false,
    rawJson: '{}',
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

export function createMockChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-456',
    telegramId: '123456',
    type: 'private',
    title: null,
    username: 'testuser',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-789',
    telegramId: '987654',
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============== Telegram Simulator ==============

export class TelegramSimulator {
  private responses: SimulatedResponse[] = [];
  private conversationHistory: Message[] = [];
  private messageCounter = 0;

  public mockIntentClassifier: MockIntentClassifier;
  public mockOllama: MockOllamaClient;
  public mockClaude: MockClaudeClient;
  public mockRepo: MockLLMResponseRepository;
  public responseRouter: ResponseRouterService;

  constructor(config: SimulatorConfig = {}) {
    this.mockIntentClassifier = new MockIntentClassifier();
    this.mockOllama = new MockOllamaClient();
    this.mockClaude = new MockClaudeClient();
    this.mockRepo = new MockLLMResponseRepository();

    this.responseRouter = new ResponseRouterService(
      this.mockIntentClassifier as unknown as IntentClassifierService,
      this.mockOllama as unknown as LLMClient,
      this.mockClaude as unknown as ClaudeClient,
      this.mockRepo as unknown as LLMResponseRepository,
      {
        responseEnabled: config.responseEnabled ?? true,
        claudeEnabled: config.claudeEnabled ?? true,
        claudeModel: 'sonnet',
        contextWindowSize: config.contextWindowSize ?? 10,
        systemPrompt: config.systemPrompt ?? 'You are Jarvis, a helpful assistant.',
      }
    );
  }

  async sendMessage(simMessage: SimulatedMessage): Promise<SimulatedResponse | null> {
    const startTime = Date.now();
    this.messageCounter++;

    // Create internal message object
    const message = createMockMessage({
      text: simMessage.text,
      senderId: simMessage.senderId,
      chatId: simMessage.chatId,
      createdAt: simMessage.timestamp,
      isBot: false,
    });

    const chat = createMockChat({
      id: simMessage.chatId,
      type: simMessage.chatType,
    });

    const sender = createMockSender({
      id: simMessage.senderId,
    });

    // Process through router
    const result = await this.responseRouter.generateResponse(
      message,
      chat,
      sender,
      [...this.conversationHistory]
    );

    // Add user message to history
    this.conversationHistory.unshift(message);

    if (!result.success || result.skipped || !result.content) {
      return null;
    }

    // Create bot response message for history
    const botMessage = createMockMessage({
      text: result.content,
      chatId: simMessage.chatId,
      isBot: true,
      createdAt: new Date(),
    });
    this.conversationHistory.unshift(botMessage);

    // Trim history to last 20 messages
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(0, 20);
    }

    const response: SimulatedResponse = {
      text: result.content,
      timestamp: new Date(),
      routedTo: result.routedTo!,
      intent: result.intent!,
      intentConfidence: result.intentConfidence!,
      durationMs: Date.now() - startTime,
    };

    this.responses.push(response);
    return response;
  }

  getResponses(): SimulatedResponse[] {
    return [...this.responses];
  }

  getLastResponse(): SimulatedResponse | undefined {
    return this.responses[this.responses.length - 1];
  }

  clearResponses(): void {
    this.responses = [];
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getConversationHistory(): Message[] {
    return [...this.conversationHistory];
  }

  reset(): void {
    this.responses = [];
    this.conversationHistory = [];
    this.messageCounter = 0;
    this.mockIntentClassifier.reset();
    this.mockOllama.reset();
    this.mockClaude.reset();
    this.mockRepo.reset();
  }

  async waitForResponse(timeoutMs: number): Promise<SimulatedResponse | null> {
    const startTime = Date.now();
    const initialCount = this.responses.length;

    while (Date.now() - startTime < timeoutMs) {
      if (this.responses.length > initialCount) {
        return this.responses[this.responses.length - 1];
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return null;
  }
}

export default TelegramSimulator;
