import { LLMClient, ChatMessage } from '../clients/llm.client';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { MESSAGE_PREVIEW_LENGTH } from '../config/constants.js';

export type IntentCategory =
  | 'simple_greeting'  // "hi", "hello", "hey"
  | 'needs_web_search' // weather, news, current events
  | 'complex_task'     // multi-step, analysis, code
  | 'general_chat';    // everything else

export interface IntentClassificationResult {
  intent: IntentCategory;
  confidence: number; // 0-1
  durationMs: number;
}

interface ClassificationResponse {
  intent: IntentCategory;
  confidence: number;
}

const CLASSIFICATION_PROMPT = `You are an intent classifier. Classify the user message into exactly one category:

- simple_greeting: Basic greetings like "hi", "hello", "hey", "good morning", "what's up"
- needs_web_search: Questions requiring current/real-time information (weather, news, prices, events, sports, stock prices, "what time is it in...")
- complex_task: Code generation, detailed explanations, multi-step tasks, analysis, writing
- general_chat: Casual conversation, opinions, general knowledge questions

Respond ONLY with valid JSON: {"intent": "<category>", "confidence": <0.0-1.0>}
No other text. Just the JSON.`;

const VALID_INTENTS: IntentCategory[] = [
  'simple_greeting',
  'needs_web_search',
  'complex_task',
  'general_chat',
];

// Fast pattern matching for obvious intents (skip LLM call)
const GREETING_PATTERNS = /^(hi|hello|hey|yo|sup|howdy|hola|good\s*(morning|afternoon|evening|night)|what'?s?\s*up|greetings?)[\s!?.]*$/i;
const WEB_SEARCH_PATTERNS = /\b(weather|forecast|temperature|current|today'?s?|latest|news|price|stock|score|game|match|who won|what time|when is|search for|look up|find me|google)\b/i;

export class IntentClassifierService {
  private llmClient: LLMClient;
  private timeoutMs: number;
  private temperature: number;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
    this.timeoutMs = appConfig.intentClassification.timeoutMs;
    this.temperature = appConfig.intentClassification.temperature;
  }

  async classifyIntent(
    message: string,
    conversationContext?: string
  ): Promise<IntentClassificationResult> {
    const startTime = Date.now();

    if (!appConfig.intentClassification.enabled) {
      logger.debug('Intent classification disabled, defaulting to general_chat');
      return {
        intent: 'general_chat',
        confidence: 1.0,
        durationMs: Date.now() - startTime,
      };
    }

    // Fast path: pattern-based classification (skip LLM call)
    const fastResult = this.fastClassify(message);
    if (fastResult) {
      const durationMs = Date.now() - startTime;
      logger.debug('Intent classified via fast path', {
        message: message.substring(0, MESSAGE_PREVIEW_LENGTH),
        intent: fastResult.intent,
        confidence: fastResult.confidence,
        durationMs,
      });
      return { ...fastResult, durationMs };
    }

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: CLASSIFICATION_PROMPT },
      ];

      if (conversationContext) {
        messages.push({
          role: 'user',
          content: `Recent conversation context:\n${conversationContext}\n\nNow classify this message: ${message}`,
        });
      } else {
        messages.push({
          role: 'user',
          content: `User message: ${message}`,
        });
      }

      const requestId = `intent-${Date.now()}`;

      // Set up timeout race
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          this.llmClient.cancelRequest(requestId);
          reject(new Error('Intent classification timed out'));
        }, this.timeoutMs);
      });

      const response = await Promise.race([
        this.llmClient.chat(messages, requestId),
        timeoutPromise,
      ]);

      const parsed = this.parseResponse(response.content);
      const durationMs = Date.now() - startTime;

      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.warn('Intent classification failed, defaulting to general_chat', {
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      });

      return {
        intent: 'general_chat',
        confidence: 0.5,
        durationMs,
      };
    }
  }

  private fastClassify(message: string): Omit<IntentClassificationResult, 'durationMs'> | null {
    const trimmed = message.trim();

    // Check for simple greetings first (most restrictive pattern)
    if (GREETING_PATTERNS.test(trimmed)) {
      return { intent: 'simple_greeting', confidence: 0.95 };
    }

    // Check for web search triggers
    if (WEB_SEARCH_PATTERNS.test(trimmed)) {
      return { intent: 'needs_web_search', confidence: 0.9 };
    }

    // No fast match - fall back to LLM
    return null;
  }

  private parseResponse(content: string): ClassificationResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[^}]+\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // Validate intent
      const intent = parsed.intent as string;
      if (!VALID_INTENTS.includes(intent as IntentCategory)) {
        throw new Error(`Invalid intent: ${intent}`);
      }

      // Validate confidence
      let confidence = parsed.confidence as number;
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        confidence = 0.7; // Default confidence if invalid
      }

      return {
        intent: intent as IntentCategory,
        confidence,
      };
    } catch (error) {
      logger.warn('Failed to parse intent response, inferring from content', {
        content: content.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Try to infer intent from raw content
      const lowerContent = content.toLowerCase();

      if (lowerContent.includes('simple_greeting')) {
        return { intent: 'simple_greeting', confidence: 0.6 };
      }
      if (lowerContent.includes('needs_web_search')) {
        return { intent: 'needs_web_search', confidence: 0.6 };
      }
      if (lowerContent.includes('complex_task')) {
        return { intent: 'complex_task', confidence: 0.6 };
      }

      // Default to general_chat
      return { intent: 'general_chat', confidence: 0.5 };
    }
  }
}
