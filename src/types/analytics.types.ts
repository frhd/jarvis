/**
 * A/B Testing & Analytics Types
 * Phase 4.3: A/B testing framework for analytics system
 *
 * Note: Core types (Experiment, ExperimentVariant, ExperimentAssignment, ExperimentEvent)
 * are inferred from Drizzle schema in types/index.ts
 */

// ============================================================================
// Input Types for Creating Experiments
// ============================================================================

/**
 * Input for creating a new experiment with variants
 */
export interface CreateExperimentInput {
  name: string;
  description?: string;
  targetMetric: string;
  variants: CreateVariantInput[];
  config?: Record<string, any>;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Input for creating a variant
 */
export interface CreateVariantInput {
  name: string;
  weight: number;
  config?: Record<string, any>;
}

/**
 * A/B test configuration
 */
export interface ABTestConfig {
  featureFlag: string; // Feature flag identifier
  variants: VariantConfig[];
  trafficPercentage: number; // Percentage of traffic to include in experiment (0-100)
  startDate?: Date;
  endDate?: Date;
}

/**
 * Variant configuration
 */
export interface VariantConfig {
  name: string;
  weight: number; // Traffic allocation weight
  config: Record<string, any>; // Variant-specific settings
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Aggregated results for a variant
 */
export interface ExperimentResult {
  experimentId: string;
  variantId: string;
  variantName: string;
  sampleSize: number;
  conversionCount: number;
  conversionRate: number;
  avgMetricValue: number | null;
  totalMetricValue: number | null;
  statisticalSignificance: number | null; // p-value from statistical test
  isWinner: boolean;
}

/**
 * Statistical test result
 */
export interface StatisticalTestResult {
  pValue: number;
  isSignificant: boolean; // True if p-value < significance level (typically 0.05)
  confidenceLevel: number; // e.g., 95 for 95% confidence
  testType: 'chi_square' | 't_test' | 'z_test';
}

/**
 * Complete experiment analysis
 */
export interface ExperimentAnalysis {
  experimentId: string;
  experimentName: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  targetMetric: string;
  startDate: Date | null;
  endDate: Date | null;
  duration: number | null; // Duration in milliseconds
  results: ExperimentResult[];
  winningVariant: ExperimentResult | null;
  overallStatistics: {
    totalSampleSize: number;
    totalConversions: number;
    avgConversionRate: number;
  };
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying experiment events
 */
export interface ExperimentEventQueryOptions {
  experimentId: string;
  variantId?: string;
  senderId?: string;
  eventType?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

/**
 * Options for ending an experiment
 */
export interface EndExperimentInput {
  experimentId: string;
  winningVariantId?: string; // Optional: explicitly declare a winner
  reason?: string; // Optional: reason for ending the experiment
}

// ============================================================================
// Conversation Flow Analytics Types
// ============================================================================

import type { ParentIntent, ChildIntent } from './intent.types';

/**
 * Time range for analytics queries
 */
export interface AnalyticsTimeRange {
  /** Start timestamp in milliseconds */
  from: number;

  /** End timestamp in milliseconds */
  to: number;
}

/**
 * Represents a continuous conversation session
 * Sessions are defined by a time gap threshold (default 30 minutes)
 */
export interface ConversationSession {
  /** Unique session identifier */
  sessionId: string;

  /** Chat ID where the session occurred */
  chatId: string;

  /** Sender ID (user) for this session */
  senderId: string;

  /** Session start timestamp (milliseconds) */
  startTime: number;

  /** Session end timestamp (milliseconds) */
  endTime: number;

  /** Duration of session in milliseconds */
  durationMs: number;

  /** Message IDs that are part of this session */
  messageIds: string[];

  /** Conversation turns (user-bot exchanges) */
  turns: ConversationTurn[];

  /** Number of turns in this session */
  turnCount: number;

  /** Average response time across all turns (ms) */
  avgResponseTime: number;

  /** Session was terminated due to timeout */
  wasTimedOut: boolean;

  /** Detected flow pattern for this session */
  flowPattern?: string;
}

/**
 * Represents a single turn in a conversation
 * A turn consists of a user message and the bot's response
 */
export interface ConversationTurn {
  /** Turn number in the session (1-indexed) */
  turnNumber: number;

  /** User message ID */
  userMessageId: string;

  /** User message timestamp */
  userMessageTimestamp: number;

  /** User message text */
  userMessageText?: string;

  /** Bot response message ID (if bot responded) */
  botResponseId?: string;

  /** Bot response timestamp */
  botResponseTimestamp?: number;

  /** Time taken to respond (ms) */
  responseTime?: number;

  /** Classified intent for this turn */
  parentIntent?: ParentIntent;
  childIntent?: ChildIntent;

  /** Intent confidence score (0-1) */
  intentConfidence?: number;

  /** Was this turn escalated to more powerful model */
  wasEscalated: boolean;

  /** Model used for response */
  modelUsed?: string;

  /** LLM response duration (ms) */
  llmDurationMs?: number;

  /** Was the response cached */
  wasCached?: boolean;
}

/**
 * Common conversation flow patterns
 * Represents sequences of intents that frequently occur together
 */
export interface FlowPattern {
  /** Pattern identifier (e.g., "greeting_question_answer") */
  patternId: string;

