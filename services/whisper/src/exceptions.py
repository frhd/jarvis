"""Custom exception classes for Whisper service."""

from enum import Enum
from typing import Optional


class ErrorCode(str, Enum):
    """Error codes for Whisper service errors."""

    MISSING_FILE = "missing_file"
    FILE_NOT_FOUND = "file_not_found"
    INVALID_AUDIO = "invalid_audio"
    UNSUPPORTED_FORMAT = "unsupported_format"
    MODEL_LOAD_FAILED = "model_load_failed"
    TRANSCRIPTION_FAILED = "transcription_failed"
    TRANSCRIPTION_TIMEOUT = "transcription_timeout"
    INTERNAL_ERROR = "internal_error"


class ErrorType(str, Enum):
    """Error types matching OpenAI API format."""

    INVALID_REQUEST = "invalid_request_error"
    SERVER_ERROR = "server_error"


class WhisperError(Exception):
    """Base exception for Whisper service errors."""

    def __init__(
        self,
        message: str,
        code: ErrorCode,
        error_type: ErrorType = ErrorType.SERVER_ERROR,
        status_code: int = 500,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.error_type = error_type
        self.status_code = status_code
        self.original_error = original_error

    def to_dict(self) -> dict:
        """Convert to OpenAI-compatible error response format."""
        return {
            "error": {
                "message": self.message,
                "type": self.error_type.value,
                "code": self.code.value,
            }
        }


class AudioFileError(WhisperError):
    """Error related to audio file operations."""

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.INVALID_AUDIO,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(
            message=message,
            code=code,
            error_type=ErrorType.INVALID_REQUEST,
            status_code=400,
            original_error=original_error,
        )


class ModelError(WhisperError):
    """Error related to Whisper model operations."""

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.MODEL_LOAD_FAILED,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(
            message=message,
            code=code,
            error_type=ErrorType.SERVER_ERROR,
            status_code=500,
            original_error=original_error,
        )


class TranscriptionError(WhisperError):
    """Error during transcription process."""

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.TRANSCRIPTION_FAILED,
        status_code: int = 500,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(
            message=message,
            code=code,
            error_type=ErrorType.SERVER_ERROR,
            status_code=status_code,
            original_error=original_error,
        )
