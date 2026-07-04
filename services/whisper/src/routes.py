"""API route handlers for Whisper transcription service."""

import tempfile
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, Query, UploadFile

from .exceptions import AudioFileError, ErrorCode
from .logging_config import get_logger
from .models import ErrorResponse, TranscriptionResult
from .transcriber import WhisperTranscriber

logger = get_logger(__name__)
router = APIRouter()
transcriber = WhisperTranscriber()


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@router.get("/")
async def root() -> dict[str, str]:
    """Root endpoint with service info."""
    return {"service": "whisper", "version": "1.0.0", "docs": "/docs"}


@router.post(
    "/v1/audio/transcriptions",
    response_model=TranscriptionResult,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def transcribe_audio(
    file: Annotated[UploadFile, File(description="Audio file to transcribe")],
    model: Annotated[str, Form()] = "base",
    language: Annotated[Optional[str], Form()] = None,
) -> TranscriptionResult:
    """Transcribe audio file (OpenAI-compatible endpoint)."""
    if not file.filename:
        raise AudioFileError(message="No file provided", code=ErrorCode.MISSING_FILE)

    suffix = Path(file.filename).suffix or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = transcriber.transcribe(tmp_path, language=language)
        return result
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post(
    "/asr",
    response_model=TranscriptionResult,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def asr_endpoint(
    audio_file: Annotated[UploadFile, File(description="Audio file to transcribe")],
    output: Annotated[str, Query()] = "json",
    task: Annotated[str, Query()] = "transcribe",
    language: Annotated[Optional[str], Query()] = None,
    word_timestamps: Annotated[bool, Query()] = False,
) -> TranscriptionResult:
    """Whisper-asr-webservice compatible endpoint."""
    if not audio_file.filename:
        raise AudioFileError(message="No file provided", code=ErrorCode.MISSING_FILE)

    suffix = Path(audio_file.filename).suffix or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await audio_file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = transcriber.transcribe(
            tmp_path, language=language, word_timestamps=word_timestamps
        )
        return result
    finally:
        tmp_path.unlink(missing_ok=True)
