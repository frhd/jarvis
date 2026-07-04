# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

When referencing dates in searches or documentation, use the current date from your environment context (it is 2026 or later) — not years from training data.

## Code Quality

Follow clean code practices documented in `CONTRIBUTING.md`. Key points:
- **No magic numbers**: Extract numeric values to named constants with descriptive names and units
- Use `getRecentMessages()` helper from `src/utils/message-context.ts` for message slicing

## Project Overview

Jarvis is a Telegram message ingestion and AI service that captures incoming messages, stores them in SQLite, and processes them through an intelligent pipeline. It features a multi-tier LLM architecture, semantic memory, priority queuing, and comprehensive monitoring.

**Tech Stack:**
- TypeScript (ESM with `"type": "module"`)
- Node.js 18+
- Drizzle ORM with better-sqlite3
- SQLite with sqlite-vec extension for vector search
- Telegram client (TDLib wrapper)
- Claude Code CLI for complex tasks
- Vitest for testing

**Path Aliases:**
- `@/*` (catch-all), `@services/*`, `@repositories/*`, `@types/*`, `@utils/*`, `@config/*`, `@clients/*`, `@handlers/*`, `@db/*`, `@errors/*`, `@llm/*`, `@api/*`, `@workers/*`

## Common Commands

```bash
# Development
npm run dev          # Development mode with hot reload (tsx watch)
npm run build        # Compile TS, fix ESM imports, copy migrations to dist/
npm start            # Run compiled application

# Database
npm run db:migrate   # Run database migrations
npm run db:studio    # Open Drizzle Studio for DB inspection
npm run db:backfill:identity     # Backfill unified identity tables from Telegram data
npm run db:backfill:memory-refs  # Backfill memory userId/conversationId references

# Testing
npx vitest run       # Run all vitest tests once (npm test runs vitest in watch mode in a TTY)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run test:ui      # Run tests with Vitest UI
npx vitest run <file>  # Run single test file

# Regression (LLM-as-judge quality validation using Ollama)
npm run regression                          # Run all 20 scenarios
npm run regression -- --category=greetings  # Filter by category
npm run regression -- --tag=critical        # Filter by tag
# Scenarios defined in tests/regression/scenarios.ts

# Production
npm run prod:pm2          # Build and start with PM2
npm run prod:pm2:restart  # Restart PM2 service
npm run prod:pm2:logs     # View PM2 logs
npm run prod:pm2:status   # Check PM2 service status
npm run prod:pm2:monit    # Interactive PM2 monitor

# Utilities
npm run check:circular    # Check for circular dependencies (madge)
npm run logs              # Tail jarvis.log
npm run logs:error        # Tail jarvis-error.log

# Docker (alternative deployment)
npm run prod:docker:up    # Start with docker compose
npm run prod:docker:down  # Stop docker containers

# launchd (alternative macOS deployment)
npm run prod:launchd:install / :uninstall / :start / :stop
```

## Architecture

### High-Level Flow

```
Telegram Event → Handler → Service → Repository → Database
                    ↓
                  Queue → Processor → LLM Router → Response
                                   ↓
                                Claude/Ollama/Cache → Result → Metrics
```

### Key Layers

**Handlers** (`src/handlers/`): Telegram event listeners that delegate to services

**Services** (`src/services/`): Business logic organized by concern:
- **Core**: Telegram service, media handling, LLM base, identity resolution
- **AI/LLM**: Embedding, memory, consolidation, Claude client, intent classification, escalation
- **Routing**: `LLMRouterService` (Ollama vs Claude, agentic tasks, web search, plan intents), `ContextBuildingService` (RAG context), plus intent routing, anti-loop, and response cache services
- **Processing**: Extraction coordination, retry coordination, transcription coordination
- **Reliability**: Retry coordination, circuit breakers, degradation handling, health monitoring, reliability hardening
- **Monitoring**: Metrics, alerting, analytics, user behavior tracking
- **Voice**: Transcription coordination, voice processing
- **Tools**: Web search integration, comic generation, browser content extraction (`BrowserService`)
- **Proactive**: Scheduled proactive messaging (in `src/services/proactive/`)
- **Plan**: Plan management, execution coordination, progress reporting (for `/plan` command)
- **Contact**: Contact management and deduplication
- **Calendar**: Apple Calendar (CalDAV) integration in `src/services/calendar/` (see Calendar Integration below)
- **CEO**: Scheduled messages and monitoring for Slack CEO bot (in `src/platforms/slack/`)