  /** Human-readable pattern name */
  patternName: string;

  /** Sequence of intents in this pattern */
  intentSequence: ChildIntent[];

  /** Number of times this pattern occurred */
  frequency: number;

  /** Average duration of this pattern (ms) */
  avgDuration: number;

  /** Min duration (ms) */
  minDuration: number;

  /** Max duration (ms) */
  maxDuration: number;

  /** Average turns in this pattern */
  avgTurns: number;

  /** Success rate (if applicable, e.g., task completion) */
  successRate?: number;

  /** Example session IDs that match this pattern */
  exampleSessionIds: string[];
}

/**
 * Represents transitions between intents
 * Used to build a Markov chain of intent flows
 */
export interface ConversationTransition {
  /** Starting intent */
  fromIntent: ChildIntent;

  /** Ending intent */
  toIntent: ChildIntent;

  /** Number of times this transition occurred */
  count: number;

  /** Average time between these intents (ms) */
  avgTimeBetween: number;

  /** Transition probability (0-1) */
  probability: number;

  /** Average response quality for this transition */
  avgResponseTime?: number;
}

/**
 * Comprehensive conversation flow metrics
 */
export interface ConversationFlowMetrics {
  /** Time range for these metrics */
  timeRange: AnalyticsTimeRange;

  /** Total number of sessions analyzed */
  totalSessions: number;

  /** Total number of turns across all sessions */
  totalTurns: number;

  /** Average turns per session */
  avgTurnsPerSession: number;

  /** Median turns per session */
  medianTurnsPerSession: number;

  /** Average response time across all turns (ms) */
  avgResponseTime: number;

  /** Median response time (p50) */
  p50ResponseTime: number;

  /** 95th percentile response time */
  p95ResponseTime: number;

  /** 99th percentile response time */
  p99ResponseTime: number;

  /** Average session duration (ms) */
  avgSessionDuration: number;

  /** Detected flow patterns */
  flowPatterns: FlowPattern[];

  /** Intent transition matrix */
  transitions: ConversationTransition[];

  /** Session length distribution (buckets) */
  sessionLengthDistribution: {
    /** Session length bucket (e.g., "1-2 turns", "3-5 turns") */
    bucket: string;

    /** Number of sessions in this bucket */
    count: number;

    /** Percentage of total sessions */
    percentage: number;
  }[];

  /** Response time by intent */
  responseTimeByIntent: {
    intent: ChildIntent;
    avgResponseTime: number;
    count: number;
  }[];

  /** Response time by model */
  responseTimeByModel: {
    model: string;
    avgResponseTime: number;
    count: number;
  }[];

  /** Response time by hour of day */
  responseTimeByHour: {
    hour: number;
    avgResponseTime: number;
    count: number;
  }[];

  /** Quality metrics */
  qualityMetrics: ConversationQualityMetrics;

  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Conversation quality metrics
 * Measures effectiveness and user satisfaction indicators
 */
export interface ConversationQualityMetrics {
  /** Overall escalation rate (0-1) */
  escalationRate: number;

  /** Escalation rate by intent */
  escalationRateByIntent: {
    intent: ChildIntent;
    rate: number;
    count: number;
    totalCount: number;
  }[];

  /** Cache hit rate */
  cacheHitRate: number;

  /** Average confidence score */
  avgConfidenceScore: number;

  /** Low confidence rate (below threshold) */
  lowConfidenceRate: number;

  /** Average turns before resolution (estimate) */
  avgTurnsToResolution?: number;

  /** Conversation abandonment rate */
  abandonmentRate?: number;

  /** Response quality by time of day */
  qualityByTimeOfDay: {
    hour: number;
    avgResponseTime: number;
    escalationRate: number;
    avgConfidence: number;
  }[];
}

/**
 * Options for conversation flow analysis queries
 */
export interface ConversationFlowOptions {
  /** Time range for analysis */
  timeRange: AnalyticsTimeRange;

  /** Filter by specific chat IDs */
  chatIds?: string[];

  /** Filter by specific sender IDs */
  senderIds?: string[];

  /** Filter by specific intents */
  intents?: ChildIntent[];

  /** Session timeout threshold in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;

  /** Minimum turns required for a session to be included */
  minTurns?: number;

  /** Maximum turns to consider for a session */
  maxTurns?: number;

  /** Include detailed turn information */
  includeDetailedTurns?: boolean;

  /** Maximum number of flow patterns to return */
  maxPatterns?: number;

  /** Minimum frequency for a pattern to be included */
  minPatternFrequency?: number;
}

/**
 * Options for session identification algorithm
 */
export interface SessionIdentificationOptions {
  /** Time gap threshold for session boundary (ms) */
  timeoutMs: number;

  /** Minimum messages required to form a session */
  minMessages: number;

  /** Maximum session duration before forcing a split (ms) */
  maxSessionDuration?: number;

  /** Consider intent changes as session boundaries */
  breakOnTopicChange?: boolean;
}

/**
 * Intent transition probability matrix
 * Used for predicting next likely intent
 */
export interface IntentTransitionMatrix {
  /** Time range for this matrix */
  timeRange: AnalyticsTimeRange;

