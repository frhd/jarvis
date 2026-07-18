import { z } from 'zod';

// Helper for positive integers
const positiveInt = z.number().int().positive();

// Helper for non-negative integers
const nonNegativeInt = z.number().int().nonnegative();

// Helper for positive floats
const positiveFloat = z.number().positive();

// Helper for floats between 0 and 1
const probability = z.number().min(0).max(1);

// Helper for URL validation
const urlString = z.string().url();

// Helper for non-empty string
const nonEmptyString = z.string().min(1);

// Helper for comma-separated string arrays (parsed from env)
const stringArray = z.array(z.string());

// Database configuration schema
const databaseSchema = z.object({
  path: nonEmptyString,
});

// Media storage configuration schema
const mediaSchema = z.object({
  basePath: nonEmptyString,
  paths: z.object({
    photos: nonEmptyString,
    documents: nonEmptyString,
    voice: nonEmptyString,
    video: nonEmptyString,
  }),
});

// Retry configuration schema
const retrySchema = z.object({
  maxAttempts: positiveInt,
  retryIntervalMs: positiveInt,
  baseDelayMs: positiveInt,
  maxDelayMs: positiveInt,
  backoffMultiplier: positiveFloat,
  jitterFactor: probability,
  stuckMessageThresholdMs: positiveInt, // Time before stuck 'processing' messages are recovered for retry
  stuckMessageMaxRetries: positiveInt, // Max retries specifically for stuck messages (lower than normal)
});

// Circuit breaker configuration schema
const circuitBreakerSchema = z.object({
  failureThreshold: positiveInt,
  resetTimeoutMs: positiveInt,
  halfOpenRequests: positiveInt,
});

// Dead letter queue configuration schema
const deadLetterQueueSchema = z.object({
  retentionDays: positiveInt,
  cleanupIntervalMs: positiveInt,
});

// PM2 monitoring configuration schema
const pm2Schema = z.object({
  restartWarningThreshold: positiveInt.default(10), // 10+ restarts triggers warning
  restartCriticalThreshold: positiveInt.default(20), // 20+ restarts triggers critical
  restartRateThresholdPerHour: positiveInt.default(30), // 30+ restarts/hour triggers degraded warning (increased for Telegram TIMEOUT tolerance)
  checkIntervalMs: positiveInt.default(300000), // Check every 5 minutes
});

// Queue cleanup configuration schema
const queueCleanupSchema = z.object({
  retentionDays: positiveInt,
  cleanupIntervalMs: positiveInt,
  stuckThresholdMs: positiveInt, // Time before processing messages are considered stuck
});

// Priority escalation configuration schema
const priorityEscalationSchema = z.object({
  enabled: z.boolean(),
  checkIntervalMs: positiveInt,
  vipChatIds: stringArray,
  vipUserIds: stringArray,
});

// Slack configuration schema
const slackSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  appToken: z.string().default(''),
  channelId: z.string().default(''),
  testUserId: z.string().default(''),
  ceoMcpConfigPath: z.string().default(''),
});

// CEO Module configuration schema
const ceoSchema = z.object({
  enabled: z.boolean().default(false),
  mcpConfigPath: z.string().default(''),
  scheduledEnabled: z.boolean().default(true),
  monitorEnabled: z.boolean().default(true),
  responseTimeoutMs: positiveInt.default(120000), // 2 minutes default
});

