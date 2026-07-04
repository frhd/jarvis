import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Senders table
 * @deprecated Use users + platformIdentities for new code. Kept for messages table FK.
 * Will be removed after messages table migration to unified identity.
 */
export const senders = sqliteTable(
  'senders',
  {
    id: text('id').primaryKey(),
    telegramId: text('telegramId').notNull().unique(),
    firstName: text('firstName'),
    lastName: text('lastName'),
    username: text('username'),
    phone: text('phone'),
    displayName: text('displayName'), // User-provided name for identity persistence
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    telegramIdIdx: index('senders_telegramId_idx').on(table.telegramId),
    displayNameIdx: index('senders_displayName_idx').on(table.displayName),
  })
);

/**
 * Chats table
 * @deprecated Use conversations for new code. Kept for messages table FK.
 * Will be removed after messages table migration to unified identity.
 */
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    telegramId: text('telegramId').notNull().unique(),
    type: text('type', { enum: ['private', 'group', 'supergroup', 'channel'] }).notNull(),
    title: text('title'),
    username: text('username'),
    preferredLanguage: text('preferredLanguage').default('en'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    telegramIdIdx: index('chats_telegramId_idx').on(table.telegramId),
  })
);

// Chat Filters table
export const chatFilters = sqliteTable(
  'chatFilters',
  {
    id: text('id').primaryKey(),
    telegramChatId: text('telegramChatId').notNull(),
    filterType: text('filterType', { enum: ['allow', 'block'] }).notNull(),
    priority: integer('priority').notNull().default(0),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    telegramChatIdIdx: index('chatFilters_telegramChatId_idx').on(table.telegramChatId),
  })
);

// Messages table
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    telegramMessageId: integer('telegramMessageId').notNull(),
    chatId: text('chatId')
      .notNull()
      .references(() => chats.id),
    senderId: text('senderId').references(() => senders.id),
    text: text('text'),
    mediaType: text('mediaType', {
      enum: ['photo', 'document', 'voice', 'video', 'audio', 'sticker'],
    }),
    mediaPath: text('mediaPath'),
    mediaFileId: text('mediaFileId'),
    // Transcript fields for voice messages
    transcript: text('transcript'),
    transcriptStatus: text('transcriptStatus', {
      enum: ['pending', 'processing', 'completed', 'failed'],
    }),
    transcriptError: text('transcriptError'),
    transcriptLanguage: text('transcriptLanguage'),
    transcriptDurationMs: integer('transcriptDurationMs'),
    transcriptedAt: integer('transcriptedAt', { mode: 'timestamp' }),
    replyToMessageId: integer('replyToMessageId'),
    forwardFromChatId: text('forwardFromChatId'),
    forwardFromMessageId: integer('forwardFromMessageId'),
    rawJson: text('rawJson').notNull(),
    isBot: integer('isBot', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    chatMessageIdx: index('messages_chatId_telegramMessageId_idx').on(
      table.chatId,
      table.telegramMessageId
    ),
    // Analytics indexes for query performance
    createdAtIdx: index('messages_createdAt_idx').on(table.createdAt),
    senderIdx: index('messages_senderId_idx').on(table.senderId),
    senderCreatedAtIdx: index('messages_senderId_createdAt_idx').on(
      table.senderId,
      table.createdAt
    ),
  })
);

// Queue table
export const queue = sqliteTable(
  'queue',
  {
    id: text('id').primaryKey(),
    messageId: text('messageId')
      .notNull()
      .unique()
      .references(() => messages.id),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('lastError'),
    processedAt: integer('processedAt', { mode: 'timestamp' }),
    nextRetryAt: integer('nextRetryAt', { mode: 'timestamp' }),
    priorityBoostApplied: integer('priorityBoostApplied', { mode: 'boolean' }).notNull().default(false),
    originalPriority: integer('originalPriority'),
    // Optimistic locking version field
    version: integer('version').notNull().default(1),
    // Processing start timestamp for timeout detection
    processingStartedAt: integer('processingStartedAt', { mode: 'timestamp' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    queueOrderIdx: index('queue_status_priority_createdAt_idx').on(
      table.status,
      table.priority,
      table.createdAt
    ),
    nextRetryAtIdx: index('queue_nextRetryAt_idx').on(table.nextRetryAt),
    versionIdx: index('queue_version_idx').on(table.id, table.version),
  })
);

// LLM Responses table
export const llmResponses = sqliteTable(
  'llmResponses',
  {
    id: text('id').primaryKey(),
    messageId: text('messageId')
      .notNull()
      .references(() => messages.id),
    promptType: text('promptType').notNull(),
    prompt: text('prompt').notNull(),
    response: text('response').notNull(),
    model: text('model').notNull(),
    durationMs: integer('durationMs'),
    promptTokens: integer('promptTokens'),
    completionTokens: integer('completionTokens'),
    error: text('error'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdIdx: index('llmResponses_messageId_idx').on(table.messageId),
    promptTypeIdx: index('llmResponses_promptType_idx').on(table.promptType),
  })
);

// Embeddings table
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    sourceType: text('sourceType', { enum: ['message', 'memory', 'preference', 'cache'] }).notNull(),
    sourceId: text('sourceId').notNull(),
    content: text('content').notNull(),
    embedding: text('embedding').notNull(), // JSON array of floats
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull().default(768),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceIdx: index('embeddings_source_idx').on(table.sourceType, table.sourceId),
  })
);