  /** All observed transitions */
  transitions: ConversationTransition[];

  /** Transition probabilities as a matrix */
  matrix: Record<ChildIntent, Record<ChildIntent, number>>;

  /** Most common starting intents */
  startingIntents: {
    intent: ChildIntent;
    count: number;
    percentage: number;
  }[];

  /** Most common ending intents */
  endingIntents: {
    intent: ChildIntent;
    count: number;
    percentage: number;
  }[];

  /** Total transitions analyzed */
  totalTransitions: number;
}

/**
 * Distribution of conversation lengths
 */
export interface ConversationLengthDistribution {
  /** Time range for this distribution */
  timeRange: AnalyticsTimeRange;

  /** Distribution buckets */
  buckets: {
    /** Bucket label (e.g., "1 turn", "2-3 turns") */
    label: string;

    /** Min turns (inclusive) */
    minTurns: number;

    /** Max turns (inclusive, -1 for unbounded) */
    maxTurns: number;

    /** Number of sessions */
    count: number;

    /** Percentage of total */
    percentage: number;

    /** Average response time for sessions in this bucket */
    avgResponseTime: number;
  }[];

  /** Statistics */
  stats: {
    totalSessions: number;
    avgTurns: number;
    medianTurns: number;
    minTurns: number;
    maxTurns: number;
  };
}

/**
 * Response time statistics grouped by various dimensions
 */
export type ResponseTimeGroupBy = 'intent' | 'model' | 'hour' | 'day_of_week';

export interface ResponseTimeStats {
  /** Grouping dimension */
  groupBy: ResponseTimeGroupBy;

  /** Time range for these stats */
  timeRange: AnalyticsTimeRange;

  /** Grouped data */
  groups: ResponseTimeGroup[];
}

export interface ResponseTimeGroup {
  /** Group key (intent name, model name, hour number, etc.) */
  key: string;

  /** Count of responses */
  count: number;

  /** Average response time (ms) */
  avgMs: number;

  /** Min response time (ms) */
  minMs: number;

  /** Max response time (ms) */
  maxMs: number;

  /** Median (p50) */
  p50Ms: number;

  /** 95th percentile */
  p95Ms: number;

  /** 99th percentile */
  p99Ms: number;

  /** Standard deviation */
  stdDevMs?: number;
}

// ============================================================================
// Report Generation Types
// ============================================================================

import type { ChartDataPoint } from './dashboard.types';

/**
 * Report generation frequency
 */
export type ReportType = 'daily' | 'weekly' | 'monthly' | 'custom';

/**
 * Report output format
 */
export type ReportFormat = 'json' | 'markdown' | 'html';

/**
 * Metric snapshot showing current vs previous value with trend
 */
export interface ReportMetricSnapshot {
  metricName: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
  unit?: string;
  higherIsBetter?: boolean;
}

/**
 * Report section containing related metrics and visualizations
 */
export interface ReportSection {
  title: string;
  description?: string;
  content: string;
  charts?: Array<{
    title: string;
    type: 'line' | 'bar' | 'pie' | 'area';
    data: ChartDataPoint[];
  }>;
  metrics?: ReportMetricSnapshot[];
  order: number;
}

/**
 * Metrics configuration for report generation
 */
export interface ReportMetricsConfig {
  responseTime?: boolean;
  tokenUsage?: boolean;
  intentClassification?: boolean;
  cachePerformance?: boolean;
  queueStatus?: boolean;
  userEngagement?: boolean;
  modelComparison?: boolean;
  alerts?: boolean;
  customMetrics?: string[];
}

/**
 * Report configuration (stored in database)
 */
export interface ReportConfig {
  id: string;
  name: string;
  description?: string;
  type: ReportType;
  metricsConfig: string; // JSON serialized ReportMetricsConfig
  format: ReportFormat;
  recipients?: string; // JSON serialized string[]
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Complete generated report data
 */
export interface GeneratedReportData {
  metadata: {
    reportId: string;
    configId: string;
    reportName: string;
    reportType: ReportType;
    generatedAt: number;
    timeRange: {
      from: number;
      to: number;
    };
    comparisonTimeRange?: {
      from: number;
      to: number;
    };
  };
  summary: {
    totalMessages: number;
    totalLLMRequests: number;
    avgResponseTime: number;
    cacheHitRate: number;
    activeAlerts: number;
    keyInsights: string[];
  };
  sections: ReportSection[];
  healthScore?: number;
  recommendations?: string[];
}

/**
 * Generated report record (stored in database)
 */
export interface GeneratedReport {
  id: string;
  configId: string;
  generatedAt: Date;
  data: string; // JSON serialized GeneratedReportData
  format: ReportFormat;
  filePath?: string;
  fileSizeBytes?: number;
  createdAt: Date;
}

/**
 * Report schedule configuration
 */
export interface ReportSchedule {
  id: string;
  configId: string;
  cronExpression: string;
  lastRunAt?: Date;
  nextRunAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Options for generating a report
 */
export interface GenerateReportOptions {
  configId: string;
  timeRange?: {
    from: number;
    to: number;
  };
  saveToDisk?: boolean;
  outputPath?: string;
  sendToRecipients?: boolean;
  includeComparison?: boolean;
  includeRecommendations?: boolean;
}

/**
 * Options for querying report history
 */
export interface ReportHistoryOptions {
  configId?: string;
  reportType?: ReportType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Input for creating a new report configuration
 */
export interface CreateReportConfigInput {
  name: string;
  description?: string;
  type: ReportType;
  metricsConfig: ReportMetricsConfig;
  format: ReportFormat;
  recipients?: string[];
  isActive?: boolean;
}

/**
 * Input for updating a report configuration
 */
export interface UpdateReportConfigInput {
  name?: string;
  description?: string;
  type?: ReportType;
  metricsConfig?: ReportMetricsConfig;
  format?: ReportFormat;
  recipients?: string[];
  isActive?: boolean;
}

/**
 * Input for creating a report schedule
 */
export interface CreateReportScheduleInput {
  configId: string;
  cronExpression: string;
  isActive?: boolean;
}

/**
 * Input for updating a report schedule
 */
export interface UpdateReportScheduleInput {
  cronExpression?: string;
  isActive?: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

/**
 * Performance insights derived from metrics
 */
export interface PerformanceInsight {
  category: 'performance' | 'efficiency' | 'quality' | 'usage';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  affectedMetrics: string[];
  recommendation?: string;
}

// ============================================================================
// Model Performance Comparison Types
// ============================================================================

/**
 * Performance metrics for a specific model
 * Aggregated statistics for model evaluation
 */
export interface ModelPerformanceMetrics {
  /** Model identifier (e.g., 'ollama', 'claude-opus-4', 'claude-sonnet-4') */
  modelId: string;