// Telegram configuration schema
const telegramSchema = z.object({
  enabled: z.boolean().default(true),
  apiId: nonNegativeInt,
  apiHash: z.string(),
  phoneNumber: z.string(),
  sessionString: z.string(),
  // Connection stability settings
  healthCheckIntervalMs: positiveInt.default(15000), // 15 seconds (faster detection)
  healthCheckTimeoutMs: positiveInt.default(10000), // 10 seconds
  staleUpdateThresholdMs: positiveInt.default(300000), // 5 minutes to avoid reconnect loops during idle
  proactiveRefreshIntervalMs: positiveInt.default(600000), // 10 minutes (reduced from 15)
  maxReconnectAttempts: positiveInt.default(10),
  reconnectBaseDelayMs: positiveInt.default(1000),
  reconnectMaxDelayMs: positiveInt.default(60000),
  // Keepalive ping settings
  keepalivePingIntervalMs: positiveInt.default(30000), // 30 seconds - send lightweight ping
  keepalivePingTimeoutMs: positiveInt.default(5000), // 5 seconds - fast timeout for ping
  keepaliveFailuresBeforeReconnect: positiveInt.default(2), // Reconnect after 2 consecutive failures
  // Outbound message queue settings
  outboundQueueMaxSize: positiveInt.default(100),
  outboundQueueFlushTimeoutMs: positiveInt.default(30000), // 30 seconds to flush queue after reconnect
  // Watchdog settings (heals the zombie-connection state the in-service health
  // check cannot recover from, since it early-returns while disconnected)
  watchdogEnabled: z.boolean().default(true),
  watchdogIntervalMs: positiveInt.default(60000), // check the connection every 60 seconds
  watchdogRestartAfterDownMs: positiveInt.default(600000), // 10 min of sustained downtime -> restart process
  watchdogStuckReconnectingThresholdMs: positiveInt.default(600000), // reconnect in progress > 10 min -> treat as unhealthy
  watchdogRestartEscalationEnabled: z.boolean().default(true),
});

// Priority configuration schema
const prioritySchema = z.object({
  chatIds: stringArray,
});

// LLM configuration schema
const llmSchema = z.object({
  enabled: z.boolean(),
  baseUrl: urlString,
  model: nonEmptyString,
  timeoutMs: positiveInt,
  maxRetries: nonNegativeInt,
  temperature: z.number().min(0).max(2),
  maxTokens: positiveInt,
  extractionMaxTokens: positiveInt,
  healthCheckIntervalMs: positiveInt,
  skipOnUnhealthy: z.boolean(),
  keepAlive: nonEmptyString.default('30m'),
});

// Response configuration schema
const responseSchema = z.object({
  enabled: z.boolean(),
  contextWindowSize: positiveInt,
  systemPrompt: nonEmptyString,
  typingIndicator: z.boolean(),
  readReceipts: z.boolean(),
  temperature: z.number().min(0).max(2),
  maxTokens: positiveInt,
  // Message length handling
  maxLength: positiveInt.default(4096),
  targetLength: positiveInt.default(3500),
  summarizationEnabled: z.boolean().default(true),
  summarizationTimeoutMs: positiveInt.default(10000),
  // Force all requests through Claude agentic mode (bypasses Ollama routing)
  forceAgenticMode: z.boolean().default(false),
});

// Search configuration schema
const searchSchema = z.object({
  enabled: z.boolean(),
  maxResults: positiveInt,
  timeoutMs: positiveInt,
});

// Browser configuration schema
const browserSchema = z.object({
  enabled: z.boolean().default(false),
  headless: z.boolean().default(true),
  contentMaxLength: positiveInt.default(50000),
  fetchTimeoutMs: positiveInt.default(30000),
  fetchTopN: nonNegativeInt.default(3),
  mcpEnabled: z.boolean().default(false),
  mcpConfigPath: z.string().default(''),
});

// Tools configuration schema
const toolsSchema = z.object({
  enabled: z.boolean(),
  maxIterations: positiveInt,
  timeoutMs: positiveInt,
});

// Claude configuration schema
const claudeSchema = z.object({
  enabled: z.boolean(),
  cliPath: nonEmptyString,
  timeoutMs: positiveInt,
  model: nonEmptyString, // e.g., 'sonnet', 'opus', 'haiku', or specific versions
  systemPrompt: nonEmptyString,
});

// Intent classification configuration schema
const intentClassificationSchema = z.object({
  enabled: z.boolean(),
  timeoutMs: positiveInt,
  temperature: z.number().min(0).max(2),
});

