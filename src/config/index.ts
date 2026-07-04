import { config } from 'dotenv';
import path from 'path';
import { validateConfig, type AppConfig } from './schema.js';
import { ConfigParsers } from '../utils/config-validation.js';
import { validateEnv } from './env-schema.js';

config();

// Validate environment variables at startup (before building config)
// This provides early detection of invalid env vars with clear error messages
validateEnv();

// Data directory: configurable via DATA_DIR env var, defaults to 'data' in cwd
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Build raw config object from environment variables
const rawConfig = {
  // Database
  database: {
    path: path.join(dataDir, 'jarvis.db'),
  },

  // Media storage
  media: {
    basePath: path.join(dataDir, 'media'),
    paths: {
      photos: path.join(dataDir, 'media', 'photos'),
      documents: path.join(dataDir, 'media', 'documents'),
      voice: path.join(dataDir, 'media', 'voice'),
      video: path.join(dataDir, 'media', 'video'),
    },
  },

  // Retry settings
  retry: {
    maxAttempts: ConfigParsers.retryAttempts(process.env.RETRY_MAX_ATTEMPTS, 5),
    retryIntervalMs: ConfigParsers.timeout(process.env.RETRY_INTERVAL_MS, 60000), // 60 seconds
    baseDelayMs: ConfigParsers.positiveInt(process.env.RETRY_BASE_DELAY_MS, 1000), // 1 second
    maxDelayMs: ConfigParsers.timeout(process.env.RETRY_MAX_DELAY_MS, 300000), // 5 minutes
    backoffMultiplier: ConfigParsers.backoffMultiplier(process.env.RETRY_BACKOFF_MULTIPLIER, 2),
    jitterFactor: ConfigParsers.jitterFactor(process.env.RETRY_JITTER_FACTOR, 0.25),
    stuckMessageThresholdMs: ConfigParsers.timeout(process.env.RETRY_STUCK_MESSAGE_THRESHOLD_MS, 1800000), // 30 minutes - messages stuck in 'processing' longer than this are recovered for retry
    stuckMessageMaxRetries: ConfigParsers.retryAttempts(process.env.RETRY_STUCK_MESSAGE_MAX_RETRIES, 3), // Max retries for stuck messages (lower than normal 5)
  },

  // Circuit Breaker settings
  circuitBreaker: {
    failureThreshold: ConfigParsers.positiveInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5),
    resetTimeoutMs: ConfigParsers.timeout(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS, 30000), // 30 seconds
    halfOpenRequests: ConfigParsers.positiveInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_REQUESTS, 3),
  },

  // Dead Letter Queue settings
  deadLetterQueue: {
    retentionDays: ConfigParsers.retentionDays(process.env.DLQ_RETENTION_DAYS, 7),
    cleanupIntervalMs: ConfigParsers.timeout(process.env.DLQ_CLEANUP_INTERVAL_MS, 3600000), // 1 hour
  },

  // Queue Cleanup settings
  queueCleanup: {
    retentionDays: ConfigParsers.retentionDays(process.env.QUEUE_RETENTION_DAYS, 7),
    cleanupIntervalMs: ConfigParsers.timeout(process.env.QUEUE_CLEANUP_INTERVAL_MS, 900000), // 15 minutes (more frequent for stuck detection)
    stuckThresholdMs: ConfigParsers.timeout(process.env.QUEUE_STUCK_THRESHOLD_MS, 3600000), // 1 hour - messages in 'processing' longer than this are stuck
  },

  // Priority Escalation settings
  priorityEscalation: {
    enabled: process.env.PRIORITY_ESCALATION_ENABLED !== 'false',
    checkIntervalMs: ConfigParsers.timeout(process.env.PRIORITY_ESCALATION_INTERVAL_MS, 60000), // 1 minute
    // VIP chat/user IDs that get highest priority
    vipChatIds: process.env.VIP_CHAT_IDS
      ? process.env.VIP_CHAT_IDS.split(',').map((id) => id.trim())
      : [],
    vipUserIds: process.env.VIP_USER_IDS
      ? process.env.VIP_USER_IDS.split(',').map((id) => id.trim())
      : [],
  },

  // Slack configuration
  slack: {
    enabled: process.env.SLACK_ENABLED === 'true',
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    channelId: process.env.SLACK_CHANNEL_ID || '',
    testUserId: process.env.SLACK_TEST_USER_ID || '',
    ceoMcpConfigPath: process.env.CEO_MCP_CONFIG_PATH || '',
  },

  // CEO Module configuration
  ceo: {
    enabled: process.env.CEO_ENABLED === 'true' || (process.env.SLACK_ENABLED === 'true' && !!process.env.CEO_MCP_CONFIG_PATH),
    mcpConfigPath: process.env.CEO_MCP_CONFIG_PATH || '',
    scheduledEnabled: process.env.CEO_SCHEDULED_ENABLED !== 'false',
    monitorEnabled: process.env.CEO_MONITOR_ENABLED !== 'false',
    responseTimeoutMs: ConfigParsers.timeout(process.env.CEO_RESPONSE_TIMEOUT_MS, 120000), // 2 minutes default
  },

  // Telegram credentials and connection settings
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED !== 'false',
    apiId: ConfigParsers.nonNegativeInt(process.env.API_ID, 0),
    apiHash: process.env.API_HASH || '',
    phoneNumber: process.env.PHONE_NUMBER || '',
    sessionString: process.env.SESSION_STRING || '',
    // Connection stability settings (configurable via env)
    healthCheckIntervalMs: ConfigParsers.timeout(process.env.TELEGRAM_HEALTH_CHECK_INTERVAL_MS, 15000),
    healthCheckTimeoutMs: ConfigParsers.timeout(process.env.TELEGRAM_HEALTH_CHECK_TIMEOUT_MS, 10000),
    staleUpdateThresholdMs: ConfigParsers.timeout(process.env.TELEGRAM_STALE_THRESHOLD_MS, 300000), // 5 min to avoid reconnect loops during idle
    proactiveRefreshIntervalMs: ConfigParsers.timeout(process.env.TELEGRAM_PROACTIVE_REFRESH_MS, 600000), // 10 minutes
    maxReconnectAttempts: ConfigParsers.retryAttempts(process.env.TELEGRAM_MAX_RECONNECT_ATTEMPTS, 10),
    reconnectBaseDelayMs: ConfigParsers.positiveInt(process.env.TELEGRAM_RECONNECT_BASE_DELAY_MS, 1000),
    reconnectMaxDelayMs: ConfigParsers.timeout(process.env.TELEGRAM_RECONNECT_MAX_DELAY_MS, 60000),
    // Keepalive ping settings for faster dead connection detection
    keepalivePingIntervalMs: ConfigParsers.timeout(process.env.TELEGRAM_KEEPALIVE_PING_INTERVAL_MS, 30000),
    keepalivePingTimeoutMs: ConfigParsers.timeout(process.env.TELEGRAM_KEEPALIVE_PING_TIMEOUT_MS, 5000),
    keepaliveFailuresBeforeReconnect: ConfigParsers.positiveInt(process.env.TELEGRAM_KEEPALIVE_FAILURES_THRESHOLD, 2),
    // Outbound message queue settings
    outboundQueueMaxSize: ConfigParsers.positiveInt(process.env.TELEGRAM_OUTBOUND_QUEUE_MAX_SIZE, 100),
    outboundQueueFlushTimeoutMs: ConfigParsers.timeout(process.env.TELEGRAM_OUTBOUND_QUEUE_FLUSH_TIMEOUT_MS, 30000),
    // Watchdog settings (heals the zombie-connection state)
    watchdogEnabled: process.env.TELEGRAM_WATCHDOG_ENABLED !== 'false',
    watchdogIntervalMs: ConfigParsers.timeout(process.env.TELEGRAM_WATCHDOG_INTERVAL_MS, 60000),
    watchdogRestartAfterDownMs: ConfigParsers.timeout(process.env.TELEGRAM_WATCHDOG_RESTART_AFTER_DOWN_MS, 600000),
    watchdogRestartEscalationEnabled: process.env.TELEGRAM_WATCHDOG_RESTART_ESCALATION_ENABLED !== 'false',
  },

  // Priority chat IDs (comma-separated in env)
  priority: {
    chatIds: process.env.PRIORITY_CHAT_IDS
      ? process.env.PRIORITY_CHAT_IDS.split(',').map((id) => id.trim())
      : [],
  },

  // LLM Configuration (Ollama)
  llm: {
    enabled: process.env.LLM_ENABLED === 'true',
    baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434',
    model: process.env.LLM_MODEL || 'mistral-small:24b-instruct-2501-q4_K_M',
    timeoutMs: ConfigParsers.timeout(process.env.LLM_TIMEOUT_MS, 60000),
    maxRetries: ConfigParsers.retryAttempts(process.env.LLM_MAX_RETRIES, 2),
    temperature: ConfigParsers.temperature(process.env.LLM_TEMPERATURE, 0.3),
    maxTokens: ConfigParsers.maxTokens(process.env.LLM_MAX_TOKENS, 1024),
    extractionMaxTokens: ConfigParsers.maxTokens(process.env.LLM_EXTRACTION_MAX_TOKENS, 2048),
    healthCheckIntervalMs: ConfigParsers.timeout(process.env.LLM_HEALTH_CHECK_INTERVAL_MS, 60000),
    skipOnUnhealthy: process.env.LLM_SKIP_ON_UNHEALTHY !== 'false',
    keepAlive: process.env.LLM_KEEP_ALIVE || '30m',
  },

  // AI Response Configuration
  response: {
    enabled: process.env.RESPONSE_ENABLED === 'true',
    contextWindowSize: ConfigParsers.positiveInt(process.env.RESPONSE_CONTEXT_WINDOW_SIZE, 10, 100),
    systemPrompt: process.env.RESPONSE_SYSTEM_PROMPT ||
      `You're Jarvis, a chill and knowledgeable friend. Keep it casual and conversational, but not over the top. Be helpful without being formal. Short and natural responses.

You have full access to the local machine - you can read/write files, execute shell commands, browse the filesystem, and interact with system services. When asked to do something on the machine, just do it.

CRITICAL: You are a Telegram bot ONLY. You can send messages to Telegram users. You CANNOT send SMS messages. When messaging capabilities come up:
- If asked to "send a message", "send to someone", "tell X something": Use Telegram's messaging API
- NEVER mention SMS or text messaging capabilities - users may think you can SMS when you cannot
- If the user corrects you about SMS, acknowledge: "You're right, I can only send Telegram messages"
- If sending to a phone number: The user is asking you to send a Telegram message to that contact

IMPORTANT: Keep responses under 3500 characters for Telegram delivery.`,
    typingIndicator: process.env.RESPONSE_TYPING_INDICATOR !== 'false',
    readReceipts: process.env.RESPONSE_READ_RECEIPTS !== 'false',
    temperature: ConfigParsers.temperature(process.env.RESPONSE_TEMPERATURE, 0.7),
    maxTokens: ConfigParsers.maxTokens(process.env.RESPONSE_MAX_TOKENS, 512),
    // Message length handling
    maxLength: ConfigParsers.positiveInt(process.env.MESSAGE_MAX_LENGTH, 4096),
    targetLength: ConfigParsers.positiveInt(process.env.MESSAGE_TARGET_LENGTH, 3500),
    summarizationEnabled: process.env.MESSAGE_SUMMARIZATION_ENABLED !== 'false',
    summarizationTimeoutMs: ConfigParsers.timeout(process.env.MESSAGE_SUMMARIZATION_TIMEOUT_MS, 10000),
    forceAgenticMode: process.env.RESPONSE_FORCE_AGENTIC_MODE === 'true',
  },

  // Web Search Configuration
  search: {
    enabled: process.env.SEARCH_ENABLED !== 'false',
    maxResults: ConfigParsers.positiveInt(process.env.SEARCH_MAX_RESULTS, 5, 20),
    timeoutMs: ConfigParsers.timeout(process.env.SEARCH_TIMEOUT_MS, 10000),
  },

  // Browser Configuration
  browser: {
    enabled: process.env.BROWSER_ENABLED === 'true',
    headless: process.env.BROWSER_HEADLESS !== 'false',
    contentMaxLength: ConfigParsers.positiveInt(process.env.BROWSER_CONTENT_MAX_LENGTH, 50000, 500000),
    fetchTimeoutMs: ConfigParsers.timeout(process.env.BROWSER_FETCH_TIMEOUT_MS, 30000),
    fetchTopN: ConfigParsers.positiveInt(process.env.BROWSER_FETCH_TOP_N, 3, 10),
    mcpEnabled: process.env.BROWSER_MCP_ENABLED === 'true',
    mcpConfigPath: process.env.BROWSER_MCP_CONFIG_PATH || '',
  },

  // Tool Configuration
  tools: {
    enabled: process.env.TOOLS_ENABLED !== 'false',
    maxIterations: ConfigParsers.positiveInt(process.env.TOOLS_MAX_ITERATIONS, 3, 10),
    timeoutMs: ConfigParsers.timeout(process.env.TOOL_TIMEOUT_MS, 60000),
  },

  // Claude Configuration (Claude Code CLI)
  claude: {
    enabled: process.env.CLAUDE_ENABLED === 'true',
    cliPath: process.env.CLAUDE_CLI_PATH || 'claude',
    timeoutMs: ConfigParsers.timeout(process.env.CLAUDE_TIMEOUT_MS, 60000),
    model: process.env.CLAUDE_MODEL || 'opus',
    systemPrompt:
      process.env.CLAUDE_SYSTEM_PROMPT ||
      `You're Jarvis, a chill and knowledgeable friend. Keep it casual and conversational, but not over the top. Be helpful without being formal. Short and natural responses.

You have full access to the local machine - you can read/write files, execute shell commands, browse the filesystem, and interact with system services. When asked to do something on the machine, just do it.

CRITICAL RULES:
- Stay in character as Jarvis the assistant at all times
- Never mention internal systems, databases, memory storage, Telegram bots, or technical implementation details
- When someone shares personal info (like their name, hobbies, interests), engage naturally and show genuine interest
- For personal sharing: acknowledge what they said, maybe ask a follow-up question
- You are a Telegram bot ONLY. You can send messages to Telegram users. You CANNOT send SMS messages.
- NEVER mention SMS or text messaging capabilities - users may think you can SMS when you cannot
- If user corrects you about SMS, acknowledge: "You're right, I can only send Telegram messages"
- If sending to a phone number: The user is asking you to send a Telegram message to that contact
- Keep responses under 3500 characters`,
  },

  // Intent Classification Configuration
  intentClassification: {
    enabled: process.env.INTENT_CLASSIFICATION_ENABLED !== 'false',
    timeoutMs: ConfigParsers.timeout(process.env.INTENT_TIMEOUT_MS, 90000), // 90 seconds (1.5 minutes) for Ollama cold starts and concurrent requests
    temperature: 0.1, // Low for consistent classification
  },

  // Embedding Configuration (for semantic memory)
  embedding: {
    enabled: process.env.EMBEDDING_ENABLED === 'true',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    dimensions: ConfigParsers.positiveInt(process.env.EMBEDDING_DIMENSIONS, 768),
    timeoutMs: ConfigParsers.timeout(process.env.EMBEDDING_TIMEOUT_MS, 10000),
  },

  // Whisper/Transcription Configuration
  // Uses whisper-asr-webservice (ARM64 compatible): https://github.com/ahmetoner/whisper-asr-webservice
  whisper: {
    enabled: process.env.WHISPER_ENABLED === 'true',
    baseUrl: process.env.WHISPER_BASE_URL || 'http://localhost:9000',
    model: process.env.WHISPER_MODEL || 'base', // tiny, base, small, medium, large-v2
    timeoutMs: ConfigParsers.timeout(process.env.WHISPER_TIMEOUT_MS, 60000),
    maxAudioDurationSeconds: ConfigParsers.positiveInt(process.env.WHISPER_MAX_DURATION_SECONDS, 300, 3600),
    defaultLanguage: process.env.WHISPER_DEFAULT_LANGUAGE || 'en',
    skipOnUnhealthy: process.env.WHISPER_SKIP_ON_UNHEALTHY !== 'false',
  },

  // Memory Configuration
  memory: {
    enabled: process.env.MEMORY_ENABLED === 'true',
    maxMemoriesPerSender: ConfigParsers.positiveInt(process.env.MAX_MEMORIES_PER_SENDER, 100, 10000),
    archiveAfterDays: ConfigParsers.retentionDays(process.env.MEMORY_ARCHIVE_AFTER_DAYS, 90),
    minConfidence: ConfigParsers.percentage(process.env.MEMORY_MIN_CONFIDENCE, 50),
  },

  // RAG Configuration
  rag: {
    enabled: process.env.RAG_ENABLED === 'true',
    topK: ConfigParsers.positiveInt(process.env.RAG_TOP_K, 10, 100),
    similarityThreshold: ConfigParsers.similarityThreshold(process.env.RAG_SIMILARITY_THRESHOLD, 0.7),
    recencyDecayHours: ConfigParsers.positiveInt(process.env.RAG_RECENCY_DECAY_HOURS, 168),
    maxContextTokens: ConfigParsers.maxTokens(process.env.RAG_MAX_CONTEXT_TOKENS, 2000),
    recentMessagesCount: ConfigParsers.positiveInt(process.env.RAG_RECENT_MESSAGES_COUNT, 5, 50),
  },

  // Semantic Cache Configuration
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    similarityThreshold: ConfigParsers.similarityThreshold(process.env.CACHE_SIMILARITY_THRESHOLD, 0.85),
    maxEntries: ConfigParsers.positiveInt(process.env.CACHE_MAX_ENTRIES, 10000, 100000),
    cleanupIntervalMs: ConfigParsers.timeout(process.env.CACHE_CLEANUP_INTERVAL_MS, 3600000), // 1 hour
    // TTL in hours for different intent types
    ttl: {
      simpleGreeting: ConfigParsers.positiveInt(process.env.CACHE_TTL_GREETING_HOURS, 24),
      factualQuestion: ConfigParsers.positiveInt(process.env.CACHE_TTL_FACTUAL_HOURS, 168), // 7 days
      personalQuestion: ConfigParsers.positiveInt(process.env.CACHE_TTL_PERSONAL_HOURS, 720), // 30 days
      default: ConfigParsers.positiveInt(process.env.CACHE_TTL_DEFAULT_HOURS, 24),
    },
    // Intents that are eligible for caching
    // Note: personal_question excluded - context-dependent (e.g., "What's my name?")
    // Note: follow_up, elaboration_request excluded - require conversation context
    cacheableIntents: [
      'simple_greeting',
      'time_greeting',
      'farewell',
      'gratitude',
      'factual_question',
      'acknowledgment',      // "ok", "got it" - generic responses
      'positive_feedback',   // "great!", "thanks!" - can use similar responses
      'calculation',         // math results are deterministic
      'how_to_question',     // generic "how to" answers can be cached
    ],
  },

  // Metrics Configuration
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    flushIntervalMs: ConfigParsers.timeout(process.env.METRICS_FLUSH_INTERVAL_MS, 5000),
    retentionDays: ConfigParsers.retentionDays(process.env.METRICS_RETENTION_DAYS, 30),
    aggregationIntervalMs: ConfigParsers.timeout(process.env.METRICS_AGGREGATION_INTERVAL_MS, 60000),
  },

  // Alerting Configuration
  alerting: {
    enabled: process.env.ALERTING_ENABLED !== 'false',
    checkIntervalMs: ConfigParsers.timeout(process.env.ALERTING_CHECK_INTERVAL_MS, 60000),
    defaultWindowMs: ConfigParsers.timeout(process.env.ALERTING_WINDOW_MS, 300000), // 5 minutes
    defaultCooldownMs: ConfigParsers.timeout(process.env.ALERTING_COOLDOWN_MS, 900000), // 15 minutes
  },

  // Performance Monitoring Configuration
  performance: {
    memoryMonitoringEnabled: process.env.PERF_MEMORY_MONITORING_ENABLED !== 'false',
    memoryWarningThreshold: ConfigParsers.percentage(process.env.PERF_MEMORY_WARNING_THRESHOLD, 92),
    memoryCriticalThreshold: ConfigParsers.percentage(process.env.PERF_MEMORY_CRITICAL_THRESHOLD, 95),
    memoryCheckIntervalMs: ConfigParsers.timeout(process.env.PERF_MEMORY_CHECK_INTERVAL_MS, 60000),
  },

  // API Authentication Configuration
  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    mode: (process.env.AUTH_MODE || 'jwt') as 'jwt' | 'api-key' | 'both',
    jwt: {
      secret: process.env.JWT_SECRET || '',
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expirySeconds: ConfigParsers.positiveInt(process.env.JWT_EXPIRY_SECONDS, 3600),
      clockToleranceSeconds: ConfigParsers.nonNegativeInt(process.env.JWT_CLOCK_TOLERANCE_SECONDS, 60),
    },
    apiKey: {
      keysString: process.env.API_KEYS || '',
    },
  },

  // CORS Configuration
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
      : process.env.NODE_ENV === 'production'
        ? [] // Production: require explicit origins
        : ['*'], // Development: allow all by default
    allowCredentials: process.env.CORS_ALLOW_CREDENTIALS === 'true',
  },

  // Proxy Trust Configuration
  proxy: {
    trustProxy: process.env.TRUST_PROXY === 'true',
    trustedProxies: process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(',').map((p) => p.trim())
      : [],
  },

  // Security Configuration
  security: {
    enabled: process.env.SECURITY_ENABLED !== 'false',
    ownerTelegramId: process.env.OWNER_TELEGRAM_ID || undefined,
    encryption: {
      enabled: process.env.ENCRYPTION_ENABLED === 'true',
      algorithm: (process.env.ENCRYPTION_ALGORITHM || 'AES-256-GCM') as 'AES-256-GCM' | 'AES-256-CBC' | 'CHACHA20-POLY1305',
      keyDerivation: (process.env.KEY_DERIVATION || 'argon2id') as 'argon2id' | 'pbkdf2' | 'scrypt',
    },
    pii: {
      detectionEnabled: process.env.PII_DETECTION_ENABLED !== 'false',
      redactionEnabled: process.env.PII_REDACTION_ENABLED !== 'false',
      redactInLogs: process.env.PII_REDACT_LOGS !== 'false',
      minConfidence: ConfigParsers.similarityThreshold(process.env.PII_MIN_CONFIDENCE, 0.8),
    },
    retention: {
      messageRetentionDays: ConfigParsers.retentionDays(process.env.MESSAGE_RETENTION_DAYS, 90),
      memoryRetentionDays: ConfigParsers.retentionDays(process.env.MEMORY_RETENTION_DAYS, 180),
      mediaRetentionDays: ConfigParsers.retentionDays(process.env.MEDIA_RETENTION_DAYS, 30),
      cacheRetentionDays: ConfigParsers.retentionDays(process.env.CACHE_RETENTION_DAYS, 7),
      metricsRetentionDays: ConfigParsers.retentionDays(process.env.METRICS_RETENTION_DAYS, 30),
      auditLogRetentionDays: ConfigParsers.retentionDays(process.env.AUDIT_LOG_RETENTION_DAYS, 365),
    },
    audit: {
      enabled: process.env.SECURITY_AUDIT_ENABLED !== 'false',
      logDataAccess: process.env.AUDIT_LOG_DATA_ACCESS !== 'false',
      logPiiDetection: process.env.AUDIT_LOG_PII !== 'false',
      logConfigChanges: process.env.AUDIT_LOG_CONFIG !== 'false',
    },
    gdpr: {
      enabled: process.env.GDPR_ENABLED !== 'false',
      allowDataExport: process.env.GDPR_ALLOW_EXPORT !== 'false',
      allowDataDeletion: process.env.GDPR_ALLOW_DELETION !== 'false',
      dataMinimization: process.env.GDPR_DATA_MINIMIZATION === 'true',
    },
  },

  // Proactive Messaging Configuration
  proactive: {
    enabled: process.env.PROACTIVE_ENABLED === 'true',
    defaultTimezone: process.env.PROACTIVE_TIMEZONE || 'UTC',
    maxConcurrentJobs: ConfigParsers.positiveInt(process.env.PROACTIVE_MAX_CONCURRENT_JOBS, 1, 10),
    stuckJobThresholdMs: ConfigParsers.timeout(process.env.PROACTIVE_STUCK_JOB_THRESHOLD_MS, 7200000), // 2 hours
    defaultContextMessages: ConfigParsers.positiveInt(process.env.PROACTIVE_DEFAULT_CONTEXT_MESSAGES, 5, 50),
    quietHoursStart: ConfigParsers.nonNegativeInt(process.env.PROACTIVE_QUIET_HOURS_START, 22),
    quietHoursEnd: ConfigParsers.nonNegativeInt(process.env.PROACTIVE_QUIET_HOURS_END, 8),
    respectQuietHours: process.env.PROACTIVE_RESPECT_QUIET_HOURS !== 'false',
    targetChatId: process.env.PROACTIVE_TARGET_CHAT_ID,
    workerIntervalMs: ConfigParsers.timeout(process.env.PROACTIVE_WORKER_INTERVAL_MS, 60000), // 60 seconds
    runHistoryRetentionDays: ConfigParsers.retentionDays(process.env.PROACTIVE_RUN_HISTORY_RETENTION_DAYS, 30),
  },

  // Apple Calendar (CalDAV) Configuration
  calendar: {
    enabled: process.env.CALENDAR_ENABLED === 'true',
    caldavUrl: process.env.CALENDAR_CALDAV_URL || 'https://caldav.icloud.com',
    appleId: process.env.CALENDAR_APPLE_ID || '',
    appPassword: process.env.CALENDAR_APP_PASSWORD || '',
    calendarName: process.env.CALENDAR_NAME || '',
    // Falls back to the proactive timezone so relative dates resolve consistently.
    timezone: process.env.CALENDAR_TIMEZONE || process.env.PROACTIVE_TIMEZONE || 'UTC',
  },

  // Loop Detection Configuration
  loopDetection: {
    enabled: process.env.LOOP_DETECTION_ENABLED !== 'false',
  },

  // Therapist/Listener Mode Configuration
  therapist: {
    enabled: process.env.THERAPIST_ENABLED === 'true',
    autoDetect: process.env.THERAPIST_AUTO_DETECT !== 'false',
    requiresConsent: process.env.THERAPIST_REQUIRES_CONSENT !== 'false',
    emotionalAnalysis: process.env.THERAPIST_EMOTIONAL_ANALYSIS !== 'false',
    minMessagesBeforeIntervention: ConfigParsers.positiveInt(process.env.THERAPIST_MIN_MESSAGES_BEFORE_INTERVENTION, 3, 50),
    maxResponsesPerHour: ConfigParsers.positiveInt(process.env.THERAPIST_MAX_RESPONSES_PER_HOUR, 2, 20),
    responseCooldownMs: ConfigParsers.timeout(process.env.THERAPIST_RESPONSE_COOLDOWN_MS, 600000), // 10 minutes
    // Claude model for therapeutic responses; falls back to the default Claude model.
    model: process.env.THERAPIST_MODEL || process.env.CLAUDE_MODEL || 'opus',
    // Bot handles that force a therapist response when @mentioned in a dyad chat.
    mentionHandles: (process.env.THERAPIST_MENTION_HANDLES || 'jarvis,jarvis_1337')
      .split(',')
      .map(h => h.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  },

  // PM2 Monitoring Configuration
  pm2: {
    restartWarningThreshold: ConfigParsers.positiveInt(process.env.PM2_RESTART_WARNING_THRESHOLD, 50, 500), // Increased from 10 to 50 for Telegram TIMEOUT tolerance
    restartCriticalThreshold: ConfigParsers.positiveInt(process.env.PM2_RESTART_CRITICAL_THRESHOLD, 100, 1000), // Increased from 20 to 100
    restartRateThresholdPerHour: ConfigParsers.positiveInt(process.env.PM2_RESTART_RATE_THRESHOLD_PER_HOUR, 30, 300), // Increased from 10 to 30 for Telegram TIMEOUT tolerance
    checkIntervalMs: ConfigParsers.timeout(process.env.PM2_CHECK_INTERVAL_MS, 300000),
  },
};

// Validate configuration at module load time
// This will throw a clear error message if validation fails
export const appConfig: AppConfig = validateConfig(rawConfig);

// Re-export the type for use elsewhere
export type { AppConfig } from './schema.js';

// Export runtime config manager for runtime configuration updates
import RuntimeConfigManager from './runtime-config.js';
export const runtimeConfig = new RuntimeConfigManager(appConfig);

// Export capability manifest for LLM context injection
export { capabilityManifest, CapabilityManifest, CapabilityCategory, CAPABILITIES } from './capabilities.js';
