"""Middleware for request logging and exception handling."""

import time
import uuid
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .exceptions import WhisperError
from .logging_config import get_logger

logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging requests and responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        start_time = time.perf_counter()

        logger.info(
            "Request started",
            extra={
                "extra_data": {
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                }
            },
        )

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            logger.info(
                "Request completed",
                extra={
                    "extra_data": {
                        "request_id": request_id,
                        "status_code": response.status_code,
                        "duration_ms": round(duration_ms, 2),
                    }
                },
            )
            return response

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.exception(
                "Request failed",
                extra={
                    "extra_data": {
                        "request_id": request_id,
                        "error": str(e),
                        "duration_ms": round(duration_ms, 2),
                    }
                },
            )
            raise


async def whisper_exception_handler(request: Request, exc: WhisperError) -> JSONResponse:
    """Handle WhisperError exceptions and return OpenAI-compatible error response."""
    request_id = getattr(request.state, "request_id", "unknown")

    logger.error(
        exc.message,
        extra={
            "extra_data": {
                "request_id": request_id,
                "error_code": exc.code.value,
                "error_type": exc.error_type.value,
            }
        },
    )

    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())
