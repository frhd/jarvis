import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { LLMClient } from '../clients/llm.client';

// Constants for Telegram message limits
export const TELEGRAM_MAX_LENGTH = 4096;
export const TARGET_LENGTH = 3500;
export const SUMMARIZATION_THRESHOLD = 3800;
export const TRUNCATE_BUFFER = 200;

export interface MessageLengthResult {
  text: string;
  originalLength: number;
  finalLength: number;
  wasSummarized: boolean;
  wasTruncated: boolean;
  processingTimeMs: number;
}

export interface MessageLengthConfig {
  maxLength: number;
  targetLength: number;
  summarizationEnabled: boolean;
  summarizationTimeoutMs: number;
}

export class MessageLengthService {
  private llmClient: LLMClient;
  private config: MessageLengthConfig;

  // Constants for truncateAtSentence
  private readonly ELLIPSIS = '...';
  private readonly MIN_SENTENCE_POSITION_FACTOR = 0.5;
  private readonly MIN_WORD_POSITION_FACTOR = 0.7;

  // Metrics tracking
  private summarizationCount = 0;
  private truncationCount = 0;

  constructor(config?: Partial<MessageLengthConfig>) {
    this.config = {
      maxLength: config?.maxLength ?? appConfig.response.maxLength ?? TELEGRAM_MAX_LENGTH,
      targetLength: config?.targetLength ?? appConfig.response.targetLength ?? TARGET_LENGTH,
      summarizationEnabled: config?.summarizationEnabled ?? appConfig.response.summarizationEnabled ?? true,
      summarizationTimeoutMs: config?.summarizationTimeoutMs ?? appConfig.response.summarizationTimeoutMs ?? 10000,
    };

    // Initialize LLM client for summarization using the main LLM config
    this.llmClient = new LLMClient({
      baseUrl: appConfig.llm.baseUrl,
      model: appConfig.llm.model,
      timeoutMs: this.config.summarizationTimeoutMs,
      maxRetries: 1, // Fail fast for summarization
      temperature: 0.3,
      maxTokens: 1024,
    });

    logger.info('[MessageLength] Service initialized', {
      maxLength: this.config.maxLength,
      targetLength: this.config.targetLength,
      summarizationEnabled: this.config.summarizationEnabled,
    });
  }

  /**
   * Check if text exceeds the maximum allowed length
   */
  isOverLimit(text: string): boolean {
    return this.getLength(text) > this.config.maxLength;
  }

  /**
   * Check if text should be summarized (above threshold but not yet at max)
   */
  shouldSummarize(text: string): boolean {
    const length = this.getLength(text);
    return length > SUMMARIZATION_THRESHOLD && this.config.summarizationEnabled;
  }

  /**
   * Get the length of text in characters
   */
  getLength(text: string): number {
    return text.length;
  }

  /**
   * Main handler: ensure text fits within Telegram's limits
   * Flow: check length → summarize if needed → truncate if still needed
   */
  async ensureFitsLimit(text: string): Promise<MessageLengthResult> {
    const startTime = Date.now();
    const originalLength = this.getLength(text);

    // Short circuit if already within limits
    if (originalLength <= this.config.targetLength) {
      return {
        text,
        originalLength,
        finalLength: originalLength,
        wasSummarized: false,
        wasTruncated: false,
        processingTimeMs: Date.now() - startTime,
      };
    }

    let result = text;
    let wasSummarized = false;
    let wasTruncated = false;

    // Try summarization first if enabled and text is above threshold
    if (this.shouldSummarize(text)) {
      try {
        const summarized = await this.summarize(text);
        if (summarized && this.getLength(summarized) < originalLength) {
          result = summarized;
          wasSummarized = true;
          this.summarizationCount++;
          logger.info('[MessageLength] Text summarized', {
            originalLength,
            summarizedLength: this.getLength(summarized),
          });
        }
      } catch (error) {
        logger.warn('[MessageLength] Summarization failed, falling back to truncation', {
          error: error instanceof Error ? error.message : String(error),
          originalLength,
        });
      }
    }

    // Truncate if still over limit
    if (this.getLength(result) > this.config.maxLength - TRUNCATE_BUFFER) {
      result = this.truncateAtSentence(result, this.config.maxLength - TRUNCATE_BUFFER);
      wasTruncated = true;
      this.truncationCount++;
      logger.info('[MessageLength] Text truncated', {
        beforeTruncation: wasSummarized ? 'after summarization' : 'original',
        finalLength: this.getLength(result),
      });
    }

    const finalLength = this.getLength(result);
    const processingTimeMs = Date.now() - startTime;

    logger.info('[MessageLength] Processing complete', {
      originalLength,
      finalLength,
      wasSummarized,
      wasTruncated,
      processingTimeMs,
    });

    return {
      text: result,
      originalLength,
      finalLength,
      wasSummarized,
      wasTruncated,
      processingTimeMs,
    };
  }

  /**
   * Summarize text using the LLM
   */
  private async summarize(text: string): Promise<string> {
    const prompt = `Summarize the following response to fit within ${this.config.targetLength} characters while preserving the key information, main points, and conclusion. Keep the same tone and style. Do not add any preamble or explanation, just output the summarized response directly.

Response to summarize:
${text}`;

    const response = await this.llmClient.chat([
      { role: 'user', content: prompt },
    ]);

    if (!response.content) {
      throw new Error('Failed to summarize text: empty response');
    }

    return response.content.trim();
  }

  /**
   * Truncate text at a sentence boundary
   * Finds the last complete sentence before the limit
   */
  truncateAtSentence(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Look for the last sentence boundary before maxLength
    const truncatePoint = maxLength - this.ELLIPSIS.length;
    const substring = text.substring(0, truncatePoint);

    // Try to find sentence boundaries in order of preference
    const sentenceEnders = [
      /\.\s+[A-Z]/g,  // Period followed by space and capital letter
      /[.!?]\s+/g,    // Any sentence ender followed by space
      /[.!?]/g,       // Any sentence ender
    ];

    for (const regex of sentenceEnders) {
      let lastMatch: RegExpExecArray | null = null;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(substring)) !== null) {
        lastMatch = match;
      }

      if (lastMatch && lastMatch.index > truncatePoint * this.MIN_SENTENCE_POSITION_FACTOR) {
        // Found a good sentence boundary in the latter half
        // Include the sentence-ending punctuation
        const endIndex = lastMatch.index + 1;
        return text.substring(0, endIndex) + this.ELLIPSIS;
      }
    }

    // No sentence boundary found, try paragraph/line breaks
    const lastNewline = substring.lastIndexOf('\n');
    if (lastNewline > truncatePoint * this.MIN_SENTENCE_POSITION_FACTOR) {
      return text.substring(0, lastNewline).trimEnd() + this.ELLIPSIS;
    }

    // Fall back to word boundary
    const lastSpace = substring.lastIndexOf(' ');
    if (lastSpace > truncatePoint * this.MIN_WORD_POSITION_FACTOR) {
      return text.substring(0, lastSpace) + this.ELLIPSIS;
    }

    // Last resort: hard truncate
    return text.substring(0, truncatePoint) + this.ELLIPSIS;
  }

  /**
   * Get current metrics
   */
  getMetrics(): { summarizationCount: number; truncationCount: number } {
    return {
      summarizationCount: this.summarizationCount,
      truncationCount: this.truncationCount,
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.summarizationCount = 0;
    this.truncationCount = 0;
  }
}
