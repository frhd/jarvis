"""Tests for API routes."""

from io import BytesIO
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.exceptions import AudioFileError, ErrorCode, ModelError, TranscriptionError
from src.main import app
from src.models import Segment, TranscriptionResult


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def mock_transcriber():
    """Mock the transcriber to avoid loading the model."""
    with patch("src.routes.transcriber") as mock:
        yield mock


class TestHealthEndpoint:
    def test_health_returns_healthy(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestRootEndpoint:
    def test_root_returns_service_info(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "whisper"
        assert "version" in data
        assert "docs" in data


class TestAsrEndpoint:
    """Tests for whisper-asr-webservice compatible /asr endpoint."""

    def test_asr_success(self, client, mock_transcriber):
        mock_transcriber.transcribe.return_value = TranscriptionResult(
            text="Hello world",
            language="en",
            duration=1.5,
            segments=[Segment(start=0.0, end=1.5, text="Hello world")],
        )

        response = client.post(
            "/asr?output=json&task=transcribe",
            files={"audio_file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "Hello world"
        assert data["language"] == "en"

    def test_asr_with_language(self, client, mock_transcriber):
        mock_transcriber.transcribe.return_value = TranscriptionResult(
            text="Hallo",
            language="de",
            duration=1.0,
        )

        response = client.post(
            "/asr?output=json&task=transcribe&language=de",
            files={"audio_file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
        )

        assert response.status_code == 200
        mock_transcriber.transcribe.assert_called_once()
        call_kwargs = mock_transcriber.transcribe.call_args[1]
        assert call_kwargs["language"] == "de"

    def test_asr_with_word_timestamps(self, client, mock_transcriber):
        mock_transcriber.transcribe.return_value = TranscriptionResult(
            text="Hello",
            language="en",
            duration=1.0,
        )

        response = client.post(
            "/asr?output=json&task=transcribe&word_timestamps=true",
            files={"audio_file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
        )

        assert response.status_code == 200
        call_kwargs = mock_transcriber.transcribe.call_args[1]
        assert call_kwargs["word_timestamps"] is True


class TestTranscriptionEndpoint:
    def test_transcribe_success(self, client, mock_transcriber):
        mock_transcriber.transcribe.return_value = TranscriptionResult(
            text="Hello world",
            language="en",
            duration=1.5,
            segments=[Segment(start=0.0, end=1.5, text="Hello world")],
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
            data={"model": "base"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "Hello world"
        assert data["language"] == "en"
        assert data["duration"] == 1.5

    def test_transcribe_with_language(self, client, mock_transcriber):
        mock_transcriber.transcribe.return_value = TranscriptionResult(
            text="Bonjour",
            language="fr",
            duration=1.0,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.wav", BytesIO(b"fake audio"), "audio/wav")},
            data={"model": "base", "language": "fr"},
        )

        assert response.status_code == 200
        mock_transcriber.transcribe.assert_called_once()
        call_kwargs = mock_transcriber.transcribe.call_args[1]
        assert call_kwargs["language"] == "fr"

    def test_transcribe_missing_file(self, client, mock_transcriber):
        response = client.post(
            "/v1/audio/transcriptions",
            data={"model": "base"},
        )

        assert response.status_code == 422


class TestErrorHandling:
    def test_audio_file_error_returns_400(self, client, mock_transcriber):
        mock_transcriber.transcribe.side_effect = AudioFileError(
            message="File not found",
            code=ErrorCode.FILE_NOT_FOUND,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
            data={"model": "base"},
        )

        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "file_not_found"
        assert data["error"]["type"] == "invalid_request_error"

    def test_unsupported_format_error(self, client, mock_transcriber):
        mock_transcriber.transcribe.side_effect = AudioFileError(
            message="Unsupported audio format: .txt",
            code=ErrorCode.UNSUPPORTED_FORMAT,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.txt", BytesIO(b"not audio"), "text/plain")},
            data={"model": "base"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "unsupported_format"

    def test_model_error_returns_500(self, client, mock_transcriber):
        mock_transcriber.transcribe.side_effect = ModelError(
            message="Failed to load model",
            code=ErrorCode.MODEL_LOAD_FAILED,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
            data={"model": "base"},
        )

        assert response.status_code == 500
        data = response.json()
        assert data["error"]["code"] == "model_load_failed"
        assert data["error"]["type"] == "server_error"

    def test_transcription_error_returns_500(self, client, mock_transcriber):
        mock_transcriber.transcribe.side_effect = TranscriptionError(
            message="Transcription failed",
            code=ErrorCode.TRANSCRIPTION_FAILED,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
            data={"model": "base"},
        )

        assert response.status_code == 500
        data = response.json()
        assert data["error"]["code"] == "transcription_failed"

    def test_openai_compatible_error_format(self, client, mock_transcriber):
        mock_transcriber.transcribe.side_effect = AudioFileError(
            message="Test error message",
            code=ErrorCode.INVALID_AUDIO,
        )

        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.ogg", BytesIO(b"fake audio"), "audio/ogg")},
            data={"model": "base"},
        )

        data = response.json()
        assert "error" in data
        assert "message" in data["error"]
        assert "type" in data["error"]
        assert "code" in data["error"]
        assert data["error"]["message"] == "Test error message"