  /** Total number of requests processed */
  totalRequests: number;

  /** Response time statistics */
  responseTime: {
    /** Average response time in milliseconds */
    avg: number;

    /** Minimum response time in milliseconds */
    min: number;

    /** Maximum response time in milliseconds */
    max: number;

    /** Median (p50) response time */
    p50: number;

    /** 95th percentile response time */
    p95: number;

    /** 99th percentile response time */
    p99: number;

    /** Standard deviation */
    stdDev: number;
  };

  /** Token usage statistics */
  tokenUsage: {
    /** Total prompt tokens used */
    totalPromptTokens: number;

    /** Total completion tokens generated */
    totalCompletionTokens: number;

    /** Total tokens (prompt + completion) */
    totalTokens: number;

    /** Average prompt tokens per request */
    avgPromptTokens: number;

    /** Average completion tokens per request */
    avgCompletionTokens: number;

    /** Average total tokens per request */
    avgTotalTokens: number;
  };

  /** Token efficiency metrics */
  tokenEfficiency: {
    /** Tokens per millisecond */
    tokensPerMs: number;

    /** Average tokens per second */
    tokensPerSecond: number;

    /** Completion tokens per prompt token ratio */
    completionToPromptRatio: number;
  };

  /** Quality and reliability metrics */
  quality: {
    /** Success rate (non-error responses) as percentage (0-100) */
    successRate: number;

    /** Error count */
    errorCount: number;

    /** Error rate as percentage (0-100) */
    errorRate: number;

    /** Cache hit rate if applicable (0-100) */
    cacheHitRate?: number;
  };

  /** Cost analysis */
  cost: {
    /** Estimated cost per request (USD) */
    costPerRequest: number;

    /** Estimated total cost (USD) */
    totalCost: number;

    /** Cost per 1K tokens (USD) */
    costPer1kTokens: number;
  };

  /** Time range for these metrics */
  timeRange: AnalyticsTimeRange;
}

/**
 * Comparison between multiple models
 * Identifies best-performing model for different use cases
 */
export interface ModelComparison {
  /** Models being compared */
  models: ModelPerformanceMetrics[];

  /** Time range for this comparison */
  timeRange: AnalyticsTimeRange;

  /** Ranking by different criteria */
  rankings: {
    /** Fastest average response time */
    bySpeed: string[]; // Array of modelIds ordered by speed

    /** Most token-efficient */
    byTokenEfficiency: string[];

    /** Most cost-effective */
    byCostEfficiency: string[];

    /** Highest quality (lowest error rate) */
    byQuality: string[];

    /** Overall recommended (weighted composite score) */
    overall: string[];
  };

  /** Recommendations based on analysis */
  recommendations: ModelRecommendation[];

  /** Generated timestamp */
  generatedAt: number;
}

/**
 * Model recommendation for specific use case
 */
export interface ModelRecommendation {
  /** Recommended model ID */
  modelId: string;

  /** Use case this recommendation applies to */
  useCase: 'speed' | 'cost' | 'quality' | 'balanced' | 'high_throughput';

  /** Confidence score (0-1) */
  confidence: number;

  /** Reasoning for this recommendation */
  reasoning: string;

  /** Expected performance characteristics */
  expectedPerformance: {
    avgResponseTimeMs: number;
    avgCostPerRequest: number;
    expectedSuccessRate: number;
  };
}

/**
 * Head-to-head benchmark between two models
 * Direct comparison on a specific metric
 */
export interface ModelBenchmark {
  /** First model being compared */
  modelA: {
    modelId: string;
    value: number;
    sampleSize: number;
  };