// Memories table
export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    /** @deprecated Use userId for new code. Kept for backward compatibility. */
    senderId: text('senderId').references(() => senders.id),
    /** @deprecated Use conversationId for new code. Kept for backward compatibility. */
    chatId: text('chatId').references(() => chats.id),
    userId: text('user_id').references(() => users.id),
    conversationId: text('conversation_id').references(() => conversations.id),
    memoryType: text('memoryType', { enum: ['fact', 'preference', 'event', 'relationship', 'capability', 'emotional_state', 'relationship_dynamic', 'conflict_pattern', 'positive_pattern', 'concern', 'goal_shared'] }).notNull(),
    content: text('content').notNull(),
    confidence: integer('confidence').notNull().default(100), // 0-100 scale
    sourceMessageIds: text('sourceMessageIds'), // JSON array
    lastAccessedAt: integer('lastAccessedAt', { mode: 'timestamp' }),
    accessCount: integer('accessCount').notNull().default(0),
    isArchived: integer('isArchived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('memories_sender_idx').on(table.senderId),
    chatIdx: index('memories_chat_idx').on(table.chatId),
    userIdx: index('memories_user_idx').on(table.userId),
    conversationIdx: index('memories_conversation_idx').on(table.conversationId),
    typeIdx: index('memories_type_idx').on(table.memoryType),
    archivedIdx: index('memories_archived_idx').on(table.isArchived),
  })
);

// User Preferences table
export const userPreferences = sqliteTable(
  'userPreferences',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    category: text('category', { enum: ['communication', 'interests', 'behavior', 'context'] }).notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(), // JSON value
    confidence: integer('confidence').notNull().default(100),
    sourceMessageIds: text('sourceMessageIds'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('userPreferences_sender_idx').on(table.senderId),
    categoryIdx: index('userPreferences_category_idx').on(table.category),
    uniquePreference: index('userPreferences_unique_idx').on(table.senderId, table.category, table.key),
  })
);

// Conversation Summaries table
export const conversationSummaries = sqliteTable(
  'conversationSummaries',
  {
    id: text('id').primaryKey(),
    chatId: text('chatId')
      .notNull()
      .references(() => chats.id),
    startMessageId: text('startMessageId').references(() => messages.id),
    endMessageId: text('endMessageId').references(() => messages.id),
    messageCount: integer('messageCount').notNull(),
    summary: text('summary').notNull(),
    keyTopics: text('keyTopics'), // JSON array
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    chatIdx: index('conversationSummaries_chat_idx').on(table.chatId),
  })
);

// Intent Classification Logs table
export const intentClassificationLogs = sqliteTable(
  'intentClassificationLogs',
  {
    id: text('id').primaryKey(),
    messageId: text('messageId')
      .notNull()
      .references(() => messages.id),
    parentIntent: text('parentIntent'),
    childIntent: text('childIntent'),
    confidence: real('confidence'),
    confidenceLevel: text('confidenceLevel', { enum: ['high', 'medium', 'low', 'uncertain'] }),
    classificationMethod: text('classificationMethod', { enum: ['pattern', 'llm', 'escalated'] }).notNull(),
    wasEscalated: integer('wasEscalated', { mode: 'boolean' }).notNull().default(false),
    feedbackCorrectIntent: text('feedbackCorrectIntent'),
    feedbackScore: integer('feedbackScore'), // -1, 0, 1
    durationMs: integer('durationMs'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdIdx: index('intentClassificationLogs_messageId_idx').on(table.messageId),
    methodIdx: index('intentClassificationLogs_method_idx').on(table.classificationMethod),
    escalatedIdx: index('intentClassificationLogs_escalated_idx').on(table.wasEscalated),
    createdAtIdx: index('intentClassificationLogs_createdAt_idx').on(table.createdAt),
  })
);

// Semantic Cache table
export const semanticCache = sqliteTable(
  'semanticCache',
  {
    id: text('id').primaryKey(),
    promptHash: text('promptHash').notNull(), // SHA-256 hash of normalized prompt
    promptText: text('promptText').notNull(), // Original prompt for debugging
    response: text('response').notNull(), // Cached response
    model: text('model').notNull(), // Model that generated the response
    intent: text('intent'), // Child intent (e.g., 'simple_greeting')
    metadata: text('metadata'), // JSON: additional context info
    hitCount: integer('hitCount').notNull().default(1),
    lastAccessedAt: integer('lastAccessedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }), // TTL support
    sourceMessageIds: text('sourceMessageIds'), // JSON array for traceability
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    hashIdx: index('semanticCache_hash_idx').on(table.promptHash),
    modelIdx: index('semanticCache_model_idx').on(table.model),
    intentIdx: index('semanticCache_intent_idx').on(table.intent),
    expiresIdx: index('semanticCache_expires_idx').on(table.expiresAt),
    accessIdx: index('semanticCache_access_idx').on(table.lastAccessedAt),
  })
);

// Metrics table
export const metrics = sqliteTable(
  'metrics',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(), // e.g., 'llm.response_time', 'cache.hit', 'intent.classification'
    type: text('type', { enum: ['counter', 'gauge', 'histogram', 'timing'] }).notNull(),
    value: real('value').notNull(),
    tags: text('tags'), // JSON object for dimensions: {model: 'ollama', intent: 'greeting'}
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    nameIdx: index('metrics_name_idx').on(table.name),
    timestampIdx: index('metrics_timestamp_idx').on(table.timestamp),
    nameTimestampIdx: index('metrics_name_timestamp_idx').on(table.name, table.timestamp),
  })
);

