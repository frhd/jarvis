/**
 * ProactiveExecutorService
 *
 * Orchestrates the execution of a single proactive job: resolves the target
 * chat, performs idle detection for check-in jobs, builds the message context,
 * generates the message via LLM, delivers it through Telegram, and records
 * the run result. Implements IProactiveExecutor so the scheduler can invoke
 * it without knowing the concrete implementation.
 *
 * Design decisions:
 * - executeJob NEVER throws — all errors are caught, recorded, and returned
 * - All dependencies are injected as duck-typed interfaces for testability
 * - Optional services (userPreferenceService, contextManagerService) degrade
 *   gracefully when null
 * - Duration is measured and included in run completion for observability
 */

import type { ProactiveJob } from '../../types/index.js';
import type {
  ProactiveMessageContext,
  ProactiveMessageResult,
  ProactiveJobStatus,
  ProactiveDeliveryStatus,
  ProactiveContextConfig,
} from '../../types/proactive.types.js';
import type { IProactiveExecutor } from './scheduler.service.js';
import { createLogger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger('proactive-executor');

// ---------------------------------------------------------------------------
// Dependency interfaces (duck-typed for testability)
// ---------------------------------------------------------------------------

export interface IRunRepository {
  startRun(jobId: string): Promise<{ id: string; jobId: string; startedAt: Date }>;
  completeRun(
    id: string,
    result: {
      status: ProactiveJobStatus;
      generatedMessage?: string;
      deliveryStatus?: ProactiveDeliveryStatus;
      error?: string;
      tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; model: string };
      durationMs?: number;
    },
  ): Promise<unknown>;
  findByJobId?(jobId: string, limit?: number): Promise<Array<{
    status: string;
    generatedMessage: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }>>;
}

export interface IMessageRepository {
  findRecentByChatId(chatId: string, limit?: number): Promise<Array<{
    text: string | null;
    createdAt: Date;
    isBot: boolean;
    chatId: string;
    senderId: string | null;
  }>>;
}

export interface IMessageGenerator {
  generate(context: ProactiveMessageContext): Promise<ProactiveMessageResult>;
}

export interface ITelegramService {
  sendMessage(chatId: string | number, text: string): Promise<unknown>;
}

export interface IUserPreferenceService {
  getPreferences(senderId: string): Promise<Array<{ category: string; key: string; value: string; senderId: string }>>;
}

export interface IContextManagerService {
  buildContext(query: string, options: Record<string, unknown>): Promise<{ context: string }>;
}

export interface ISenderInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

export interface ISenderRepository {
  findById(id: string): Promise<ISenderInfo | null>;
}

export interface ExecutorConfig {
  targetChatId?: string;
  defaultTimezone: string;
  defaultContextMessages: number;
}

// ---------------------------------------------------------------------------
// Default idle threshold (12 hours in milliseconds)
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_THRESHOLD_MS = 43_200_000;

/** Skip check-in after this many consecutive unanswered sends */
const MAX_UNANSWERED_CHECKINS = 3;

/** Number of messages to fetch for idle detection */
const IDLE_CHECK_MESSAGE_WINDOW = 10;

/** Number of recent proactive runs to include for repetition avoidance */
const RECENT_PROACTIVE_RUNS_LIMIT = 3;

// ---------------------------------------------------------------------------
// ProactiveExecutorService
// ---------------------------------------------------------------------------

export class ProactiveExecutorService implements IProactiveExecutor {
  private runRepo: IRunRepository;
  private messageRepo: IMessageRepository;
  private messageGenerator: IMessageGenerator;
  private telegramService: ITelegramService;
  private config: ExecutorConfig;
  private userPreferenceService: IUserPreferenceService | null;
  private contextManagerService: IContextManagerService | null;
  private senderRepo: ISenderRepository | null;

  constructor(
    runRepo: IRunRepository,
    messageRepo: IMessageRepository,
    messageGenerator: IMessageGenerator,
    telegramService: ITelegramService,
    config: ExecutorConfig,
    userPreferenceService?: IUserPreferenceService | null,
    contextManagerService?: IContextManagerService | null,
    senderRepo?: ISenderRepository | null,
  ) {
    this.runRepo = runRepo;
    this.messageRepo = messageRepo;
    this.messageGenerator = messageGenerator;
    this.telegramService = telegramService;
    this.config = config;
    this.userPreferenceService = userPreferenceService ?? null;
    this.contextManagerService = contextManagerService ?? null;
    this.senderRepo = senderRepo ?? null;
  }

  // -------------------------------------------------------------------------
  // IProactiveExecutor implementation
  // -------------------------------------------------------------------------

