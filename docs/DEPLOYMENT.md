# Jarvis Deployment Guide

This guide covers deploying Jarvis in various environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [LLM Setup](#llm-setup)
- [Production Deployment](#production-deployment)
- [Docker Deployment](#docker-deployment)
- [Monitoring Setup](#monitoring-setup)
- [Scaling Considerations](#scaling-considerations)

---

## Prerequisites

### Required

- **Node.js**: v20.x or later (ESM support required)
- **npm**: v10.x or later
- **SQLite**: Included via better-sqlite3
- **Telegram Account**: With API credentials

### Optional

- **Ollama**: For local LLM processing
- **Docker**: For containerized deployment
- **Prometheus/Grafana**: For monitoring

---

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd jarvis
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Required: Telegram credentials from https://my.telegram.org/apps
API_ID=your_api_id
API_HASH=your_api_hash
PHONE_NUMBER=+1234567890

# Database (default path)
DATABASE_PATH=./data/jarvis.db

# LLM (optional but recommended)
LLM_ENABLED=true
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=mistral-small:24b-instruct-2501-q4_K_M
```

### 3. Initialize Database

```bash
npm run db:migrate
```

### 4. First Run (Authentication)

```bash
npm run dev
```

On first run, you'll be prompted for Telegram authentication. After successful auth, a `SESSION_STRING` will be generated. Add it to your `.env` for persistent sessions.

### 5. Production Build

```bash
npm run build
npm start
```

---

## Configuration

### Environment Variables

See `.env.example` for all available options. Key configuration groups:

#### Telegram

```bash
API_ID=12345678                    # From my.telegram.org
API_HASH=abc123def456              # From my.telegram.org
PHONE_NUMBER=+1234567890           # Your phone number
SESSION_STRING=                    # Generated after first auth
```

#### LLM (Ollama)

```bash
LLM_ENABLED=true
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=mistral-small:24b-instruct-2501-q4_K_M
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=2
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=1024
```

#### Claude CLI (Optional)

```bash
CLAUDE_ENABLED=false
CLAUDE_CLI_PATH=claude
CLAUDE_TIMEOUT_MS=60000
CLAUDE_MODEL=sonnet
```

#### Memory System

```bash
EMBEDDING_ENABLED=true
EMBEDDING_MODEL=nomic-embed-text
MEMORY_ENABLED=true
MEMORY_MIN_CONFIDENCE=50
RAG_ENABLED=true
RAG_TOP_K=10
RAG_SIMILARITY_THRESHOLD=0.7
```

#### Semantic Cache

```bash
CACHE_ENABLED=true
CACHE_SIMILARITY_THRESHOLD=0.92
CACHE_MAX_ENTRIES=10000
CACHE_TTL_GREETING_HOURS=24
CACHE_TTL_FACTUAL_HOURS=168
CACHE_TTL_PERSONAL_HOURS=720
```

#### Monitoring

```bash
METRICS_ENABLED=true
METRICS_FLUSH_INTERVAL_MS=5000
METRICS_RETENTION_DAYS=30
ALERTING_ENABLED=true
```

#### Queue & Priority

```bash
PRIORITY_CHAT_IDS=123,456,789      # VIP chat IDs
PRIORITY_USER_IDS=111,222,333      # VIP user IDs
```

### Feature Flags

Feature flags can be toggled at runtime. Default states:

| Flag | Default | Description |
|------|---------|-------------|
| `llm.enabled` | false | Ollama integration |
| `llm.skipOnUnhealthy` | true | Skip LLM when unhealthy |
| `claude.enabled` | false | Claude CLI integration |
| `intent.enabled` | true | Intent classification |
| `embedding.enabled` | false | Semantic embeddings |
| `memory.enabled` | false | Long-term memory |
| `rag.enabled` | false | RAG context building |
| `cache.enabled` | false | Semantic caching |
| `metrics.enabled` | true | Metrics collection |
| `alerting.enabled` | true | Alert system |
| `priorityEscalation.enabled` | true | Priority escalation |

---

## Database Setup

### SQLite (Default)

The default SQLite database is automatically created at `data/jarvis.db`.

```bash
# Run migrations
npm run db:migrate

# Inspect database with Drizzle Studio
npm run db:studio
```

### Database Location

```bash
DATABASE_PATH=./data/jarvis.db     # Default
DATABASE_PATH=/var/lib/jarvis/db   # Custom location
```

### WAL Mode

SQLite runs in WAL (Write-Ahead Logging) mode for better concurrent performance:

```bash
# Verify WAL mode
sqlite3 data/jarvis.db "PRAGMA journal_mode;"
# Should return: wal
```

### Vector Search (sqlite-vec)

The sqlite-vec extension is automatically loaded for semantic search. Ensure your Node.js environment supports native modules.

### Backup

```bash
# Hot backup (safe during operation)
sqlite3 data/jarvis.db ".backup backup/jarvis-$(date +%Y%m%d).db"

# Or with compression
sqlite3 data/jarvis.db ".dump" | gzip > backup/jarvis-$(date +%Y%m%d).sql.gz
```

---

## LLM Setup

### Ollama (Recommended)

1. **Install Ollama**

```bash
# macOS/Linux
curl -fsSL https://ollama.com/install.sh | sh

# Or download from https://ollama.com
```

2. **Pull Models**

```bash
# Main model for chat
ollama pull mistral-small:24b-instruct-2501-q4_K_M

# Embedding model
ollama pull nomic-embed-text
```

3. **Start Ollama**

```bash
ollama serve
# Default: http://localhost:11434
```

4. **Configure Jarvis**

```bash
LLM_ENABLED=true
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=mistral-small:24b-instruct-2501-q4_K_M
EMBEDDING_ENABLED=true
EMBEDDING_MODEL=nomic-embed-text
```

### Claude CLI (Optional)

For complex tasks, Jarvis can escalate to Claude:

1. **Install Claude Code CLI**

```bash
npm install -g @anthropic-ai/claude-code
```

2. **Authenticate**

```bash
claude auth
```

3. **Configure Jarvis**

```bash
CLAUDE_ENABLED=true
CLAUDE_CLI_PATH=claude
CLAUDE_MODEL=sonnet
```

### Multi-Model Setup

To use multiple LLM providers:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic (direct API, not CLI)
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
GEMINI_API_KEY=...
```

---

## Production Deployment

### Systemd Service

Create `/etc/systemd/system/jarvis.service`:

```ini
[Unit]
Description=Jarvis Telegram Bot
After=network.target

[Service]
Type=simple
User=jarvis
WorkingDirectory=/opt/jarvis
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable jarvis
sudo systemctl start jarvis
sudo systemctl status jarvis

# View logs
journalctl -u jarvis -f
```

### PM2 (Alternative)

```bash
npm install -g pm2

# Start with ecosystem file
pm2 start ecosystem.config.js

# Or direct
pm2 start dist/index.js --name jarvis

# Save process list
pm2 save

# Setup startup
pm2 startup
```

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'jarvis',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

### Environment Security

- Never commit `.env` to version control
- Use secret management (HashiCorp Vault, AWS Secrets Manager)
- Restrict file permissions: `chmod 600 .env`

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY dist/ ./dist/
COPY data/ ./data/

# Create non-root user
RUN addgroup -g 1001 jarvis && \
    adduser -u 1001 -G jarvis -s /bin/sh -D jarvis && \
    chown -R jarvis:jarvis /app

USER jarvis

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  jarvis:
    build: .
    container_name: jarvis
    restart: unless-stopped
    volumes:
      - ./data:/app/data
      - ./.env:/app/.env:ro
    environment:
      - NODE_ENV=production
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"

volumes:
  ollama_data:
```

### Build and Run

```bash
# Build
docker-compose build

# Start
docker-compose up -d

# View logs
docker-compose logs -f jarvis

# Stop
docker-compose down
```

---

## Monitoring Setup

### Quick Start

```bash
cd scripts/monitoring
./setup.sh
```

This configures:
- Metric export schedules
- Prometheus scrape configuration
- Alert rule defaults

### Prometheus Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'jarvis'
    scrape_interval: 60s
    static_configs:
      - targets: ['localhost:3000']
    file_sd_configs:
      - files:
          - /etc/prometheus/jarvis.json
```

### Manual Metric Export

```bash
# Export Prometheus format
npm run metrics:export -- --format prometheus --output metrics.prom

# Export JSON
npm run metrics:export -- --format json --output metrics.json

# Export CSV
npm run metrics:export -- --format csv --type response_time --output response_time.csv
```

### Alert Rules

Default alerts in `config/alerting-rules.json`:

| Alert | Threshold | Severity |
|-------|-----------|----------|
| High LLM Response Time | > 10s | warning |
| High Error Rate | > 5 errors/5min | warning |
| Low Cache Hit Rate | < 20% | warning |
| High Queue Depth | > 100 | warning |
| Low Intent Confidence | < 30% | warning |
| High Escalation Rate | > 10/15min | warning |

### Grafana Dashboard

Import the provided dashboard from `scripts/monitoring/grafana-dashboard.json` or create custom dashboards using the exported metrics.

---

## Scaling Considerations

### Single Instance Optimization

Jarvis is designed for single-instance deployment. Optimize for:

1. **Memory**: Adjust Node.js heap size
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096"
   ```

2. **SQLite Performance**:
   - WAL mode (enabled by default)
   - Proper indexes (included in migrations)
   - Regular VACUUM: `sqlite3 data/jarvis.db "VACUUM;"`

3. **Queue Processing**:
   - Adjust `maxConcurrentProcessing` (default: 5)
   - Tune retry settings for your workload

### Resource Requirements

| Load | CPU | RAM | Disk |
|------|-----|-----|------|
| Light (<100 msg/day) | 1 core | 512MB | 1GB |
| Medium (<1000 msg/day) | 2 cores | 1GB | 5GB |
| Heavy (<10000 msg/day) | 4 cores | 2GB | 20GB |

Add resources for Ollama if running locally:
- Ollama: 4-8GB RAM depending on model
- GPU: Recommended for faster inference

### High Availability

For HA deployments:

1. **Database**: Consider PostgreSQL with pgvector for multi-instance support
2. **Queue**: External message queue (Redis, RabbitMQ)
3. **Load Balancing**: Sticky sessions for Telegram connection

Note: Multi-instance support requires architectural changes not included in the current implementation.

---

## Troubleshooting

### Common Issues

**Telegram Auth Failed**
- Verify API_ID and API_HASH from my.telegram.org
- Check phone number format (+country code)
- Delete SESSION_STRING and re-authenticate

**Ollama Connection Failed**
- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check LLM_BASE_URL matches Ollama address
- Pull required models: `ollama pull <model>`

**Database Locked**
- Only one instance should access the database
- Check for zombie processes: `fuser data/jarvis.db`
- Enable WAL mode if disabled

**High Memory Usage**
- Reduce `CACHE_MAX_ENTRIES`
- Lower `RAG_TOP_K` and `recentMessagesCount`
- Adjust Node.js heap size

**Slow Responses**
- Check Ollama model size (smaller = faster)
- Enable semantic caching
- Review queue depth and processing times

See `docs/TROUBLESHOOTING.md` for more detailed solutions.
