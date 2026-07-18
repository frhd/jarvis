import { search, SearchResults, SearchResult, SafeSearchType } from 'duck-duck-scrape';
import { logger } from '../../utils/logger.js';
import { isWebSearchEnabled } from '../../config/feature-flags.js';
import { computeBackoffDelayMs, DEFAULT_BACKOFF_MULTIPLIER } from '../../utils/backoff.js';

/** One-sided jitter added to web-search retry delays, as a fraction of the base delay (25%). */
const WEB_SEARCH_RETRY_JITTER_FACTOR = 0.25;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchToolResult {
  success: boolean;
  results: WebSearchResult[];
  query: string;
  error?: string;
  durationMs: number;
  retryCount?: number;
  rateLimitedUntil?: Date | null;
}

export interface WebSearchOptions {
  maxResults?: number;
  safeSearch?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<WebSearchOptions> = {
  maxResults: 5,
  safeSearch: true,
  timeoutMs: 10000,
  maxRetries: 3,
  retryBaseDelayMs: 5000,
  retryMaxDelayMs: 120000,
};

/** Default rate limit cooldown in milliseconds (5 minutes) */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 300_000;

/** Rate limit cache cleanup timeout in milliseconds (10 minutes) */
const RATE_LIMIT_CACHE_CLEANUP_MS = 600_000;

// Track rate limit state per query pattern
interface RateLimitState {
  rateLimited: boolean;
  rateLimitedUntil?: Date;
  retryAfter?: number; // seconds until retry allowed
}
const rateLimitCache = new Map<string, RateLimitState>();

// Global rate limiter - enforce minimum delay between ALL requests
let lastSearchTime = 0;
const MIN_DELAY_BETWEEN_REQUESTS_MS = 5000; // 5 seconds between requests to avoid DDG rate limits

// Track recent successful search results for serving during rate limits
interface CachedSearchResult {
  query: string;
  results: WebSearchResult[];
  cachedAt: Date;
}
const searchResultCache = new Map<string, CachedSearchResult>();
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes (was 30 minutes)

/**
 * Web Search Tool
 *
 * Uses DuckDuckGo (via duck-duck-scrape) to perform web searches.
 * Designed to be used with the tool executor service for agentic workflows.
 */
export class WebSearchTool {
  private options: Required<WebSearchOptions>;

  constructor(options?: WebSearchOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get cached search results for a query (useful during rate limits)
   */
  getCachedResults(query: string): WebSearchResult[] | null {
    const cached = searchResultCache.get(query);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    if (new Date().getTime() - cached.cachedAt.getTime() > SEARCH_CACHE_TTL_MS) {
      searchResultCache.delete(query);
      return null;
    }

    logger.debug('[WebSearchTool] Returning cached results', {
      query: query.substring(0, 50),
      cachedAt: cached.cachedAt,
      ageMs: new Date().getTime() - cached.cachedAt.getTime(),
      resultCount: cached.results.length,
    });

    return cached.results;
  }

  /**
   * Check if a query is currently rate-limited
   */
  private isRateLimited(query: string): RateLimitState | null {
    const state = rateLimitCache.get(query);
    if (!state) return null;

    if (state.rateLimited && state.rateLimitedUntil) {
      // Check if rate limit has expired
      if (new Date() >= state.rateLimitedUntil) {
        rateLimitCache.delete(query);
        return null;
      }
      return state;
    }

    return null;
  }

  /**
   * Update rate limit state for a query
   */
  private updateRateLimitState(query: string, error: string): void {
    const retryAfterMatch = error.match(/retry-after[:\s]*(\d+)/i);
    const retryAfter = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : undefined;

    const rateLimitedUntil = retryAfter
      ? new Date(Date.now() + retryAfter * 1000)
      : new Date(Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS); // Default 5 minutes cooldown (was 1 minute)

    rateLimitCache.set(query, {
      rateLimited: true,
      rateLimitedUntil,
      retryAfter,
    });

    // Clean up expired entries after timeout
    setTimeout(() => {
      const cached = rateLimitCache.get(query);
      if (cached && cached.rateLimitedUntil && new Date() >= cached.rateLimitedUntil) {
        rateLimitCache.delete(query);
      }
    }, RATE_LIMIT_CACHE_CLEANUP_MS);
  }

  /**
   * Calculate delay with exponential backoff and jitter.
   *
   * Uses the shared backoff utility: baseDelay * 2^(attempt-1) plus one-sided
   * jitter of up to 25% of the base delay, capped at retryMaxDelayMs.
   */
  private calculateRetryDelay(attempt: number): number {
    return computeBackoffDelayMs(attempt, {
      baseDelayMs: this.options.retryBaseDelayMs,
      maxDelayMs: this.options.retryMaxDelayMs,
      multiplier: DEFAULT_BACKOFF_MULTIPLIER,
      attemptOffset: 1,
      jitterFactor: WEB_SEARCH_RETRY_JITTER_FACTOR,
      jitterMode: 'upward',
      jitterBasis: 'base',
    });
  }

  /**
   * Execute a web search query with retry and rate limit handling
   *
   * @param query - The search query string
   * @returns WebSearchToolResult with search results or error
   */
  async execute(query: string): Promise<WebSearchToolResult> {
    const startTime = Date.now();

    // Check if web search is enabled
    if (!isWebSearchEnabled()) {
      logger.warn('[WebSearchTool] Web search is disabled via feature flag');
      return {
        success: false,
        results: [],
        query,
        error: 'Web search is disabled',
        durationMs: Date.now() - startTime,
      };
    }

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        results: [],
        query,
        error: 'Empty query provided',
        durationMs: Date.now() - startTime,
      };
    }