  /** Second model being compared */
  modelB: {
    modelId: string;
    value: number;
    sampleSize: number;
  };

  /** Metric being compared */
  metric: BenchmarkMetric;

  /** Winner of this benchmark */
  winner: string | 'tie';

  /** Performance difference */
  difference: {
    /** Absolute difference */
    absolute: number;

    /** Percentage difference */
    percentage: number;

    /** Direction (positive means modelA is better) */
    direction: 'modelA_better' | 'modelB_better' | 'tie';
  };

  /** Statistical significance */
  significance: {
    /** Is the difference statistically significant? */
    isSignificant: boolean;

    /** Confidence level (0-1) */
    confidenceLevel: number;

    /** P-value if statistical test was performed */
    pValue?: number;
  };

  /** Time range for this benchmark */
  timeRange: AnalyticsTimeRange;
}

/**
 * Metrics available for benchmarking
 */
export type BenchmarkMetric =
  | 'avg_response_time'
  | 'p95_response_time'
  | 'p99_response_time'
  | 'tokens_per_second'
  | 'cost_per_request'
  | 'success_rate'
  | 'token_efficiency'
  | 'cache_hit_rate';

/**
 * Detailed cost analysis for a model
 * Token usage and cost projections
 */
export interface CostAnalysis {
  /** Model identifier */
  model: string;

  /** Time range analyzed */
  timeRange: AnalyticsTimeRange;

  /** Token usage breakdown */
  tokens: {
    /** Total prompt tokens */
    totalPromptTokens: number;

    /** Total completion tokens */
    totalCompletionTokens: number;

    /** Total tokens */
    totalTokens: number;

    /** Tokens by time period */
    byPeriod: Array<{
      timestamp: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }>;
  };

  /** Cost breakdown */
  costs: {
    /** Estimated total cost (USD) */
    estimatedCost: number;

    /** Cost for prompt tokens (USD) */
    promptCost: number;

    /** Cost for completion tokens (USD) */
    completionCost: number;

    /** Average cost per message (USD) */
    costPerMessage: number;

    /** Cost per 1K tokens (USD) */
    costPer1kTokens: number;

    /** Daily average cost (USD) */
    dailyAvgCost: number;

    /** Projected monthly cost (USD) */
    projectedMonthlyCost: number;
  };

  /** Cost optimization suggestions */
  optimizations: CostOptimization[];

  /** Pricing model used for calculations */
  pricingModel: {
    promptTokenPrice: number; // Per 1K tokens
    completionTokenPrice: number; // Per 1K tokens
    currency: string;
  };
}

/**
 * Cost optimization suggestion
 */
export interface CostOptimization {
  /** Type of optimization */
  type: 'model_switch' | 'cache_improvement' | 'prompt_optimization' | 'batching';

  /** Description of the optimization */
  description: string;

  /** Estimated savings (USD) */
  estimatedSavings: number;

  /** Estimated savings percentage */
  savingsPercentage: number;

  /** Implementation difficulty (1-5, 5 being hardest) */
  difficulty: number;

  /** Impact score (1-5, 5 being highest impact) */
  impact: number;
}

/**
 * Performance trend analysis over time
 * Detects performance degradation or improvement
 */
export interface PerformanceTrend {
  /** Model being analyzed */
  modelId: string;

  /** Metric being tracked */
  metric: BenchmarkMetric;

  /** Time range analyzed */
  timeRange: AnalyticsTimeRange;

  /** Trend direction */
  trend: 'improving' | 'degrading' | 'stable' | 'volatile';

  /** Data points over time */
  dataPoints: Array<{
    timestamp: number;
    value: number;
    sampleSize: number;
  }>;

  /** Statistical analysis */
  statistics: {
    /** Slope of trend line (change per day) */
    slope: number;

    /** Correlation coefficient (-1 to 1) */
    correlation: number;

    /** Variance in the metric */
    variance: number;

    /** Current value */
    current: number;

    /** Average value */
    average: number;

    /** Change from start to end */
    totalChange: number;

    /** Percentage change */
    percentageChange: number;
  };

  /** Anomalies detected */
  anomalies: Array<{
    timestamp: number;
    value: number;
    expectedValue: number;
    deviation: number;
    severity: 'low' | 'medium' | 'high';
  }>;
}

/**
 * Detected performance issue
 * Identifies problems requiring attention
 */
export interface PerformanceIssue {
  /** Unique identifier for this issue */
  id: string;

  /** Model affected */
  modelId: string;

  /** Issue type */
  type: PerformanceIssueType;

  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Issue title */
  title: string;

  /** Detailed description */
  description: string;

  /** When was this issue detected */
  detectedAt: number;

  /** Metric that triggered this issue */
  metric: BenchmarkMetric;

  /** Current value */
  currentValue: number;

  /** Expected/threshold value */
  expectedValue: number;

  /** Deviation from expected */
  deviation: number;

  /** Impact assessment */
  impact: {
    /** Affected request count */
    affectedRequests: number;

    /** Percentage of total requests */
    affectedPercentage: number;

    /** Estimated cost impact (USD) */
    costImpact?: number;

    /** User experience impact */
    userImpact: 'none' | 'low' | 'medium' | 'high';
  };