**Clients** (`src/clients/`): External service wrappers (`LLMClient`, `ClaudeClient`, `EmbeddingClient`)

**LLM Providers** (`src/llm/`): Multi-model abstraction with `ModelRegistry`, `ModelRouter`, `ComplexityScorer` and providers for OpenAI, Anthropic, Gemini, Ollama, LM Studio

**Routing** (`src/services/routing/`): Request routing with `LLMRouterService` (Ollama/Claude routing, agentic tasks, web search, plan intents), `ContextBuildingService` (RAG context assembly), `IntentRoutingService`, `AntiLoopService`, `ResponseCacheService`, and intent-specific handlers in `routing/handlers/`

**Platforms** (`src/platforms/`): Multi-platform support (Slack CEO bot in `src/platforms/slack/`)

**Modules** (`src/modules/`): Modular extension system with `ModuleRegistry` for lifecycle management. The CEO module (`src/modules/ceo/`) provides scheduled Slack messages and monitoring. Modules implement `IModule` interface and can register with multiple platforms.

**Repositories** (`src/repositories/`): Database operations using Drizzle ORM

**Workers** (`src/workers/`): Background tasks - retry, priority escalation, DLQ cleanup, cache cleanup, queue cleanup, proactive messaging, memory cleanup, Telegram connection watchdog

**Processing** (`src/services/processing/`): Coordinators for extraction, retry, and transcription

**Interfaces** (`src/interfaces/`): Service and repository interfaces for dependency inversion (`services.ts`, `repositories.ts`, `modules.ts`, `platforms.ts`)

**Errors** (`src/errors/`): Modular error handling with 50+ error codes (`error-codes.ts`, `error-classes.ts`)

**Config** (`src/config/`): Configuration with Zod validation (`env-schema.ts`), feature flags (`feature-flags.ts`), runtime config (`runtime-config.ts`)

### Service Factory & Dependency Injection

Services are wired through a two-tier factory pattern to avoid circular dependencies:

**Tier 1 - Factory Modules** (`src/services/factory/`): Create singleton service instances grouped by concern (`core-services.ts`, `ai-services.ts`, `monitoring-services.ts`, `circuit-breakers.ts`, `comic-services.ts`, `browser-services.ts`, `therapist-services.ts`, `command-handler.service.ts`).

**Tier 2 - Lazy Getters** (`src/services/instances/`): Provide `getXxxService()` lazy accessors (`core.ts`, `ai.ts`, `monitoring.ts`, `therapist.ts`) that resolve instances on first call.

**Orchestration** (`src/services/index.ts`): Wires cross-cutting dependencies using setter methods (e.g., `setMemoryService()`, `setTranscriptionService()`) and registers health checks, recovery strategies, and failover configurations.

### Bootstrap Phases (`src/index.ts`)

1. Config validation (Telegram API credentials)
2. Database migrations and connection verification
3. Service initialization (media, LLM, Telegram, Slack)
4. Handler registration (message handlers, reconnect-safe)
5. Worker startup (retry, priority escalation, DLQ cleanup, cache cleanup, queue cleanup, proactive, memory cleanup, Telegram watchdog)
6. Startup health check (warns about unhealthy components)
7. Graceful shutdown handler (SIGINT/SIGTERM: resets `processing` → `pending`, stops workers, ~10s timeout)

### Graceful Shutdown System

