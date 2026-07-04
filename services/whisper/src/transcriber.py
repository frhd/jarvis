"""Whisper transcription service using faster-whisper."""

from pathlib import Path
from typing import Optional, Union

from faster_whisper import WhisperModel

from .config import settings
from .exceptions import AudioFileError, ErrorCode, ModelError, TranscriptionError
from .logging_config import get_logger
from .models import Segment, TranscriptionResult, Word

logger = get_logger(__name__)

SUPPORTED_EXTENSIONS = {".ogg", ".mp3", ".wav", ".m4a", ".flac", ".webm", ".mp4", ".mpeg", ".bin"}

AUDIO_MAGIC_BYTES = {
    b"OggS": "ogg",
    b"ID3": "mp3",
    b"\xff\xfb": "mp3",
    b"\xff\xfa": "mp3",
    b"RIFF": "wav",
    b"fLaC": "flac",
    b"\x1aE\xdf\xa3": "webm",
}


def detect_audio_format(file_path: Path) -> Optional[str]:
    """Detect audio format from file magic bytes."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
        for magic, fmt in AUDIO_MAGIC_BYTES.items():
            if header.startswith(magic):
                return fmt
        if b"ftyp" in header:
            return "m4a"
        return None
    except Exception:
        return None


class WhisperTranscriber:
    """Handles audio transcription using faster-whisper."""

    def __init__(
        self,
        model_size: Optional[str] = None,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
    ):
        self._model: Optional[WhisperModel] = None
        self._model_size = model_size or settings.model_size
        self._device = device or settings.device
        self._compute_type = compute_type or settings.compute_type

    @property
    def model(self) -> WhisperModel:
        """Lazy-load the Whisper model on first access."""
        if self._model is None:
            logger.info(
                "Loading Whisper model: %s (device=%s, compute=%s)",
                self._model_size,
                self._device,
                self._compute_type,
            )
            try:
                self._model = WhisperModel(
                    self._model_size,
                    device=self._device,
                    compute_type=self._compute_type,
                )
                logger.info("Whisper model loaded successfully")
            except Exception as e:
                logger.error("Failed to load Whisper model: %s", str(e))
                raise ModelError(
                    message=f"Failed to load model '{self._model_size}': {e}",
                    original_error=e,
                ) from e
        return self._model

    def transcribe(
        self,
        audio_path: Union[Path, str],
        language: Optional[str] = None,
        word_timestamps: bool = False,
    ) -> TranscriptionResult:
        """Transcribe an audio file."""
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise AudioFileError(
                message=f"Audio file not found: {audio_path}",
                code=ErrorCode.FILE_NOT_FOUND,
            )

        suffix = audio_path.suffix.lower()
        if suffix == ".bin":
            detected = detect_audio_format(audio_path)
            if not detected:
                raise AudioFileError(
                    message="Could not detect audio format from .bin file",
                    code=ErrorCode.UNSUPPORTED_FORMAT,
                )
            logger.debug("Detected format %s for .bin file", detected)
        elif suffix and suffix not in SUPPORTED_EXTENSIONS:
            raise AudioFileError(
                message=f"Unsupported audio format: {suffix}",
                code=ErrorCode.UNSUPPORTED_FORMAT,
            )

        try:
            segments_iter, info = self.model.transcribe(
                str(audio_path),
                language=language or settings.language,
                beam_size=settings.beam_size,
                word_timestamps=word_timestamps,
            )
        except Exception as e:
            logger.error("Transcription failed: %s", str(e))
            raise TranscriptionError(
                message=f"Transcription failed: {e}",
                original_error=e,
            ) from e

        segments: list[Segment] = []
        words: list[Word] = []
        full_text_parts: list[str] = []

        for segment in segments_iter:
            segments.append(
                Segment(start=segment.start, end=segment.end, text=segment.text.strip())
            )
            full_text_parts.append(segment.text.strip())
            if word_timestamps and segment.words:
                for w in segment.words:
                    words.append(
                        Word(
                            start=w.start,
                            end=w.end,
                            word=w.word,
                            probability=w.probability,
                        )
                    )

        return TranscriptionResult(
            text=" ".join(full_text_parts),
            language=info.language,
            duration=info.duration,
            segments=segments,
            words=words,
        )

    def unload(self) -> None:
        """Unload the model to free memory."""
        if self._model is not None:
            del self._model
            self._model = None
            logger.info("Whisper model unloaded")