  /** Suggested actions */
  suggestedActions: string[];

  /** Related trends or context */
  context?: {
    recentTrend: 'improving' | 'degrading' | 'stable';
    comparedToOtherModels: 'better' | 'worse' | 'similar';
  };
}

/**
 * Types of performance issues
 */
export type PerformanceIssueType =
  | 'high_latency'
  | 'high_error_rate'
  | 'cost_spike'
  | 'token_inefficiency'
  | 'degrading_performance'
  | 'capacity_issue'
  | 'quality_degradation'
  | 'cache_underutilization';

/**
 * Detailed latency percentile analysis
 * Used for SLA monitoring and performance optimization
 */
export interface LatencyPercentiles {
  /** Model identifier */
  modelId: string;

  /** Time range analyzed */
  timeRange: AnalyticsTimeRange;

  /** Sample size */
  sampleSize: number;

  /** Percentile values in milliseconds */
  percentiles: {
    p10: number;
    p25: number;
    p50: number; // Median
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    p99_9: number;
  };

  /** Distribution statistics */
  distribution: {
    mean: number;
    median: number;
    mode?: number;
    stdDev: number;
    variance: number;
    skewness: number;
    kurtosis: number;
  };

  /** Histogram buckets */
  histogram: Array<{
    /** Lower bound of bucket (ms) */
    min: number;

    /** Upper bound of bucket (ms) */
    max: number;

    /** Count of requests in this bucket */
    count: number;

    /** Percentage of total requests */
    percentage: number;
  }>;

  /** Time-series percentile data */
  timeSeries: Array<{
    timestamp: number;
    p50: number;
    p95: number;
    p99: number;
  }>;

  /** SLA compliance */
  sla?: {
    /** Target latency in milliseconds */
    targetMs: number;

    /** Compliance rate (0-100) */
    complianceRate: number;

    /** Number of violations */
    violations: number;
  };
}

/**
 * Comprehensive model performance report
 * Aggregates all performance data for executive summary
 */
export interface ModelPerformanceReport {
  /** Report metadata */
  metadata: {
    /** Report generation timestamp */
    generatedAt: number;

    /** Time range covered */
    timeRange: AnalyticsTimeRange;

    /** Report version */
    version: string;

    /** Total models analyzed */
    modelsAnalyzed: number;

    /** Total requests analyzed */
    totalRequests: number;
  };

  /** Executive summary */
  summary: {
    /** Best performing model overall */
    bestOverall: string;

    /** Most cost-effective model */
    mostCostEffective: string;

    /** Fastest model */
    fastest: string;

    /** Most reliable model */
    mostReliable: string;

    /** Key insights */
    insights: string[];

    /** Critical issues count */
    criticalIssuesCount: number;
  };

  /** Per-model performance metrics */
  modelMetrics: ModelPerformanceMetrics[];

  /** Model comparisons */
  comparisons: ModelComparison;

  /** Performance trends */
  trends: PerformanceTrend[];

  /** Detected issues */
  issues: PerformanceIssue[];

  /** Cost analysis summary */
  costSummary: {
    /** Total cost across all models (USD) */
    totalCost: number;

    /** Per-model cost breakdown */
    byModel: Array<{
      modelId: string;
      cost: number;
      percentage: number;
    }>;

    /** Potential savings from optimizations */
    potentialSavings: number;
  };

  /** Recommendations */
  recommendations: ModelRecommendation[];
}

/**
 * Options for querying model performance data
 */
export interface ModelPerformanceQueryOptions {
  /** Time range to analyze */
  timeRange: AnalyticsTimeRange;

  /** Specific models to include (omit for all) */
  modelIds?: string[];

  /** Minimum sample size required */
  minSampleSize?: number;

  /** Include cost analysis */
  includeCost?: boolean;

  /** Include trend analysis */
  includeTrends?: boolean;

  /** Include issue detection */
  includeIssues?: boolean;

  /** Aggregation interval for time-series */
  aggregationInterval?: 'minute' | 'hour' | 'day';
}

// ============================================================================
// User Behavior Tracking & Analytics Types
// ============================================================================

/**
 * Time range for behavior analysis
 */
export interface BehaviorTimeRange {
  /** Start timestamp in milliseconds */
  from: number;

  /** End timestamp in milliseconds */
  to: number;

  /** Optional label for preset ranges */
  label?: string;
}

// ============================================================================
// User Activity Pattern Types
// ============================================================================

/**
 * Activity pattern showing when a user is active
 * Helps identify peak engagement times
 */
export interface UserActivityPattern {
  /** User/sender ID */
  senderId: string;

  /** Active hours (0-23) with message counts */
  activeHours: Array<{
    hour: number;
    messageCount: number;
    percentage: number;
  }>;

  /** Active days of week (0=Sunday, 6=Saturday) with message counts */
  activeDays: Array<{
    dayOfWeek: number;
    dayName: string;
    messageCount: number;
    percentage: number;
  }>;

  /** Average messages per day */
  averageMessagesPerDay: number;