`ShutdownRegistry` (`src/utils/shutdown-registry.ts`) manages graceful shutdown with priority-ordered cleanup:

**Priorities:**
- 10: Queue reset (reset `processing` → `pending`)
- 20-26: Workers (retry, escalation, DLQ, memory stats, cache, queue cleanup)
- 30-31: Proactive system (worker, scheduler)
- 40: Modules
- 50: PM2 restart monitor
- 60: Platforms (Slack)
- 65: Browser (Playwright)
- 70-72: Core services (processor, LLM, Telegram)
- 80: Database connection (last)

### Multi-Model LLM Routing

`LLMRouterService` (`src/services/routing/llm-router.service.ts`) handles request routing:

```
Request → Intent Classification → LLMRouterService:
  ├─ simple_greeting     → Ollama (fast, local)
  ├─ needs_web_search    → Web search + Claude
  ├─ agentic_task        → Claude with tools (Read, Write, Edit, Bash)
  ├─ plan_intent         → PlanIntentHandlerService
  └─ general_chat        → Claude (with Ollama fallback)
```

Agentic requests (file operations, shell commands) enrich context with memories and use Claude's `runAgent` mode with tool access. Web search is pre-processed before the LLM call.

### Intent Classification System

`src/services/intent/` provides multi-stage intent classification:

- `IntentClassifierService` - Legacy simple classifier
- `EnhancedIntentClassifierService` - Advanced classifier with LLM

**Configuration:**
- `INTENT_CLASSIFICATION_ENABLED` - Enable/disable
- `INTENT_TIMEOUT_MS` - Classification timeout (increase for local LLMs)
- Temperature hardcoded to 0.1 for consistency

**Intent Categories:**
- `simple_greeting` - Basic greetings/hellos
- `needs_web_search` - Questions requiring current information
- `agentic_task` - File operations, shell commands
- `plan_intent` - Implementation planning requests
- `general_chat` - Conversational messages

### Plan Workflow System

The `/plan` command triggers a structured planning workflow:

**Components:**
- `PlanIntentHandlerService` - Entry point for plan intents
- `PlanManagementService` - Plan lifecycle management
- `ExecutionCoordinatorService` - Step-by-step execution
- `ProgressReporterService` - Progress updates via Telegram

**Flow:**
```
/plan request → PlanIntentHandler → PlanManagement (create plan)
                                    → ExecutionCoordinator (execute steps)
                                    → ProgressReporter (update user)
```

### Comic Generation

Comic generation is available as an LLM tool for creating visual summaries:
- `ComicGeneratorService` (`src/services/comic/`) - Generates comic-style summaries
- Triggered by LLM router for appropriate requests
- Uses Ollama for generation

### Reliability Hardening

`ReliabilityHardeningService` provides advanced reliability features:
- Health check registration with severity tiers (critical/important/standard)
- Service failover configuration (e.g., Claude → Ollama backup)
- Self-healing fallbacks for degraded operation
- Service tier classification for prioritized recovery

### Queue Resilience

- **Priority Escalation**: Messages auto-boosted based on age (5m → +1, 15m → +2, 30m → +3)
- **Retry**: Exponential backoff with jitter (1s → 2s → 4s → 8s → 16s, ±10% jitter)
- **Circuit Breaker**: Opens after 5 failures, resets after 30s, 3 half-open test requests
- **Dead Letter Queue**: Failed messages after max retries with full error history

### Unified Identity System

Jarvis uses a platform-agnostic identity system to support multiple messaging platforms (Telegram, Slack, etc.):

**Tables:**
- `users`: Platform-agnostic user identities with `displayName`
- `platformIdentities`: Maps platform-specific IDs (Telegram user ID, Slack user ID) to unified `users`
- `conversations`: Platform-agnostic conversations (DM, group, channel)
- `memories`: Now references `userId` and `conversationId` instead of Telegram-specific `senderId`/`chatId`