// Metric Aggregates table (pre-computed stats for performance)
export const metricAggregates = sqliteTable(
  'metricAggregates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    period: text('period', { enum: ['minute', 'hour', 'day'] }).notNull(),
    periodStart: integer('periodStart', { mode: 'timestamp' }).notNull(), // Start of the time bucket
    count: integer('count').notNull(),
    sum: real('sum').notNull(),
    min: real('min').notNull(),
    max: real('max').notNull(),
    avg: real('avg').notNull(),
    p50: real('p50'), // Median
    p95: real('p95'),
    p99: real('p99'),
    tags: text('tags'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    namePeriodIdx: index('metricAggregates_name_period_idx').on(table.name, table.period, table.periodStart),
    periodStartIdx: index('metricAggregates_periodStart_idx').on(table.periodStart),
  })
);

// Experiments table (A/B testing)
export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['draft', 'running', 'paused', 'completed'] })
      .notNull()
      .default('draft'),
    targetMetric: text('targetMetric').notNull(),
    config: text('config'), // JSON object
    startDate: integer('startDate', { mode: 'timestamp' }),
    endDate: integer('endDate', { mode: 'timestamp' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index('experiments_status_idx').on(table.status),
    targetMetricIdx: index('experiments_targetMetric_idx').on(table.targetMetric),
    startDateIdx: index('experiments_startDate_idx').on(table.startDate),
  })
);

// Experiment Variants table
export const experimentVariants = sqliteTable(
  'experimentVariants',
  {
    id: text('id').primaryKey(),
    experimentId: text('experimentId')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    weight: integer('weight').notNull(),
    config: text('config'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    experimentIdIdx: index('experimentVariants_experimentId_idx').on(table.experimentId),
  })
);

// Experiment Assignments table
export const experimentAssignments = sqliteTable(
  'experimentAssignments',
  {
    id: text('id').primaryKey(),
    experimentId: text('experimentId')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    variantId: text('variantId')
      .notNull()
      .references(() => experimentVariants.id, { onDelete: 'cascade' }),
    assignedAt: integer('assignedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    uniqueIdx: index('experimentAssignments_unique_idx').on(table.experimentId, table.senderId),
    experimentIdIdx: index('experimentAssignments_experimentId_idx').on(table.experimentId),
    senderIdIdx: index('experimentAssignments_senderId_idx').on(table.senderId),
    variantIdIdx: index('experimentAssignments_variantId_idx').on(table.variantId),
  })
);

// Experiment Events table
export const experimentEvents = sqliteTable(
  'experimentEvents',
  {
    id: text('id').primaryKey(),
    experimentId: text('experimentId')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    variantId: text('variantId')
      .notNull()
      .references(() => experimentVariants.id, { onDelete: 'cascade' }),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    eventType: text('eventType').notNull(),
    value: real('value'),
    metadata: text('metadata'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    experimentIdIdx: index('experimentEvents_experimentId_idx').on(table.experimentId),
    variantIdIdx: index('experimentEvents_variantId_idx').on(table.variantId),
    senderIdIdx: index('experimentEvents_senderId_idx').on(table.senderId),
    eventTypeIdx: index('experimentEvents_eventType_idx').on(table.eventType),
    createdAtIdx: index('experimentEvents_createdAt_idx').on(table.createdAt),
  })
);

// Dead Letter Queue table
export const deadLetterQueue = sqliteTable(
  'deadLetterQueue',
  {
    id: text('id').primaryKey(),
    originalQueueId: text('originalQueueId')
      .notNull()
      .references(() => queue.id),
    messageId: text('messageId')
      .notNull()
      .references(() => messages.id),
    reason: text('reason').notNull(),
    errorHistory: text('errorHistory').notNull(), // JSON array of error objects
    attempts: integer('attempts').notNull().default(0),
    metadata: text('metadata'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    lastAttemptAt: integer('lastAttemptAt', { mode: 'timestamp' }),
  },
  (table) => ({
    messageIdIdx: index('deadLetterQueue_messageId_idx').on(table.messageId),
    originalQueueIdIdx: index('deadLetterQueue_originalQueueId_idx').on(table.originalQueueId),
    createdAtIdx: index('deadLetterQueue_createdAt_idx').on(table.createdAt),
  })
);

// Circuit Breaker State table
export const circuitBreakerStates = sqliteTable(
  'circuitBreakerStates',
  {
    id: text('id').primaryKey(),
    serviceName: text('serviceName').notNull().unique(),
    state: text('state', { enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] })
      .notNull()
      .default('CLOSED'),
    failureCount: integer('failureCount').notNull().default(0),
    successCount: integer('successCount').notNull().default(0),
    lastFailureAt: integer('lastFailureAt', { mode: 'timestamp' }),
    lastSuccessAt: integer('lastSuccessAt', { mode: 'timestamp' }),
    lastStateChangeAt: integer('lastStateChangeAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    nextAttemptAt: integer('nextAttemptAt', { mode: 'timestamp' }),
    halfOpenAttempts: integer('halfOpenAttempts').notNull().default(0),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    serviceNameIdx: index('circuitBreakerStates_serviceName_idx').on(table.serviceName),
    stateIdx: index('circuitBreakerStates_state_idx').on(table.state),
  })
);

