/**
 * ProactiveMessageGenerator Service
 *
 * Generates personalized proactive messages via LLM based on context,
 * user preferences, recent conversations, and memories.
 */

import { ChatMessage, LLMResponse } from '../../clients/llm.client.js';
import {
  ProactiveMessageContext,
  ProactiveMessageResult,
  ProactiveTokenUsage,
  ProactiveMessageType,
} from '../../types/proactive.types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('proactive-message-generator');

// ============================================================================
// System Prompt Templates
// ============================================================================

const ANTI_REPETITION_INSTRUCTION =
  'If previous messages are provided, discuss different topics. Never repeat the same opening, question, or theme.';

const SYSTEM_PROMPTS: Record<ProactiveMessageType, string> = {
  greeting:
    `You are Jarvis, a friendly personal AI assistant. Generate a brief, warm greeting message. Be casual and conversational - like texting a friend. Use the person's name naturally if provided. Do NOT use quotes around your message or any words. Reference the time of day and day of week when relevant. Do NOT ask about topics unless they appear in the recent conversation. Do NOT invent or assume what the user is working on. ${ANTI_REPETITION_INSTRUCTION} Keep it under 500 characters.`,
  checkin:
    `You are Jarvis, a caring personal AI assistant. Generate a gentle, non-intrusive check-in message. Use the person's name naturally if provided. Do NOT use quotes around your message or any words. Ask how they're doing or if they need help with anything. Do NOT ask about topics unless they appear in the recent conversation. Do NOT invent or assume what the user is working on. ${ANTI_REPETITION_INSTRUCTION} Keep it under 500 characters.`,
  summary:
    `You are Jarvis, an organized personal AI assistant. Generate a structured daily summary. Use the person's name naturally if provided. Do NOT use quotes around items - just write normally. ONLY summarize topics that appear in the conversation below. Do NOT include weather, news, prices, or any information not present in the provided context. If there is little or no recent conversation, say so briefly instead of inventing content. Use bullet points for clarity. ${ANTI_REPETITION_INSTRUCTION} Keep it under 2000 characters.`,
  reminder:
    `You are Jarvis, a reliable personal AI assistant. Generate a clear, actionable reminder message. Use the person's name naturally if provided. Do NOT use quotes around your message or any words. Be direct and specific. ${ANTI_REPETITION_INSTRUCTION} Keep it under 500 characters.`,
  followup:
    `You are Jarvis, an attentive personal AI assistant. Generate a thoughtful follow-up message about a previous conversation topic. Use the person's name naturally if provided. Do NOT use quotes around your message or any words. Invite them to continue the discussion. ${ANTI_REPETITION_INSTRUCTION} Keep it under 500 characters.`,
  custom: `Generate a message based on the following context. Do NOT use quotes around your message or any words. ${ANTI_REPETITION_INSTRUCTION}`,
};

// ============================================================================
// Types
// ============================================================================

interface MessageGeneratorConfig {
  defaultModel?: string;
}

interface LLMChatClient {
  chat(messages: ChatMessage[], requestId?: string): Promise<LLMResponse>;
}

// ============================================================================
// Service
// ============================================================================

export class ProactiveMessageGenerator {
  private llmClient: LLMChatClient;
  private config: MessageGeneratorConfig;

  constructor(llmClient: LLMChatClient, config: MessageGeneratorConfig = {}) {
    this.llmClient = llmClient;
    this.config = config;
  }

  /**
   * Generate a proactive message based on the provided context.
   */
  async generate(context: ProactiveMessageContext): Promise<ProactiveMessageResult> {
    const { messageType } = context;

    logger.info(`Generating proactive message: type=${messageType}, timezone=${context.timezone}`);

    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await this.llmClient.chat(messages);

      const tokenUsage = this.mapTokenUsage(response);

      logger.info(
        `Proactive message generated successfully: type=${messageType}, model=${response.model}, tokens=${tokenUsage.totalTokens}`,
      );

      return {
        message: response.content.trim(),
        model: response.model,
        tokenUsage,
      };
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : 'Unknown error during message generation';

      logger.error(`Failed to generate proactive message: type=${messageType}, error=${errMsg}`);

      throw new Error(`Proactive message generation failed for type "${messageType}": ${errMsg}`);
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Build the system prompt based on message type.
   * For 'custom' type, uses the customTemplate from context if available.
   */
  private buildSystemPrompt(context: ProactiveMessageContext): string {
    if (context.messageType === 'custom' && context.customTemplate) {
      return context.customTemplate;
    }
    return SYSTEM_PROMPTS[context.messageType];
  }

  /**
   * Build the user prompt with all available context details.
   */
  private buildUserPrompt(context: ProactiveMessageContext): string {
    const parts: string[] = [];

    // Basic context: user, time, timezone
    const userName = context.userName || 'the user';
    const localTimeStr = this.formatLocalTime(context.localTime);
    parts.push(`User: ${userName}`);
    parts.push(`Local time: ${localTimeStr}`);
    parts.push(`Day: ${context.dayOfWeek}`);
    parts.push(`Timezone: ${context.timezone}`);

    // User preferences
    if (context.userPreferences && context.userPreferences.length > 0) {
      parts.push('');
      parts.push('User preferences:');
      for (const pref of context.userPreferences) {
        parts.push(`- ${pref.category}/${pref.key}: ${pref.value}`);
      }
    }

    // Recent conversation
    if (context.recentConversation && context.recentConversation.length > 0) {
      parts.push('');
      parts.push('Recent conversation:');
      for (const msg of context.recentConversation) {
        const speaker = msg.isBot ? 'Jarvis' : userName;
        const time = this.formatLocalTime(msg.createdAt);
        parts.push(`- [${time}] ${speaker}: ${msg.text}`);
      }
    }

    // Memories
    if (context.memories && context.memories.length > 0) {
      parts.push('');
      parts.push('Relevant memories:');
      for (const memory of context.memories) {
        parts.push(`- [${memory.type}] ${memory.content}`);
      }
    }

    // Previous proactive messages (for repetition avoidance)
    if (context.recentProactiveMessages && context.recentProactiveMessages.length > 0) {
      parts.push('');
      parts.push('Previous messages you already sent (do NOT repeat these topics or phrases):');
      for (const msg of context.recentProactiveMessages) {
        const time = this.formatLocalTime(msg.sentAt);
        parts.push(`- [${time}] ${msg.text}`);
      }
    }

    // Custom context
    if (context.customContext && Object.keys(context.customContext).length > 0) {
      parts.push('');
      parts.push('Additional context:');
      for (const [key, value] of Object.entries(context.customContext)) {
        parts.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Format a Date into a human-readable local time string.
   */
  private formatLocalTime(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Map LLM response token counts to ProactiveTokenUsage.
   */
  private mapTokenUsage(response: LLMResponse): ProactiveTokenUsage {
    const promptTokens = response.promptEvalCount ?? 0;
    const completionTokens = response.evalCount ?? 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model: response.model,
    };
  }
}