  /** Last active timestamp */
  lastActiveAt: Date;

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;
}

// ============================================================================
// User Engagement Score Types
// ============================================================================

/**
 * Detailed engagement metrics for calculating user engagement score
 */
export interface UserEngagementMetrics {
  /** Total number of messages sent */
  messageCount: number;

  /** Number of days user has been active */
  activeDays: number;

  /** Response rate (messages received / messages sent) */
  responseRate: number;

  /** Average session length in minutes */
  averageSessionLength: number;

  /** Number of days since first message */
  retentionDays: number;

  /** Number of days since last message */
  daysSinceLastActive: number;

  /** Message frequency (messages per day) */
  messageFrequency: number;

  /** Intent diversity (unique intents / total messages) */
  intentDiversity: number;

  /** Average message length in characters */
  averageMessageLength: number;
}

/**
 * Computed engagement score with breakdown
 */
export interface UserEngagementScore {
  /** User/sender ID */
  senderId: string;

  /** Overall engagement score (0-100) */
  score: number;

  /** Score components breakdown */
  components: {
    /** Frequency score (0-100) - how often they engage */
    frequency: number;

    /** Recency score (0-100) - how recently they engaged */
    recency: number;

    /** Depth score (0-100) - quality of engagement */
    depth: number;

    /** Retention score (0-100) - loyalty over time */
    retention: number;
  };

  /** Detailed metrics used for calculation */
  metrics: UserEngagementMetrics;

  /** Calculated timestamp */
  calculatedAt: Date;
}

// ============================================================================
// User Intent Preferences Types
// ============================================================================

/**
 * User's intent usage pattern
 */
export interface UserIntentPreference {
  /** Intent type */
  intent: ChildIntent;

  /** Number of times this intent was used */
  count: number;

  /** Percentage of total messages */
  percentage: number;

  /** Average confidence for this intent */
  averageConfidence: number;

  /** Trend (increasing, stable, decreasing) */
  trend: 'increasing' | 'stable' | 'decreasing';
}

/**
 * User's intent preferences summary
 */
export interface UserIntentPreferences {
  /** User/sender ID */
  senderId: string;

  /** Top intents by usage */
  topIntents: UserIntentPreference[];

  /** Intent diversity score (0-1) */
  diversityScore: number;

  /** Most common parent intent category */
  dominantCategory: string;

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;
}

// ============================================================================
// User Segmentation Types
// ============================================================================

/**
 * User segment categories based on engagement patterns
 */
export type UserSegmentType =
  | 'power_user'    // High engagement, frequent usage
  | 'casual'        // Moderate engagement, occasional usage
  | 'inactive'      // Low engagement, rare usage
  | 'new'           // Recently joined, still exploring
  | 'at_risk';      // Previously active, declining engagement

/**
 * Criteria for user segment classification
 */
export interface UserSegmentCriteria {
  /** Minimum engagement score */
  minEngagementScore: number;

  /** Maximum engagement score */
  maxEngagementScore: number;

  /** Minimum messages per day */
  minMessagesPerDay?: number;

  /** Maximum days since last active */
  maxDaysSinceActive?: number;

  /** Minimum retention days */
  minRetentionDays?: number;

  /** Maximum retention days */
  maxRetentionDays?: number;
}

/**
 * User segment with classification details
 */
export interface UserSegment {
  /** User/sender ID */
  senderId: string;

  /** Segment type */
  type: UserSegmentType;

  /** Segment name */
  name: string;

  /** Segment description */
  description: string;

  /** Criteria that qualified this user for segment */
  criteria: UserSegmentCriteria;

  /** Engagement score */
  engagementScore: number;

  /** Key metrics for this user */
  metrics: {
    messageCount: number;
    messagesPerDay: number;
    daysSinceLastActive: number;
    retentionDays: number;
  };

  /** Classification timestamp */
  classifiedAt: Date;
}

/**
 * User segmentation summary
 */
export interface UserSegmentationSummary {
  /** Total users analyzed */
  totalUsers: number;

  /** Segments with user counts */
  segments: Array<{
    type: UserSegmentType;
    name: string;
    count: number;
    percentage: number;
  }>;

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;

  /** Analysis timestamp */
  analyzedAt: Date;
}

// ============================================================================
// User Retention Types
// ============================================================================

/**
 * Cohort retention data point
 */
export interface CohortRetentionPoint {
  /** Cohort date (when users joined) */
  cohortDate: Date;

  /** Period number (0 = cohort date, 1 = next period, etc.) */
  period: number;

  /** Period label (e.g., "Week 1", "Month 2") */
  periodLabel: string;

  /** Number of users active in this period */
  activeUsers: number;

  /** Retention rate (0-1) */
  retentionRate: number;

  /** Percentage retained */
  retentionPercentage: number;
}

/**
 * Cohort retention analysis
 */
export interface CohortRetention {
  /** Cohort date (when users joined) */
  cohortDate: Date;

  /** Cohort size (initial users) */
  cohortSize: number;

  /** Retention curve by period */
  retentionCurve: CohortRetentionPoint[];

  /** Average retention rate across all periods */
  averageRetention: number;

  /** Period type (day, week, month) */
  periodType: 'day' | 'week' | 'month';
}

/**
 * Retention analysis summary
 */
export interface RetentionAnalysis {
  /** Cohorts with retention data */
  cohorts: CohortRetention[];

