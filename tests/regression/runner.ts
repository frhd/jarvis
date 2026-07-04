/**
 * Regression Test Runner
 *
 * Orchestrates scenario execution, collects results, and manages test lifecycle.
 */

import type {
  RegressionScenario,
  ScenarioResult,
  TurnResult,
  RegressionReport,
  ReportSummary,
  CategoryStats,
  ScenarioCategory,
  RunnerOptions,
} from './types.js';
import { TestPipelineService, createTestPipeline } from './test-pipeline.service.js';
import { QualityEvaluator, type ConversationTurn } from './quality-evaluator.js';
import {
  QUALITY_THRESHOLDS,
  PERFORMANCE_THRESHOLDS,
  EXECUTION_CONFIG,
} from './config.js';

/**
 * Result container for a complete regression run
 */
export interface RunResults {
  scenarios: ScenarioResult[];
  summary: ReportSummary;
  byCategory: CategoryStats[];
  durationMs: number;
}

/**
 * RegressionRunner - Orchestrates regression test execution
 */
export class RegressionRunner {
  private pipeline: TestPipelineService;
  private evaluator: QualityEvaluator;
  private options: RunnerOptions;

  constructor(
    pipeline: TestPipelineService,
    evaluator: QualityEvaluator,
    options: RunnerOptions = {}
  ) {
    this.pipeline = pipeline;
    this.evaluator = evaluator;
    this.options = options;
  }

  /**
   * Factory method to create a fully initialized runner
   */
  static async create(options: RunnerOptions = {}): Promise<RegressionRunner> {
    const pipeline = await createTestPipeline();
    await pipeline.initialize();

    // Get LLMClient from the llmService
    const { llmService } = await import('../../src/services/index.js');
    const llmClient = llmService.getClient();
    const evaluator = new QualityEvaluator(llmClient);

    return new RegressionRunner(pipeline, evaluator, options);
  }

  /**
   * Run all provided scenarios
   */
  async run(scenarios: RegressionScenario[]): Promise<RunResults> {
    const startTime = Date.now();
    const results: ScenarioResult[] = [];

    const total = scenarios.length;
    let passedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const progress = `[${i + 1}/${total}]`;

      if (this.options.verbose) {
        console.log(`${progress} Running: ${scenario.id} - ${scenario.name}`);
      }

      try {
        const result = await this.runScenario(scenario);
        results.push(result);

        if (result.overallPassed) {
          passedCount++;
          if (this.options.verbose) {
            console.log(
              `${progress} ✓ PASSED (avg quality: ${result.avgQualityScore.toFixed(1)}, latency: ${result.totalLatencyMs}ms)`
            );
          }
        } else {
          failedCount++;
          if (this.options.verbose) {
            console.log(
              `${progress} ✗ FAILED (avg quality: ${result.avgQualityScore.toFixed(1)})`
            );
            // Show failure details
            for (const turn of result.turns) {
              if (!turn.passed) {
                console.log(
                  `    Turn "${turn.turn.text.substring(0, 30)}..." - Score: ${turn.quality.score}/10 - ${turn.quality.feedback}`
                );
              }
            }
          }
        }

        // Reset conversation between scenarios (maintains test user/chat)
        await this.pipeline.resetConversation();

        // Delay between scenarios to avoid overwhelming LLM
        if (i < scenarios.length - 1) {
          await this.delay(EXECUTION_CONFIG.SCENARIO_DELAY_MS);
        }
      } catch (error) {
        // Handle scenario-level errors
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const errorResult: ScenarioResult = {
          scenario,
          turns: [],
          overallPassed: false,
          totalLatencyMs: 0,
          avgQualityScore: 0,
          error: errorMessage,
        };
        results.push(errorResult);

        if (this.options.verbose) {
          console.log(`${progress} ✗ ERROR: ${errorMessage}`);
        }

        // Reset conversation after error
        try {
          await this.pipeline.resetConversation();
        } catch {
          // Ignore reset errors
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const summary = this.calculateSummary(results);
    const byCategory = this.calculateCategoryStats(results);

    return {
      scenarios: results,
      summary,
      byCategory,
      durationMs,
    };
  }

  /**
   * Run a single scenario with all its turns
   */
  async runScenario(scenario: RegressionScenario): Promise<ScenarioResult> {
    const turnResults: TurnResult[] = [];
    const conversationHistory: ConversationTurn[] = [];
    let totalLatencyMs = 0;
    let totalQualityScore = 0;
    let allTurnsPassed = true;

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];

      try {
        // Send message through pipeline
        const startTime = Date.now();
        const pipelineResponse = await this.pipeline.sendMessage(turn.text);
        const latencyMs = Date.now() - startTime;

        totalLatencyMs += latencyMs;

        // Evaluate response quality with conversation history for multi-turn context
        const quality = await this.evaluator.evaluate(
          turn.text,
          pipelineResponse.response || '',
          turn.expectedIntent,
          conversationHistory.length > 0 ? conversationHistory : undefined
        );

        totalQualityScore += quality.score;

        // Determine if this turn passed
        const minScore = turn.minQualityScore ?? QUALITY_THRESHOLDS.PASS;
        const maxLatency = scenario.maxLatencyMs ?? PERFORMANCE_THRESHOLDS.DEFAULT_MAX_LATENCY_MS;

        // Extract child intent from EnhancedIntentResult
        const detectedChildIntent = pipelineResponse.intent?.childIntent;
        const intentMatched =
          !turn.expectedIntent || detectedChildIntent === turn.expectedIntent;
        const routeMatched =
          !turn.expectedRoute || pipelineResponse.routedTo === turn.expectedRoute;
        const qualityPassed = quality.score >= minScore;
        const latencyPassed = latencyMs <= maxLatency;

        const turnPassed = intentMatched && routeMatched && qualityPassed && latencyPassed;

        if (!turnPassed) {
          allTurnsPassed = false;
        }

        const turnResult: TurnResult = {
          turn,
          response: pipelineResponse.response || '',
          routedTo: pipelineResponse.routedTo,
          detectedIntent: detectedChildIntent,
          quality,
          metrics: {
            latencyMs,
            ...pipelineResponse.metrics,
          },
          passed: turnPassed,
        };

        turnResults.push(turnResult);

        // Add this turn to conversation history for subsequent turns
        conversationHistory.push({ role: 'user', text: turn.text });
        if (pipelineResponse.response) {
          conversationHistory.push({ role: 'assistant', text: pipelineResponse.response });
        }

        // Delay between turns
        if (i < scenario.turns.length - 1) {
          await this.delay(EXECUTION_CONFIG.TURN_DELAY_MS);
        }
      } catch (error) {
        // Handle turn-level errors
        allTurnsPassed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const errorTurnResult: TurnResult = {
          turn,
          response: '',
          routedTo: 'unknown',
          quality: {
            score: 0,
            feedback: `Error: ${errorMessage}`,
            passed: false,
          },
          metrics: { latencyMs: 0 },
          passed: false,
          error: errorMessage,
        };

        turnResults.push(errorTurnResult);
      }
    }

    const avgQualityScore =
      turnResults.length > 0 ? totalQualityScore / turnResults.length : 0;

    return {
      scenario,
      turns: turnResults,
      overallPassed: allTurnsPassed,
      totalLatencyMs,
      avgQualityScore,
    };
  }

