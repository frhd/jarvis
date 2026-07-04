/**
 * Complexity Scorer - Analyzes message complexity for intelligent model selection
 */

import { ComplexityAnalysis, UnifiedMessage } from '../types/llm.types';
import { createLogger } from '../utils/logger';
import {
  SIMPLE_TOKEN_THRESHOLD,
  QUICK_LOW_TOKEN_THRESHOLD,
  MEDIUM_COMPLEXITY_THRESHOLD,
  HIGH_COMPLEXITY_THRESHOLD,
  SIMPLE_MESSAGE_THRESHOLD,
  LOW_MESSAGE_THRESHOLD,
  IMAGE_TOKEN_ESTIMATE,
  SIMPLE_OUTPUT_TOKENS,
  CODE_GEN_OUTPUT_TOKENS,
  REASONING_OUTPUT_TOKENS,
  MULTI_TURN_OUTPUT_TOKENS,
} from '../config/constants.js';

const logger = createLogger('ComplexityScorer');

const REASONING_KEYWORDS = [
  'explain', 'analyze', 'analyse', 'compare', 'contrast', 'evaluate', 'assess',
  'critique', 'review', 'why', 'how does', 'how can', 'what if', 'consider',
  'think through', 'think about', 'step by step', 'reasoning', 'logic', 'logical',
  'argument', 'proof', 'prove', 'derive', 'deduce', 'infer', 'conclude', 'therefore',
  'implications', 'consequences', 'trade-offs', 'tradeoffs', 'pros and cons',
  'advantages', 'disadvantages',
];

const CODE_KEYWORDS = [
  'code', 'function', 'method', 'class', 'implement', 'programming', 'script',
  'algorithm', 'debug', 'fix the bug', 'fix this', 'refactor', 'optimize',
  'write a', 'create a', 'build', 'develop', 'typescript', 'javascript', 'python',
  'rust', 'golang', 'java', 'c++', 'sql', 'html', 'css', 'react', 'node', 'express',
  'api', 'endpoint', 'database', 'query', 'schema', 'migration', 'test', 'unit test',
];

const WEB_SEARCH_KEYWORDS = [
  'latest', 'current', 'recent', 'news', 'today', 'yesterday', 'this week',
  'this month', 'update', 'updates', 'search for', 'look up', 'find information',
  'find out', 'what is happening', 'trending', 'real-time', 'live', '2024', '2025',
  'breaking', 'announcement',
];

const SIMPLE_KEYWORDS = [
  'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye', 'ok', 'okay',
  'yes', 'no', 'sure', 'got it', 'understood', 'cool', 'nice', 'great', 'awesome',
];

const MATH_KEYWORDS = [
  'calculate', 'compute', 'solve', 'equation', 'formula', 'math', 'mathematical',
  'derivative', 'integral', 'matrix', 'vector', 'probability', 'statistics',
  'average', 'sum', 'multiply', 'divide',
];

const MULTI_STEP_PATTERNS = [
  /\b(first|then|next|after that|finally)\b/i,
  /\b(step \d+|step one|step two)\b/i,
  /\b(1\.|2\.|3\.|4\.)/,
  /\b(and then|followed by)\b/i,
  /\b(also|additionally|furthermore)\b/i,
];

export interface ComplexityWeights {
  tokenCount: number;
  multipleTurns: number;
  reasoning: number;
  codeGeneration: number;
  webSearch: number;
  images: number;
  math: number;
  multiStep: number;
}

const DEFAULT_WEIGHTS: ComplexityWeights = {
  tokenCount: 0.15,
  multipleTurns: 0.10,
  reasoning: 0.25,
  codeGeneration: 0.20,
  webSearch: 0.10,
  images: 0.10,
  math: 0.05,
  multiStep: 0.05,
};

export class ComplexityScorer {
  private weights: ComplexityWeights;

