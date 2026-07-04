/**
 * Intent Escalation Service
 * Handles uncertain intent classifications by escalating to Claude CLI for more accurate classification
 */

import { ClaudeClient } from '../clients/claude.client';
import { appConfig } from '../config';
import {
  ESCALATION_CONFIDENCE_HIGH,
  ESCALATION_CONFIDENCE_MEDIUM,
  ESCALATION_CONFIDENCE_LOW,
  ESCALATION_CONFIDENCE_DEFAULT,
  ESCALATION_MESSAGE_PREVIEW_LENGTH,
  ESCALATION_CONTENT_PREVIEW_LENGTH,
} from '../config/constants';
import { logger } from '../utils/logger';
import {
  EnhancedIntentResult,
  ParentIntent,
  ChildIntent,
  CHILD_TO_PARENT,
} from '../types/intent.types';

const ESCALATION_SYSTEM_PROMPT = `You are an expert intent classifier. Your task is to verify and potentially correct intent classifications.

## Parent Categories:
- greeting: Social interactions (hello, goodbye, thanks)
- question: Information seeking (what, how, why questions)
- command: Action requests (do something, create, search)
- feedback: Reactions (good, bad, ok, opinions)
- continuation: Follow-ups to previous messages

## Child Categories by Parent:

### greeting:
- simple_greeting: "hi", "hello", "hey"
- time_greeting: "good morning", "good evening"
- farewell: "bye", "see you", "talk later"
- gratitude: "thanks", "thank you", "appreciate it"

### question:
- factual_question: "what is X?", "who invented Y?"
- how_to_question: "how do I...", "how can I..."
- opinion_question: "what do you think?", "should I..."
- clarification: "what do you mean?", "can you explain?"
- web_search_question: requires current info (weather, news, prices, scores)
- personal_question: about the assistant ("what's your name?")

### command:
- task_request: "write code", "create a document", "help me with"
- search_request: "search for", "find me", "look up"
- reminder_request: "remind me", "set a reminder"
- calculation: math operations
- translation: "translate X to Y"
- summarization: "summarize", "tldr"
- correction: "no, I meant...", "fix that"

### feedback:
- positive_feedback: "great!", "perfect", "that's right"
- negative_feedback: "wrong", "not what I wanted"
- acknowledgment: "ok", "got it", "understood"
- opinion_statement: expressing views

### continuation:
- follow_up: continuing the same topic
- elaboration_request: "tell me more", "go on"
- topic_change: explicitly changing subject
- reference_previous: "about what you said earlier"

You must respond ONLY with valid JSON matching this exact format (no additional text):
{
  "parentIntent": "<parent_category>",
  "childIntent": "<child_category>",
  "confidence": <0.0-1.0>,
  "isFollowUp": <true/false>,
  "referencesContext": <true/false>,
  "requiresWebSearch": <true/false>,
  "requiresComplexReasoning": <true/false>,
  "reasoning": "<brief explanation of the classification>"
}`;

const VALID_PARENT_INTENTS: ParentIntent[] = [
  'greeting',
  'question',
  'command',
  'feedback',
  'continuation',
];

const VALID_CHILD_INTENTS: ChildIntent[] = [
  'simple_greeting', 'time_greeting', 'farewell', 'gratitude',
  'factual_question', 'how_to_question', 'opinion_question', 'clarification',
  'web_search_question', 'personal_question',
  'task_request', 'search_request', 'reminder_request', 'calculation',
  'translation', 'summarization', 'correction',
  'positive_feedback', 'negative_feedback', 'acknowledgment', 'opinion_statement',
  'follow_up', 'elaboration_request', 'topic_change', 'reference_previous',
];

export interface EscalationConfig {
  timeoutMs: number;
  model: string;
  enableFallback: boolean;
}

export class EscalationService {
  private claudeClient: ClaudeClient;
  private config: EscalationConfig;

