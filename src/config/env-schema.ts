import { z } from 'zod';

/**
 * Environment variable schema with Zod validation
 *
 * This validates process.env directly before building the config object.
 * Provides clear error messages with env var names and cross-field validation.
 */
export const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_PATH: z.string().optional(),

  // Retry settings
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  RETRY_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).max(3600000).default(300000),
  RETRY_BACKOFF_MULTIPLIER: z.coerce.number().min(1).max(10).default(2),
  RETRY_JITTER_FACTOR: z.coerce.number().min(0).max(1).default(0.25),
  RETRY_STUCK_MESSAGE_THRESHOLD_MS: z.coerce.number().int().min(60000).max(7200000).default(1800000),
  RETRY_STUCK_MESSAGE_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),

  // Circuit Breaker
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  CIRCUIT_BREAKER_HALF_OPEN_REQUESTS: z.coerce.number().int().min(1).max(10).default(3),

  // Dead Letter Queue
  DLQ_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  DLQ_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),

  // Queue Cleanup
  QUEUE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  QUEUE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(900000),
  QUEUE_STUCK_THRESHOLD_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),

  // Priority Escalation
  PRIORITY_ESCALATION_ENABLED: z.string().optional(),
  PRIORITY_ESCALATION_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),
  VIP_CHAT_IDS: z.string().optional(),
  VIP_USER_IDS: z.string().optional(),
  PRIORITY_CHAT_IDS: z.string().optional(),

  // Platform Selection
  TELEGRAM_ENABLED: z.string().optional(), // default 'true' for backward compat
  SLACK_ENABLED: z.string().optional(),

  // Slack Configuration
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_CHANNEL_ID: z.string().optional(),
  SLACK_TEST_USER_ID: z.string().optional(),
  CEO_MCP_CONFIG_PATH: z.string().optional(),

  // CEO Module Configuration
  CEO_ENABLED: z.string().optional(),
  CEO_SCHEDULED_ENABLED: z.string().optional(),
  CEO_MONITOR_ENABLED: z.string().optional(),
  CEO_RESPONSE_TIMEOUT_MS: z.coerce.number().int().min(30000).max(300000).default(120000),

  // Telegram Configuration
  API_ID: z.coerce.number().int().min(0).optional(),
  API_HASH: z.string().optional(),
  PHONE_NUMBER: z.string().optional(),
  SESSION_STRING: z.string().optional(),
  TELEGRAM_HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(15000),
  TELEGRAM_HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  TELEGRAM_STALE_THRESHOLD_MS: z.coerce.number().int().min(30000).max(600000).default(600000),
  TELEGRAM_PROACTIVE_REFRESH_MS: z.coerce.number().int().min(60000).max(3600000).default(600000),
  TELEGRAM_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(10),
  TELEGRAM_RECONNECT_BASE_DELAY_MS: z.coerce.number().int().min(100).max(30000).default(1000),
  TELEGRAM_RECONNECT_MAX_DELAY_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  TELEGRAM_KEEPALIVE_PING_INTERVAL_MS: z.coerce.number().int().min(5000).max(120000).default(20000),
  TELEGRAM_KEEPALIVE_PING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(15000),
  TELEGRAM_KEEPALIVE_FAILURES_THRESHOLD: z.coerce.number().int().min(1).max(10).default(2),
  TELEGRAM_OUTBOUND_QUEUE_MAX_SIZE: z.coerce.number().int().min(10).max(1000).default(100),
  TELEGRAM_OUTBOUND_QUEUE_FLUSH_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(30000),

  // LLM Configuration
  LLM_ENABLED: z.string().optional(),
  LLM_BASE_URL: z.string().url().default('http://localhost:11434'),
  LLM_MODEL: z.string().min(1).default('mistral-small:24b-instruct-2501-q4_K_M'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  LLM_MAX_TOKENS: z.coerce.number().int().min(1).max(100000).default(1024),
  LLM_EXTRACTION_MAX_TOKENS: z.coerce.number().int().min(1).max(100000).default(2048),
  LLM_HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),
  LLM_SKIP_ON_UNHEALTHY: z.string().optional(),
  LLM_KEEP_ALIVE: z.string().default('30m'),

  // Response Configuration
  RESPONSE_ENABLED: z.string().optional(),
  RESPONSE_CONTEXT_WINDOW_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  RESPONSE_SYSTEM_PROMPT: z.string().optional(),
  RESPONSE_TYPING_INDICATOR: z.string().optional(),
  RESPONSE_READ_RECEIPTS: z.string().optional(),
  RESPONSE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  RESPONSE_MAX_TOKENS: z.coerce.number().int().min(1).max(100000).default(512),
  MESSAGE_MAX_LENGTH: z.coerce.number().int().min(100).max(10000).default(4096),
  MESSAGE_TARGET_LENGTH: z.coerce.number().int().min(100).max(10000).default(3500),
  MESSAGE_SUMMARIZATION_ENABLED: z.string().optional(),
  MESSAGE_SUMMARIZATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  RESPONSE_FORCE_AGENTIC_MODE: z.string().optional(),

  // Search Configuration
  SEARCH_ENABLED: z.string().optional(),
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(5),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

  // Browser Configuration
  BROWSER_ENABLED: z.string().optional(),
  BROWSER_HEADLESS: z.string().optional(),
  BROWSER_CONTENT_MAX_LENGTH: z.coerce.number().int().min(1000).max(500000).optional(),
  BROWSER_FETCH_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).optional(),
  BROWSER_FETCH_TOP_N: z.coerce.number().int().min(0).max(10).optional(),
  BROWSER_MCP_ENABLED: z.string().optional(),
  BROWSER_MCP_CONFIG_PATH: z.string().optional(),

  // Tools Configuration
  TOOLS_ENABLED: z.string().optional(),
  TOOLS_MAX_ITERATIONS: z.coerce.number().int().min(1).max(20).default(3),
  TOOL_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(60000), // 60 seconds default for tool execution

  // Claude Configuration
  CLAUDE_ENABLED: z.string().optional(),
  CLAUDE_CLI_PATH: z.string().default('claude'),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  CLAUDE_MODEL: z.string().default('opus'),
  CLAUDE_SYSTEM_PROMPT: z.string().optional(),

  // Intent Classification
  INTENT_CLASSIFICATION_ENABLED: z.string().optional(),
  INTENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90000), // 90 seconds (1.5 minutes) for Ollama cold starts

  // Embedding Configuration
  EMBEDDING_ENABLED: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(4096).default(768),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

  // Whisper/Transcription Configuration
  WHISPER_ENABLED: z.string().optional(),
  WHISPER_BASE_URL: z.string().url().default('http://localhost:9000'),
  WHISPER_MODEL: z.string().default('base'),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  WHISPER_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  WHISPER_DEFAULT_LANGUAGE: z.string().default('en'),
  WHISPER_SKIP_ON_UNHEALTHY: z.string().optional(),

  // Memory Configuration
  MEMORY_ENABLED: z.string().optional(),
  MAX_MEMORIES_PER_SENDER: z.coerce.number().int().min(1).max(10000).default(100),
  MEMORY_ARCHIVE_AFTER_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  MEMORY_MIN_CONFIDENCE: z.coerce.number().int().min(0).max(100).default(30),

  // RAG Configuration
  RAG_ENABLED: z.string().optional(),
  RAG_TOP_K: z.coerce.number().int().min(1).max(100).default(10),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  RAG_RECENCY_DECAY_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
  RAG_MAX_CONTEXT_TOKENS: z.coerce.number().int().min(100).max(100000).default(2000),
  RAG_RECENT_MESSAGES_COUNT: z.coerce.number().int().min(1).max(50).default(5),

  // Cache Configuration
  CACHE_ENABLED: z.string().optional(),
  CACHE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(100).max(1000000).default(5000),
  CACHE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),
  CACHE_TTL_GREETING_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  CACHE_TTL_FACTUAL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  CACHE_TTL_PERSONAL_HOURS: z.coerce.number().int().min(1).max(720).default(720),
  CACHE_TTL_DEFAULT_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  // Metrics Configuration
  METRICS_ENABLED: z.string().optional(),
  METRICS_FLUSH_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  METRICS_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  METRICS_AGGREGATION_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),

  // Alerting Configuration
  ALERTING_ENABLED: z.string().optional(),
  ALERTING_CHECK_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),
  ALERTING_WINDOW_MS: z.coerce.number().int().min(60000).max(3600000).default(300000),
  ALERTING_COOLDOWN_MS: z.coerce.number().int().min(60000).max(7200000).default(900000),

  // Performance Monitoring
  PERF_MEMORY_MONITORING_ENABLED: z.string().optional(),
  PERF_MEMORY_WARNING_THRESHOLD: z.coerce.number().int().min(50).max(99).default(95),
  PERF_MEMORY_CRITICAL_THRESHOLD: z.coerce.number().int().min(51).max(100).default(98),
  PERF_MEMORY_CHECK_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),

  // API Authentication
  AUTH_ENABLED: z.string().optional(),
  AUTH_MODE: z.enum(['jwt', 'api-key', 'both']).default('jwt'),
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
  JWT_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
  API_KEYS: z.string().optional(),

  // CORS
  CORS_ENABLED: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional(),

  // Proxy
  TRUST_PROXY: z.string().optional(),
  TRUSTED_PROXIES: z.string().optional(),

  // Owner Access Control
  OWNER_TELEGRAM_ID: z.string().optional(),

  // Security Configuration
  SECURITY_ENABLED: z.string().optional(),
  ENCRYPTION_ENABLED: z.string().optional(),
  ENCRYPTION_ALGORITHM: z.enum(['AES-256-GCM', 'AES-256-CBC', 'CHACHA20-POLY1305']).default('AES-256-GCM'),
  KEY_DERIVATION: z.enum(['argon2id', 'pbkdf2', 'scrypt']).default('argon2id'),
  PII_DETECTION_ENABLED: z.string().optional(),
  PII_REDACTION_ENABLED: z.string().optional(),
  PII_REDACT_LOGS: z.string().optional(),
  PII_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  MEMORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(180),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CACHE_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(365),
  SECURITY_AUDIT_ENABLED: z.string().optional(),
  AUDIT_LOG_DATA_ACCESS: z.string().optional(),
  AUDIT_LOG_PII: z.string().optional(),
  AUDIT_LOG_CONFIG: z.string().optional(),
  GDPR_ENABLED: z.string().optional(),
  GDPR_ALLOW_EXPORT: z.string().optional(),
  GDPR_ALLOW_DELETION: z.string().optional(),
  GDPR_DATA_MINIMIZATION: z.string().optional(),

  // Proactive Messaging Configuration
  PROACTIVE_ENABLED: z.string().optional(),
  PROACTIVE_TIMEZONE: z.string().default('UTC'),
  PROACTIVE_MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(10).default(1),
  PROACTIVE_STUCK_JOB_THRESHOLD_MS: z.coerce.number().int().min(60000).max(86400000).default(7200000),
  PROACTIVE_DEFAULT_CONTEXT_MESSAGES: z.coerce.number().int().min(0).max(50).default(5),
  PROACTIVE_QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(22),
  PROACTIVE_QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(8),
  PROACTIVE_RESPECT_QUIET_HOURS: z.string().optional(),
  PROACTIVE_TARGET_CHAT_ID: z.string().optional(),
  PROACTIVE_WORKER_INTERVAL_MS: z.coerce.number().int().min(10000).max(600000).default(60000),
  PROACTIVE_RUN_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Apple Calendar (CalDAV) Configuration
  CALENDAR_ENABLED: z.string().optional(),
  CALENDAR_CALDAV_URL: z.string().default('https://caldav.icloud.com'),
  CALENDAR_APPLE_ID: z.string().optional(),
  CALENDAR_APP_PASSWORD: z.string().optional(),
  CALENDAR_NAME: z.string().optional(),
  CALENDAR_TIMEZONE: z.string().optional(),

  // PM2 Monitoring Configuration
  PM2_RESTART_WARNING_THRESHOLD: z.coerce.number().int().min(1).max(50).default(10),
  PM2_RESTART_CRITICAL_THRESHOLD: z.coerce.number().int().min(1).max(50).default(20),
  PM2_CHECK_INTERVAL_MS: z.coerce.number().int().min(60000).max(600000).default(300000),
  PM2_BIN: z.string().optional(), // Absolute path to the pm2 binary; auto-resolved from process.execPath if unset

  // Ollama Concurrency Configuration
  OLLAMA_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(2),

  // Loop Detection Configuration
  LOOP_DETECTION_ENABLED: z.string().optional(),

  // Therapist/Listener Mode Configuration
  THERAPIST_ENABLED: z.string().optional(),
  THERAPIST_AUTO_DETECT: z.string().optional(),
  THERAPIST_REQUIRES_CONSENT: z.string().optional(),
  THERAPIST_EMOTIONAL_ANALYSIS: z.string().optional(),
  THERAPIST_MIN_MESSAGES_BEFORE_INTERVENTION: z.coerce.number().int().min(1).max(50).default(3),
  THERAPIST_MAX_RESPONSES_PER_HOUR: z.coerce.number().int().min(1).max(20).default(2),
  THERAPIST_RESPONSE_COOLDOWN_MS: z.coerce.number().int().min(60000).max(3600000).default(600000), // 10 min
  THERAPIST_MENTION_HANDLES: z.string().optional(), // comma-separated bot handles that force a response when @mentioned

}).superRefine((data, ctx) => {
  // Cross-field validation

  // Memory thresholds must be ordered correctly
  if (data.PERF_MEMORY_WARNING_THRESHOLD >= data.PERF_MEMORY_CRITICAL_THRESHOLD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PERF_MEMORY_WARNING_THRESHOLD must be less than PERF_MEMORY_CRITICAL_THRESHOLD',
      path: ['PERF_MEMORY_WARNING_THRESHOLD'],
    });
  }

  // Retry delays must be ordered correctly
  if (data.RETRY_BASE_DELAY_MS >= data.RETRY_MAX_DELAY_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RETRY_BASE_DELAY_MS must be less than RETRY_MAX_DELAY_MS',
      path: ['RETRY_BASE_DELAY_MS'],
    });
  }

  // Telegram reconnect delays must be ordered correctly
  if (data.TELEGRAM_RECONNECT_BASE_DELAY_MS >= data.TELEGRAM_RECONNECT_MAX_DELAY_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TELEGRAM_RECONNECT_BASE_DELAY_MS must be less than TELEGRAM_RECONNECT_MAX_DELAY_MS',
      path: ['TELEGRAM_RECONNECT_BASE_DELAY_MS'],
    });
  }

  // Message target length should be less than max length
  if (data.MESSAGE_TARGET_LENGTH > data.MESSAGE_MAX_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MESSAGE_TARGET_LENGTH must be less than or equal to MESSAGE_MAX_LENGTH',
      path: ['MESSAGE_TARGET_LENGTH'],
    });
  }

  // Require JWT_SECRET when auth is enabled with JWT mode
  if (data.AUTH_ENABLED === 'true' && (data.AUTH_MODE === 'jwt' || data.AUTH_MODE === 'both')) {
    if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_SECRET must be at least 32 characters when JWT auth is enabled',
        path: ['JWT_SECRET'],
      });
    }
  }

  // Require Telegram credentials in production (only when Telegram is enabled)
  const telegramEnabled = data.TELEGRAM_ENABLED !== 'false';
  if (data.NODE_ENV === 'production' && telegramEnabled) {
    if (!data.API_ID || data.API_ID === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API_ID is required in production when Telegram is enabled',
        path: ['API_ID'],
      });
    }
    if (!data.API_HASH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API_HASH is required in production when Telegram is enabled',
        path: ['API_HASH'],
      });
    }
  }

  // Require Slack tokens when Slack is enabled
  if (data.SLACK_ENABLED === 'true') {
    if (!data.SLACK_BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLACK_BOT_TOKEN is required when Slack is enabled',
        path: ['SLACK_BOT_TOKEN'],
      });
    }
    if (!data.SLACK_APP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLACK_APP_TOKEN is required when Slack is enabled',
        path: ['SLACK_APP_TOKEN'],
      });
    }
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables
 * Throws descriptive error if validation fails
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path}: ${issue.message}`;
    });

    console.error('\n========================================');
    console.error('Environment variable validation failed:');
    console.error('========================================');
    errors.forEach(e => console.error(e));
    console.error('========================================\n');

    throw new Error(`Environment variable validation failed:\n${errors.join('\n')}`);
  }

  return result.data;
}

/**
 * Validate environment variables with warnings instead of errors
 * Use this for non-critical validation during development
 */
export function validateEnvWithWarnings(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.warn('\n[Config] Environment variable warnings:');
    result.error.issues.forEach((issue) => {
      console.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    console.warn('Using defaults where possible.\n');
  }

  // Return parsed data (will use defaults for missing fields)
  // For truly invalid values, this will still throw
  return envSchema.parse(process.env);
}
