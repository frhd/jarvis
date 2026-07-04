import { LLMClient, ChatMessage } from '../clients/llm.client';
import { LLMResponseRepository } from '../repositories/llmResponse.repository';
import { Message, Chat, Sender, PromptType } from '../types';
import { appConfig } from '../config';
import { logger } from '../utils/logger';

export interface AnalysisResult {
  success: boolean;
  content?: string;
  responseId?: string;
  error?: string;
  skipped?: boolean;
}

export class LLMService {
  private client: LLMClient;
  private isHealthy: boolean = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(private llmResponseRepo: LLMResponseRepository) {
    this.client = new LLMClient({
      baseUrl: appConfig.llm.baseUrl,
      model: appConfig.llm.model,
      timeoutMs: appConfig.llm.timeoutMs,
      maxRetries: appConfig.llm.maxRetries,
      temperature: appConfig.llm.temperature,
      maxTokens: appConfig.llm.maxTokens,
    });
  }

  async initialize(): Promise<void> {
    if (!appConfig.llm.enabled) {
      logger.info('[LLM] LLM processing disabled');
      return;
    }

    await this.performHealthCheck();
    this.startHealthCheckLoop();
    logger.info('[LLM] Service initialized', { healthy: this.isHealthy });
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    logger.info('[LLM] Service shutdown');
  }

