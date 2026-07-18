import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { logger } from './utils/logger.js';
import { appConfig } from './config/index.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, connection } from './db/client.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  MS_PER_MINUTE,
  MS_PER_HOUR,
  FIVE_MINUTES_MS,
  THIRTY_MINUTES_MS,
  MEMORY_CLEANUP_INTERVAL_MS,
} from './config/constants.js';
import {
  telegramService,
  mediaService,
  ingestionService,
  processorService,
  llmService,
  priorityEscalationService,
  deadLetterQueueService,
  semanticCacheService,
  healthService,
  metricsService,
  proactiveSchedulerService,
  memoryService,
  pm2RestartMonitorService,
} from './services/index.js';
import {
  queueRepository,
  messageRepository,
  chatRepository,
  senderRepository,
  proactiveJobRepository,
  proactiveRunRepository,
  memoryRepository,
  embeddingRepository,
} from './repositories/index.js';
import { setupMessageHandler } from './handlers/index.js';
import {
  RetryWorker,
  PriorityEscalationWorker,
  DLQCleanupWorker,
  CacheCleanupWorker,
  QueueCleanupWorker,
  ProactiveWorker,
  MemoryCleanupWorker,
  TelegramWatchdogWorker,
} from './workers/index.js';
import { STALE_HARD_RECONNECT_MULTIPLIER } from './services/telegram.service.js';
import { SlackService } from './platforms/slack/index.js';
import { CeoModule, DEFAULT_CEO_CONFIG } from './modules/ceo/index.js';
import { moduleRegistry } from './modules/index.js';
import { ShutdownRegistry } from './utils/shutdown-registry.js';
import { getErrorMessage } from './utils/error-utils.js';
import {
  isTelegramConnectionError,
  isNonCriticalError,
  formatErrorForLog,
} from './utils/error-classification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const MEMORY_STATS_INTERVAL_MS = 300000; // 5 minutes
const MEMORY_LEAK_THRESHOLD_MB = 20; // Warn if growing more than 20MB per hour
const MIN_HEAP_FOR_PERCENT_WARNING_MB = 100;
const PM2_RESTART_THRESHOLD = 10;
const PM2_TIME_WINDOW_MS = MS_PER_HOUR; // 1 hour
const PM2_COOLDOWN_MS = THIRTY_MINUTES_MS; // 30 minutes
const PM2_CHECK_INTERVAL_MS = MS_PER_MINUTE; // 1 minute

// Global worker instances
let retryWorker: RetryWorker;
let priorityEscalationWorker: PriorityEscalationWorker;
let dlqCleanupWorker: DLQCleanupWorker;
let cacheCleanupWorker: CacheCleanupWorker;
let memoryCleanupWorker: MemoryCleanupWorker;
let memoryStatsInterval: NodeJS.Timeout | null = null;
let queueCleanupWorker: QueueCleanupWorker;
let proactiveWorker: ProactiveWorker | null = null;
let telegramWatchdogWorker: TelegramWatchdogWorker | null = null;
let slackService: SlackService | null = null;

// Shutdown registry instance
const shutdownRegistry = new ShutdownRegistry(15000, 3000); // 15s total, 3s per handler

// ============================================================================
// Database Phase
// ============================================================================

