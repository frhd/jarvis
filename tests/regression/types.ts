/**
 * Regression Testing System Types
 *
 * Defines interfaces for test scenarios, results, and reports.
 */

import type { ChildIntent, EnhancedIntentResult } from '../../src/types/intent.types.js';

// ============================================================================
// Scenario Definitions
// ============================================================================

/**
 * Categories of test scenarios
 */
export type ScenarioCategory =
  | 'greetings'
  | 'questions'
  | 'commands'
  | 'multi_turn'
  | 'edge_cases';

/**
 * A single turn in a conversation scenario
 */
export interface ConversationTurn {
  /** Role is always 'user' - we inject user messages */
  role: 'user';
  /** The message text to send */
  text: string;
  /** Expected intent classification (optional) */
  expectedIntent?: ChildIntent;
  /** Expected LLM route (optional) */
  expectedRoute?: 'ollama' | 'claude' | 'cache';
  /** Minimum acceptable quality score for this turn (optional, default 6) */
  minQualityScore?: number;
}

/**
 * A regression test scenario
 */
export interface RegressionScenario {
  /** Unique identifier for the scenario */
  id: string;
  /** Category for filtering and grouping */
  category: ScenarioCategory;
  /** Human-readable name */
  name: string;
  /** Description of what this scenario tests */
  description: string;
  /** Sequence of conversation turns */
  turns: ConversationTurn[];
  /** Maximum acceptable latency in milliseconds (optional) */
  maxLatencyMs?: number;
  /** Tags for filtering (e.g., 'critical', 'slow', 'context') */
  tags: string[];
}

// ============================================================================
// Quality Evaluation
// ============================================================================

/**
 * Result of LLM-as-judge quality evaluation
 */
export interface QualityScore {
  /** Score from 0-10 */
  score: number;
  /** LLM judge's explanation */
  feedback: string;
  /** Whether the score meets the passing threshold (>= 6) */
  passed: boolean;
}

/**
 * Performance metrics for a single turn
 */
export interface PerformanceMetrics {
  /** Total latency from send to response */
  latencyMs: number;
  /** Time spent on intent classification */
  intentClassificationMs?: number;
  /** Time spent on context building */
  contextBuildingMs?: number;
  /** Time spent on LLM generation */
  llmGenerationMs?: number;
}

// ============================================================================
// Results
// ============================================================================

/**
 * Result of executing a single conversation turn
 */
export interface TurnResult {
  /** The turn definition */
  turn: ConversationTurn;
  /** The bot's response text */
  response: string;
  /** Which LLM handled the response */
  routedTo: 'ollama' | 'claude' | 'cache' | 'unknown';
  /** Detected intent */
  detectedIntent?: ChildIntent;
  /** Quality evaluation from LLM judge */
  quality: QualityScore;
  /** Performance metrics */
  metrics: PerformanceMetrics;
  /** Whether this turn passed all checks */
  passed: boolean;
  /** Error message if the turn failed to execute */
  error?: string;
}

/**
 * Result of executing a complete scenario
 */
export interface ScenarioResult {
  /** The scenario that was run */
  scenario: RegressionScenario;
  /** Results for each turn */
  turns: TurnResult[];
  /** Whether all turns passed */
  overallPassed: boolean;
  /** Total time to execute all turns */
  totalLatencyMs: number;
  /** Average quality score across turns */
  avgQualityScore: number;
  /** Error if scenario failed to execute */
  error?: string;
}

// ============================================================================
// Report
// ============================================================================

/**
 * Summary statistics for a regression run
 */
export interface ReportSummary {
  /** Total number of scenarios run */
  total: number;
  /** Number of scenarios that passed */
  passed: number;
  /** Number of scenarios that failed */
  failed: number;
  /** Average quality score across all turns */
  avgQuality: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** 95th percentile latency */
  p95Latency: number;
}

/**
 * Statistics grouped by category
 */
export interface CategoryStats {
  /** Category name */
  category: ScenarioCategory;
  /** Total scenarios in this category */
  total: number;
  /** Passed scenarios */
  passed: number;
  /** Failed scenarios */
  failed: number;
  /** Average quality score */
  avgQuality: number;
  /** Average latency */
  avgLatency: number;
}

/**
 * Options for running regression tests
 */
export interface RunnerOptions {
  /** Filter by categories */
  categories?: ScenarioCategory[];
  /** Filter by tags */
  tags?: string[];
  /** Show detailed progress output */
  verbose?: boolean;
  /** Keep test data after run (don't cleanup) */
  keep?: boolean;
}

/**
 * Complete regression test report
 */
export interface RegressionReport {
  /** When the test run started (ISO string) */
  timestamp: string;
  /** Duration of the test run in milliseconds */
  durationMs: number;
  /** Individual scenario results */
  scenarios: ScenarioResult[];
  /** Overall summary statistics */
  summary: ReportSummary;
  /** Statistics by category */
  byCategory: CategoryStats[];
  /** CLI arguments used for the run */
  options: RunnerOptions;
}

// ============================================================================
// Pipeline Types
// ============================================================================

/**
 * Response from the test pipeline after sending a message
 */
export interface PipelineResponse {
  /** The bot's response text */
  response?: string;
  /** Which LLM handled the response */
  routedTo: 'ollama' | 'claude' | 'cache' | 'unknown';
  /** Detected intent (full enhanced intent with parent and child) */
  intent?: EnhancedIntentResult;
  /** Performance metrics */
  metrics: PerformanceMetrics;
}
