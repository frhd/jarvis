# Jarvis API Documentation

This document provides API reference for internal services and modules.

## Table of Contents

- [Memory System](#memory-system)
- [Intent Classification](#intent-classification)
- [Semantic Cache](#semantic-cache)
- [Multi-Model LLM](#multi-model-llm)
- [Queue System](#queue-system)
- [Metrics & Analytics](#metrics--analytics)
- [Health & Recovery](#health--recovery)
- [Configuration](#configuration)

---

## Memory System

### MemoryService

Extracts and stores user memories from conversations.

```typescript
import { memoryService } from './services';

// Extract and store memories from a message
const result = await memoryService.extractAndStore(message, sender, conversationContext);
// Returns: { facts: Memory[], stored: number, duplicates: number }

// Retrieve relevant memories
const memories = await memoryService.retrieveRelevant(query, senderId, {
  topK: 10,
  minSimilarity: 0.7,
  includeArchived: false,
});
// Returns: Array<Memory & { similarity: number, recencyBoost: number }>

// Update a memory
await memoryService.updateMemory(memoryId, { content: 'updated content', confidence: 0.9 });

// Consolidate similar memories
await memoryService.consolidateMemories(memoryIds, consolidatedContent, confidence);

// Prune old memories
const archived = await memoryService.pruneOldMemories();

// Get statistics
const stats = await memoryService.getStats(senderId);
// Returns: { total: number, active: number, byType: Record<MemoryType, number> }
```

**Memory Types:** `'fact'`, `'preference'`, `'event'`, `'relationship'`

### ContextManagerService

Builds RAG context from multiple sources.

```typescript
import { contextManagerService } from './services';

// Build context for a query
const context = await contextManagerService.buildContext(query, {
  senderId: '123',
  chatId: '456',
  maxTokens: 2000,
  includePreferences: true,
  includeMemories: true,
  includeSummaries: true,
  includeRecentMessages: true,
  recentMessageCount: 5,
  minSimilarity: 0.7,
  topK: 10,
});
// Returns: { context: string, items: ContextItem[], tokenCount: number, debug: RetrievalDebugInfo }

// Inspect context (for debugging)
const inspection = await contextManagerService.inspectContext(query, options);

// Get context statistics
const stats = await contextManagerService.getContextStats(chatId, senderId);
// Returns: { memories: number, messages: number, summaries: number, hasPreferences: boolean }
```

### UserPreferenceService

Extracts and manages user preferences.

```typescript
import { userPreferenceService } from './services';

// Extract preferences from a message
const result = await userPreferenceService.extractAndStore(message, sender, context);

// Get user profile
const profile = await userPreferenceService.getProfile(senderId);
// Returns: { communication: {...}, interests: {...}, behavior: {...}, context: {...} }

// Get specific preference
const value = await userPreferenceService.getPreference(senderId, 'communication', 'formality');

// Update preference manually
await userPreferenceService.updatePreference(senderId, 'communication', 'formality', 'casual', 0.9);

// Build context string for LLM
const contextString = await userPreferenceService.buildContextString(senderId);
```

**Preference Categories:**
- `communication`: formality, verbosity, humor, emojis, language, timezone
- `interests`: topics, avoidTopics, expertise
- `behavior`: responseTime, questionStyle, preferredTime
- `context`: name, nickname, occupation, location, currentProjects

### ConsolidationService

Consolidates memories and summarizes conversations.

```typescript
import { consolidationService } from './services';

// Consolidate similar memories for a sender
const groups = await consolidationService.consolidateSimilarMemories(senderId, 0.85);

// Summarize a conversation
const summary = await consolidationService.summarizeConversation(chatId, 100);
// Returns: { summary: string, keyTopics: string[], messageCount: number }

// Run consolidation job (batch)
const stats = await consolidationService.runConsolidationJob(50);
// Returns: { sendersProcessed: number, memoriesConsolidated: number }
```

---

## Intent Classification

### EnhancedIntentClassifierService

Three-tier intent classification system.

```typescript
import { enhancedIntentClassifierService } from './services';

// Classify a message
const result = await enhancedIntentClassifierService.classify(message, conversationContext);
// Returns: EnhancedIntentResult

interface EnhancedIntentResult {
  parentIntent: ParentIntent;
  childIntent: ChildIntent;
  confidence: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'uncertain';
  classificationMethod: 'pattern' | 'llm' | 'escalated';
  isFollowUp: boolean;
  referencesContext: boolean;
  requiresWebSearch: boolean;
  requiresComplexReasoning: boolean;
  suggestedContextDepth: number;
  canUseCache: boolean;
  shouldEscalate: boolean;
  wasEscalated: boolean;
  contextSignals: ConversationContextSignals;
}
```

**Parent Intents:** `'greeting'`, `'question'`, `'command'`, `'feedback'`, `'continuation'`

**Child Intents:** 24 granular intents (see CLAUDE.md for full list)

### IntentLogRepository

Records and analyzes classification data.

```typescript
import { intentLogRepository } from './repositories';

// Record a classification
await intentLogRepository.create({
  messageId,
  parentIntent,
  childIntent,
  confidence,
  confidenceLevel,
  classificationMethod,
  wasEscalated,
  durationMs,
});

// Record user feedback
await intentLogRepository.recordFeedback(id, correctIntent, score);
// score: -1 (incorrect), 0 (neutral), 1 (correct)

// Get accuracy statistics
const stats = await intentLogRepository.getAccuracyStats({ startDate, endDate });
// Returns: { totalClassifications, accuracyRate, byMethod: {...}, byConfidenceLevel: {...} }

// Get escalation rate
const escalation = await intentLogRepository.getEscalationRate();
// Returns: { overall: number, byParentIntent: Record<string, number> }
```

---

## Semantic Cache

### SemanticCacheService

Caches responses with semantic similarity matching.

```typescript
import { semanticCacheService } from './services';

// Lookup cached response
const result = await semanticCacheService.lookup(prompt, {
  intent: 'simple_greeting',
  useSemanticSearch: true,
  minSimilarity: 0.92,
});
// Returns: { hit: boolean, response?: string, similarity?: number, matchType?: 'exact' | 'semantic' }

// Store response in cache
await semanticCacheService.store(prompt, response, {
  intent: 'factual_question',
  model: 'ollama',
  ttlHours: 168,
  sourceMessageIds: ['msg-123'],
});

// Check if intent is cacheable
const cacheable = semanticCacheService.isCacheable('simple_greeting'); // true

// Get cache statistics
const stats = await semanticCacheService.getStats();
// Returns: { totalEntries, totalHits, avgHitCount, hitRate, entriesByIntent, entriesByModel }

// Invalidate by intent
const deleted = await semanticCacheService.invalidateByIntent('simple_greeting');

// Cleanup expired entries
const cleaned = await semanticCacheService.cleanup();

// Warm cache with common responses
await semanticCacheService.warmCache([
  { prompt: 'hello', response: 'Hi there!', intent: 'simple_greeting', model: 'ollama' },
]);
```

**Cacheable Intents:** `simple_greeting`, `time_greeting`, `farewell`, `gratitude`, `factual_question`, `personal_question`

**TTLs:** greetings (24h), factual (7d), personal (30d)

---

## Multi-Model LLM

### ModelRouter

Intelligent model selection with fallback.

```typescript
import { ModelRouter, getModelRegistry } from './llm';

const router = new ModelRouter(getModelRegistry());

// Route a request with automatic model selection
const response = await router.route(request, {
  taskComplexity: 'medium',
  maxLatencyMs: 5000,
  maxCostPerRequest: 0.01,
  requiredCapabilities: ['streaming'],
  preferredProviders: ['ollama', 'openai'],
});

// Select model without executing
const selection = await router.selectModel(request, criteria);
// Returns: { provider: LLMProviderType, model: string, score: number, reasons: string[] }

// Analyze message complexity
const complexity = router.analyzeComplexity(messages);
// Returns: { level: 'low' | 'medium' | 'high', score: number, factors: {...} }

// Get provider status
const status = await router.getProviderStatus();
// Returns: Record<LLMProviderType, ProviderHealthStatus>
```

### ModelRegistry

Central provider registry.

```typescript
import { getModelRegistry } from './llm';

const registry = getModelRegistry();

// Register a provider
registry.register(new OpenAIProvider(config));

// Get provider
const provider = registry.getProvider('openai');

// Get all available models
const models = registry.getAllModels();

// Get models by capability
const visionModels = registry.getModelsByCapability('vision');

// Get cheapest/fastest model
const cheapest = registry.getCheapestModel({ requiredCapabilities: ['streaming'] });
const fastest = registry.getFastestModel();

// Health check all providers
const health = await registry.healthCheckAll();
```

### Providers

```typescript
import { OllamaProvider, OpenAIProvider, AnthropicProvider, GeminiProvider, LMStudioProvider } from './llm';

// Create providers
const ollama = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const gemini = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY });
const lmstudio = new LMStudioProvider({ baseUrl: 'http://localhost:1234/v1' });

// Use provider directly
const response = await provider.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  stream: false,
});

// Stream response
for await (const chunk of provider.stream(request)) {
  console.log(chunk.content);
}

// Health check
const health = await provider.healthCheck();

// Estimate cost
const cost = provider.estimateCost(request);
```

### ComplexityScorer

Analyzes message complexity for routing.

```typescript
import { getComplexityScorer } from './llm';

const scorer = getComplexityScorer();

// Score complexity
const analysis = scorer.analyze(messages);
// Returns: {
//   score: number (0-1),
//   level: 'low' | 'medium' | 'high',
//   factors: {
//     tokenCount, multipleTurns, requiresReasoning,
//     requiresCodeGeneration, requiresWebSearch, hasImages,
//     requiresMath, isMultiStep
//   },
//   estimatedOutputTokens: number
// }

// Quick check without full analysis
const quick = scorer.quickCheck(message);
// Returns: 'low' | 'medium' | 'high'
```

---

## Queue System

### PriorityEscalationService

Age-based priority boosting.

```typescript
import { priorityEscalationService } from './services';

// Calculate priority for a message
const priority = priorityEscalationService.calculatePriority(chatId, senderId);
// Returns: PriorityLevel (0-4)

// Escalate stale items
const escalated = await priorityEscalationService.escalateStaleItems();

// Manual priority override
await priorityEscalationService.manualPriorityOverride(queueItemId, PriorityLevel.VIP);

// Check if VIP
const isVip = priorityEscalationService.isVip(chatId, senderId);
```

**Priority Levels:** LOW (0), NORMAL (1), HIGH (2), URGENT (3), VIP (4)

**Escalation Rules:** 5min → +1 (max HIGH), 15min → +2 (max URGENT), 30min → +3 (max VIP)

### RetryStrategyService

Exponential backoff with jitter.

```typescript
import { retryStrategyService } from './services';

// Calculate retry delay
const delayMs = retryStrategyService.calculateNextRetryDelay(attemptNumber);

// Calculate next retry time
const nextRetry = retryStrategyService.calculateNextRetryTime(attemptNumber);

// Check if should retry
const shouldRetry = retryStrategyService.shouldRetry(attemptNumber, error);

// Get remaining retry budget
const remaining = retryStrategyService.getRetryBudgetRemaining(currentAttempts);

// Calculate total retry time breakdown
const breakdown = retryStrategyService.calculateTotalRetryTime(5);
```

**Default Config:** maxAttempts=5, baseDelay=1s, maxDelay=60s, backoffMultiplier=2, jitterFactor=0.1

### CircuitBreakerService

Protects against cascading failures.

```typescript
import { circuitBreakerService } from './services';

// Execute with circuit breaker protection
try {
  const result = await circuitBreakerService.execute(serviceName, async () => {
    return await riskyOperation();
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // Circuit is open, try again after error.nextAttemptAt
  }
}

// Record success/failure manually
circuitBreakerService.recordSuccess(serviceName);
circuitBreakerService.recordFailure(serviceName, error);

// Check state
const state = circuitBreakerService.getState(serviceName);
// Returns: 'CLOSED' | 'OPEN' | 'HALF_OPEN'

// Get statistics
const stats = circuitBreakerService.getStats(serviceName);

// Manual reset
circuitBreakerService.reset(serviceName);
```

**States:** CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)

**Config:** failureThreshold=5, resetTimeout=30s, halfOpenRequests=3

### DeadLetterQueueService

Handles failed messages.

```typescript
import { deadLetterQueueService } from './services';

// Move item to DLQ
await deadLetterQueueService.moveToDeadLetter(queueItemId, reason, errorHistory);

// Inspect DLQ item
const item = await deadLetterQueueService.inspectItem(dlqId);

// Reprocess item
const success = await deadLetterQueueService.reprocessItem(dlqId);

// Reprocess all items
const results = await deadLetterQueueService.reprocessAll();

// Get statistics
const stats = await deadLetterQueueService.getStats();
// Returns: { total, byReason: Record<DLQReason, number>, oldestItemAge, recentFailures }

// Purge old items
const purged = await deadLetterQueueService.purgeOlderThan(7 * 24 * 60 * 60 * 1000);
```

**DLQ Reasons:** `MAX_RETRIES_EXCEEDED`, `CIRCUIT_BREAKER_OPEN`, `INVALID_MESSAGE`, `PERMANENT_FAILURE`, `MANUAL_MOVE`

---

## Metrics & Analytics

### MetricsService

Collects and aggregates performance metrics.

```typescript
import { metricsService } from './services';

// Record a metric
metricsService.record('response_time_ms', 250, { model: 'ollama', intent: 'greeting' });

// Record batch
metricsService.recordBatch([
  { name: 'token_usage_prompt', value: 100 },
  { name: 'token_usage_completion', value: 50 },
]);

// Flush metrics to database
await metricsService.flush();

// Get aggregated metrics
const metrics = await metricsService.getAggregated({
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
  granularity: 'hour',
  metrics: ['response_time_ms', 'cache_hit'],
});
```

**Metric Names:** `response_time_ms`, `llm_response_time_ms`, `token_usage_*`, `cache_hit`, `cache_miss`, `intent_confidence`, `intent_escalation`, `queue_depth`, `memory_retrieval_time_ms`, etc.

### AnalyticsService

Conversation and user analytics.

```typescript
import { analyticsService } from './services';

// Analyze conversation flows
const flows = await analyticsService.analyzeConversationFlows({ startDate, endDate });

// Get flow patterns
const patterns = await analyticsService.getFlowPatterns();

// Analyze intent transitions
const transitions = await analyticsService.analyzeIntentTransitions();

// Get response time analysis
const responseAnalysis = await analyticsService.getResponseTimeAnalysis();
```

### UserBehaviorService

User engagement and segmentation.

```typescript
import { userBehaviorService } from './services';

// Calculate engagement score
const score = await userBehaviorService.calculateEngagementScore(userId);

// Get user segment
const segment = await userBehaviorService.getUserSegment(userId);
// Returns: 'power_user' | 'casual_user' | 'inactive_user' | 'new_user' | 'at_risk_user'

// Get activity patterns
const patterns = await userBehaviorService.getActivityPatterns(userId);

// Analyze retention
const retention = await userBehaviorService.analyzeRetention({ cohortStart, cohortEnd });

// Get behavior trends
const trends = await userBehaviorService.getBehaviorTrends(userId, { days: 30 });
```

### DashboardService

Dashboard data and charts.

```typescript
import { dashboardService } from './services';

// Get summary dashboard
const summary = await dashboardService.getSummary();

// Get response time chart data
const chart = await dashboardService.getResponseTimeChart({ range: '7d' });

// Get token usage chart
const tokens = await dashboardService.getTokenUsageChart({ range: '24h' });

// Get intent accuracy chart
const accuracy = await dashboardService.getIntentAccuracyChart();

// Get user engagement metrics
const engagement = await dashboardService.getUserEngagementMetrics();
```

### MetricsExporterService

Export metrics in various formats.

```typescript
import { metricsExporterService } from './services';

// Export as Prometheus format
const prometheus = await metricsExporterService.exportPrometheus({ startDate, endDate });

// Export as JSON
const json = await metricsExporterService.exportJSON({ startDate, endDate });

// Export as CSV (by metric type)
const csv = await metricsExporterService.exportCSV({ type: 'response_time' });
```

---

## Health & Recovery

### HealthService

Component health monitoring.

```typescript
import { healthService } from './services';

// Register a health check
healthService.registerCheck('custom-service', async () => {
  const healthy = await checkService();
  return {
    status: healthy ? 'healthy' : 'unhealthy',
    latencyMs: 50,
    metadata: { version: '1.0.0' },
  };
}, { interval: 30000, timeout: 5000, critical: true });

// Check all components
const components = await healthService.checkAll();

// Get system health
const health = await healthService.getSystemHealth();
// Returns: { status: 'healthy' | 'degraded' | 'unhealthy', components: [...], timestamp }

// Check if system is healthy
const isHealthy = await healthService.isHealthy();

// Get cached health (no new check)
const cached = healthService.getCachedHealth();

// Start continuous monitoring
healthService.startMonitoring(30000);

// Subscribe to health changes
const unsubscribe = healthService.onHealthChange((health) => {
  console.log('Health changed:', health);
});
```

**Built-in Checks:** database, queue, llm, claude, telegram, dlq, circuitBreakers

### RecoveryService

Automatic recovery from failures.

```typescript
import { recoveryService } from './services';

// Register recovery strategy
recoveryService.registerStrategy('custom-service', {
  action: 'reconnect',
  condition: (error) => error.message.includes('connection'),
  maxAttempts: 5,
  cooldownMs: 2000,
  handler: async () => { await reconnect(); return true; },
});

// Attempt recovery
const result = await recoveryService.attemptRecovery('custom-service', error);
// Returns: { success: boolean, action, attempts, duration, error? }

// Handle health degradation
await recoveryService.handleHealthDegradation('llm', error);

// Enable auto-recovery
recoveryService.enableAutoRecovery('custom-service');

// Check recovery state
const state = recoveryService.getServiceState('custom-service');
const isRecovering = recoveryService.isRecovering('custom-service');

// Get recovery history
const history = recoveryService.getRecoveryHistory('custom-service');

// Get statistics
const stats = recoveryService.getRecoveryStats();

// Subscribe to events
recoveryService.onRecoveryStart((service) => console.log('Starting recovery:', service));
recoveryService.onRecoveryComplete((result) => console.log('Recovery complete:', result));
```

**Recovery Actions:** `restart`, `reconnect`, `retry`, `fallback`, `escalate`

---

## Configuration

### RuntimeConfig

Dynamic configuration updates.

```typescript
import { runtimeConfig } from './config';

// Get value
const timeout = runtimeConfig.get('llm.timeoutMs');

// Set value
runtimeConfig.set('llm.timeoutMs', 5000);

// Reset to original
runtimeConfig.reset('llm.timeoutMs');
runtimeConfig.resetAll();

// Check for changes
const hasChanges = runtimeConfig.hasChanges();
const diff = runtimeConfig.getDiff();

// Subscribe to changes
const unsubscribe = runtimeConfig.subscribe('llm.timeoutMs', (newValue, oldValue) => {
  console.log(`Timeout changed from ${oldValue} to ${newValue}`);
});

// Get snapshot
const snapshot = runtimeConfig.getSnapshot();
```

### FeatureFlags

Runtime feature toggles.

```typescript
import { featureFlags } from './config';

// Check if enabled
if (featureFlags.isEnabled('memory.enabled')) {
  // Use memory system
}

// Get all flags
const all = featureFlags.getAllFlags();
const byCategory = featureFlags.getFlagsByCategory();

// Set flag (in-memory only)
featureFlags.setFlag('cache.enabled', false);

// Reset flag
featureFlags.resetFlag('cache.enabled');

// Get flag metadata
const config = featureFlags.getFlagConfig('memory.enabled');
const snapshot = featureFlags.getSnapshot();
```

**Flag Categories:** LLM, AI Response, Tools, Memory, Performance, Monitoring, Queue

### ConfigMigrator

Configuration versioning.

```typescript
import { configMigrator, CONFIG_VERSION } from './config';

// Register migration
configMigrator.registerMigration('1.0.0', '1.1.0', (config) => ({
  ...config,
  newFeature: { enabled: false },
}), 'Added newFeature');

// Migrate config
const result = configMigrator.migrate(config, '1.0.0', '1.1.0');

// Check migration path
const hasPath = configMigrator.hasMigrationPath('1.0.0', '2.0.0');

// Validate config
const validation = configMigrator.validateConfig(config, '1.0.0');
```

---

## Error Handling

### Error Classes

```typescript
import {
  AppError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  RateLimitError,
  ExternalServiceError,
  TelegramError,
  LLMError,
  EmbeddingError,
  DatabaseError,
  QueueError,
  ConfigurationError,
  InvariantViolationError,
  UnexpectedError,
} from './errors';

// Create errors
throw new ValidationError('Invalid input', [
  { field: 'email', message: 'Invalid format' },
]);

throw new NotFoundError('User', userId);
throw new TimeoutError('LLM request', 30000);
throw new RateLimitError('openai', { retryAfterSeconds: 60 });

// Error utilities
import { isOperationalError, isRetryableError, wrapError, createCorrelationId } from './errors';

if (isRetryableError(error)) {
  // Schedule retry
}

const correlationId = createCorrelationId();
const wrapped = wrapError(error, 'EXTERNAL_SERVICE_TIMEOUT', { correlationId });
```

**Error Severities:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`

**Error Categories:** VALIDATION, DATABASE, TELEGRAM, LLM, EMBEDDING, QUEUE, CONFIGURATION, INTERNAL
