# Jarvis Telegram Message Service

A service for ingesting incoming Telegram messages, storing them in SQLite, and processing them through Jarvis with queue-based ordering, priority handling, and retry logic.

## Features

- **Message Ingestion**: Captures all incoming Telegram messages in real-time
- **SQLite Storage**: Persists messages, chats, and senders using Drizzle ORM
- **Priority Queue**: Processes messages based on configurable chat priorities
- **Media Handling**: Downloads photos, documents, voice messages, videos, and stickers
- **Retry Logic**: Automatic retries (up to 3 attempts) for failed message processing
- **Chat Filtering**: Allow/block lists for controlling which chats are processed
- **Two-Tier LLM Architecture**: Fast intent classification (Ollama) + powerful responses (Claude Code CLI)
- **Intelligent Routing**: Routes messages to optimal handler based on intent classification

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ (for Whisper service)
- npm or yarn

### Installation

```bash
npm install

# Install Whisper service (optional, for voice transcription)
cd services/whisper
python -m venv .venv
source .venv/bin/activate
pip install -e .
cd ../..
```

### Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Get your Telegram API credentials from https://my.telegram.org/apps

3. Update `.env` with your values:
   ```
   API_ID=your_api_id
   API_HASH=your_api_hash
   PHONE_NUMBER=+1234567890
   SESSION_STRING=          # Saved after first login
   PRIORITY_CHAT_IDS=       # Optional: comma-separated chat IDs

   # LLM Configuration
   LLM_ENABLED=true
   LLM_BASE_URL=http://localhost:11434
   LLM_MODEL=mistral-small:24b-instruct-2501-q4_K_M

   # Claude Configuration
   CLAUDE_ENABLED=true
   CLAUDE_CLI_PATH=claude
   CLAUDE_MODEL=sonnet

   # Whisper Configuration (voice transcription)
   WHISPER_ENABLED=true
   WHISPER_BASE_URL=http://localhost:9000
   ```

### Database Setup

Run migrations to create the database:
```bash
npm run db:migrate
```

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled version |
| `npm run db:migrate` | Run database migrations |
| `npm run db:studio` | Open Drizzle Studio (DB inspector) |
| `npm run prod:pm2` | Build and start all services with PM2 |
| `npm run prod:pm2:status` | Check PM2 service status |
| `npm run prod:pm2:logs` | View PM2 logs |
| `npm run prod:pm2:restart` | Restart all PM2 services |

## Database Schema

### Tables

- **senders**: Telegram users who send messages
- **chats**: Telegram chats (private, group, supergroup, channel)
- **chatFilters**: Allow/block rules with priority
- **messages**: Stored messages with metadata and media paths
- **queue**: Processing queue with status and retry tracking
- **llmResponses**: LLM analysis results with intent, model, and token usage

### Key Fields

**messages**
- `telegramMessageId`: Original Telegram message ID
- `chatId`: Reference to chats table
- `senderId`: Reference to senders table
- `text`: Message text content
- `mediaType`: photo, document, voice, video, audio, sticker
- `mediaPath`: Local path to downloaded media
- `rawJson`: Full message JSON for future-proofing

**queue**
- `status`: pending, processing, completed, failed
- `priority`: Higher values processed first
- `attempts`: Retry counter (max 3)
- `lastError`: Error message from last failure

## Directory Structure

```
src/
├── config/         # Configuration settings
├── db/             # Database schema, client, migrations
├── handlers/       # Telegram event handlers
├── repositories/   # Data access layer
├── services/       # Business logic
├── types/          # TypeScript type definitions
├── utils/          # Logging utilities
└── workers/        # Background workers (retry)

services/
└── whisper/        # Python Whisper transcription microservice
    ├── src/        # FastAPI app with faster-whisper
    └── tests/      # Pytest test suite

data/
├── jarvis.db       # SQLite database
└── media/          # Downloaded media files
    ├── photos/
    ├── documents/
    ├── voice/
    ├── video/
    └── audio/
```

## Architecture

The service follows a layered architecture:

1. **Handlers**: Receive Telegram events
2. **Services**: Orchestrate business logic
3. **Repositories**: Database operations
4. **Workers**: Background tasks (retries)

### Two-Tier LLM Architecture

```
User message → Ollama (classify intent) → Route:
  ├─ simple_greeting     → Ollama direct response (~200ms)
  └─ everything else     → Claude CLI --print (~2-10s)
```

**Tier 1: Ollama** - Fast intent classification (~500ms)
- Categories: simple_greeting, needs_web_search, complex_task, general_chat

**Tier 2: Claude Code CLI** - Heavy lifting
- Handles web search, complex reasoning, general conversation
- Uses `claude --print` for non-interactive mode

### Message Flow

1. Telegram event received
2. Filter check (allow/block)
3. Upsert sender and chat
4. Download media (if present)
5. Store message
6. Enqueue with priority
7. Classify intent (Ollama)
8. Route to handler (Ollama or Claude)
9. Handle result (complete/retry/fail)

## Future Enhancements

- **Message Search**: Full-text search across stored messages
- **Analytics/Reporting**: Dashboard for message statistics and processing metrics
- **Web UI**: Browser-based interface for queue monitoring and management
- **Backup Strategy**: Automated SQLite backup and restore procedures

## License

MIT