**Service:** `IdentityService` (`src/services/identity.service.ts`) provides find-or-create semantics:
- `resolveUser(platform, platformUserId)` → Creates/returns unified `User`
- `resolveConversation(platform, platformConversationId, type)` → Creates/returns unified `Conversation`
- `linkIdentities(userId, platform, platformUserId)` → Cross-platform identity linking

**Platform Constants:** `src/config/platforms.ts` defines `PLATFORM_TELEGRAM`, `PLATFORM_SLACK` and `ConversationType` ('dm' | 'group' | 'channel').

**Usage Pattern:**
```typescript
// In handlers, resolve identities early:
const user = await identityService.resolveUser(PLATFORM_TELEGRAM, telegramUserId, { displayName: sender.firstName });
const conversation = await identityService.resolveConversation(PLATFORM_TELEGRAM, chatId, mapTelegramChatType(chat.type));

// Pass unified IDs to services:
await memoryService.extractAndStore(message, context, { userId: user.id, conversationId: conversation.id });
```

**Migration:** The `memories` table still has legacy `senderId`/`chatId` columns for backward compatibility. New code should use `userId`/`conversationId`. Run `npm run db:backfill:identity` to populate the new tables from existing Telegram data.

### Database

- **Schema**: All tables in `src/db/schema.ts` using Drizzle's `sqliteTable()`
- **Migrations**: `src/db/migrations/`, run with `npm run db:migrate`
- **Config**: `drizzle.config.ts` (SQLite dialect, `./data/jarvis.db`)
- **Storage**: `data/jarvis.db` (WAL mode, sqlite-vec extension), media in `data/media/`

### Critical Gotchas

**Message ordering**: `findRecentByChatId` returns messages in **descending order** (newest first). Use `getRecentMessages()` helper which correctly handles this with `.slice(0, N)` to get newest messages. Never use `.slice(-N)` on message arrays - that gets the oldest messages.

**Cron expressions**: Always verify actual cron schedules before stating them. `0 */5 * * *` means "at minute 0 of every 5th hour" (runs at 00:00, 05:00, 10:00, etc.), NOT every 5 minutes. For every 5 minutes use `*/5 * * * *`.

**Migration journal sync**: The `src/db/migrations/meta/_journal.json` must match actual migration files. If Drizzle Kit generates new migrations, the journal entries' `tag` fields must match the migration filenames (without `.sql`). A mismatch causes "No file found" errors at startup. When manually adding migrations, update the journal accordingly.

**SQLite delete results**: Drizzle ORM with better-sqlite3 returns a `RunResult` object for delete operations, not an array. Use `result.changes` to get the count of affected rows, not `result.length`.

**ESM imports**: TypeScript compiles without `.js` extensions on relative imports, but Node.js ESM requires them. The build script runs `scripts/fix-esm-imports.js` post-compile to add extensions. When adding new files with relative imports, they must follow the `./path/to/module.js` pattern in source (TypeScript resolves it).

### Owner-Only Access Control

Set `OWNER_TELEGRAM_ID` to restrict sensitive operations to the configured owner only:

- **Agentic requests**: Claude Code CLI tasks with file system access
- **Plan intents**: `/plan` command for implementation planning
- **Force-agentic mode**: When `FORCE_AGENTIC_MODE=true`, only owner gets agentic routing
- Non-owners are routed to safer Claude chat mode instead

### Testing Conventions

**Framework**: Vitest with `globals: true` (no need to import `describe`, `it`, `expect`).

**File placement**: Test files live next to their source (`*.test.ts` alongside `*.ts`).

**Excluded tests**: Some test files in `vitest.config.ts` `exclude` array run standalone with `npx tsx` instead of vitest. These require real services (Ollama, Whisper) or have custom test runners.

**Why excluded:**
- **Integration tests** requiring live services (Ollama, Whisper, Claude CLI)
- Tests with custom runners that don't fit Vitest's async model
- Heavy integration tests better run directly for debugging