  /**
   * Calculate summary statistics for all results
   */
  private calculateSummary(results: ScenarioResult[]): ReportSummary {
    const total = results.length;
    const passed = results.filter((r) => r.overallPassed).length;
    const failed = total - passed;

    const allLatencies = results.map((r) => r.totalLatencyMs).sort((a, b) => a - b);
    const avgLatency =
      total > 0 ? allLatencies.reduce((a, b) => a + b, 0) / total : 0;

    // P95 latency
    const p95Index = Math.floor(allLatencies.length * 0.95);
    const p95Latency = allLatencies[p95Index] ?? avgLatency;

    const avgQuality =
      total > 0
        ? results.reduce((sum, r) => sum + r.avgQualityScore, 0) / total
        : 0;

    return {
      total,
      passed,
      failed,
      avgQuality,
      avgLatency,
      p95Latency,
    };
  }

  /**
   * Calculate statistics grouped by category
   */
  private calculateCategoryStats(results: ScenarioResult[]): CategoryStats[] {
    const byCategory = new Map<ScenarioCategory, ScenarioResult[]>();

    for (const result of results) {
      const category = result.scenario.category;
      const existing = byCategory.get(category) || [];
      existing.push(result);
      byCategory.set(category, existing);
    }

    const stats: CategoryStats[] = [];

    for (const [category, categoryResults] of byCategory) {
      const total = categoryResults.length;
      const passed = categoryResults.filter((r) => r.overallPassed).length;
      const failed = total - passed;

      const avgQuality =
        total > 0
          ? categoryResults.reduce((sum, r) => sum + r.avgQualityScore, 0) / total
          : 0;

      const avgLatency =
        total > 0
          ? categoryResults.reduce((sum, r) => sum + r.totalLatencyMs, 0) / total
          : 0;

      stats.push({
        category,
        total,
        passed,
        failed,
        avgQuality,
        avgLatency,
      });
    }

    // Sort by category name for consistent output
    stats.sort((a, b) => a.category.localeCompare(b.category));

    return stats;
  }

  /**
   * Cleanup test data from database
   */
  async cleanup(): Promise<void> {
    await this.pipeline.cleanup();
  }

  /**
   * Get the test run ID
   */
  getRunId(): string {
    return this.pipeline.getRunId();
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Build a complete RegressionReport from run results
 */
export function buildReport(
  results: RunResults,
  options: RunnerOptions = {}
): RegressionReport {
  return {
    timestamp: new Date().toISOString(),
    durationMs: results.durationMs,
    scenarios: results.scenarios,
    summary: results.summary,
    byCategory: results.byCategory,
    options,
  };
}