    // Enforce global rate limiting - minimum delay between ALL requests
    const timeSinceLastSearch = Date.now() - lastSearchTime;
    if (timeSinceLastSearch < MIN_DELAY_BETWEEN_REQUESTS_MS) {
      const delayMs = MIN_DELAY_BETWEEN_REQUESTS_MS - timeSinceLastSearch;
      logger.debug('[WebSearchTool] Global rate limiter: waiting', {
        delayMs,
        query: query.substring(0, 50),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Check if this query is currently rate-limited
    const rateLimitState = this.isRateLimited(query);
    if (rateLimitState) {
      const waitTimeSeconds = rateLimitState.retryAfter ?? 60;
      const waitTimeReadable = waitTimeSeconds < 60
        ? `${waitTimeSeconds} seconds`
        : `${Math.round(waitTimeSeconds / 60)} minutes`;

      logger.warn('[WebSearchTool] Query is rate-limited', {
        query: query.substring(0, 50),
        waitTimeSeconds,
        rateLimitedUntil: rateLimitState.rateLimitedUntil,
      });

      return {
        success: false,
        results: [],
        query,
        error: `Rate limited. Please try again in ${waitTimeReadable}.`,
        durationMs: Date.now() - startTime,
        rateLimitedUntil: rateLimitState.rateLimitedUntil,
      };
    }

    // Attempt search with retry logic
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      const attemptStartTime = Date.now();

      logger.info('[WebSearchTool] Executing search', {
        query: query.substring(0, 100),
        maxResults: this.options.maxResults,
        attempt,
        maxAttempts: this.options.maxRetries,
      });

      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, this.options.timeoutMs);

        // Execute search with DuckDuckGo
        const searchResults: SearchResults = await search(query, {
          safeSearch: this.options.safeSearch ? SafeSearchType.MODERATE : SafeSearchType.OFF,
        });

        clearTimeout(timeoutId);

        // Update global rate limiter timestamp
        lastSearchTime = Date.now();

        // Clear rate limit state on success
        rateLimitCache.delete(query);

        // Format results
        const formattedResults = this.formatResults(searchResults, this.options.maxResults);
        const durationMs = Date.now() - startTime;

        logger.info('[WebSearchTool] Search completed', {
          query: query.substring(0, 50),
          resultCount: formattedResults.length,
          durationMs,
          attempt,
          retryCount: attempt - 1,
        });

        // Cache successful results for future rate limit fallback
        searchResultCache.set(query, {
          query,
          results: formattedResults,
          cachedAt: new Date(),
        });

        // Clean up expired cache entries
        this.cleanupExpiredCacheEntries();

        return {
          success: true,
          results: formattedResults,
          query,
          durationMs,
          retryCount: attempt - 1,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Handle timeout specifically
        if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
          logger.warn('[WebSearchTool] Search timed out', {
            query: query.substring(0, 50),
            timeoutMs: this.options.timeoutMs,
            attempt,
          });

          if (attempt < this.options.maxRetries) {
            const retryDelay = this.calculateRetryDelay(attempt);
            logger.info('[WebSearchTool] Retrying after timeout', {
              delayMs: retryDelay,
              attempt: attempt + 1,
            });
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          }

          return {
            success: false,
            results: [],
            query,
            error: `Search timed out after ${this.options.timeoutMs}ms (${this.options.maxRetries} attempts)`,
            durationMs,
            retryCount: attempt - 1,
          };
        }

        // Check for rate limit errors
        if (errorMessage.toLowerCase().includes('rate limit') ||
            errorMessage.toLowerCase().includes('too many requests') ||
            errorMessage.toLowerCase().includes('429') ||
            errorMessage.toLowerCase().includes('detected an anomaly')) {
          logger.warn('[WebSearchTool] Rate limit detected', {
            query: query.substring(0, 50),
            errorMessage,
            attempt,
          });

          this.updateRateLimitState(query, errorMessage);

          if (attempt < this.options.maxRetries) {
            const retryDelay = this.calculateRetryDelay(attempt);
            logger.info('[WebSearchTool] Retrying after rate limit', {
              delayMs: retryDelay,
              attempt: attempt + 1,
            });
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          }

          // Return rate limited state
          const rateLimitState = this.isRateLimited(query);
          const waitTime = rateLimitState?.retryAfter ?? 60;
          const waitTimeReadable = waitTime < 60
            ? `${waitTime} seconds`
            : `${Math.round(waitTime / 60)} minutes`;

          return {
            success: false,
            results: [],
            query,
            error: `Rate limited. Please try again in ${waitTimeReadable}.`,
            durationMs,
            retryCount: attempt - 1,
            rateLimitedUntil: rateLimitState?.rateLimitedUntil,
          };
        }

        // Log other errors
        logger.error('[WebSearchTool] Search failed', {
          query: query.substring(0, 50),
          error: errorMessage,
          attempt,
          durationMs,
        });

        // Retry on transient errors
        if (attempt < this.options.maxRetries &&
            (errorMessage.includes('ECONNRESET') ||
             errorMessage.includes('ETIMEDOUT') ||
             errorMessage.includes('ENETUNREACH') ||
             errorMessage.includes('network'))) {
          const retryDelay = this.calculateRetryDelay(attempt);
          logger.info('[WebSearchTool] Retrying after network error', {
            delayMs: retryDelay,
            attempt: attempt + 1,
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        // Final failure after all retries
        return {
          success: false,
          results: [],
          query,
          error: errorMessage,
          durationMs,
          retryCount: attempt - 1,
        };
      }
    }

    // Should not reach here, but TypeScript requires a return
    return {
      success: false,
      results: [],
      query,
      error: 'Max retries exceeded',
      durationMs: Date.now() - startTime,
      retryCount: this.options.maxRetries,
    };
  }

  /**
   * Format raw DuckDuckGo results into our standard format
   *
   * @param searchResults - Raw search results from duck-duck-scrape
   * @param maxResults - Maximum number of results to return
   * @returns Formatted search results array
   */
  formatResults(searchResults: SearchResults, maxResults: number): WebSearchResult[] {
    if (!searchResults?.results || !Array.isArray(searchResults.results)) {
      return [];
    }

    return searchResults.results
      .slice(0, maxResults)
      .map((result: SearchResult) => ({
        title: result.title || 'No title',
        url: result.url || '',
        snippet: result.description || result.rawDescription || '',
      }))
      .filter((result) => result.url && result.snippet);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCacheEntries(): void {
    const now = new Date().getTime();

    for (const [query, cached] of searchResultCache.entries()) {
      if (now - cached.cachedAt.getTime() > SEARCH_CACHE_TTL_MS) {
        searchResultCache.delete(query);
      }
    }
  }

  /**
   * Format search results as a human-readable string for LLM consumption
   *
   * @param result - WebSearchToolResult to format
   * @returns Formatted string for LLM context
   */
  formatForLLM(result: WebSearchToolResult): string {
    if (!result.success) {
      return `Web search failed: ${result.error}`;
    }

    if (result.results.length === 0) {
      return `No search results found for: "${result.query}"`;
    }

    const formattedResults = result.results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`)
      .join('\n\n');

    return `Search results for "${result.query}":\n\n${formattedResults}`;
  }

  /**
   * Get the tool definition for LLM tool calling
   */
  static getToolDefinition() {
    return {
      type: 'function' as const,
      function: {
        name: 'web_search',
        description: 'Search the web for current information, news, weather, prices, or any other real-time data. Use this when the user asks about current events, recent news, live data, or anything that requires up-to-date information.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to look up on the web',
            },
          },
          required: ['query'],
        },
      },
    };
  }
}

// Export singleton instance with default options
export const webSearchTool = new WebSearchTool();