Excluded files:
- `src/services/consolidation.service.test.ts`
- `src/services/enhancedIntentClassifier.service.test.ts`
- `src/services/escalation.service.test.ts`
- `src/services/frustrationDetector.service.test.ts`
- `src/services/intentClassifier.service.test.ts`
- `src/services/memory.service.test.ts`
- `src/services/responseRouter.service.test.ts`
- `src/repositories/embedding.repository.test.ts`
- `src/repositories/memory.repository.test.ts`
- `src/repositories/queue.repository.test.ts`
- `src/tests/**` and `tests/**` directories

**Critical mock ordering**: Mocks **must** be declared before importing modules that use them.

**Fake timers pattern**:
```typescript
vi.useFakeTimers();
async function flushPromises() { await vi.advanceTimersByTimeAsync(0); }
// Use vi.advanceTimersByTimeAsync(ms) for timer-dependent tests
```

**Testability convention**: Services define minimal interfaces in `src/interfaces/` for their dependencies, making it easy to create mocks without importing full implementations.

## Database Schema

### Core Tables

- **senders**: Telegram users who send messages
- **chats**: Telegram chats (private, group, supergroup, channel)
- **chatFilters**: Allow/block rules with priority
- **messages**: Stored messages with metadata and media paths
- **queue**: Processing queue with status and retry tracking
- **llmResponses**: LLM analysis results with intent, model, and token usage

### Unified Identity Tables

- **users**: Platform-agnostic user identities (`id`, `displayName`)
- **platformIdentities**: Maps platform-specific IDs to unified users (`userId`, `platform`, `platformUserId`)
- **conversations**: Platform-agnostic conversations (`platform`, `platformConversationId`, `type`)
- **memories**: Now has `userId`/`conversationId` foreign keys (in addition to legacy `senderId`/`chatId`)

### Key Fields

**messages:**
- `telegramMessageId`: Original Telegram message ID
- `chatId`: Reference to chats table
- `senderId`: Reference to senders table
- `text`: Message text content
- `mediaType`: photo, document, voice, video, audio, sticker
- `mediaPath`: Local path to downloaded media
- `rawJson`: Full message JSON for future-proofing
- `transcript`: Transcribed text for voice messages
- `transcriptStatus`: pending, processing, completed, failed

**queue:**
- `status`: pending, processing, completed, failed
- `priority`: Higher values processed first
- `attempts`: Retry counter (max 3)
- `lastError`: Error message from last failure

## Contact Management System

`ContactService` and `ContactManagerService` provide user contact tracking and deduplication:
- `contact.service.ts` - Contact CRUD operations
- `contactManager.service.ts` - Contact merging and deduplication logic
- `contact-management.service.ts` - High-level contact management

## Loop Detection System

`LoopPreventionService` detects and prevents conversation loops:
- Tracks message patterns that indicate repetitive/circular conversations
- Configured via `loopPrevention.QUICKSTART.md`
- Full documentation in `loopPrevention.README.md`

## Voice Transcription

Python microservice with faster-whisper at `services/whisper/`. Setup:
```bash
cd services/whisper && python -m venv .venv && source .venv/bin/activate && pip install -e .
pm2 start ecosystem.config.cjs --only whisper
# Env: WHISPER_ENABLED=true, WHISPER_BASE_URL=http://localhost:9000
```

## Telegram Connection Stability

Jarvis includes extensive connection monitoring and recovery mechanisms:

**Configuration** (all in `.env`):
- `TELEGRAM_HEALTH_CHECK_INTERVAL_MS` - Health check frequency (default: 15s)
- `TELEGRAM_HEALTH_CHECK_TIMEOUT_MS` - Health check timeout (default: 10s)
- `TELEGRAM_STALE_THRESHOLD_MS` - Time before considering connection stale (default: 5m)
- `TELEGRAM_KEEPALIVE_PING_INTERVAL_MS` - Ping frequency (default: 30s)
- `TELEGRAM_MAX_RECONNECT_ATTEMPTS` - Max reconnection attempts (default: 10)