// Security Audit Logs table
export const securityAuditLogs = sqliteTable(
  'security_audit_logs',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    userId: text('user_id'),
    telegramId: integer('telegram_id'),
    action: text('action').notNull(),
    details: text('details').notNull().default('{}'), // JSON object
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    severity: text('severity', { enum: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] })
      .notNull()
      .default('INFO'),
    correlationId: text('correlation_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    eventTypeIdx: index('idx_security_audit_event_type').on(table.eventType),
    userIdIdx: index('idx_security_audit_user_id').on(table.userId),
    telegramIdIdx: index('idx_security_audit_telegram_id').on(table.telegramId),
    createdAtIdx: index('idx_security_audit_created_at').on(table.createdAt),
    severityIdx: index('idx_security_audit_severity').on(table.severity),
  })
);

// Data Export Requests table
export const dataExportRequests = sqliteTable(
  'data_export_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    telegramId: integer('telegram_id').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    includeMessages: integer('include_messages', { mode: 'boolean' }).notNull().default(true),
    includeMemories: integer('include_memories', { mode: 'boolean' }).notNull().default(true),
    includePreferences: integer('include_preferences', { mode: 'boolean' }).notNull().default(true),
    includeMedia: integer('include_media', { mode: 'boolean' }).notNull().default(false),
    format: text('format', { enum: ['json', 'csv', 'xml'] }).notNull().default('json'),
    filePath: text('file_path'),
    sizeBytes: integer('size_bytes'),
    recordCounts: text('record_counts').default('{}'), // JSON object
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    errorMessage: text('error_message'),
  },
  (table) => ({
    userIdIdx: index('idx_data_export_user_id').on(table.userId),
    telegramIdIdx: index('idx_data_export_telegram_id').on(table.telegramId),
    statusIdx: index('idx_data_export_status').on(table.status),
  })
);

// Data Deletion Requests table
export const dataDeletionRequests = sqliteTable(
  'data_deletion_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    telegramId: integer('telegram_id').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    deleteMessages: integer('delete_messages', { mode: 'boolean' }).notNull().default(true),
    deleteMemories: integer('delete_memories', { mode: 'boolean' }).notNull().default(true),
    deletePreferences: integer('delete_preferences', { mode: 'boolean' }).notNull().default(true),
    deleteMedia: integer('delete_media', { mode: 'boolean' }).notNull().default(true),
    reason: text('reason'),
    deletedCounts: text('deleted_counts').default('{}'), // JSON object
    auditLogId: text('audit_log_id'),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    errorMessage: text('error_message'),
  },
  (table) => ({
    userIdIdx: index('idx_data_deletion_user_id').on(table.userId),
    telegramIdIdx: index('idx_data_deletion_telegram_id').on(table.telegramId),
    statusIdx: index('idx_data_deletion_status').on(table.status),
  })
);

// Retention Policies table
export const retentionPolicies = sqliteTable(
  'retention_policies',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type', {
      enum: ['message', 'memory', 'media', 'cache', 'metrics', 'embeddings', 'audit_logs'],
    })
      .notNull()
      .unique(),
    retentionDays: integer('retention_days').notNull(),
    archiveBeforeDelete: integer('archive_before_delete', { mode: 'boolean' }).notNull().default(false),
    requiresUserConsent: integer('requires_user_consent', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  }
);

// Loop Patterns table - stores learned conversation loop patterns
export const loopPatterns = sqliteTable(
  'loopPatterns',
  {
    id: text('id').primaryKey(),
    patternHash: text('patternHash').notNull().unique(), // SHA-256 hash of pattern sequence
    pattern: text('pattern').notNull(), // JSON array of message pattern sequence
    loopType: text('loopType', { enum: ['imperative_repeat', 'clarification_loop', 'execution_hesitation', 'misunderstanding', 'context_lost', 'custom'] }).notNull(),
    frequency: integer('frequency').notNull().default(1), // How many times this pattern has occurred
    avgDurationMs: integer('avgDurationMs').notNull(), // Average duration of loop in milliseconds
    avgMessageCount: integer('avgMessageCount').notNull().default(0), // Average number of messages in loop
    resolutionStrategy: text('resolutionStrategy').notNull(), // What action breaks the loop
    confidence: real('confidence').notNull().default(0.5), // 0-1, confidence in pattern accuracy
    metadata: text('metadata'), // JSON: additional context
    lastOccurredAt: integer('lastOccurredAt', { mode: 'timestamp' }), // When last detected
    isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true), // Can be disabled
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    typeIdx: index('loopPatterns_type_idx').on(table.loopType),
    frequencyIdx: index('loopPatterns_frequency_idx').on(table.frequency),
    activeIdx: index('loopPatterns_active_idx').on(table.isActive),
    lastOccurredIdx: index('loopPatterns_lastOccurred_idx').on(table.lastOccurredAt),
  })
);

// Loop Detections table - tracks actual loop occurrences
export const loopDetections = sqliteTable(
  'loopDetections',
  {
    id: text('id').primaryKey(),
    patternId: text('patternId')
      .notNull()
      .references(() => loopPatterns.id),
    chatId: text('chatId')
      .notNull()
      .references(() => chats.id),
    senderId: text('senderId').references(() => senders.id),
    messageIds: text('messageIds').notNull(), // JSON array of message IDs in loop
    messageCount: integer('messageCount').notNull(),
    durationMs: integer('durationMs').notNull(),
    wasResolved: integer('wasResolved', { mode: 'boolean' }).notNull().default(false),
    resolutionAction: text('resolutionAction'), // What action was taken
    userFeedback: integer('userFeedback'), // -1, 0, 1 (negative, neutral, positive)
    detectedAt: integer('detectedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    patternIdx: index('loopDetections_pattern_idx').on(table.patternId),
    chatIdx: index('loopDetections_chat_idx').on(table.chatId),
    senderIdx: index('loopDetections_sender_idx').on(table.senderId),
    detectedAtIdx: index('loopDetections_detectedAt_idx').on(table.detectedAt),
  })
);