  /**
   * Execute a proactive job end-to-end. NEVER throws — all errors are caught
   * and returned as `{ status: 'error', error: string }`.
   */
  async executeJob(job: ProactiveJob): Promise<{ status: 'ok' | 'error' | 'skipped'; error?: string }> {
    const startTime = Date.now();
    let run: { id: string; jobId: string; startedAt: Date } | null = null;

    try {
      // -- Start run record ---------------------------------------------------
      run = await this.runRepo.startRun(job.id);

      // -- Resolve target chat ------------------------------------------------
      const targetChatId = this.resolveTargetChat(job);

      // -- Idle check for check-in jobs ---------------------------------------
      if (job.messageType === 'checkin') {
        const thresholdMs = this.getIdleThreshold(job);
        const userIsIdle = await this.isUserIdle(targetChatId, thresholdMs);

        if (!userIsIdle) {
          const durationMs = Date.now() - startTime;

          await this.runRepo.completeRun(run.id, {
            status: 'skipped',
            error: 'User is not idle — skipping check-in',
            durationMs,
          });

          logger.info('Check-in skipped: user is not idle', {
            jobId: job.id,
            jobName: job.name,
            targetChatId,
            durationMs,
          });

          return { status: 'skipped' };
        }

        // -- Backoff: skip if too many unanswered check-ins ----------------------
        const unanswered = await this.countUnansweredSends(job, targetChatId);
        if (unanswered >= MAX_UNANSWERED_CHECKINS) {
          const durationMs = Date.now() - startTime;

          await this.runRepo.completeRun(run.id, {
            status: 'skipped',
            error: `backoff: user not responding (${unanswered} unanswered)`,
            durationMs,
          });

          logger.info('Check-in skipped: backoff due to unanswered sends', {
            jobId: job.id,
            jobName: job.name,
            targetChatId,
            unanswered,
            durationMs,
          });

          return { status: 'skipped' };
        }
      }

      // -- Build message context ----------------------------------------------
      const context = await this.buildMessageContext(job, targetChatId);

      // -- Generate message via LLM ------------------------------------------
      const result = await this.messageGenerator.generate(context);

      // -- Send via Telegram --------------------------------------------------
      await this.telegramService.sendMessage(targetChatId, result.message);

      // -- Complete run as success --------------------------------------------
      const durationMs = Date.now() - startTime;

      await this.runRepo.completeRun(run.id, {
        status: 'ok',
        generatedMessage: result.message,
        deliveryStatus: 'sent' as ProactiveDeliveryStatus,
        tokenUsage: result.tokenUsage,
        durationMs,
      });

      logger.info('Job executed successfully', {
        jobId: job.id,
        jobName: job.name,
        targetChatId,
        model: result.model,
        durationMs,
      });

      return { status: 'ok' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;

      logger.error('Job execution failed', {
        jobId: job.id,
        jobName: job.name,
        error: errorMessage,
        durationMs,
      });

      // Complete run as error if we have a run record
      if (run) {
        try {
          await this.runRepo.completeRun(run.id, {
            status: 'error',
            error: errorMessage,
            durationMs,
          });
        } catch (completeError) {
          const completeErrMsg = completeError instanceof Error ? completeError.message : String(completeError);
          logger.error('Failed to record run completion after error', {
            runId: run.id,
            error: completeErrMsg,
          });
        }
      }

      return { status: 'error', error: errorMessage };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the target chat ID for a job.
   * Priority: job.targetChatId > config.targetChatId > throw error.
   */
  private resolveTargetChat(job: ProactiveJob): string {
    if (job.targetChatId) {
      return job.targetChatId;
    }

    if (this.config.targetChatId) {
      return this.config.targetChatId;
    }

    throw new Error(`No target chat ID available for job "${job.name}" (${job.id})`);
  }

  /**
   * Determine the idle threshold for a check-in job.
   * For 'every' schedule type, uses the scheduleValue (ms) as the threshold.
   * Otherwise defaults to 12 hours.
   */
  private getIdleThreshold(job: ProactiveJob): number {
    if (job.scheduleType === 'every') {
      const parsed = parseInt(job.scheduleValue, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return DEFAULT_IDLE_THRESHOLD_MS;
  }

  /**
   * Check if the user is idle (no non-bot messages within the threshold).
   * Returns true if user is idle (we should send the check-in).
   */
  private async isUserIdle(chatId: string, thresholdMs: number): Promise<boolean> {
    const recentMessages = await this.messageRepo.findRecentByChatId(chatId, IDLE_CHECK_MESSAGE_WINDOW);

    // No messages at all — consider idle
    if (!recentMessages || recentMessages.length === 0) {
      return true;
    }

    // Find the latest non-bot message
    const latestNonBot = recentMessages.find((msg) => !msg.isBot);

    if (!latestNonBot) {
      // Only bot messages — consider idle
      return true;
    }

    const messageAge = Date.now() - latestNonBot.createdAt.getTime();
    return messageAge >= thresholdMs;
  }

  /**
   * Count how many consecutive recent sends of this job went unanswered.
   * Checks if a non-bot message exists in the chat after each run's startedAt.
   * Returns the count of consecutive unanswered runs from most recent.
   */
  async countUnansweredSends(job: ProactiveJob, targetChatId: string): Promise<number> {
    if (!this.runRepo.findByJobId) {
      return 0;
    }

    try {
      const recentRuns = await this.runRepo.findByJobId(job.id, MAX_UNANSWERED_CHECKINS + 2);
      const successfulRuns = recentRuns.filter((r) => r.status === 'ok' && r.generatedMessage);

      if (successfulRuns.length === 0) {
        return 0;
      }

      // Get recent messages to check for user replies
      const messages = await this.messageRepo.findRecentByChatId(targetChatId, IDLE_CHECK_MESSAGE_WINDOW);
      const userMessages = (messages || []).filter((m) => !m.isBot);

      let unanswered = 0;
      for (const run of successfulRuns) {
        const runTime = run.startedAt.getTime();
        // Check if any user message was sent after this run
        const hasReply = userMessages.some((m) => m.createdAt.getTime() > runTime);
        if (hasReply) {
          break;
        }
        unanswered++;
      }

      return unanswered;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to count unanswered sends', { jobId: job.id, error: errMsg });
      return 0;
    }
  }

  /**
   * Build the ProactiveMessageContext for message generation.
   */
  private async buildMessageContext(
    job: ProactiveJob,
    targetChatId: string,
  ): Promise<ProactiveMessageContext> {
    const timezone = job.timezone || this.config.defaultTimezone;
    const localTimeStr = new Date().toLocaleString('en-US', { timeZone: timezone });
    const localTime = new Date(localTimeStr);
    const dayOfWeek = localTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });

    // Parse context config from job (stored as JSON string)
    const contextConfig = this.parseContextConfig(job.contextConfig);
    const recentMessageCount = contextConfig?.recentMessages ?? this.config.defaultContextMessages;

    // -- Gather optional data -------------------------------------------------

    let userPreferences: Array<{ key: string; value: string; category: string }> | undefined;
    let userName: string | undefined;

    // Get user preferences if service is available and sender is known
    if (this.userPreferenceService && job.targetSenderId) {
      try {
        const prefs = await this.userPreferenceService.getPreferences(job.targetSenderId);
        if (prefs && prefs.length > 0) {
          userPreferences = prefs.map((p) => ({
            key: p.key,
            value: p.value,
            category: p.category,
          }));

          // Extract user name from preferences
          const namePref = prefs.find(
            (p) => p.key === 'name' && p.category === 'context',
          );
          const nicknamePref = prefs.find(
            (p) => p.key === 'nickname' && p.category === 'context',
          );
          userName = namePref?.value ?? nicknamePref?.value;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to load user preferences', {
          senderId: job.targetSenderId,
          error: errMsg,
        });
      }
    }

    // Get recent messages if configured
    let recentConversation: Array<{ text: string; createdAt: Date; isBot: boolean }> | undefined;

    if (recentMessageCount > 0) {
      try {
        const messages = await this.messageRepo.findRecentByChatId(targetChatId, recentMessageCount);
        if (messages && messages.length > 0) {
          recentConversation = messages.map((m) => ({
            text: m.text ?? '',
            createdAt: m.createdAt,
            isBot: m.isBot,
          }));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to load recent messages', {
          chatId: targetChatId,
          error: errMsg,
        });
      }
    }

    // -- Fallback: get user name from sender record -------------------------
    if (!userName && this.senderRepo && job.targetSenderId) {
      try {
        const sender = await this.senderRepo.findById(job.targetSenderId);
        if (sender) {
          // Prefer displayName, then firstName, then construct from firstName + lastName
          userName = sender.displayName ?? sender.firstName ??
            sender.lastName ?? undefined;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to look up sender for name fallback', {
          senderId: job.targetSenderId,
          error: errMsg,
        });
      }
    }

    // -- Get recent proactive messages for repetition avoidance ---------------
    let recentProactiveMessages: Array<{ text: string; sentAt: Date }> | undefined;

    if (this.runRepo.findByJobId) {
      try {
        const recentRuns = await this.runRepo.findByJobId(job.id, RECENT_PROACTIVE_RUNS_LIMIT);
        const successful = recentRuns.filter((r) => r.status === 'ok' && r.generatedMessage);
        if (successful.length > 0) {
          recentProactiveMessages = successful.map((r) => ({
            text: r.generatedMessage!,
            sentAt: r.startedAt,
          }));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to load recent proactive runs', { jobId: job.id, error: errMsg });
      }
    }

    // -- Assemble context ----------------------------------------------------

    const context: ProactiveMessageContext = {
      messageType: job.messageType,
      timezone,
      localTime,
      dayOfWeek,
      userName,
      userPreferences,
      recentConversation,
      recentProactiveMessages,
      customTemplate: job.messageTemplate ?? undefined,
      customContext: contextConfig?.customContext,
    };

    return context;
  }

  /**
   * Parse the contextConfig JSON string from the job.
   * Returns null if not set or invalid.
   */
  private parseContextConfig(configStr: string | null): ProactiveContextConfig | null {
    if (!configStr) {
      return null;
    }

    try {
      return JSON.parse(configStr) as ProactiveContextConfig;
    } catch {
      logger.warn('Failed to parse contextConfig JSON', { configStr });
      return null;
    }
  }
}

export default ProactiveExecutorService;
