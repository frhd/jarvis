/**
 * Quality Evaluator - LLM-as-Judge
 *
 * Evaluates response quality using Ollama to rate responses on a 0-10 scale.
 * Provides feedback and pass/fail determination for regression testing.
 */

import type { LLMClient } from '../../src/clients/llm.client.js';
import type { ChildIntent } from '../../src/types/intent.types.js';
import type { QualityScore } from './types.js';
import {
  LLM_JUDGE_PROMPT,
  QUALITY_THRESHOLDS,
} from './config.js';

/**
 * Represents a prior turn in the conversation for context
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Response format expected from the LLM judge
 */
interface JudgeResponse {
  score: number;
  feedback: string;
}

/**
 * QualityEvaluator uses an LLM to evaluate chatbot response quality.
 *
 * It implements the "LLM-as-judge" pattern where a separate LLM call
 * rates the quality of responses based on relevance, coherence,
 * helpfulness, and appropriateness.
 */
export class QualityEvaluator {
  constructor(private readonly llmClient: LLMClient) {}

  /**
   * Evaluate the quality of a bot response.
   *
   * @param userMessage - The original user message
   * @param botResponse - The bot's response to evaluate
   * @param expectedIntent - Optional expected intent for context
   * @param conversationHistory - Optional prior turns for multi-turn context
   * @returns Quality score with feedback and pass/fail status
   */
  async evaluate(
    userMessage: string,
    botResponse: string,
    expectedIntent?: ChildIntent,
    conversationHistory?: ConversationTurn[],
  ): Promise<QualityScore> {
    // Build the judge prompt
    const prompt = this.buildPrompt(userMessage, botResponse, expectedIntent, conversationHistory);

    try {
      // Call LLM to evaluate
      const response = await this.llmClient.chat([
        { role: 'user', content: prompt },
      ]);

      // Parse the response
      const parsed = this.parseResponse(response.content);

      return {
        score: parsed.score,
        feedback: parsed.feedback,
        passed: parsed.score >= QUALITY_THRESHOLDS.PASS,
      };
    } catch (error) {
      // On error, return a default score with error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        score: 5,
        feedback: `Evaluation error: ${errorMessage}`,
        passed: false,
      };
    }
  }

  /**
   * Build the evaluation prompt from the template.
   */
  private buildPrompt(
    userMessage: string,
    botResponse: string,
    expectedIntent?: ChildIntent,
    conversationHistory?: ConversationTurn[],
  ): string {
    // Build conversation context string if we have prior turns
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const contextLines = conversationHistory.map((turn) => {
        const role = turn.role === 'user' ? 'User' : 'Bot';
        return `${role}: "${this.escapeForPrompt(turn.text)}"`;
      });
      conversationContext = `\nPrior conversation:\n${contextLines.join('\n')}\n`;
    }

    return LLM_JUDGE_PROMPT
      .replace('{conversationContext}', conversationContext)
      .replace('{userMessage}', this.escapeForPrompt(userMessage))
      .replace('{botResponse}', this.escapeForPrompt(botResponse))
      .replace('{expectedIntent}', expectedIntent ?? 'not specified');
  }

  /**
   * Escape special characters in text for safe prompt inclusion.
   */
  private escapeForPrompt(text: string): string {
    // Escape quotes and newlines
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Parse the LLM response to extract score and feedback.
   * Handles malformed responses with regex fallback.
   */
  private parseResponse(content: string): JudgeResponse {
    // Try to parse as JSON first
    try {
      // Find JSON in the response (may have extra text)
      const jsonMatch = content.match(/\{[\s\S]*?"score"[\s\S]*?"feedback"[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as JudgeResponse;
        if (typeof parsed.score === 'number' && typeof parsed.feedback === 'string') {
          // Clamp score to 0-10 range
          const clampedScore = Math.max(0, Math.min(10, parsed.score));
          return {
            score: clampedScore,
            feedback: parsed.feedback,
          };
        }
      }
    } catch {
      // JSON parsing failed, try regex fallback
    }

    // Regex fallback: try to extract score
    const scoreMatch = content.match(/(?:score|rating)[:\s]*(\d+(?:\.\d+)?)/i);
    if (scoreMatch) {
      const score = Math.max(0, Math.min(10, parseFloat(scoreMatch[1])));
      // Try to extract some feedback text
      const feedbackMatch = content.match(/(?:feedback|reason|explanation)[:\s]*["']?([^"'\n]+)/i);
      const feedback = feedbackMatch?.[1]?.trim() ?? 'Unable to extract feedback';
      return { score, feedback };
    }

    // Last resort: look for any number 0-10
    const numberMatch = content.match(/\b([0-9]|10)\b/);
    if (numberMatch) {
      return {
        score: parseInt(numberMatch[1], 10),
        feedback: 'Parse fallback: extracted score from response',
      };
    }

    // Complete failure
    return {
      score: 5,
      feedback: 'Parse error: could not extract score from LLM response',
    };
  }

  /**
   * Determine the quality level based on score.
   */
  static getQualityLevel(score: number): 'pass' | 'warn' | 'fail' {
    if (score >= QUALITY_THRESHOLDS.PASS) {
      return 'pass';
    } else if (score >= QUALITY_THRESHOLDS.WARN) {
      return 'warn';
    }
    return 'fail';
  }
}
