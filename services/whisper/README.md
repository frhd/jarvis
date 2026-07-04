# Whisper Transcription Service

Python microservice for audio transcription using faster-whisper.

## Setup

```bash
cd services/whisper
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Development

```bash
# Run with hot reload
uvicorn src.main:app --reload --port 9000

# Run tests
pytest tests/ -v

# Lint
ruff check src/
```

## PM2 Commands

```bash
# Start
pm2 start ecosystem.config.cjs --only whisper

# Status
pm2 status whisper

# Logs
pm2 logs whisper --lines 50

# Restart
pm2 restart whisper

# Stop
pm2 stop whisper
```

## API Endpoints

- `GET /health` - Health check
- `GET /` - Service info (redirects to /docs)
- `POST /v1/audio/transcriptions` - OpenAI-compatible transcription

## Configuration

Environment variables (set in ecosystem.config.cjs):

| Variable | Default | Description |
|----------|---------|-------------|
| WHISPER_MODEL | base | Model size (tiny, base, small, medium, large-v3) |
| WHISPER_DEVICE | auto | Device (auto, cpu, cuda) |
| WHISPER_COMPUTE_TYPE | auto | Compute type (auto, int8, float16, float32) |
| WHISPER_HOST | 127.0.0.1 | Host to bind |
| WHISPER_PORT | 9000 | Port to bind |
| LOG_LEVEL | INFO | Log level |
| LOG_FORMAT | json | Log format (json, text) |