// ============================================================================
// Jarvis University - Personalized Learning System
// ============================================================================

// Skills table - Catalog of all skills that can be learned
export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    category: text('category', {
      enum: ['programming', 'architecture', 'data', 'devops', 'security', 'ai_ml', 'soft_skills', 'domain'],
    }).notNull(),
    description: text('description'),
    prerequisites: text('prerequisites'), // JSON array of skill IDs
    difficultyLevel: integer('difficultyLevel').notNull().default(1), // 1-10
    estimatedHoursToLearn: integer('estimatedHoursToLearn').notNull().default(10),
    keywords: text('keywords'), // JSON array for matching
    resources: text('resources'), // JSON array of curated resources
    metadata: text('metadata'), // JSON object
    isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    categoryIdx: index('skills_category_idx').on(table.category),
    difficultyIdx: index('skills_difficulty_idx').on(table.difficultyLevel),
    activeIdx: index('skills_active_idx').on(table.isActive),
  })
);

// User Skills table - Tracks user's current skill levels
export const userSkills = sqliteTable(
  'userSkills',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    skillId: text('skillId')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    currentLevel: real('currentLevel').notNull().default(0), // 0-10 scale
    confidence: real('confidence').notNull().default(0.5), // 0-1 assessment confidence
    assessmentMethod: text('assessmentMethod', {
      enum: ['self_reported', 'inferred', 'tested', 'project_demonstrated'],
    }).notNull().default('inferred'),
    lastPracticedAt: integer('lastPracticedAt', { mode: 'timestamp' }),
    practiceCount: integer('practiceCount').notNull().default(0),
    evidenceMessageIds: text('evidenceMessageIds'), // JSON array of message IDs
    notes: text('notes'), // JSON array of learning notes
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('userSkills_sender_idx').on(table.senderId),
    skillIdx: index('userSkills_skill_idx').on(table.skillId),
    senderSkillIdx: index('userSkills_sender_skill_idx').on(table.senderId, table.skillId),
    levelIdx: index('userSkills_level_idx').on(table.currentLevel),
  })
);

// Learning Paths table - Generated learning paths for users
export const learningPaths = sqliteTable(
  'learningPaths',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    goalDescription: text('goalDescription').notNull(),
    targetSkills: text('targetSkills').notNull(), // JSON array of {skillId, targetLevel}
    learningStyle: text('learningStyle', {
      enum: ['learning_by_building', 'theory_first', 'example_driven', 'project_based', 'mixed'],
    }).notNull().default('learning_by_building'),
    weeklyTimeCommitmentHours: real('weeklyTimeCommitmentHours').notNull().default(10),
    estimatedDurationWeeks: integer('estimatedDurationWeeks').notNull(),
    status: text('status', {
      enum: ['draft', 'active', 'paused', 'completed', 'abandoned'],
    }).notNull().default('draft'),
    currentPhase: integer('currentPhase').notNull().default(0),
    totalPhases: integer('totalPhases').notNull().default(1),
    progress: real('progress').notNull().default(0), // 0-100 percentage
    curriculum: text('curriculum').notNull(), // JSON: detailed curriculum with modules
    checkpoints: text('checkpoints'), // JSON array of checkpoints
    practiceProjects: text('practiceProjects'), // JSON array of project definitions
    curatedResources: text('curatedResources'), // JSON array of resources
    mentorshipConfig: text('mentorshipConfig'), // JSON: mentorship settings
    metadata: text('metadata'), // JSON object
    startedAt: integer('startedAt', { mode: 'timestamp' }),
    completedAt: integer('completedAt', { mode: 'timestamp' }),
    lastActivityAt: integer('lastActivityAt', { mode: 'timestamp' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('learningPaths_sender_idx').on(table.senderId),
    statusIdx: index('learningPaths_status_idx').on(table.status),
    senderStatusIdx: index('learningPaths_sender_status_idx').on(table.senderId, table.status),
  })
);

// Learning Progress table - Tracks progress through learning path items
export const learningProgress = sqliteTable(
  'learningProgress',
  {
    id: text('id').primaryKey(),
    pathId: text('pathId')
      .notNull()
      .references(() => learningPaths.id, { onDelete: 'cascade' }),
    itemType: text('itemType', {
      enum: ['module', 'lesson', 'checkpoint', 'project', 'assessment'],
    }).notNull(),
    itemId: text('itemId').notNull(), // Reference within curriculum JSON
    status: text('status', {
      enum: ['not_started', 'in_progress', 'completed', 'skipped'],
    }).notNull().default('not_started'),
    score: real('score'), // 0-100 for assessments
    timeSpentMinutes: integer('timeSpentMinutes').notNull().default(0),
    completedAt: integer('completedAt', { mode: 'timestamp' }),
    notes: text('notes'), // User's notes during learning
    feedback: text('feedback'), // Mentor feedback
    metadata: text('metadata'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    pathIdx: index('learningProgress_path_idx').on(table.pathId),
    itemTypeIdx: index('learningProgress_itemType_idx').on(table.itemType),
    statusIdx: index('learningProgress_status_idx').on(table.status),
    pathItemIdx: index('learningProgress_path_item_idx').on(table.pathId, table.itemId),
  })
);