  constructor(
    claudeClient: ClaudeClient,
    config?: Partial<EscalationConfig>
  ) {
    this.claudeClient = claudeClient;
    this.config = {
      timeoutMs: config?.timeoutMs ?? appConfig.claude.timeoutMs,
      model: config?.model ?? appConfig.claude.model,
      enableFallback: config?.enableFallback ?? true,
    };
  }

  /**
   * Escalate an uncertain intent classification to Claude for more accurate analysis
   */
  async escalateIntent(
    message: string,
    originalResult: EnhancedIntentResult,
    conversationContext?: string
  ): Promise<EnhancedIntentResult> {
    const startTime = Date.now();

    logger.info('[Escalation] Starting intent escalation', {
      message: message.substring(0, ESCALATION_MESSAGE_PREVIEW_LENGTH),
      originalIntent: originalResult.childIntent,
      originalConfidence: originalResult.confidence,
      originalMethod: originalResult.classificationMethod,
    });

    // Build escalation prompt
    const escalationPrompt = this.buildEscalationPrompt(
      message,
      originalResult,
      conversationContext
    );

    try {
      // Call Claude CLI
      const response = await this.claudeClient.chat(escalationPrompt);

      if (!response.success || !response.content) {
        throw new Error(response.error || 'Empty response from Claude');
      }

      // Parse the response
      const parsed = this.parseClaudeResponse(response.content);

      // Build escalated result
      const escalatedResult = this.buildEscalatedResult(
        parsed,
        originalResult,
        startTime
      );

      logger.info('[Escalation] Intent escalation successful', {
        message: message.substring(0, ESCALATION_MESSAGE_PREVIEW_LENGTH),
        originalIntent: originalResult.childIntent,
        originalConfidence: originalResult.confidence,
        escalatedIntent: escalatedResult.childIntent,
        escalatedConfidence: escalatedResult.confidence,
        durationMs: escalatedResult.durationMs,
        reasoning: parsed.reasoning,
      });

      return escalatedResult;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.warn('[Escalation] Intent escalation failed, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
        fallbackEnabled: this.config.enableFallback,
      });

      if (this.config.enableFallback) {
        return this.createFallbackResult(originalResult, durationMs);
      }

      throw error;
    }
  }

  /**
   * Build the escalation prompt with original classification context
   */
  private buildEscalationPrompt(
    message: string,
    originalResult: EnhancedIntentResult,
    conversationContext?: string
  ): string {
    let prompt = `A previous classification system identified this message with LOW CONFIDENCE.\n\n`;

    prompt += `**Original Classification:**\n`;
    prompt += `- Parent Intent: ${originalResult.parentIntent}\n`;
    prompt += `- Child Intent: ${originalResult.childIntent}\n`;
    prompt += `- Confidence: ${originalResult.confidence.toFixed(2)}\n`;
    prompt += `- Confidence Level: ${originalResult.confidenceLevel}\n`;
    prompt += `- Method: ${originalResult.classificationMethod}\n\n`;

    if (conversationContext) {
      prompt += `**Conversation Context:**\n${conversationContext}\n\n`;
    }

    prompt += `**Message to Classify:**\n"${message}"\n\n`;
    prompt += `**Task:**\nVerify or correct the classification. Provide a more confident and accurate classification based on your analysis.\n\n`;
    prompt += `Respond ONLY with valid JSON (no markdown, no code blocks, no additional text).`;

    return prompt;
  }

  /**
   * Parse Claude's JSON response
   */
  private parseClaudeResponse(content: string): {
    parentIntent: ParentIntent;
    childIntent: ChildIntent;
    confidence: number;
    isFollowUp: boolean;
    referencesContext: boolean;
    requiresWebSearch: boolean;
    requiresComplexReasoning: boolean;
    reasoning?: string;
  } {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = content.trim();

      // Remove markdown code blocks if present
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      } else {
        // Try to find JSON object
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      // Validate and sanitize parent intent
      let parentIntent = parsed.parentIntent as ParentIntent;
      if (!VALID_PARENT_INTENTS.includes(parentIntent)) {
        logger.warn('[Escalation] Invalid parent intent, using default', {
          received: parentIntent,
        });
        parentIntent = 'question';
      }

      // Validate and sanitize child intent
      let childIntent = parsed.childIntent as ChildIntent;
      if (!VALID_CHILD_INTENTS.includes(childIntent)) {
        logger.warn('[Escalation] Invalid child intent, using default', {
          received: childIntent,
        });
        childIntent = 'factual_question';
      }

      // Ensure parent-child consistency
      const expectedParent = CHILD_TO_PARENT[childIntent];
      if (expectedParent !== parentIntent) {
        logger.warn('[Escalation] Parent-child mismatch, correcting', {
          childIntent,
          receivedParent: parentIntent,
          expectedParent,
        });
        parentIntent = expectedParent;
      }

      // Validate confidence
      let confidence = parsed.confidence as number;
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        logger.warn('[Escalation] Invalid confidence, using default', {
          received: confidence,
        });
        confidence = ESCALATION_CONFIDENCE_DEFAULT;
      }

      return {
        parentIntent,
        childIntent,
        confidence,
        isFollowUp: Boolean(parsed.isFollowUp),
        referencesContext: Boolean(parsed.referencesContext),
        requiresWebSearch: Boolean(parsed.requiresWebSearch),
        requiresComplexReasoning: Boolean(parsed.requiresComplexReasoning),
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    } catch (error) {
      logger.error('[Escalation] Failed to parse Claude response', {
        content: content.substring(0, ESCALATION_CONTENT_PREVIEW_LENGTH),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error(`Failed to parse escalation response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the escalated result from parsed response
   */
  private buildEscalatedResult(
    parsed: {
      parentIntent: ParentIntent;
      childIntent: ChildIntent;
      confidence: number;
      isFollowUp: boolean;
      referencesContext: boolean;
      requiresWebSearch: boolean;
      requiresComplexReasoning: boolean;
    },
    originalResult: EnhancedIntentResult,
    startTime: number
  ): EnhancedIntentResult {
    const durationMs = Date.now() - startTime;

    // Determine confidence level
    let confidenceLevel: 'high' | 'medium' | 'low' | 'uncertain';
    if (parsed.confidence >= ESCALATION_CONFIDENCE_HIGH) {
      confidenceLevel = 'high';
    } else if (parsed.confidence >= ESCALATION_CONFIDENCE_MEDIUM) {
      confidenceLevel = 'medium';
    } else if (parsed.confidence >= ESCALATION_CONFIDENCE_LOW) {
      confidenceLevel = 'low';
    } else {
      confidenceLevel = 'uncertain';
    }

    // Suggest context depth based on signals
    let suggestedContextDepth = 0;
    if (parsed.isFollowUp || parsed.referencesContext) {
      suggestedContextDepth = 5;
    }

    return {
      parentIntent: parsed.parentIntent,
      childIntent: parsed.childIntent,
      confidence: parsed.confidence,
      confidenceLevel,
      shouldEscalate: false, // Already escalated
      isFollowUp: parsed.isFollowUp,
      referencesContext: parsed.referencesContext,
      suggestedContextDepth,
      requiresWebSearch: parsed.requiresWebSearch,
      requiresComplexReasoning: parsed.requiresComplexReasoning,
      canUseCache: !parsed.referencesContext && !parsed.isFollowUp,
      durationMs,
      classificationMethod: 'escalated',
    };
  }

  /**
   * Create fallback result when escalation fails
   */
  private createFallbackResult(
    originalResult: EnhancedIntentResult,
    durationMs: number
  ): EnhancedIntentResult {
    logger.warn('[Escalation] Using original result as fallback with warning flag');

    return {
      ...originalResult,
      durationMs,
      shouldEscalate: false, // Don't retry escalation
      classificationMethod: 'escalated', // Mark as attempted escalation
      // Keep original classification but user should know it's uncertain
    };
  }
}