// Embedding configuration schema
const embeddingSchema = z.object({
  enabled: z.boolean(),
  model: nonEmptyString,
  dimensions: positiveInt,
  timeoutMs: positiveInt,
});

// Whisper/Transcription configuration schema
const whisperSchema = z.object({
  enabled: z.boolean(),
  baseUrl: urlString,
  model: nonEmptyString,
  timeoutMs: positiveInt,
  maxAudioDurationSeconds: positiveInt,
  defaultLanguage: z.string().default('en'),
  skipOnUnhealthy: z.boolean(),
});

// Memory configuration schema
const memorySchema = z.object({
  enabled: z.boolean(),
  maxMemoriesPerSender: positiveInt,
  archiveAfterDays: positiveInt,
  minConfidence: z.number().int().min(0).max(100),
});

// RAG configuration schema
const ragSchema = z.object({
  enabled: z.boolean(),
  topK: positiveInt,
  similarityThreshold: probability,
  recencyDecayHours: positiveInt,
  maxContextTokens: positiveInt,
  recentMessagesCount: positiveInt,
});

// Cache TTL configuration schema
const cacheTtlSchema = z.object({
  simpleGreeting: positiveInt,
  factualQuestion: positiveInt,
  personalQuestion: positiveInt,
  default: positiveInt,
});

// Cache configuration schema
const cacheSchema = z.object({
  enabled: z.boolean(),
  similarityThreshold: probability,
  maxEntries: positiveInt,
  cleanupIntervalMs: positiveInt,
  ttl: cacheTtlSchema,
  cacheableIntents: z.array(z.string()), // String array for flexibility
});

// Metrics configuration schema
const metricsSchema = z.object({
  enabled: z.boolean(),
  flushIntervalMs: positiveInt,
  retentionDays: positiveInt,
  aggregationIntervalMs: positiveInt,
});

// Alerting configuration schema
const alertingSchema = z.object({
  enabled: z.boolean(),
  checkIntervalMs: positiveInt,
  defaultWindowMs: positiveInt,
  defaultCooldownMs: positiveInt,
});

// Performance monitoring configuration schema
const performanceSchema = z.object({
  memoryMonitoringEnabled: z.boolean().default(true),
  memoryWarningThreshold: z.number().int().min(50).max(99).default(85),
  memoryCriticalThreshold: z.number().int().min(50).max(99).default(95),
  memoryCheckIntervalMs: positiveInt.default(60000),
});

// API Authentication configuration schema
const authSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['jwt', 'api-key', 'both']).default('jwt'),
  jwt: z.object({
    secret: z.string().default(''),
    issuer: z.string().optional(),
    audience: z.string().optional(),
    expirySeconds: positiveInt.default(3600),
    clockToleranceSeconds: nonNegativeInt.default(60),
  }),
  apiKey: z.object({
    keysString: z.string().default(''),
  }),
});

// CORS configuration schema
const corsSchema = z.object({
  enabled: z.boolean().default(true),
  origins: stringArray,
  allowCredentials: z.boolean().default(false),
});

// Proxy trust configuration schema
const proxySchema = z.object({
  trustProxy: z.boolean().default(false),
  trustedProxies: stringArray,
});

// Proactive messaging configuration schema
const proactiveSchema = z.object({
  enabled: z.boolean().default(false),
  defaultTimezone: nonEmptyString.default('UTC'),
  maxConcurrentJobs: positiveInt.default(1),
  stuckJobThresholdMs: positiveInt.default(7200000), // 2 hours
  defaultContextMessages: positiveInt.default(5),
  quietHoursStart: z.number().int().min(0).max(23).default(22), // 10pm
  quietHoursEnd: z.number().int().min(0).max(23).default(8), // 8am
  respectQuietHours: z.boolean().default(true),
  targetChatId: z.string().optional(),
  workerIntervalMs: positiveInt.default(60000), // 60 seconds
  runHistoryRetentionDays: positiveInt.default(30),
});

