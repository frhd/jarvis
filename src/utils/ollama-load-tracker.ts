/**
 * Ollama Load Tracker
 *
 * Simple active-request counter to detect when Ollama is overloaded.
 * Non-critical background tasks (memory extraction, preference extraction)
 * can check this before making requests to avoid contention cascades.
 *
 * This is NOT a semaphore/blocker — it only tracks and reports load.
 */

import { logger } from './logger.js';

const DEFAULT_MAX_CONCURRENT = 2;

let activeRequests = 0;
let maxConcurrent = DEFAULT_MAX_CONCURRENT;

/**
 * Initialize the max concurrent threshold from config.
 * Call once at startup.
 */
export function initOllamaLoadTracker(max: number): void {
  maxConcurrent = max;
  logger.info('[OllamaLoadTracker] Initialized', { maxConcurrent });
}

/**
 * Increment the active request count. Call before an Ollama request.
 */
export function trackOllamaRequestStart(): void {
  activeRequests++;
}

/**
 * Decrement the active request count. Call after an Ollama request completes (success or failure).
 */
export function trackOllamaRequestEnd(): void {
  activeRequests = Math.max(0, activeRequests - 1);
}

/**
 * Check if Ollama is currently overloaded (active requests >= max concurrent).
 * Non-critical background tasks should skip their Ollama calls when this returns true.
 */
export function isOllamaOverloaded(): boolean {
  return activeRequests >= maxConcurrent;
}

/**
 * Get current active request count (for monitoring/logging).
 */
export function getOllamaActiveRequests(): number {
  return activeRequests;
}
