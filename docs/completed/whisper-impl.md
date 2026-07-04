# Implementation Plan: Python Whisper Microservice

> **Goal**: Replace Docker-based Whisper with a native Python microservice for improved reliability and unified process management.

## Clean Code Principles

- **Minimal comments** - Code should be self-documenting; comments only for "why", not "what"
- **Small files** - Each file < 150 lines; single responsibility
- **Clear separation** - Models, services, routes in separate modules
- **Thorough tests** - Unit tests for each module; integration tests for API
- **Type hints** - Full typing for all functions and classes

---

## Phase 1: Project Setup

> Set up Python project structure with modern tooling.

### Tasks

- [x] Create directory structure `services/whisper/`
- [x] Create `pyproject.toml` with dependencies and metadata
- [x] Create `requirements.txt` for pip fallback
- [x] Set up virtual environment and install dependencies
- [x] Configure ruff for linting/formatting (`.ruff.toml`)
- [x] Create `.gitignore` for Python artifacts
- [x] Verify faster-whisper installs correctly on Apple Silicon

### Directory Structure

```
services/whisper/
├── src/
│   ├── __init__.py
│   ├── main.py           # FastAPI app entry (< 30 lines)
│   ├── config.py         # Environment config (< 40 lines)
│   ├── models.py         # Pydantic request/response models (< 50 lines)
│   ├── transcriber.py    # Whisper wrapper service (< 80 lines)
│   └── routes.py         # API route handlers (< 60 lines)
├── tests/
│   ├── __init__.py
│   ├── conftest.py       # Pytest fixtures
│   ├── test_transcriber.py
│   └── test_routes.py
├── pyproject.toml
├── requirements.txt
└── README.md
```

### Test Phase 1

```bash
cd services/whisper
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
ruff check src/
python -c "import faster_whisper; print('faster-whisper OK')"
```

---

## Phase 2: Core Transcriber Service

> Implement the Whisper transcription logic as a standalone service class.

### Tasks

- [x] Create `config.py` - environment variables with defaults
- [x] Create `transcriber.py` - WhisperTranscriber class
  - [x] Model loading with configurable model size
  - [x] Lazy loading (load on first request, not startup)
  - [x] `transcribe(file_path) -> TranscriptionResult`
  - [x] Proper resource cleanup
- [x] Create `models.py` - Pydantic models for transcription
- [x] Write unit tests for transcriber

### Code Guidelines

```python
# transcriber.py - Example structure
class WhisperTranscriber:
    """Handles audio transcription using faster-whisper."""

    def __init__(self, model_size: str = "base"):
        self._model: WhisperModel | None = None
        self._model_size = model_size

    def transcribe(self, audio_path: Path) -> TranscriptionResult:
        # Implementation
```

### Test Phase 2

```bash
cd services/whisper
source .venv/bin/activate
pytest tests/test_transcriber.py -v
ruff check src/
```

---

## Phase 3: FastAPI Server

> Create the HTTP API with OpenAI-compatible endpoints.

### Tasks

- [x] Create `routes.py` - API route handlers
  - [x] `POST /v1/audio/transcriptions` - main transcription endpoint
  - [x] `GET /health` - health check endpoint
  - [x] `GET /` - redirect to docs or basic info
- [x] Create `main.py` - FastAPI app initialization
  - [x] CORS middleware (if needed)
  - [x] Lifespan handler for startup/shutdown
  - [x] Mount routes
- [x] Handle multipart file uploads
- [x] Return OpenAI-compatible JSON response format
- [x] Write API integration tests

### OpenAI-Compatible Response Format

```json
{
  "text": "Transcribed text here",
  "language": "en",
  "duration": 5.2
}
```

### Test Phase 3

```bash
cd services/whisper
source .venv/bin/activate

# Run all tests
pytest tests/ -v --cov=src --cov-report=term-missing

# Manual API test
uvicorn src.main:app --port 9000 &
curl -X POST http://localhost:9000/v1/audio/transcriptions \
  -F "file=@test_audio.ogg" \
  -F "model=base"
curl http://localhost:9000/health
pkill -f uvicorn
```

---

## Phase 4: Error Handling & Logging

> Add robust error handling and structured logging.

### Tasks

- [x] Create custom exception classes
- [x] Add structured JSON logging (match Jarvis format)
- [x] Handle common errors:
  - [x] File not found / invalid file
  - [x] Unsupported audio format
  - [x] Model loading failures
  - [x] Transcription timeouts