async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  try {
    migrate(db, { migrationsFolder: join(__dirname, 'db', 'migrations') });
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

// ============================================================================
// Configuration Validation Phase
// ============================================================================

function validateConfiguration(): void {
  const telegramEnabled = appConfig.telegram.enabled;

  if (!telegramEnabled) {
    logger.info('Telegram disabled, skipping credential validation');
    return;
  }

  const { apiId, apiHash, phoneNumber } = appConfig.telegram;

  if (!apiId || !apiHash) {
    logger.error('Missing Telegram API credentials');
    logger.error('  - API_ID: ' + (apiId ? 'set' : 'NOT SET'));
    logger.error('  - API_HASH: ' + (apiHash ? 'set' : 'NOT SET'));
    logger.error('Set these in your .env file from https://my.telegram.org/apps');
    throw new Error('Telegram API credentials not configured');
  }

  if (!phoneNumber) {
    logger.warn('PHONE_NUMBER not set in .env - will prompt for input');
  } else {
    logger.info(`Phone number configured: ${phoneNumber}`);
  }
}

// ============================================================================
// Database Initialization Phase
// ============================================================================

async function initializeDatabase(): Promise<void> {
  await runMigrations();
  logger.info('Media service initialized');
}

// ============================================================================
// Startup Queue Recovery Phase
// ============================================================================

/**
 * Reset any queue items stuck in 'processing' status from a previous unclean shutdown.
 * This handles cases where the process was killed (SIGKILL, OOM) before the
 * graceful shutdown handler could reset them.
 */
async function recoverStuckQueueItems(): Promise<void> {
  try {
    const resetCount = await queueRepository.resetAllProcessingForShutdown();
    if (resetCount > 0) {
      logger.info(`[Bootstrap] Recovered ${resetCount} stuck processing queue item(s) from previous run`);
    }
  } catch (error) {
    logger.warn('[Bootstrap] Failed to recover stuck queue items', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Services Initialization Phase
// ============================================================================

async function initializeServices(): Promise<void> {
  // Initialize Ollama load tracker
  const ollamaMaxConcurrent = parseInt(process.env.OLLAMA_MAX_CONCURRENT || '2', 10);
  const { initOllamaLoadTracker } = await import('./utils/ollama-load-tracker.js');
  initOllamaLoadTracker(ollamaMaxConcurrent);

  // Initialize LLM service
  await llmService.initialize();
  const llmHealth = llmService.getHealthStatus();
  if (llmHealth.enabled && !llmHealth.healthy) {
    logger.warn('[Bootstrap] LLM service unhealthy - running in degraded mode');
  }

  // Backfill missing memory embeddings
  if (appConfig.memory.enabled && appConfig.embedding.enabled) {
    try {
      const backfilledCount = await memoryService.backfillMissingEmbeddings();
      if (backfilledCount > 0) {
        logger.info(`[Bootstrap] Backfilled ${backfilledCount} missing memory embedding(s)`);
      }
    } catch (error) {
      logger.warn('[Bootstrap] Failed to backfill memory embeddings', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// ============================================================================
// Platform Initialization Phase
// ============================================================================

async function initializePlatforms(): Promise<void> {
  const telegramEnabled = appConfig.telegram.enabled;
  const slackEnabled = appConfig.slack.enabled;

  // Initialize Telegram platform
  if (telegramEnabled) {
    logger.info('Attempting to connect to Telegram...');
    await telegramService.connect();

    const me = await telegramService.getMe();
    logger.info(`Connected as: ${me.firstName} (@${me.username})`);

    // Setup message handlers with reconnection support
    const client = telegramService.getClient();
    const handlerSetup = (c: typeof client) => {
      setupMessageHandler(c, ingestionService, telegramService);
    };

    telegramService.setHandlerSetupFn(handlerSetup);
    handlerSetup(client);
    telegramService.markHandlersRegistered();
    logger.info('Message handlers registered');
  } else {
    logger.info('Telegram disabled, skipping connection');
  }

  // Initialize Slack platform
  if (slackEnabled) {
    logger.info('[Slack] Initializing Slack platform...');

    slackService = new SlackService({
      enabled: true,
      botToken: appConfig.slack.botToken,
      appToken: appConfig.slack.appToken,
      channelId: appConfig.slack.channelId,
      testUserId: appConfig.slack.testUserId,
    });

    await slackService.start();
    moduleRegistry.registerPlatformWithModules(slackService);
    logger.info('[Slack] Platform initialized and registered');
  }
}

// ============================================================================
// Workers Initialization Phase
// ============================================================================

async function startWorkers(): Promise<void> {
  // Start retry worker
  retryWorker = new RetryWorker(
    queueRepository,
    messageRepository,
    chatRepository,
    senderRepository,
    processorService
  );
  retryWorker.startRetryWorker();
  logger.info('Retry worker started');

  // Start priority escalation worker
  if (appConfig.priorityEscalation.enabled) {
    priorityEscalationWorker = new PriorityEscalationWorker(priorityEscalationService);
    priorityEscalationWorker.start(appConfig.priorityEscalation.checkIntervalMs);
    logger.info('Priority escalation worker started');
  }

  // Start DLQ cleanup worker
  dlqCleanupWorker = new DLQCleanupWorker(
    deadLetterQueueService,
    appConfig.deadLetterQueue.retentionDays
  );
  dlqCleanupWorker.start(appConfig.deadLetterQueue.cleanupIntervalMs);
  logger.info('DLQ cleanup worker started');

  // Start cache cleanup worker
  if (appConfig.cache.enabled) {
    cacheCleanupWorker = new CacheCleanupWorker(semanticCacheService);
    cacheCleanupWorker.start(appConfig.cache.cleanupIntervalMs);
    logger.info('Cache cleanup worker started');
  }

  // Start memory cleanup worker
  memoryCleanupWorker = new MemoryCleanupWorker();
  memoryCleanupWorker.start(MEMORY_CLEANUP_INTERVAL_MS); // 1 hour
  logger.info('Memory cleanup worker started');

  // Start memory stats logging
  startMemoryStatsLogging();

  // Start queue cleanup worker
  queueCleanupWorker = new QueueCleanupWorker(
    queueRepository,
    appConfig.queueCleanup.retentionDays,
    appConfig.queueCleanup.stuckThresholdMs
  );
  queueCleanupWorker.setMetricsService(metricsService);
  queueCleanupWorker.start(appConfig.queueCleanup.cleanupIntervalMs);
  logger.info('Queue cleanup worker started with stuck message detection and metrics', {
    cleanupIntervalMs: appConfig.queueCleanup.cleanupIntervalMs,
    stuckThresholdMs: appConfig.queueCleanup.stuckThresholdMs,
  });

  // Start Telegram connection watchdog (heals the zombie-connection state where
  // the process stays alive but the client stops receiving/sending messages)
  if (appConfig.telegram.enabled && appConfig.telegram.watchdogEnabled) {
    telegramWatchdogWorker = new TelegramWatchdogWorker(
      {
        getConnectionStatus: () => {
          const status = telegramService.getConnectionStatus();
          return {
            connected: status.connected,
            reconnecting: status.reconnecting,
            lastUpdate: status.lastUpdate,
            outboundQueueSize: status.outboundQueueSize,
          };
        },
        forceReconnect: () => telegramService.forceReconnect(),
        restartProcess: () => {
          logger.error('[TelegramWatchdog] Exiting process for PM2 to restart a fresh instance');
          process.exit(1);
        },
      },
      {
        // The service itself defers stale reconnects while the connection
        // validates; the watchdog is the backstop, so it only intervenes at
        // the hard threshold.
        staleUpdateThresholdMs: appConfig.telegram.staleUpdateThresholdMs * STALE_HARD_RECONNECT_MULTIPLIER,
        restartAfterDownMs: appConfig.telegram.watchdogRestartAfterDownMs,
        stuckReconnectingThresholdMs: appConfig.telegram.watchdogStuckReconnectingThresholdMs,
        enableRestartEscalation: appConfig.telegram.watchdogRestartEscalationEnabled,
      }
    );
    telegramWatchdogWorker.start(appConfig.telegram.watchdogIntervalMs);
    logger.info('Telegram watchdog worker started', {
      intervalMs: appConfig.telegram.watchdogIntervalMs,
      restartAfterDownMs: appConfig.telegram.watchdogRestartAfterDownMs,
    });
  }

  // Start proactive messaging system
  if (appConfig.proactive.enabled && proactiveSchedulerService) {
    await startProactiveMessaging();
  }

  // Start CEO module
  if (appConfig.ceo.enabled) {
    await startCeoModule();
  }

  // Log therapist mode status (event-driven via message processor, no worker needed)
  if (appConfig.therapist.enabled) {
    logger.info('[Therapist] Therapist/Listener mode enabled', {
      autoDetect: appConfig.therapist.autoDetect,
      requiresConsent: appConfig.therapist.requiresConsent,
      emotionalAnalysis: appConfig.therapist.emotionalAnalysis,
      minMessagesBeforeIntervention: appConfig.therapist.minMessagesBeforeIntervention,
      maxResponsesPerHour: appConfig.therapist.maxResponsesPerHour,
      responseCooldownMs: appConfig.therapist.responseCooldownMs,
    });
  } else {
    logger.info('[Therapist] Therapist/Listener mode disabled');
  }

  // Start PM2 restart monitor
  if (appConfig.telegram.enabled) {
    startPm2RestartMonitor();
  } else {
    logger.info('[PM2] Skipping PM2 restart monitor - Telegram disabled');
  }
}

/**
 * Starts memory statistics logging at regular intervals.
 * Tracks memory growth for leak detection.
 */
function startMemoryStatsLogging(): void {
  let lastHeapUsedMB = 0;
  let growthReadings: number[] = []; // Track last 12 readings (1 hour)

  const logMemoryStats = () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const rssMB = memUsage.rss / 1024 / 1024;
    const externalMB = memUsage.external / 1024 / 1024;
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    // Calculate growth rate
    const growthMB = lastHeapUsedMB > 0 ? heapUsedMB - lastHeapUsedMB : 0;
    growthReadings.push(growthMB);
    if (growthReadings.length > 12) {
      growthReadings.shift(); // Keep last 12 readings (1 hour)
    }
    const avgGrowthPerInterval = growthReadings.reduce((a, b) => a + b, 0) / growthReadings.length;
    const totalGrowthLastHour = growthReadings.reduce((a, b) => a + b, 0);
    lastHeapUsedMB = heapUsedMB;

    const logData = {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      rssMB: Math.round(rssMB * 100) / 100,
      externalMB: Math.round(externalMB * 100) / 100,
      heapUsagePercent: Math.round(heapUsagePercent * 100) / 100,
      growthMB: Math.round(growthMB * 100) / 100,
      avgGrowthPer5minMB: Math.round(avgGrowthPerInterval * 100) / 100,
      totalGrowthLastHourMB: Math.round(totalGrowthLastHour * 100) / 100,
    };

    // Only warn on percentage for heaps > 100MB; small heaps routinely hit 90%+
    if (
      heapTotalMB > MIN_HEAP_FOR_PERCENT_WARNING_MB &&
      heapUsagePercent >= appConfig.performance.memoryWarningThreshold
    ) {
      logger.warn('Memory usage above threshold', logData);
    } else if (totalGrowthLastHour > MEMORY_LEAK_THRESHOLD_MB) {
      logger.warn('Potential memory leak detected - sustained growth', logData);
    } else {
      logger.info('Memory statistics', logData);
    }
  };

  // Log initial stats
  logMemoryStats();

  // Log every 5 minutes
  memoryStatsInterval = setInterval(logMemoryStats, MEMORY_STATS_INTERVAL_MS);
  logger.info('Memory stats logging started (interval: 5 minutes)');
}

/**
 * Starts the proactive messaging system.
 */
async function startProactiveMessaging(): Promise<void> {
  const { seedDefaultJobs } = await import('./services/proactive/seed-defaults.js');
  const seededCount = await seedDefaultJobs(proactiveJobRepository, {
    defaultTimezone: appConfig.proactive.defaultTimezone,
    targetChatId: appConfig.proactive.targetChatId,
  });

  if (seededCount > 0) {
    logger.info(`[Proactive] Seeded ${seededCount} default job(s)`);
  }

  // Reset any jobs stuck in 'running' status from a previous crash
  const resetCount = await proactiveJobRepository.resetStaleRunningJobs();
  if (resetCount > 0) {
    logger.warn(`[Proactive] Reset ${resetCount} stale running job(s) from previous crash`);
  }

  await proactiveSchedulerService!.start();
  const schedulerState = proactiveSchedulerService!.getState();
  logger.info('[Proactive] Scheduler started', {
    nextWakeTime: schedulerState.nextWakeTime?.toISOString() ?? null,
  });

  proactiveWorker = new ProactiveWorker(
    proactiveJobRepository,
    proactiveRunRepository,
    {
      stuckJobThresholdMs: appConfig.proactive.stuckJobThresholdMs,
      runHistoryRetentionDays: appConfig.proactive.runHistoryRetentionDays,
    }
  );
  proactiveWorker.start(appConfig.proactive.workerIntervalMs);
  logger.info('[Proactive] Cleanup worker started (stuck runs, old runs)', {
    intervalMs: appConfig.proactive.workerIntervalMs,
  });
}

/**
 * Starts the CEO module for Slack.
 */
async function startCeoModule(): Promise<void> {
  const claudeCliPath = process.env.CLAUDE_CLI_PATH || 'claude';
  const mcpConfigPath = appConfig.ceo.mcpConfigPath || '';

  const ceoConfig = {
    ...DEFAULT_CEO_CONFIG,
    enabled: appConfig.ceo.enabled,
    claudeCliPath,
    mcpConfigPath,
    scheduledEnabled: appConfig.ceo.scheduledEnabled,
    monitorEnabled: appConfig.ceo.monitorEnabled,
  };

  const ceoModule = new CeoModule();
  moduleRegistry.registerModule(ceoModule);

  await moduleRegistry.initializeAll({
    config: ceoConfig,
    claudeCliPath,
    mcpConfigPath,
    logger: {
      info: (msg, data) => logger.info(msg, data),
      warn: (msg, data) => logger.warn(msg, data),
      error: (msg, data) => logger.error(msg, data),
      debug: (msg, data) => logger.debug(msg, data),
    },
  });

  await moduleRegistry.startAll();
  logger.info('[Modules] CEO module initialized and started');
}

/**
 * Starts the PM2 restart monitor for restart count alerting.
 */
function startPm2RestartMonitor(): void {
  logger.info('[PM2] Starting PM2 restart monitor');

  pm2RestartMonitorService.setTelegramService(telegramService);
  pm2RestartMonitorService.setOwnerTelegramId(appConfig.security.ownerTelegramId || null);

  pm2RestartMonitorService.updateConfig({
    restartThreshold: PM2_RESTART_THRESHOLD,
    timeWindowMs: PM2_TIME_WINDOW_MS,
    cooldownMs: PM2_COOLDOWN_MS,
  });

  pm2RestartMonitorService.startMonitoring(PM2_CHECK_INTERVAL_MS);
  logger.info('[PM2] Restart monitor started', {
    restartThreshold: PM2_RESTART_THRESHOLD,
    timeWindowMinutes: 60,
    ownerTelegramId: appConfig.security.ownerTelegramId || 'not set',
  });
}

// ============================================================================
// Startup Checks Phase
// ============================================================================

async function runStartupChecks(): Promise<void> {
  // Diagnose and clean up malformed embedding rows that cause sqlite-vec JSON parsing errors
  try {
    const cleaned = await embeddingRepository.cleanupMalformedEmbeddings();
    if (cleaned > 0) {
      logger.warn(`[Startup] Cleaned up ${cleaned} malformed embedding row(s)`);
    }
  } catch (error) {
    logger.warn('[Startup] Embedding cleanup failed (non-fatal)', {
      error: getErrorMessage(error),
    });
  }

  // Clean up orphaned user_id references in memories
  try {
    const cleaned = await memoryRepository.cleanupOrphanedUserIds();
    if (cleaned > 0) {
      logger.warn(`[Startup] Cleaned up ${cleaned} orphaned user_id reference(s) in memories`);
    }
  } catch (error) {
    logger.warn('[Startup] Memory user_id cleanup failed (non-fatal)', {
      error: getErrorMessage(error),
    });
  }

  const startupHealth = await healthService.getSystemHealth();
  const unhealthyComponents = startupHealth.components
    .filter(c => c.status !== 'healthy')
    .map(c => `${c.name}: ${c.status}`);

  if (unhealthyComponents.length > 0) {
    logger.warn('[Startup] Some components are not healthy:', { unhealthyComponents });
  } else {
    logger.info('[Startup] All health checks passed');
  }

  const platforms = [
    appConfig.telegram.enabled && 'Telegram',
    appConfig.slack.enabled && 'Slack',
  ]
    .filter(Boolean)
    .join(', ');

  logger.info(`Jarvis Service is running (${platforms}). Press Ctrl+C to stop.`);
}

// ============================================================================
// Shutdown Handler Registration
// ============================================================================

function registerShutdownHandlers(): void {
  // Priority 10: Queue reset (must be first to prevent message loss)
  shutdownRegistry.register(
    'Queue reset',
    async () => {
      const resetCount = await queueRepository.resetAllProcessingForShutdown();
      if (resetCount > 0) {
        logger.info(`Reset ${resetCount} processing message(s) to pending for restart`);
      }
    },
    10
  );

  // Priority 20: Stop workers
  shutdownRegistry.register(
    'Retry worker',
    () => {
      if (retryWorker && retryWorker['timer']) {
        retryWorker.stopRetryWorker(retryWorker['timer']);
      }
    },
    20
  );

  shutdownRegistry.register(
    'Priority escalation worker',
    () => priorityEscalationWorker?.stop(),
    21
  );

  shutdownRegistry.register('DLQ cleanup worker', () => dlqCleanupWorker?.stop(), 22);

  shutdownRegistry.register(
    'Memory stats logging',
    () => {
      if (memoryStatsInterval) {
        clearInterval(memoryStatsInterval);
        memoryStatsInterval = null;
      }
    },
    23
  );

  shutdownRegistry.register('Cache cleanup worker', () => cacheCleanupWorker?.stop(), 24);

  shutdownRegistry.register('Memory cleanup worker', () => memoryCleanupWorker?.stop(), 25);

  shutdownRegistry.register('Queue cleanup worker', () => queueCleanupWorker?.stop(), 26);

  shutdownRegistry.register('Telegram watchdog worker', () => telegramWatchdogWorker?.stop(), 27);

  shutdownRegistry.register(
    'Proactive backup worker',
    () => proactiveWorker?.stop(),
    30
  );

  shutdownRegistry.register(
    'Proactive scheduler',
    () => proactiveSchedulerService?.stop(),
    31
  );

  // Priority 40: Stop modules
  shutdownRegistry.register('All modules', () => moduleRegistry.stopAll(), 40);

  // Priority 50: Stop monitoring
  shutdownRegistry.register(
    'PM2 restart monitor',
    () => {
      const { getPM2RestartMonitorService } = require('./services/instances/index');
      getPM2RestartMonitorService().stopMonitoring();
    },
    50
  );

  // Priority 60: Stop platforms
  shutdownRegistry.register('Slack service', () => slackService?.stop(), 60);

  // Priority 70: Stop core services
  shutdownRegistry.register('Processor service', () => processorService.stop(), 70);

  shutdownRegistry.register('LLM service', () => llmService.shutdown(), 71);

  shutdownRegistry.register(
    'Telegram client',
    async () => {
      if (appConfig.telegram.enabled) {
        await telegramService.disconnect();
      }
    },
    72
  );

  // Priority 80: Close database (must be last)
  shutdownRegistry.register(
    'Database connection',
    () => {
      connection.close();
    },
    80
  );
}

// ============================================================================
// Bootstrap
// ============================================================================

async function bootstrap(): Promise<void> {
  const telegramEnabled = appConfig.telegram.enabled;
  const slackEnabled = appConfig.slack.enabled;

  logger.info('Starting Jarvis Service...', { telegramEnabled, slackEnabled });

  // Record startup time for system uptime tracking
  const { systemService } = await import('./services/index.js');
  systemService.recordStartupTime().catch((err: unknown) => {
    logger.warn('[Bootstrap] Failed to record startup time', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Phase 1: Validate configuration
  validateConfiguration();

  // Phase 2: Initialize database
  await initializeDatabase();

  // Phase 2.5: Recover any queue items stuck in 'processing' from a previous crash
  await recoverStuckQueueItems();

  // Phase 3: Initialize services
  await initializeServices();

  // Phase 4: Initialize platforms
  await initializePlatforms();

  // Phase 5: Start workers
  await startWorkers();

  // Phase 6: Run startup checks
  await runStartupChecks();

  // Register shutdown handlers
  registerShutdownHandlers();
}

// ============================================================================
// Global Error Handlers
// ============================================================================

/**
 * Helper to write logs to file only (no console output).
 * Used for errors that should not trigger PM2 restarts via stderr.
 */
function writeLogToFileOnly(level: 'info' | 'warn' | 'error', context: string, message: string): void {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}\n`;
  const { writeFileSync, join } = require('fs');
  const LOG_FILE = join(process.cwd(), 'logs', 'jarvis.log');
  const ERROR_LOG_FILE = join(process.cwd(), 'logs', 'jarvis-error.log');

  try {
    writeFileSync(LOG_FILE, formattedMessage, { flag: 'a' });
    if (level === 'error') {
      writeFileSync(ERROR_LOG_FILE, formattedMessage, { flag: 'a' });
    }
  } catch {
    // Silently fail to avoid infinite recursion
  }
}

process.on('uncaughtException', (error: Error) => {
  const errorMessage = formatErrorForLog(error);

  // For Telegram TIMEOUT errors, handle silently without writing to stderr to avoid PM2 restarts
  const isTelegramTimeout = error.message === 'TIMEOUT' &&
    error.stack?.includes('telegram/client/updates.js');

  if (appConfig.telegram.enabled && isTelegramTimeout) {
    // Log only to file to avoid PM2 detecting the error
    writeLogToFileOnly('error', 'Telegram', 'Telegram TIMEOUT error caught, attempting reconnection...');
    telegramService.forceReconnect().catch((reconnectError) => {
      writeLogToFileOnly('error', 'Telegram', `Reconnection failed: ${String(reconnectError)}`);
    });
    return;
  }

  // For other Telegram connection errors, try to recover instead of shutting down
  if (appConfig.telegram.enabled && isTelegramConnectionError(error)) {
    logger.warn('[Recovery] Telegram connection error detected, attempting reconnection...');
    telegramService.forceReconnect().catch((reconnectError) => {
      logger.error('[Recovery] Reconnection failed:', reconnectError);
    });
    return;
  }

  // For non-critical errors, just log and continue
  if (isNonCriticalError(error)) {
    logger.warn('[Recovery] Non-critical error detected, continuing operation', {
      error: errorMessage,
    });
    return;
  }

  logger.error('Uncaught Exception:', { error: errorMessage });
  shutdownRegistry.shutdownAll('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason: unknown) => {
  const errorMessage = formatErrorForLog(reason);

  // For Telegram TIMEOUT errors, handle silently without writing to stderr to avoid PM2 restarts
  const isTelegramTimeout = reason instanceof Error &&
    reason.message === 'TIMEOUT' &&
    reason.stack?.includes('telegram/client/updates.js');

  if (appConfig.telegram.enabled && isTelegramTimeout) {
    // Log only to file to avoid PM2 detecting the error
    writeLogToFileOnly('error', 'Telegram', 'Telegram TIMEOUT rejection caught, attempting reconnection...');
    telegramService.forceReconnect().catch((reconnectError) => {
      writeLogToFileOnly('error', 'Telegram', `Reconnection failed: ${String(reconnectError)}`);
    });
    return;
  }

  // For other Telegram connection errors, try to recover instead of shutting down
  if (appConfig.telegram.enabled && isTelegramConnectionError(reason)) {
    logger.warn('[Recovery] Telegram connection error detected, attempting reconnection...');
    telegramService.forceReconnect().catch((reconnectError) => {
      logger.error('[Recovery] Reconnection failed:', reconnectError);
    });
    return;
  }

  // For non-critical errors, just log and continue
  if (isNonCriticalError(reason)) {
    logger.warn('[Recovery] Non-critical error detected, continuing operation', {
      error: errorMessage,
    });
    return;
  }

  logger.error('Unhandled Rejection:', { error: errorMessage });
  shutdownRegistry.shutdownAll('unhandledRejection').catch(() => process.exit(1));
});

// Graceful shutdown handlers
process.on('SIGINT', () => shutdownRegistry.shutdownAll('SIGINT'));
process.on('SIGTERM', () => shutdownRegistry.shutdownAll('SIGTERM'));

// SIGHUP handler for configuration reload
process.on('SIGHUP', () => {
  logger.info('[SIGHUP] Configuration reload signal received');
  logger.info('[SIGHUP] To reload configuration, restart the service or use runtime-config API');
});

// Start the application
bootstrap().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});