// Therapist/Listener Mode configuration schema
const therapistSchema = z.object({
  enabled: z.boolean().default(false),
  autoDetect: z.boolean().default(true),
  requiresConsent: z.boolean().default(true),
  emotionalAnalysis: z.boolean().default(true),
  minMessagesBeforeIntervention: positiveInt.default(3),
  maxResponsesPerHour: positiveInt.default(2),
  responseCooldownMs: positiveInt.default(600000), // 10 minutes
  model: nonEmptyString, // Claude model for therapeutic responses; defaults to CLAUDE_MODEL
  // Bot handles (without leading @) that force a response when mentioned in a dyad chat
  mentionHandles: z.array(z.string()).default([]),
});

// Security configuration schema
const securitySchema = z.object({
  enabled: z.boolean().default(true),
  ownerTelegramId: z.string().optional(),
  encryption: z.object({
    enabled: z.boolean().default(false),
    algorithm: z.enum(['AES-256-GCM', 'AES-256-CBC', 'CHACHA20-POLY1305']).default('AES-256-GCM'),
    keyDerivation: z.enum(['argon2id', 'pbkdf2', 'scrypt']).default('argon2id'),
  }),
  pii: z.object({
    detectionEnabled: z.boolean().default(true),
    redactionEnabled: z.boolean().default(true),
    redactInLogs: z.boolean().default(true),
    minConfidence: probability.default(0.8),
  }),
  retention: z.object({
    messageRetentionDays: positiveInt.default(90),
    memoryRetentionDays: positiveInt.default(180),
    mediaRetentionDays: positiveInt.default(30),
    cacheRetentionDays: positiveInt.default(7),
    metricsRetentionDays: positiveInt.default(30),
    auditLogRetentionDays: positiveInt.default(365),
  }),
  audit: z.object({
    enabled: z.boolean().default(true),
    logDataAccess: z.boolean().default(true),
    logPiiDetection: z.boolean().default(true),
    logConfigChanges: z.boolean().default(true),
  }),
  gdpr: z.object({
    enabled: z.boolean().default(true),
    allowDataExport: z.boolean().default(true),
    allowDataDeletion: z.boolean().default(true),
    dataMinimization: z.boolean().default(false),
  }),
});

// Main configuration schema
export const configSchema = z.object({
  database: databaseSchema,
  media: mediaSchema,
  retry: retrySchema,
  circuitBreaker: circuitBreakerSchema,
  deadLetterQueue: deadLetterQueueSchema,
  queueCleanup: queueCleanupSchema,
  priorityEscalation: priorityEscalationSchema,
  telegram: telegramSchema,
  slack: slackSchema,
  ceo: ceoSchema,
  priority: prioritySchema,
  llm: llmSchema,
  response: responseSchema,
  search: searchSchema,
  browser: browserSchema,
  tools: toolsSchema,
  claude: claudeSchema,
  intentClassification: intentClassificationSchema,
  embedding: embeddingSchema,
  whisper: whisperSchema,
  memory: memorySchema,
  rag: ragSchema,
  cache: cacheSchema,
  metrics: metricsSchema,
  alerting: alertingSchema,
  performance: performanceSchema,
  security: securitySchema,
  auth: authSchema,
  cors: corsSchema,
  proxy: proxySchema,
  proactive: proactiveSchema,
  therapist: therapistSchema,
  loopDetection: z.object({
    enabled: z.boolean(),
  }).optional(),
  calendar: z.object({
    enabled: z.boolean(),
    caldavUrl: z.string(),
    appleId: z.string(),
    appPassword: z.string(),
    calendarName: z.string(),
    timezone: z.string(),
  }),
  pm2: pm2Schema,
});

// Export the type inferred from the schema
export type AppConfig = z.infer<typeof configSchema>;

// Validation function that provides clear error messages
export function validateConfig(config: unknown): AppConfig {
  const result = configSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path}: ${issue.message}`;
    });

    throw new Error(
      `Configuration validation failed:\n${errors.join('\n')}\n\n` +
      `Please check your environment variables and configuration.`
    );
  }

  return result.data;
}
