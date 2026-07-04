"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .exceptions import WhisperError
from .logging_config import get_logger, setup_logging
from .middleware import RequestLoggingMiddleware, whisper_exception_handler
from .routes import router, transcriber

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Handle startup and shutdown events."""
    logger.info("Whisper service starting")
    yield
    logger.info("Whisper service shutting down")
    transcriber.unload()


app = FastAPI(
    title="Whisper Transcription Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)
app.add_exception_handler(WhisperError, whisper_exception_handler)
app.include_router(router)
