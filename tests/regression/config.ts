/**
 * Regression Testing System Configuration
 *
 * Defines thresholds, prompts, and settings for the regression testing system.
 */

import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// Paths
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** Directory for regression test reports */
export const REPORT_OUTPUT_PATH = path.join(PROJECT_ROOT, 'data/regression');

/** Prefix for test data in database (for isolation and cleanup) */
export const TEST_DATA_PREFIX = 'TEST_regression_';

// ============================================================================
// Quality Thresholds
// ============================================================================

export const QUALITY_THRESHOLDS = {
  /** Minimum score to pass (0-10) */
  PASS: 6,
  /** Score below this triggers a warning */
  WARN: 4,
  /** Default minimum quality score if not specified in scenario */
  DEFAULT_MIN_SCORE: 6,
} as const;

// ============================================================================
// Performance Thresholds
// ============================================================================

export const PERFORMANCE_THRESHOLDS = {
  /** Default max latency per turn in milliseconds */
  DEFAULT_MAX_LATENCY_MS: 30000,
  /** Warning threshold for latency */
  LATENCY_WARN_MS: 15000,
  /** Target p95 latency for the full suite */
  P95_TARGET_MS: 20000,
} as const;

// ============================================================================
// LLM Judge Configuration
// ============================================================================

/**
 * Prompt template for the LLM-as-judge quality evaluation.
 * Uses Ollama to rate responses on a 0-10 scale.
 */
export const LLM_JUDGE_PROMPT = `You are evaluating a chatbot response. Rate on a scale of 0-10.
{conversationContext}
User message: "{userMessage}"
Bot response: "{botResponse}"
Expected intent: {expectedIntent}

Evaluate on:
1. Relevance: Does the response address the user's message?
2. Coherence: Is the response well-formed and clear?
3. Correctness: For recall/factual questions, is the answer accurate? A correct direct answer to a simple question is excellent.
4. Appropriateness: Is the tone and content appropriate?
5. Context awareness: For multi-turn conversations, does it correctly use prior context?

IMPORTANT: Do NOT penalize concise, direct answers. If a user asks a simple question (e.g., "What's my name?") and the bot answers correctly (e.g., "Your name is Alex!"), that is a 9-10 score. The response doesn't need to add "extra value" - correctness IS the value.

Scoring guide:
- 9-10: Correct, relevant, and appropriate response
- 7-8: Good, minor issues but generally correct
- 5-6: Acceptable, some issues with correctness or relevance
- 3-4: Poor, significant issues
- 0-2: Wrong, irrelevant, or harmful

Return ONLY valid JSON: {"score": 0-10, "feedback": "1-2 sentence explanation"}`;

/**
 * Model to use for quality evaluation
 */
export const LLM_JUDGE_MODEL = 'llama3.1:8b';

/**
 * Timeout for judge evaluation in milliseconds
 */
export const LLM_JUDGE_TIMEOUT_MS = 30000;

// ============================================================================
// Test Execution Configuration
// ============================================================================

export const EXECUTION_CONFIG = {
  /** Delay between scenarios to avoid rate limiting */
  SCENARIO_DELAY_MS: 500,
  /** Delay between turns in a multi-turn scenario */
  TURN_DELAY_MS: 100,
  /** Maximum retries for failed LLM calls */
  MAX_RETRIES: 2,
  /** Timeout for cleanup operations */
  CLEANUP_TIMEOUT_MS: 10000,
} as const;

// ============================================================================
// Report Configuration
// ============================================================================

export const REPORT_CONFIG = {
  /** Include full response text in report (can be verbose) */
  INCLUDE_FULL_RESPONSES: true,
  /** Maximum response length to include in report */
  MAX_RESPONSE_LENGTH: 500,
  /** Timestamp format for report filenames */
  TIMESTAMP_FORMAT: 'YYYY-MM-DD-HHmmss',
} as const;
