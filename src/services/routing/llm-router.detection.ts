import type { Message } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { getRecentMessages } from '../../utils/index.js';
import { isWebSearchEnabled } from '../../config/feature-flags.js';
import { MAX_SEARCH_QUERY_LENGTH, MIN_SEARCH_QUERY_LENGTH } from './llm-router.constants.js';

/**
 * Extract a search-optimized query from user message
 *
 * @param text - User message text
 * @returns Optimized search query
 */
export function extractSearchQuery(text: string): string {
  // Remove common prefixes that don't add search value
  let query = text
    .replace(/^(search|google|look\s*up|find)\s*(for|me)?\s*/i, '')
    .replace(/^(what'?s?\s*(the\s*)?|tell\s*me\s*(about\s*)?)/i, '')
    .replace(/^(can\s*you\s*(find|search|tell\s*me))\s*/i, '')
    .trim();

  // If query is too short after cleanup, use original
  if (query.length < MIN_SEARCH_QUERY_LENGTH) {
    query = text;
  }

  // Limit query length for search API
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    query = query.substring(0, MAX_SEARCH_QUERY_LENGTH);
  }

  return query;
}

/**
 * Check if a message requires web search
 *
 * @param text - Message text to analyze
 * @returns True if web search should be triggered
 */
export function requiresWebSearch(text: string): boolean {
  if (!text || !isWebSearchEnabled()) {
    return false;
  }

  const webSearchPatterns = [
    // Weather
    /\b(weather|forecast|temperature)\s*(in|for|at)?\b/i,
    // Current events/news
    /\b(current|today'?s?|latest|recent)\s*(news|price|stock|score)\b/i,
    /\bwho\s*won\s*(the|last|yesterday)/i,
    /\bwhat\s*time\s*is\s*it\s*in\b/i,
    // News patterns
    /\bwhat'?s?\s*(going\s*on|happening)\s*(in|with|around)?\s*(the\s*)?(world|news|today)?/i,
    /\b(news|headlines)\s*(about|on|from|in|for)\s+/i,
    /\bwhat'?s?\s*(the\s*)?(latest|new|news)\s*(in|on|about|with)?\b/i,
    /\bwhat'?s?\s*new\s*(in|with|on)\s+/i,
    /\b(tell|give)\s*me\s*(the\s*)?(news|headlines|updates)/i,
    /\b(update|updates)\s*(on|about|from)\s+/i,
    /\b(happened|happening)\s*(in|to|with|at)\s+/i,
    // Explicit search
    /^(search|google|look\s*up|find)\s*(for|me)?\s+/i,
    // Prices and market data
    /\b(price|cost)\s*(of|for)\s+/i,
    /\b(stock|crypto|bitcoin|ethereum)\s*(price|value|worth)/i,
    // Sports
    /\b(score|result)\s*(of|for|from)\s+/i,
    /\bwho\s*(is\s*)?(playing|won|lost)/i,
  ];

  return webSearchPatterns.some((pattern) => pattern.test(text));
}

/**
 * Detect if a message requests an agentic task
 *
 * Checks for patterns like:
 * - "create a file"
 * - "write to file"
 * - "implement X.ts"
 * - "draw up a plan"
 *
 * Also checks conversation history for follow-up patterns like:
 * - "try again"
 * - "do it"
 * - "go ahead"
 *
 * @param text - The message text to analyze
 * @param conversationHistory - Optional conversation history for follow-up detection
 * @returns True if this is an agentic request
 */
export function isAgenticRequest(text: string, conversationHistory?: Message[]): boolean {
  const agenticPatterns = [
    // File operations
    /create\s+(a\s+)?file/i,
    /write\s+(to\s+)?file/i,
    /save\s+(to|in|into)\s+/i,
    /put\s+(it\s+)?(inside|in|into)\s+/i,
    /implement\s+.*\.(ts|js|md|txt|json)/i,
    /generate\s+.*\.(ts|js|md|txt|json)/i,
    /\.(md|txt|ts|js|json)\s+(file|in\s+the)/i,
    /impl\.md/i,
    /draw\s+up\s+a\s+plan/i,
    /write\s+(code|implementation)/i,
    // Shell/script operations
    /run\s+(the\s+)?(script|command|bash|shell)/i,
    /execute\s+(the\s+)?(script|command|bash|shell)/i,
    /start\s+(the\s+)?(script|server|service|process)/i,
    /stop\s+(the\s+)?(script|server|service|process)/i,
    /restart\s+(the\s+)?(script|server|service|process)/i,
    /kick\s+(off|it\s+off)/i,
    /launch\s+(the\s+)?/i,
    /\.sh\b/i,  // Any .sh file reference
    /check\s+(if\s+)?(it'?s?\s+)?running/i,
    /is\s+(it\s+)?running/i,
    /ps\s+aux/i,
    /process(es)?\s+(list|status|running)/i,
    // System operations
    /install\s+(the\s+)?/i,
    /deploy\s+/i,
    /build\s+(the\s+)?(project|app|code)/i,
    /npm\s+(run|install|start|test)/i,
    /git\s+(status|pull|push|commit|clone)/i,
    // German equivalents
    /speicher(e|n)\s+/i,  // speichere/speichern (save/store)
    /erstell(e|en)\s+/i,  // erstelle/erstellen (create)
    /schreib(e|en)\s+(in|auf|zu)\s+/i,  // schreibe in (write to)
    /schick(e|en)\s+/i,   // schicke/schicken (send)
    /send(e|en)\s+/i,     // sende/senden (send)
    /führ(e|en)\s+.*aus/i, // führe ... aus (execute)
    /starte\s+/i,         // starte (start)
    /stopp(e|en)\s+/i,    // stoppe/stoppen (stop)
  ];

  // Check current message
  if (agenticPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  // Check if this is a follow-up to an agentic request (e.g., "try again", "do it")
  const followUpPatterns = [
    /try\s+.{0,10}(again|more)/i,  // "try [typos] again/more"
    /do\s+it/i,
    /go\s+(ahead|for\s+it)/i,
    /please\s*(do|try)/i,
    /yes\s*(please)?/i,
    /ok\s*(do\s+it)?/i,
    /one\s*more\s*time/i,
    /again\s*please/i,
    /retry/i,
    /more\s*plea/i,  // "more please" with typos
  ];

  if (followUpPatterns.some((pattern) => pattern.test(text)) && conversationHistory?.length) {
    // Check last 5 messages for agentic request (messages are in descending order)
    const recentMessages = getRecentMessages(conversationHistory, 5);
    for (const msg of recentMessages) {
      if (msg.text && agenticPatterns.some((pattern) => pattern.test(msg.text!))) {
        logger.debug('[LLMRouter] Follow-up to agentic request detected', {
          currentMessage: text.substring(0, 50),
          originalRequest: msg.text.substring(0, 100),
        });
        return true;
      }
    }
  }

  return false;
}
