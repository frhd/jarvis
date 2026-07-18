import type { Message } from '../../types/index.js';
import type { BrowserService } from '../tools/browser.service.js';
import { logger } from '../../utils/logger.js';
import { webSearchTool } from '../tools/web-search.tool.js';
import { isWebSearchEnabled } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
import { extractSearchQuery } from './llm-router.detection.js';
import type { LLMRouterResult } from './llm-router.constants.js';
import {
  LOG_QUERY_SUBSTRING_LENGTH,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from './llm-router.constants.js';

/**
 * Dependencies required for web search preprocessing.
 */
export interface WebSearchDeps {
  browserService: BrowserService | null;
  /** Delegate back to the router's standard Claude handling */
  handleWithClaude: (
    message: Message,
    context: string,
    conversationHistory: Message[]
  ) => Promise<LLMRouterResult>;
}

/**
 * Handle web search requests
 *
 * Executes web search and includes results in the context for Claude to use.
 * This implements a pre-processing agentic pattern where tool results are
 * gathered before the main LLM call.
 *
 * @param deps - Web search dependencies (browser service, Claude handler)
 * @param message - The message requiring web search
 * @param context - RAG context string with user preferences, memories, etc.
 * @param conversationHistory - Recent conversation history
 * @returns LLMRouterResult with web-enhanced response
 */
export async function handleWebSearchRequest(
  deps: WebSearchDeps,
  message: Message,
  context: string,
  conversationHistory: Message[]
): Promise<LLMRouterResult> {
  const startTime = Date.now();
  const messageText = message.text || '';

  // Guard: Check if web search is enabled
  if (!isWebSearchEnabled()) {
    logger.info('[LLMRouter] Web search disabled, falling back to standard handling', {
      messageId: message.id,
    });
    return deps.handleWithClaude(message, context, conversationHistory);
  }

  logger.info('[LLMRouter] Handling web search request', {
    messageId: message.id,
    query: messageText.substring(0, LOG_QUERY_SUBSTRING_LENGTH),
  });

  try {
    // Extract search query from message
    const searchQuery = extractSearchQuery(messageText);

    // Execute web search
    const searchResult = await webSearchTool.execute(searchQuery);
    const searchDurationMs = Date.now() - startTime;

    // Guard: Handle failed search with fallback context
    if (!searchResult.success) {
      return handleFailedWebSearch(deps, message, context, conversationHistory, searchQuery, searchResult);
    }

    // Format search results for LLM context
    const searchContext = webSearchTool.formatForLLM(searchResult);

    // Enrich search results with full page content via browser
    let browserContent = '';
    if (deps.browserService && searchResult.results.length > 0) {
      try {
        const urlsToFetch = searchResult.results
          .slice(0, appConfig.browser.fetchTopN)
          .map(r => r.url);

        const pageResults = await deps.browserService.fetchMultiplePages(urlsToFetch);
        const successfulPages = pageResults.filter(r => r.success && r.content);

        if (successfulPages.length > 0) {
          browserContent = '\n\n[Full Page Content]:\n' +
            successfulPages
              .map(r => `--- ${r.url} ---\n${r.content}`)
              .join('\n\n');

          logger.info('[LLMRouter] Browser content enrichment succeeded', {
            messageId: message.id,
            fetchedPages: successfulPages.length,
            totalPages: urlsToFetch.length,
          });
        }
      } catch (error) {
        logger.warn('[LLMRouter] Browser content enrichment failed, using snippets only', {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Build enhanced context with web results
    const enhancedContext = `${context}\n\n[Web Search Results - Retrieved ${new Date().toISOString()}]:\n${searchContext}${browserContent}\n\n[Instructions]: Use the above search results to provide accurate, current information. Cite sources where appropriate.`;

    logger.info('[LLMRouter] Web search completed, routing to Claude', {
      messageId: message.id,
      searchDurationMs,
      resultCount: searchResult.results.length,
    });

    // Now route to Claude with enhanced context
    const result = await deps.handleWithClaude(message, enhancedContext, conversationHistory);

    // Log combined metrics
    const totalDurationMs = Date.now() - startTime;
    logger.info('[LLMRouter] Web search request completed', {
      messageId: message.id,
      searchDurationMs,
      totalDurationMs,
      routedTo: result.routedTo,
      success: result.success,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[LLMRouter] Web search request failed', {
      messageId: message.id,
      error: errorMessage,
    });

    // Fallback to standard handling
    return deps.handleWithClaude(message, context, conversationHistory);
  }
}

/**
 * Handle failed web search by building appropriate fallback context
 *
 * @param deps - Web search dependencies (Claude handler)
 * @param message - The original message
 * @param context - Original RAG context
 * @param conversationHistory - Conversation history
 * @param searchQuery - The search query that failed
 * @param searchResult - The failed search result
 * @returns LLMRouterResult with fallback context
 */
async function handleFailedWebSearch(
  deps: WebSearchDeps,
  message: Message,
  context: string,
  conversationHistory: Message[],
  searchQuery: string,
  searchResult: Awaited<ReturnType<typeof webSearchTool.execute>>
): Promise<LLMRouterResult> {
  logger.warn('[LLMRouter] Web search failed, proceeding without results', {
    messageId: message.id,
    error: searchResult.error,
    retryCount: searchResult.retryCount,
  });

  // Try to get cached results as fallback
  const cachedResults = webSearchTool.getCachedResults(searchQuery);

  // Build appropriate search context based on failure type
  const searchContext = buildFailedSearchContext(searchResult, cachedResults);

  // Proceed without web results (or with cached results), but inform the LLM
  const enhancedContext = `${context}\n\n${searchContext}`;
  return deps.handleWithClaude(message, enhancedContext, conversationHistory);
}

/**
 * Build context string for failed web searches
 *
 * @param searchResult - The failed search result
 * @param cachedResults - Any cached results available
 * @returns Context string for the LLM
 */
function buildFailedSearchContext(
  searchResult: Awaited<ReturnType<typeof webSearchTool.execute>>,
  cachedResults: ReturnType<typeof webSearchTool.getCachedResults>
): string {
  // Handle rate limiting with cached results
  if (searchResult.rateLimitedUntil) {
    return buildRateLimitedContext(searchResult.rateLimitedUntil, cachedResults);
  }

  // Generic search failure — don't expose error details to the LLM
  return `[System: Web search is temporarily unavailable. Answer the user's question using your own knowledge. Do NOT mention that web search failed or is unavailable — just answer naturally. If your information might be outdated, briefly note that.]`;
}

/**
 * Build context string for rate-limited searches
 *
 * @param rateLimitedUntil - When the rate limit expires
 * @param cachedResults - Any cached results available
 * @returns Context string for the LLM
 */
function buildRateLimitedContext(
  rateLimitedUntil: Date,
  cachedResults: ReturnType<typeof webSearchTool.getCachedResults>
): string {
  const waitTimeMs = rateLimitedUntil.getTime() - Date.now();
  const waitTimeReadable = waitTimeMs < MILLISECONDS_PER_MINUTE
    ? `${Math.round(waitTimeMs / MILLISECONDS_PER_SECOND)} seconds`
    : `${Math.round(waitTimeMs / MILLISECONDS_PER_MINUTE)} minutes`;

  // Use cached results if available
  if (cachedResults && cachedResults.length > 0) {
    const cachedResultsText = cachedResults
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`)
      .join('\n\n');

    return `[System: Web search is temporarily unavailable. Use these cached results to answer the user's question.]\n\n${cachedResultsText}`;
  }

  // No cached results - instruct LLM to use its knowledge without exposing rate limit details
  return `[System: Web search is temporarily unavailable. Answer the user's question using your own knowledge. Do NOT mention that web search failed or is unavailable — just answer naturally. If your information might be outdated, briefly note that.]`;
}