**Error Classification** (`src/utils/error-classification.ts`):
- `isTelegramConnectionError()` - Detects recoverable connection errors
- `isNonCriticalError()` - Identifies errors that shouldn't trigger shutdown
- Telegram TIMEOUT errors are handled silently to avoid PM2 restarts

**Recovery:**
- Auto-reconnect on connection loss
- Graceful handling of TIMEOUT errors (logs only to file, not stderr)
- `forceReconnect()` method available for manual recovery

## Configuration

See `.env.example` for all options. Key feature toggles:

- `LLM_ENABLED`, `CLAUDE_ENABLED` - AI providers
- `MEMORY_ENABLED`, `RAG_ENABLED`, `EMBEDDING_ENABLED` - Memory system
- `CACHE_ENABLED` - Semantic caching
- `WHISPER_ENABLED` - Voice transcription
- `AUTH_ENABLED`, `AUTH_MODE` - API authentication
- `OWNER_TELEGRAM_ID` - Restricts sensitive operations to owner

Env vars validated at startup via Zod (`src/config/env-schema.ts`). Invalid config causes startup failure.

Runtime-toggleable feature flags in `src/config/feature-flags.ts`. Dynamic config updates (no restart) via `src/config/runtime-config.ts`.

### Browser Capabilities

Jarvis supports Playwright-based browser capabilities (opt-in):

- **Content Extraction** (`BROWSER_ENABLED`): Fetches full page content for web search enrichment via `BrowserService`
- **MCP Browser Tools** (`BROWSER_MCP_ENABLED`): Gives Claude CLI access to Playwright browser tools in agentic mode

Both features are disabled by default. See `.env.example` for all `BROWSER_*` configuration options.

### Calendar Integration

Apple Calendar (iCloud CalDAV) integration, disabled by default:

- `CalendarService` (`src/services/calendar/calendar.service.ts`) - Reads events and creates them via a propose-then-confirm flow (proposed events expire if unconfirmed); uses an LLM to parse natural-language requests
- `CalendarClient` (`src/clients/calendar.client.ts`) - CalDAV wrapper (tsdav + ical.js)
- Config: `CALENDAR_ENABLED`, `CALENDAR_CALDAV_URL`, `CALENDAR_APPLE_ID`, `CALENDAR_APP_PASSWORD` (app-specific password), `CALENDAR_NAME`, `CALENDAR_TIMEZONE` — see `.env.example`

## Proactive Messaging System

Jarvis can initiate conversations based on schedules and context. The system is organized in `src/services/proactive/`:

**Components:**
- `SchedulerService` - Manages cron-based job scheduling with timezone support
- `ExecutorService` - Executes scheduled jobs, handles quiet hours and stuck job detection
- `MessageGeneratorService` - Generates context-aware proactive messages
- `ScheduleUtils` - Cron parsing and validation utilities
- `seed-defaults.ts` - Idempotent seeder for default proactive jobs

**Configuration:** See `PROACTIVE_*` environment variables in `.env.example`. Key settings:
- `PROACTIVE_ENABLED` - Enable/disable the system
- `PROACTIVE_TARGET_CHAT_ID` - Telegram chat ID to send messages to
- `PROACTIVE_TIMEZONE` - IANA timezone for schedules (default: UTC)
- `PROACTIVE_QUIET_HOURS_START/END` - No messages during these hours

**Database Tables:**
- `proactiveJobs` - Job definitions (schedule, template, enabled)
- `proactiveRuns` - Execution history and status

**Worker:** `ProactiveWorker` triggers the scheduler and handles missed jobs after restarts.

## Therapist Mode System

Jarvis provides an empathetic listening and supportive response system for users experiencing emotional distress.