  /** Overall retention metrics */
  overall: {
    /** Average 1-period retention (e.g., day 1, week 1) */
    day1Retention: number;

    /** Average 7-period retention (e.g., week 1, month 1) */
    day7Retention: number;

    /** Average 30-period retention */
    day30Retention: number;
  };

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;

  /** Analysis timestamp */
  analyzedAt: Date;
}

// ============================================================================
// User Behavior Trends Types
// ============================================================================

/**
 * Time-series data point for behavior trends
 */
export interface BehaviorTrendPoint {
  /** Timestamp */
  timestamp: Date;

  /** Value at this point */
  value: number;

  /** Label for this point */
  label: string;
}

/**
 * Behavior trend analysis
 */
export interface BehaviorTrend {
  /** Metric name */
  metric: string;

  /** Metric label */
  label: string;

  /** Time-series data points */
  dataPoints: BehaviorTrendPoint[];

  /** Trend direction */
  trend: 'increasing' | 'decreasing' | 'stable';

  /** Percentage change over period */
  percentageChange: number;

  /** Current value */
  currentValue: number;

  /** Previous value for comparison */
  previousValue: number;
}

/**
 * User behavior trends over time
 */
export interface UserBehaviorTrends {
  /** User/sender ID */
  senderId: string;

  /** Message frequency trend */
  messageFrequency: BehaviorTrend;

  /** Engagement score trend */
  engagementScore: BehaviorTrend;

  /** Session length trend */
  sessionLength: BehaviorTrend;

  /** Intent diversity trend */
  intentDiversity: BehaviorTrend;

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;

  /** Analysis timestamp */
  analyzedAt: Date;
}

// ============================================================================
// Complete User Behavior Profile
// ============================================================================

/**
 * Complete user behavior profile combining all analytics
 */
export interface UserBehaviorProfile {
  /** User/sender ID */
  senderId: string;

  /** User information */
  user: {
    telegramId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };

  /** Activity pattern */
  activityPattern: UserActivityPattern;

  /** Intent preferences */
  intentPreferences: UserIntentPreferences;

  /** Engagement score */
  engagementScore: UserEngagementScore;

  /** User segment */
  segment: UserSegment;

  /** Behavior trends */
  trends: UserBehaviorTrends;

  /** Profile generation timestamp */
  generatedAt: Date;

  /** Time range for this profile */
  timeRange: BehaviorTimeRange;
}

// ============================================================================
// Top Users Types
// ============================================================================

/**
 * Top user by specific metric
 */
export interface TopUser {
  /** User/sender ID */
  senderId: string;

  /** User information */
  username: string | null;
  firstName: string | null;

  /** Metric value */
  value: number;

  /** Metric label */
  metricLabel: string;

  /** Rank (1 = highest) */
  rank: number;

  /** Engagement score */
  engagementScore: number;

  /** Segment type */
  segment: UserSegmentType;
}

/**
 * Top users summary
 */
export interface TopUsersSummary {
  /** Top users by message count */
  byMessageCount: TopUser[];

  /** Top users by engagement score */
  byEngagementScore: TopUser[];

  /** Top users by session length */
  bySessionLength: TopUser[];

  /** Top users by retention */
  byRetention: TopUser[];

  /** Time range for this analysis */
  timeRange: BehaviorTimeRange;

  /** Analysis timestamp */
  analyzedAt: Date;
}

// ============================================================================
// Default Segment Criteria
// ============================================================================

/**
 * Default criteria for user segmentation
 */
export const DEFAULT_SEGMENT_CRITERIA: Record<UserSegmentType, UserSegmentCriteria> = {
  power_user: {
    minEngagementScore: 70,
    maxEngagementScore: 100,
    minMessagesPerDay: 5,
    maxDaysSinceActive: 3,
    minRetentionDays: 30,
  },
  casual: {
    minEngagementScore: 30,
    maxEngagementScore: 69,
    minMessagesPerDay: 0.5,
    maxDaysSinceActive: 14,
    minRetentionDays: 7,
  },
  inactive: {
    minEngagementScore: 0,
    maxEngagementScore: 29,
    maxDaysSinceActive: 30,
    minRetentionDays: 7,
  },
  new: {
    minEngagementScore: 0,
    maxEngagementScore: 100,
    maxRetentionDays: 7,
  },
  at_risk: {
    minEngagementScore: 30,
    maxEngagementScore: 100,
    maxDaysSinceActive: 14,
    minRetentionDays: 14,
  },
};

/**
 * Segment names and descriptions
 */
export const SEGMENT_DEFINITIONS: Record<UserSegmentType, { name: string; description: string }> = {
  power_user: {
    name: 'Power User',
    description: 'Highly engaged users with frequent activity and high retention',
  },
  casual: {
    name: 'Casual User',
    description: 'Moderately engaged users with occasional activity',
  },
  inactive: {
    name: 'Inactive User',
    description: 'Low engagement users with rare activity',
  },
  new: {
    name: 'New User',
    description: 'Recently joined users still exploring the system',
  },
  at_risk: {
    name: 'At Risk',
    description: 'Previously active users with declining engagement',
  },
};