// Learning Sessions table - Tracks learning sessions for mentorship
export const learningSessions = sqliteTable(
  'learningSessions',
  {
    id: text('id').primaryKey(),
    pathId: text('pathId')
      .notNull()
      .references(() => learningPaths.id, { onDelete: 'cascade' }),
    sessionType: text('sessionType', {
      enum: ['lesson', 'practice', 'review', 'assessment', 'mentorship', 'project_work'],
    }).notNull(),
    topic: text('topic').notNull(),
    startedAt: integer('startedAt', { mode: 'timestamp' }).notNull(),
    endedAt: integer('endedAt', { mode: 'timestamp' }),
    durationMinutes: integer('durationMinutes'),
    socraticQuestions: text('socraticQuestions'), // JSON array of questions asked
    challengesPosed: text('challengesPosed'), // JSON array of challenges
    conceptsExplored: text('conceptsExplored'), // JSON array of concepts
    userInsights: text('userInsights'), // JSON array of insights gained
    feedbackProvided: text('feedbackProvided'), // Mentor feedback
    nextSteps: text('nextSteps'), // JSON array of recommended next steps
    metadata: text('metadata'), // JSON object
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    pathIdx: index('learningSessions_path_idx').on(table.pathId),
    sessionTypeIdx: index('learningSessions_sessionType_idx').on(table.sessionType),
    startedAtIdx: index('learningSessions_startedAt_idx').on(table.startedAt),
  })
);

// Skill Assessments table - Formal skill assessments
export const skillAssessments = sqliteTable(
  'skillAssessments',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    skillId: text('skillId')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    pathId: text('pathId')
      .references(() => learningPaths.id, { onDelete: 'set null' }),
    assessmentType: text('assessmentType', {
      enum: ['initial', 'checkpoint', 'final', 'practice', 'project_review'],
    }).notNull(),
    questions: text('questions'), // JSON array of questions/challenges
    responses: text('responses'), // JSON array of user responses
    score: real('score').notNull(), // 0-100
    levelBefore: real('levelBefore').notNull(),
    levelAfter: real('levelAfter').notNull(),
    strengthsIdentified: text('strengthsIdentified'), // JSON array
    areasToImprove: text('areasToImprove'), // JSON array
    recommendations: text('recommendations'), // JSON array of next steps
    durationMinutes: integer('durationMinutes'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('skillAssessments_sender_idx').on(table.senderId),
    skillIdx: index('skillAssessments_skill_idx').on(table.skillId),
    pathIdx: index('skillAssessments_path_idx').on(table.pathId),
    typeIdx: index('skillAssessments_type_idx').on(table.assessmentType),
    createdAtIdx: index('skillAssessments_createdAt_idx').on(table.createdAt),
  })
);

// ============================================
// Plan Workflow System
// ============================================

// Plan state enum values
export const PLAN_STATES = ['idle', 'proposing', 'feedback', 'approved', 'executing', 'completed', 'failed'] as const;
export type PlanState = typeof PLAN_STATES[number];

// Plan Execution status enum values
export const EXECUTION_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];

// Plans table - stores plan content and state machine state
export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(), // Markdown content
    state: text('state', { enum: PLAN_STATES }).notNull().default('proposing'),
    createdBy: text('createdBy').references(() => senders.id),
    chatId: text('chatId').references(() => chats.id),
    metadata: text('metadata').default('{}'), // JSON: {tags, priority, estimatedTasks, etc}
    version: integer('version').notNull().default(1), // Plan version for tracking iterations
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    approvedAt: integer('approvedAt', { mode: 'timestamp' }),
    completedAt: integer('completedAt', { mode: 'timestamp' }),
  },
  (table) => ({
    stateIdx: index('plans_state_idx').on(table.state),
    chatIdIdx: index('plans_chat_id_idx').on(table.chatId),
    createdByIdx: index('plans_created_by_idx').on(table.createdBy),
  })
);