- [x] Return appropriate HTTP status codes
- [x] Add request logging middleware
- [x] Write error handling tests

### Error Response Format

```json
{
  "error": {
    "message": "Audio file could not be processed",
    "type": "invalid_request_error",
    "code": "invalid_audio"
  }
}
```

### Test Phase 4

```bash
cd services/whisper
source .venv/bin/activate
pytest tests/ -v

# Test error cases
curl -X POST http://localhost:9000/v1/audio/transcriptions \
  -F "file=@invalid.txt"  # Should return 400
```

---

## Phase 5: PM2 Integration

> Integrate with existing PM2 process management.

### Tasks

- [x] Update `ecosystem.config.cjs` with whisper-python service
- [x] Create startup script `services/whisper/start.sh`
- [x] Configure log paths to match Jarvis (`logs/whisper.log`)
- [x] Set up environment variables in PM2 config
- [x] Test PM2 start/stop/restart
- [x] Test auto-restart on crash
- [x] Document PM2 commands in README

### PM2 Configuration

```javascript
// ecosystem.config.cjs addition
{
  name: 'whisper',
  script: 'uvicorn',
  args: 'src.main:app --host 127.0.0.1 --port 9000',
  cwd: './services/whisper',
  interpreter: '.venv/bin/python',
  env: {
    WHISPER_MODEL: 'base',
    LOG_LEVEL: 'INFO'
  },
  error_file: './logs/whisper-error.log',
  out_file: './logs/whisper.log',
  max_restarts: 10,
  restart_delay: 1000
}
```

### Test Phase 5

```bash
# Start with PM2
pm2 start ecosystem.config.cjs --only whisper
pm2 status
pm2 logs whisper --lines 20

# Test health
curl http://localhost:9000/health

# Test restart recovery
pm2 restart whisper
curl http://localhost:9000/health
```

---

## Phase 6: Integration Testing

> Verify end-to-end integration with Jarvis TypeScript service.

### Tasks

- [x] Verify Jarvis VoiceProcessingService connects to Python service
- [x] Test voice message transcription flow end-to-end
- [x] Verify response format matches expected schema
- [x] Test error propagation to Jarvis
- [x] Test health check integration
- [x] Performance test: transcription latency
- [x] Load test: concurrent requests

### Test Phase 6

```bash
# Start both services
pm2 start ecosystem.config.cjs

# Check health from Jarvis perspective
pm2 logs jarvis --lines 50 | grep -i whisper

# Send a voice message via Telegram and verify:
# 1. Transcription appears in logs
# 2. Response is generated
# 3. No errors in whisper logs
```

---

## Phase 7: Deploy

> Production deployment and Docker cleanup.

### Pre-Deploy Checklist

- [x] All tests passing
- [x] PM2 integration verified
- [x] Health checks working
- [x] Logs configured correctly
- [x] Error handling tested

### Deployment Tasks

- [x] Stop Docker Whisper container
- [x] Remove Docker Whisper from `docker-compose.yml` (or mark deprecated)
- [x] Start Python Whisper via PM2
- [x] Restart Jarvis to pick up healthy Whisper
- [x] Verify voice messages work end-to-end
- [x] Monitor logs for 30 minutes
- [x] Update `CLAUDE.md` with new architecture
- [x] Update `README.md` with new setup instructions

### Deploy Commands

```bash
# Stop Docker whisper
docker compose stop whisper
docker compose rm -f whisper

# Start Python whisper
pm2 start ecosystem.config.cjs --only whisper

# Restart Jarvis
pm2 restart jarvis

# Verify
pm2 status
curl http://localhost:9000/health
pm2 logs --lines 50
```

### Rollback Plan

If issues occur:
```bash
# Stop Python whisper
pm2 stop whisper

# Restart Docker whisper
docker compose up -d whisper

# Restart Jarvis
pm2 restart jarvis
```

---

## Post-Deploy

- [ ] Remove Docker Whisper volume (after 1 week stable)
- [ ] Archive this IMPL.md or move to `docs/completed/`
- [ ] Update `hybrid.md` with completion status

---

## Summary

| Phase | Description | Est. Files |
|-------|-------------|------------|
| 1 | Project Setup | 4 |
| 2 | Core Transcriber | 3 |
| 3 | FastAPI Server | 2 |
| 4 | Error Handling | 1-2 |
| 5 | PM2 Integration | 2 |
| 6 | Integration Testing | 0 |
| 7 | Deploy | 0 |

**Total new files**: ~12 Python files + tests
**Total lines**: ~400-500 lines of code
