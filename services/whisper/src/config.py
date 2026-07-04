"""Environment configuration for Whisper service."""

from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration loaded from environment variables."""

    model_size: str = "base"
    compute_type: str = "int8"
    device: str = "cpu"
    language: Optional[str] = None
    beam_size: int = 5
    log_level: str = "INFO"
    host: str = "127.0.0.1"
    port: int = 9000

    model_config = {"env_prefix": "WHISPER_"}


settings = Settings()