// Plan Executions table - tracks loop.sh execution sessions
export const planExecutions = sqliteTable(
  'planExecutions',
  {
    id: text('id').primaryKey(),
    planId: text('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    sessionId: text('sessionId').notNull().unique(), // Unique execution session ID
    status: text('status', { enum: EXECUTION_STATUSES }).notNull().default('running'),
    promptFile: text('promptFile'), // Path to prompt.md
    loopLogPath: text('loopLogPath'), // Path to loop.log
    startedAt: integer('startedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completedAt', { mode: 'timestamp' }),
    totalIterations: integer('totalIterations').notNull().default(0),
    currentIteration: integer('currentIteration').notNull().default(0),
    totalTokensIn: integer('totalTokensIn').notNull().default(0),
    totalTokensOut: integer('totalTokensOut').notNull().default(0),
    totalCost: real('totalCost').notNull().default(0),
    progressReport: text('progressReport').default('{}'), // JSON: last progress snapshot
  },
  (table) => ({
    planIdIdx: index('planExecutions_plan_id_idx').on(table.planId),
    statusIdx: index('planExecutions_status_idx').on(table.status),
    sessionIdIdx: index('planExecutions_session_id_idx').on(table.sessionId),
  })
);

// Plan Feedback table - stores feedback iterations
export const planFeedback = sqliteTable(
  'planFeedback',
  {
    id: text('id').primaryKey(),
    planId: text('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    feedback: text('feedback').notNull(),
    version: integer('version').notNull(), // Which plan version this feedback applies to
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    planIdIdx: index('planFeedback_plan_id_idx').on(table.planId),
    senderIdIdx: index('planFeedback_sender_id_idx').on(table.senderId),
  })
);

// ============================================
// Proactive Messaging System
// ============================================

// Proactive Jobs table - stores scheduled proactive tasks
export const proactiveJobs = sqliteTable(
  'proactiveJobs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    scheduleType: text('scheduleType', { enum: ['at', 'every', 'cron'] }).notNull(),
    scheduleValue: text('scheduleValue').notNull(), // ISO timestamp, ms interval, or cron expr
    timezone: text('timezone').notNull().default('UTC'),
    targetChatId: text('targetChatId').references(() => chats.id),
    targetSenderId: text('targetSenderId').references(() => senders.id),
    messageType: text('messageType', {
      enum: ['greeting', 'checkin', 'summary', 'reminder', 'followup', 'custom'],
    }).notNull(),
    messageTemplate: text('messageTemplate'), // Optional custom template
    contextConfig: text('contextConfig'), // JSON: { includeMemories, includePreferences, recentMessages }
    deleteAfterRun: integer('deleteAfterRun', { mode: 'boolean' }).notNull().default(false),
    nextRunAt: integer('nextRunAt', { mode: 'timestamp' }),
    lastRunAt: integer('lastRunAt', { mode: 'timestamp' }),
    lastStatus: text('lastStatus', { enum: ['ok', 'error', 'skipped', 'running'] }),
    lastError: text('lastError'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    enabledIdx: index('proactiveJobs_enabled_idx').on(table.enabled),
    nextRunAtIdx: index('proactiveJobs_nextRunAt_idx').on(table.nextRunAt),
    messageTypeIdx: index('proactiveJobs_messageType_idx').on(table.messageType),
    targetChatIdx: index('proactiveJobs_targetChat_idx').on(table.targetChatId),
  })
);

// Proactive Runs table - tracks execution history for auditing
export const proactiveRuns = sqliteTable(
  'proactiveRuns',
  {
    id: text('id').primaryKey(),
    jobId: text('jobId')
      .notNull()
      .references(() => proactiveJobs.id, { onDelete: 'cascade' }),
    startedAt: integer('startedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completedAt', { mode: 'timestamp' }),
    status: text('status', { enum: ['ok', 'error', 'skipped', 'running'] }).notNull(),
    generatedMessage: text('generatedMessage'),
    deliveryStatus: text('deliveryStatus', { enum: ['sent', 'queued', 'failed'] }),
    error: text('error'),
    tokenUsage: text('tokenUsage'), // JSON: { promptTokens, completionTokens, totalTokens, model }
  },
  (table) => ({
    jobIdIdx: index('proactiveRuns_jobId_idx').on(table.jobId),
    startedAtIdx: index('proactiveRuns_startedAt_idx').on(table.startedAt),
    statusIdx: index('proactiveRuns_status_idx').on(table.status),
  })
);

// ============================================
// Comic Module - Joke History
// ============================================

// Joke styles enum values
export const JOKE_STYLES = ['dad_joke', 'punny', 'clever', 'one_liner', 'absurdist', 'story', 'mixed'] as const;
export type JokeStyleType = typeof JOKE_STYLES[number];

// Joke categories enum values
export const JOKE_CATEGORIES = ['general', 'tech', 'science', 'wordplay'] as const;
export type JokeCategoryType = typeof JOKE_CATEGORIES[number];

// User reactions enum values
export const USER_REACTIONS = ['laughed', 'groaned', 'meh', 'requested_more'] as const;
export type UserReactionType = typeof USER_REACTIONS[number];

// Joke History table - tracks jokes told to users for anti-repetition
export const jokeHistory = sqliteTable(
  'jokeHistory',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId').references(() => senders.id),
    chatId: text('chatId')
      .notNull()
      .references(() => chats.id),
    jokeContent: text('jokeContent').notNull(),
    jokeHash: text('jokeHash').notNull(), // SHA-256 hash for deduplication
    style: text('style', { enum: JOKE_STYLES }).notNull().default('mixed'),
    categoryId: text('categoryId').notNull().default('general'),
    userReaction: text('userReaction', { enum: USER_REACTIONS }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('jokeHistory_sender_idx').on(table.senderId),
    chatIdx: index('jokeHistory_chat_idx').on(table.chatId),
    hashIdx: index('jokeHistory_hash_idx').on(table.jokeHash),
    styleIdx: index('jokeHistory_style_idx').on(table.style),
    createdAtIdx: index('jokeHistory_createdAt_idx').on(table.createdAt),
    senderHashIdx: index('jokeHistory_sender_hash_idx').on(table.senderId, table.jokeHash),
  })
);

// ============================================================================
// Contact Management System
// ============================================================================

// Contact categories enum values
export const CONTACT_CATEGORIES = ['friend', 'family', 'work', 'other'] as const;
export type ContactCategoryType = typeof CONTACT_CATEGORIES[number];

// Contacts table - stores user contacts for messaging
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    senderId: text('senderId')
      .notNull()
      .references(() => senders.id),
    name: text('name').notNull(),
    phoneNumber: text('phoneNumber').notNull(), // E.164 format
    originalInput: text('originalInput'), // Keep original for reference
    preferredFormat: text('preferredFormat'), // User's preferred display format
    category: text('category', { enum: CONTACT_CATEGORIES }).notNull().default('friend'),
    confidence: integer('confidence').notNull().default(50), // 0-100 confidence score
    lastContactedAt: integer('lastContactedAt', { mode: 'timestamp' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    senderIdx: index('contacts_sender_idx').on(table.senderId),
    phoneNumberIdx: index('contacts_phoneNumber_idx').on(table.phoneNumber),
    senderPhoneIdx: index('contacts_sender_phone_idx').on(table.senderId, table.phoneNumber),
    createdAtIdx: index('contacts_createdAt_idx').on(table.createdAt),
    updatedAtIdx: index('contacts_updatedAt_idx').on(table.updatedAt),
  })
);

