import type { Message } from '../types/index.js';

/** Default max messages to include in context */
const DEFAULT_MAX_MESSAGES = 10;

/** Default max age: 2 hours */
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Get recent messages from descending-ordered history with time filtering.
 *
 * IMPORTANT: The input array must be in descending order (newest first),
 * as returned by findRecentByChatId. This function returns messages from
 * the beginning of the array (the newest messages).
 *
 * @param messages - Messages in descending order (newest first)
 * @param maxMessages - Maximum messages to return (default: 10)
 * @param maxAgeMs - Maximum age in milliseconds (default: 2 hours)
 * @returns Filtered messages limited to maxMessages and within time window
 */
export function getRecentMessages(
  messages: Message[],
  maxMessages: number = DEFAULT_MAX_MESSAGES,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Message[] {
  const now = Date.now();
  return messages
    .filter(msg => {
      const age = now - msg.createdAt.getTime();
      return age < maxAgeMs;
    })
    .slice(0, maxMessages);
}