  constructor(weights?: Partial<ComplexityWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  analyze(messages: UnifiedMessage[]): ComplexityAnalysis {
    let totalTokens = 0;
    let hasImages = false;
    let requiresReasoning = false;
    let requiresCodeGeneration = false;
    let requiresWebSearch = false;
    let requiresMath = false;
    let isMultiStep = false;
    let isSimple = true;

    const allText: string[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalTokens += this.estimateTokens(msg.content);
        allText.push(msg.content);
      } else {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            totalTokens += this.estimateTokens(part.text);
            allText.push(part.text);
          } else if (part.type === 'image_url') {
            hasImages = true;
            totalTokens += IMAGE_TOKEN_ESTIMATE;
          }
        }
      }
    }

    const combinedText = allText.join(' ').toLowerCase();

    requiresReasoning = this.containsKeywords(combinedText, REASONING_KEYWORDS);
    requiresCodeGeneration = this.containsKeywords(combinedText, CODE_KEYWORDS);
    requiresWebSearch = this.containsKeywords(combinedText, WEB_SEARCH_KEYWORDS);
    requiresMath = this.containsKeywords(combinedText, MATH_KEYWORDS);
    isMultiStep = this.matchesPatterns(combinedText, MULTI_STEP_PATTERNS);

    isSimple =
      totalTokens < SIMPLE_TOKEN_THRESHOLD &&
      !requiresReasoning &&
      !requiresCodeGeneration &&
      !requiresWebSearch &&
      !requiresMath &&
      !isMultiStep &&
      !hasImages &&
      messages.length <= SIMPLE_MESSAGE_THRESHOLD;

    if (this.containsKeywords(combinedText, SIMPLE_KEYWORDS) && totalTokens < QUICK_LOW_TOKEN_THRESHOLD) {
      isSimple = true;
    }

    const hasMultipleTurns = messages.length > 2;

    let score = 0;

    const tokenFactor = Math.min(totalTokens / 4000, 1);
    score += tokenFactor * this.weights.tokenCount;

    if (hasMultipleTurns) {
      score += this.weights.multipleTurns;
    }

    if (requiresReasoning) {
      score += this.weights.reasoning;
    }

    if (requiresCodeGeneration) {
      score += this.weights.codeGeneration;
    }

    if (requiresWebSearch) {
      score += this.weights.webSearch;
    }

    if (hasImages) {
      score += this.weights.images;
    }

    if (requiresMath) {
      score += this.weights.math;
    }

    if (isMultiStep) {
      score += this.weights.multiStep;
    }

    if (isSimple) {
      score = Math.min(score, 0.15);
    }

    score = Math.max(0, Math.min(1, score));

    const estimatedOutputTokens = this.estimateOutputTokens(score, {
      requiresCodeGeneration,
      requiresReasoning,
      hasMultipleTurns,
      isSimple,
    });

    let level: 'low' | 'medium' | 'high';
    if (score < MEDIUM_COMPLEXITY_THRESHOLD) {
      level = 'low';
    } else if (score < HIGH_COMPLEXITY_THRESHOLD) {
      level = 'medium';
    } else {
      level = 'high';
    }

    logger.debug(`Complexity analysis: score=${score.toFixed(2)}, level=${level}`, {
      tokenCount: totalTokens,
      requiresReasoning,
      requiresCodeGeneration,
      requiresWebSearch,
      hasImages,
    });

    return {
      score,
      level,
      factors: {
        tokenCount: totalTokens,
        hasMultipleTurns,
        requiresReasoning,
        requiresCodeGeneration,
        requiresWebSearch,
        hasImages,
        estimatedOutputTokens,
      },
    };
  }

  private containsKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }

  private matchesPatterns(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }

  private estimateTokens(text: string): number {
    const codeIndicators = ['{', '}', '()', '=>', 'function', 'const ', 'let ', 'var ', 'import '];
    const looksLikeCode = codeIndicators.some((indicator) => text.includes(indicator));
    const charsPerToken = looksLikeCode ? 3 : 4;
    return Math.ceil(text.length / charsPerToken);
  }

  private estimateOutputTokens(
    score: number,
    factors: {
      requiresCodeGeneration: boolean;
      requiresReasoning: boolean;
      hasMultipleTurns: boolean;
      isSimple: boolean;
    }
  ): number {
    if (factors.isSimple) {
      return SIMPLE_OUTPUT_TOKENS;
    }

    if (factors.requiresCodeGeneration) {
      return CODE_GEN_OUTPUT_TOKENS;
    }

    if (factors.requiresReasoning) {
      return REASONING_OUTPUT_TOKENS;
    }

    if (factors.hasMultipleTurns) {
      return MULTI_TURN_OUTPUT_TOKENS;
    }

    return Math.round(300 + score * 1200);
  }

  setWeights(weights: Partial<ComplexityWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  getWeights(): ComplexityWeights {
    return { ...this.weights };
  }

  quickCheck(text: string): 'low' | 'medium' | 'high' {
    const lower = text.toLowerCase();
    const tokens = this.estimateTokens(text);

    if (tokens < QUICK_LOW_TOKEN_THRESHOLD && this.containsKeywords(lower, SIMPLE_KEYWORDS)) {
      return 'low';
    }

    if (
      this.containsKeywords(lower, CODE_KEYWORDS) ||
      this.containsKeywords(lower, REASONING_KEYWORDS)
    ) {
      return 'high';
    }

    if (tokens > 500 || this.containsKeywords(lower, WEB_SEARCH_KEYWORDS)) {
      return 'medium';
    }

    return 'low';
  }
}

let scorerInstance: ComplexityScorer | null = null;

export function getComplexityScorer(): ComplexityScorer {
  if (!scorerInstance) {
    scorerInstance = new ComplexityScorer();
  }
  return scorerInstance;
}

export function resetComplexityScorer(): void {
  scorerInstance = null;
}
