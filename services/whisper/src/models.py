"""Pydantic models for transcription requests and responses."""

from pydantic import BaseModel


class Segment(BaseModel):
    """A transcription segment with timing information."""

    start: float
    end: float
    text: str


class Word(BaseModel):
    """A transcribed word with timing information."""

    start: float
    end: float
    word: str
    probability: float


class TranscriptionResult(BaseModel):
    """Result of a transcription operation."""

    text: str
    language: str
    duration: float
    segments: list[Segment] = []
    words: list[Word] = []


class ErrorResponse(BaseModel):
    """Error response format matching OpenAI API."""

    error: dict[str, str]