**Key Environment Variables:**
- `THERAPIST_ENABLED` - Enable therapist mode
- `THERAPIST_AUTO_DETECT` - Auto-detect when user needs intervention
- `THERAPIST_REQUIRES_CONSENT` - Ask for permission before intervention
- `THERAPIST_EMOTIONAL_ANALYSIS` - Enable emotional analysis
- `THERAPIST_MIN_MESSAGES_BEFORE_INTERVENTION` - Consecutive distress messages before triggering
- `THERAPIST_MAX_RESPONSES_PER_HOUR` - Rate limit interventions
- `THERAPIST_RESPONSE_COOLDOWN_MS` - Cooldown between responses

**Components** (`src/services/therapist/`):
- `DyadDetectorService` - Detects when user is speaking as if to another person (dyadic engagement)
- `EmotionalAnalyzerService` - Analyzes emotional content of messages
- `DynamicsAnalyzerService` - Tracks conversational dynamics and patterns
- `InterventionEngineService` - Determines when/how to intervene
- `ConsentManagerService` - Manages user consent for therapy mode
- `ResponseGeneratorService` - Generates empathetic responses
- `TherapistService` - Main coordinator

**Flow:**
```
Message → DyadDetector → EmotionalAnalyzer → DynamicsAnalyzer
                              ↓
                    InterventionEngine → ConsentManager
                              ↓
                    ResponseGenerator → TherapistService
```

## CEO Bot System

The Slack CEO bot provides scheduled messaging and monitoring capabilities.

**Key Environment Variables:**
- `CEO_ENABLED` - Enable CEO bot
- `CEO_SLACK_BOT_TOKEN` - Slack bot token
- `CEO_SLACK_SIGNING_SECRET` - Slack signing secret
- `CEO_RESPONSE_TIMEOUT_MS` - Timeout for CEO responses (default: 60000)

**Components:**
- `src/modules/ceo/` - CEO module implementation
- `src/platforms/slack/` - Slack platform integration
- MCP tools for YouTrack, Slack API, and scheduled messages

## Specialized Claude Agents

The `.claude/agents/` directory contains specialized agents for common tasks:

| Agent | Purpose |
|-------|---------|
| `rag-optimization.md` | Optimize context building and retrieval |
| `log-analysis.md` | Analyze logs for debugging patterns |
| `metrics-analysis.md` | Analyze system metrics for performance insights |
| `service-generator.md` | Generate new services following patterns |
| `test-generator.md` | Generate comprehensive test suites |
| `migration-generator.md` | Create database migrations |
| `incident-response.md` | Guide incident investigation |
| `security-audit.md` | Check for vulnerabilities |
| `llm-provider.md` | Add new LLM provider support |
| `health-monitor.md` | System health assessment |
| `slack-history-memory-ingester.md` | Ingest Slack history to memory |
| `dependency-updater.md` | Analyze outdated packages, create safe upgrade plans |
| `queue-health-auditor.md` | Deep analysis of job queue health, detect stuck jobs |
| `cost-optimizer.md` | Analyze LLM token usage, identify cost savings |
| `prompt-engineer.md` | Analyze and improve LLM prompts across codebase |
| `error-pattern-analyzer.md` | Identify recurring error patterns from logs/DLQ |
| `schema-evolution.md` | Help plan database schema changes |
| `telegram-api-specialist.md` | Track Telegram API changes, optimize TDLib usage |
| `platform-expansion.md` | Generate boilerplate for new platform integrations |
| `memory-quality.md` | Analyze stored memories for redundancy/staleness |
| `conversation-insights.md` | Extract patterns from conversation history |
| `regression-runner.md` | Analyze failed regression scenarios, expand coverage |
| `config-drift-detector.md` | Compare configs across environments |
| `clean-code-refactorer.md` | Refactor code following clean code principles |

These agents are invoked via the Task tool with `subagent_type` matching the agent name.

## Key Integration Points

