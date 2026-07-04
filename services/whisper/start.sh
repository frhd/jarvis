#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Run: python3 -m venv .venv && pip install -e ."
    exit 1
fi

source .venv/bin/activate

HOST="${WHISPER_HOST:-127.0.0.1}"
PORT="${WHISPER_PORT:-9000}"

exec uvicorn src.main:app --host "$HOST" --port "$PORT"