  private startHealthCheckLoop(): void {
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      appConfig.llm.healthCheckIntervalMs
    );
  }

  private async performHealthCheck(): Promise<void> {
    const status = await this.client.healthCheck();
    const wasHealthy = this.isHealthy;
    this.isHealthy = status.healthy;

    if (status.healthy && !wasHealthy) {
      logger.info('[LLM] Service recovered:', status.model);
    } else if (!status.healthy && wasHealthy) {
      logger.warn('[LLM] Service unhealthy:', status.error);
    }
  }

  getHealthStatus(): { enabled: boolean; healthy: boolean } {
    return {
      enabled: appConfig.llm.enabled,
      healthy: this.isHealthy,
    };
  }

  getClient(): LLMClient {
    return this.client;
  }

  async analyzeMessage(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    promptType: PromptType = 'analysis'
  ): Promise<AnalysisResult> {
    if (!appConfig.llm.enabled) {
      return { success: true, skipped: true, content: 'LLM disabled' };
    }

    if (!this.isHealthy && appConfig.llm.skipOnUnhealthy) {
      logger.warn('[LLM] Skipping analysis - service unhealthy', {
        messageId: message.id,
      });
      return { success: true, skipped: true, content: 'LLM unavailable' };
    }

    const prompt = this.buildPrompt(message, chat, sender);
    const messages: ChatMessage[] = [
      { role: 'system', content: this.getSystemPrompt(promptType) },
      { role: 'user', content: prompt },
    ];

    try {
      const startTime = Date.now();
      const response = await this.client.chat(messages, message.id);
      const durationMs = Date.now() - startTime;

      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType,
        prompt,
        response: response.content,
        model: response.model,
        durationMs,
        promptTokens: response.promptEvalCount ?? null,
        completionTokens: response.evalCount ?? null,
        error: null,
      });

      logger.info('[LLM] Analysis completed', {
        messageId: message.id,
        durationMs,
        tokens: response.evalCount,
      });

      return {
        success: true,
        content: response.content,
        responseId: stored.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLM] Analysis failed', { messageId: message.id, error: errorMessage });

      await this.llmResponseRepo.create({
        messageId: message.id,
        promptType,
        prompt,
        response: '',
        model: appConfig.llm.model,
        durationMs: null,
        promptTokens: null,
        completionTokens: null,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async generateResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    conversationHistory: Message[]
  ): Promise<AnalysisResult> {
    if (!appConfig.response.enabled) {
      return { success: true, skipped: true, content: 'Response disabled' };
    }

    if (!this.isHealthy && appConfig.llm.skipOnUnhealthy) {
      logger.warn('[LLM] Skipping response - service unhealthy', {
        messageId: message.id,
      });
      return { success: true, skipped: true, content: 'LLM unavailable' };
    }

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: appConfig.response.systemPrompt },
      ...this.buildConversationContext(conversationHistory, message),
    ];

    try {
      const startTime = Date.now();
      const response = await this.client.chat(chatMessages, `response-${message.id}`);
      const durationMs = Date.now() - startTime;

      const stored = await this.llmResponseRepo.create({
        messageId: message.id,
        promptType: 'response',
        prompt: JSON.stringify(chatMessages),
        response: response.content,
        model: response.model,
        durationMs,
        promptTokens: response.promptEvalCount ?? null,
        completionTokens: response.evalCount ?? null,
        error: null,
      });

      logger.info('[LLM] Response generated', {
        messageId: message.id,
        durationMs,
        tokens: response.evalCount,
      });

      return {
        success: true,
        content: response.content,
        responseId: stored.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LLM] Response generation failed', {
        messageId: message.id,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private buildConversationContext(
    history: Message[],
    currentMessage: Message
  ): ChatMessage[] {
    // Reverse to get chronological order (history is desc by createdAt)
    const chronological = [...history].reverse();
    const chatMessages: ChatMessage[] = [];

    for (const msg of chronological) {
      if (!msg.text) continue;
      chatMessages.push({
        role: msg.isBot ? 'assistant' : 'user',
        content: msg.text,
      });
    }

    if (currentMessage.text) {
      chatMessages.push({
        role: 'user',
        content: currentMessage.text,
      });
    }

    return chatMessages;
  }

  private getSystemPrompt(promptType: PromptType): string {
    const prompts: Record<PromptType, string> = {
      analysis: `You are Jarvis, an intelligent assistant analyzing Telegram messages.
Analyze the message and provide a structured response with:

1. **Summary**: A brief 1-2 sentence summary
2. **Topics**: Key topics or entities mentioned (comma-separated)
3. **Sentiment**: positive, negative, or neutral
4. **Action Items**: Any tasks or requests (or "None")
5. **Priority**: high, medium, or low based on urgency

Be concise and structured. Use the exact headers above.`,

      summary: `You are Jarvis. Provide a brief, one-paragraph summary of the message. Be concise.`,

      classification: `You are Jarvis. Classify the message into exactly one category:
- question: User asking for information
- task: Request to do something
- information: Sharing information or update
- conversation: Casual chat
- spam: Irrelevant or promotional

Respond with only the category name, nothing else.`,

      extraction: `You are Jarvis. Extract structured information from the message as JSON:
{
  "people": ["names mentioned"],
  "dates": ["dates/times mentioned"],
  "locations": ["places mentioned"],
  "urls": ["links mentioned"],
  "contacts": ["phone/email"],
  "action_items": ["tasks to do"]
}
Only include fields that have values. Return valid JSON only.`,

      response: `You're Jarvis, a chill and knowledgeable friend. Keep it casual and conversational, but not over the top. Be helpful without being formal. Short and natural responses. IMPORTANT: Keep responses under 3500 characters for Telegram delivery. Respond in plain text - do not use markdown formatting like **bold**, ## headers, or code blocks.

You have full access to the local machine - you can read/write files, execute shell commands, browse the filesystem, and interact with system services. When asked to do something on the machine, just do it.`,
    };

    return prompts[promptType];
  }

  private buildPrompt(message: Message, chat: Chat, sender: Sender | null): string {
    const parts: string[] = [];

    const chatName = chat.title || chat.username || 'Private Chat';
    parts.push(`**Chat**: ${chatName} (${chat.type})`);

    if (sender) {
      const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ');
      const username = sender.username ? ` (@${sender.username})` : '';
      parts.push(`**From**: ${senderName}${username}`);
    }

    parts.push('');

    if (message.text) {
      parts.push(`**Message**:\n${message.text}`);
    } else {
      parts.push('**Message**: [No text content]');
    }

    if (message.mediaType) {
      const downloaded = message.mediaPath ? ' (downloaded)' : '';
      parts.push(`\n[Attachment: ${message.mediaType}${downloaded}]`);
    }

    return parts.join('\n');
  }
}
