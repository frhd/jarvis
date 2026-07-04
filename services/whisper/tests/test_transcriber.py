"""Tests for WhisperTranscriber."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.exceptions import AudioFileError, ErrorCode, ModelError, TranscriptionError
from src.transcriber import WhisperTranscriber


class TestWhisperTranscriber:
    """Test cases for WhisperTranscriber class."""

    def test_init_with_defaults(self):
        """Transcriber initializes with default settings."""
        transcriber = WhisperTranscriber()
        assert transcriber._model is None
        assert transcriber._model_size == "base"

    def test_init_with_custom_settings(self):
        """Transcriber accepts custom model settings."""
        transcriber = WhisperTranscriber(
            model_size="small",
            device="cuda",
            compute_type="float16",
        )
        assert transcriber._model_size == "small"
        assert transcriber._device == "cuda"
        assert transcriber._compute_type == "float16"

    def test_lazy_loading(self, mock_whisper_model):
        """Model is loaded only when first accessed."""
        transcriber = WhisperTranscriber()
        assert transcriber._model is None
        _ = transcriber.model
        assert transcriber._model is not None

    def test_transcribe_file_not_found(self):
        """Raises AudioFileError for missing audio file."""
        transcriber = WhisperTranscriber()
        with pytest.raises(AudioFileError) as exc_info:
            transcriber.transcribe(Path("/nonexistent/file.ogg"))
        assert exc_info.value.code == ErrorCode.FILE_NOT_FOUND

    def test_transcribe_unsupported_format(self):
        """Raises AudioFileError for unsupported audio format."""
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(b"not audio")
            path = Path(f.name)
        try:
            transcriber = WhisperTranscriber()
            with pytest.raises(AudioFileError) as exc_info:
                transcriber.transcribe(path)
            assert exc_info.value.code == ErrorCode.UNSUPPORTED_FORMAT
        finally:
            path.unlink(missing_ok=True)

    def test_model_load_failure(self):
        """Raises ModelError when model fails to load."""
        with patch("src.transcriber.WhisperModel") as mock_cls:
            mock_cls.side_effect = RuntimeError("Model not found")
            transcriber = WhisperTranscriber()
            with pytest.raises(ModelError) as exc_info:
                _ = transcriber.model
            assert exc_info.value.code == ErrorCode.MODEL_LOAD_FAILED
            assert exc_info.value.original_error is not None

    def test_transcription_failure(self, mock_whisper_model, temp_audio_file):
        """Raises TranscriptionError when transcription fails."""
        mock_whisper_model.transcribe.side_effect = RuntimeError("Transcription failed")
        transcriber = WhisperTranscriber()
        with pytest.raises(TranscriptionError) as exc_info:
            transcriber.transcribe(temp_audio_file)
        assert exc_info.value.code == ErrorCode.TRANSCRIPTION_FAILED

    def test_transcribe_success(self, mock_whisper_model, temp_audio_file):
        """Transcribes audio file successfully."""
        mock_segment = MagicMock()
        mock_segment.start = 0.0
        mock_segment.end = 2.5
        mock_segment.text = " Hello world "
        mock_segment.words = None

        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.duration = 2.5

        mock_whisper_model.transcribe.return_value = ([mock_segment], mock_info)

        transcriber = WhisperTranscriber()
        result = transcriber.transcribe(temp_audio_file)

        assert result.text == "Hello world"
        assert result.language == "en"
        assert result.duration == 2.5
        assert len(result.segments) == 1
        assert result.segments[0].text == "Hello world"

    def test_transcribe_with_word_timestamps(self, mock_whisper_model, temp_audio_file):
        """Transcribes with word-level timestamps."""
        mock_word = MagicMock()
        mock_word.start = 0.0
        mock_word.end = 0.5
        mock_word.word = "Hello"
        mock_word.probability = 0.95

        mock_segment = MagicMock()
        mock_segment.start = 0.0
        mock_segment.end = 1.0
        mock_segment.text = " Hello "
        mock_segment.words = [mock_word]

        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.duration = 1.0

        mock_whisper_model.transcribe.return_value = ([mock_segment], mock_info)

        transcriber = WhisperTranscriber()
        result = transcriber.transcribe(temp_audio_file, word_timestamps=True)

        assert len(result.words) == 1
        assert result.words[0].word == "Hello"
        assert result.words[0].probability == 0.95

    def test_unload_model(self, mock_whisper_model):
        """Unloads the model to free memory."""
        transcriber = WhisperTranscriber()
        _ = transcriber.model
        assert transcriber._model is not None

        transcriber.unload()
        assert transcriber._model is None