- **New Event Handlers**: Register in `src/handlers/message.handler.ts`
- **New API Routes**: Add in `src/api/routes/`, register in `src/api/gateway.ts`
- **New Platforms**: Add in `src/platforms/`, register with `moduleRegistry.registerPlatformWithModules()` in `src/index.ts`
- **New Modules**: Add in `src/modules/`, implement `IModule` interface, register with `moduleRegistry.registerModule()`
- **Identity Resolution**: `src/services/identity.service.ts` (resolves platform-specific IDs to unified users/conversations)
- **LLM Processing**: `src/services/processor.service.ts`
- **LLM Routing**: `src/services/routing/llm-router.service.ts` (Ollama/Claude routing, agentic tasks, web search, plan intents)
- **Intent Classification**: `src/services/intent/enhanced-intent-classifier.service.ts`
- **Memory System**: `src/services/memory.service.ts`, `contextManager.service.ts`
- **Multi-Model Router**: `src/llm/model-router.ts`
- **Error Handling**: `src/errors/index.ts` (error codes in `error-codes.ts`, classes in `error-classes.ts`)
- **Health Monitoring**: `src/services/health.service.ts`
- **Metrics**: `src/services/metrics.service.ts`
- **Reliability**: `src/services/reliability/` (hardening, failover, self-healing)
- **Plan Workflow**: `src/services/planManagement.service.ts`, `src/services/executionCoordinator.service.ts`

## Adding New Features

Follow the established pattern (migration → repository → service → worker → integration):

1. **Schema**: Add tables to `src/db/schema.ts`, create migration with Drizzle Kit
2. **Repository**: Create in `src/repositories/` with Drizzle ORM queries
3. **Interface**: Define interface in `src/interfaces/services.ts` or `repositories.ts` for dependency inversion
4. **Service**: Create in `src/services/`, use interface types for dependencies
5. **Factory**: Instantiate in `src/services/factory/`, add lazy getter in `src/services/instances/` if needed
6. **Wiring**: Orchestrate in `src/services/index.ts` (set cross-dependencies, register health checks)
7. **Worker** (if background processing): Implement in `src/workers/` with start/stop methods
8. **Bootstrap**: Integrate in `src/index.ts` (start in worker phase, stop in shutdown handler)
9. **Seeder** (if default data): Create idempotent seeder called at bootstrap

## Multi-Database Deployment

Jarvis supports running multiple instances with separate databases via PM2:

**Configuration** (`ecosystem.config.cjs`):
- `jarvis` - Primary instance using `data/jarvis.db`
- `jarvis-ceo` - CEO bot instance using `data-ceo/jarvis.db`

**CEO Bot Environment:**
- `DOTENV_CONFIG_PATH=.env.ceo` - Separate env file
- `DATA_DIR=data-ceo` - Separate database directory
- Separate logs: `logs/ceo-pm2-*.log`

## Status Handler System

`StatusHandlerService` (`src/services/statusHandler.service.ts`) handles status commands:
- Provides system status information via `/status` command
- Returns health check summary, queue status, memory usage

## Troubleshooting

### "Migration failed: {}" at Startup

The error object is often empty in logs. Check these causes:

1. **Missing migration file**: Compare `src/db/migrations/meta/_journal.json` entries with actual `.sql` files. The `tag` in journal must match the filename prefix (e.g., tag `0016_plan-workflow-system` needs file `0016_plan-workflow-system.sql`).

2. **Missing table**: If logs show "no such table: X", the table may need to be created manually or via a migration that wasn't applied.

3. **Manual test**: Run migrations directly to see actual error:
   ```bash
   npm run db:migrate
   ```

### PM2 "waiting restart" Loop

Indicates the process crashes immediately after starting. Check:
1. `pm2 logs jarvis --err --lines 50` for error messages
2. Build output for TypeScript errors: `npm run build`
3. Database connection and migrations

### ESM Import Errors ("Cannot find module")

If you see `ERR_MODULE_NOT_FOUND` for a path without `.js` extension:
1. The file likely exists but the import is missing the extension
2. Run `npm run build` - the post-build script should fix it
3. If persistent, check the import in source uses the correct path