// --- Platform-Agnostic Identity Tables (Phase 1) ---

// Unified users table — platform-agnostic identity
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Platform identities — maps platform-specific user IDs to unified users
export const platformIdentities = sqliteTable(
  'platform_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    platform: text('platform').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    metadata: text('metadata'), // JSON: platform-specific fields (firstName, username, etc.)
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uniquePlatformUser: uniqueIndex('idx_platform_identities_platform_user')
      .on(table.platform, table.platformUserId),
    userIdIdx: index('platform_identities_user_id_idx').on(table.userId),
  })
);

// Conversations — platform-agnostic conversation/chat abstraction
export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    platform: text('platform').notNull(),
    platformConversationId: text('platform_conversation_id').notNull(),
    type: text('type').notNull(), // 'dm' | 'group' | 'channel'
    title: text('title'),
    participantCount: integer('participant_count').default(0), // For dyad detection (2 = dyad)
    metadata: text('metadata'), // JSON: platform-specific fields
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uniquePlatformConversation: uniqueIndex('idx_conversations_platform_conv')
      .on(table.platform, table.platformConversationId),
    participantCountIdx: index('idx_conversations_participant_count').on(table.participantCount),
  })
);

// ============================================
// Therapist/Listener Mode System
// ============================================

// Therapist mode types
export const THERAPIST_MODE_TYPES = ['active_listener', 'moderator', 'coach'] as const;
export type TherapistModeType = typeof THERAPIST_MODE_TYPES[number];

// Response frequency levels
export const RESPONSE_FREQUENCY_LEVELS = ['minimal', 'moderate', 'active'] as const;
export type ResponseFrequencyLevel = typeof RESPONSE_FREQUENCY_LEVELS[number];

// Therapist Mode Config table - Per-conversation settings and consent
export const therapistModeConfig = sqliteTable(
  'therapistModeConfig',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    modeType: text('mode_type', { enum: THERAPIST_MODE_TYPES }).notNull().default('active_listener'),
    consentedByUserIds: text('consented_by_user_ids').notNull().default('[]'), // JSON array of unified user IDs
    responseFrequency: text('response_frequency', { enum: RESPONSE_FREQUENCY_LEVELS }).notNull().default('minimal'),
    lastInterventionAt: integer('last_intervention_at', { mode: 'timestamp' }),
    interventionsCount: integer('interventions_count').notNull().default(0),
    metadata: text('metadata').default('{}'), // JSON: custom settings
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    conversationIdx: index('idx_therapist_config_conversation').on(table.conversationId),
    enabledIdx: index('idx_therapist_config_enabled').on(table.enabled),
  })
);

// Dyad Emotional States table - Track emotional patterns per user in dyads
export const dyadEmotionalStates = sqliteTable(
  'dyadEmotionalStates',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    primaryEmotion: text('primary_emotion').notNull(), // e.g., 'happy', 'frustrated', 'anxious', 'neutral'
    emotionIntensity: integer('emotion_intensity').notNull().default(50), // 0-100 scale
    emotionTrend: text('emotion_trend', { enum: ['improving', 'stable', 'declining', 'volatile'] }).notNull().default('stable'),
    lastAnalyzedAt: integer('last_analyzed_at', { mode: 'timestamp' }).notNull(),
    analysisData: text('analysis_data').default('{}'), // JSON: detailed emotion analysis
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    conversationIdx: index('idx_dyad_emotional_conversation').on(table.conversationId),
    userIdx: index('idx_dyad_emotional_user').on(table.userId),
    conversationUserIdx: index('idx_dyad_emotional_conversation_user').on(table.conversationId, table.userId),
    analyzedAtIdx: index('idx_dyad_emotional_analyzed_at').on(table.lastAnalyzedAt),
  })
);

// Conversation Dynamics table - Communication pattern analysis
export const conversationDynamics = sqliteTable(
  'conversationDynamics',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tensionLevel: integer('tension_level').notNull().default(0), // 0-100 scale
    conflictDetected: integer('conflict_detected', { mode: 'boolean' }).notNull().default(false),
    conflictType: text('conflict_type'), // e.g., 'misunderstanding', 'disagreement', 'escalation'
    positiveMomentsCount: integer('positive_moments_count').notNull().default(0),
    turnTakingBalance: real('turn_taking_balance').notNull().default(0.5), // 0-1 (0.5 = balanced)
    topicCoherence: real('topic_coherence').notNull().default(0.5), // 0-1
    supportPatterns: text('support_patterns').default('[]'), // JSON array of detected support patterns
    lastAnalyzedAt: integer('last_analyzed_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    conversationIdx: index('idx_conversation_dynamics_conversation').on(table.conversationId),
    tensionIdx: index('idx_conversation_dynamics_tension').on(table.tensionLevel),
    conflictIdx: index('idx_conversation_dynamics_conflict').on(table.conflictDetected),
    analyzedAtIdx: index('idx_conversation_dynamics_analyzed_at').on(table.lastAnalyzedAt),
  })
);
