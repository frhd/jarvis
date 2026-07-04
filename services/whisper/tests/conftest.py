"""Pytest fixtures for Whisper service tests."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_whisper_model():
    """Mock WhisperModel for testing without loading the actual model."""
    with patch("src.transcriber.WhisperModel") as mock_cls:
        mock_model = MagicMock()
        mock_cls.return_value = mock_model
        yield mock_model


@pytest.fixture
def temp_audio_file():
    """Create a temporary file to simulate an audio file."""
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
        f.write(b"fake audio content")
        path = Path(f.name)
    yield path
    path.unlink(missing_ok=True)
