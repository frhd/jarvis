import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionService, TranscriptionResult } from './transcription.service';
import { VoiceProcessingService } from './voiceProcessing.service';
import { MessageRepository } from '../repositories/message.repository';
import { Message } from '../types';
import * as configModule from '../config/index';

// ============================================================================
// Mocks
// ============================================================================

// Mock the config module
vi.mock('../config/index', () => ({
  appConfig: {
    whisper: {
      enabled: true,
      baseUrl: 'http://localhost:8000',
      model: 'Systran/faster-whisper-medium',
      defaultLanguage: 'en',
      maxAudioDurationSeconds: 300,
    },
  },
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-123',
    chatId: 'chat-456',
    senderId: 'sender-789',
    telegramMessageId: 1,
    text: null,
    mediaType: 'voice',
    mediaPath: '/path/to/voice.ogg',
    mediaFileId: 'file-123',
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    isBot: false,
    rawJson: '{}',
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TranscriptionService', () => {
  let transcriptionService: TranscriptionService;
  let mockVoiceProcessingService: VoiceProcessingService;
  let mockMessageRepository: MessageRepository;

  beforeEach(() => {
    // Reset config to enabled state
    (configModule.appConfig as any).whisper.enabled = true;

    // Create mock VoiceProcessingService
    mockVoiceProcessingService = {
      transcribe: vi.fn(),
    } as any;

    // Create mock MessageRepository
    mockMessageRepository = {
      markTranscriptProcessing: vi.fn(),
      updateTranscript: vi.fn(),
      markTranscriptFailed: vi.fn(),
      findPendingTranscriptions: vi.fn(),
    } as any;

    // Create service instance
    transcriptionService = new TranscriptionService(
      mockVoiceProcessingService,
      mockMessageRepository
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('transcribeAsync', () => {
    it('should skip transcription when whisper is disabled', () => {
      // Disable whisper
      (configModule.appConfig as any).whisper.enabled = false;

      const message = createMockMessage();

      // Should return without calling transcribe
      transcriptionService.transcribeAsync(message);

      // Wait a tick to ensure async operations complete
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(mockVoiceProcessingService.transcribe).not.toHaveBeenCalled();
          expect(mockMessageRepository.markTranscriptProcessing).not.toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });

    it('should skip transcription for non-voice messages', () => {
      const message = createMockMessage({ mediaType: 'photo' });

      transcriptionService.transcribeAsync(message);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(mockVoiceProcessingService.transcribe).not.toHaveBeenCalled();
          expect(mockMessageRepository.markTranscriptProcessing).not.toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });

    it('should skip transcription when mediaPath is missing', () => {
      const message = createMockMessage({ mediaPath: null });

      transcriptionService.transcribeAsync(message);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(mockVoiceProcessingService.transcribe).not.toHaveBeenCalled();
          expect(mockMessageRepository.markTranscriptProcessing).not.toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });

    it('should fire and forget transcription for valid voice message', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Hello world',
        language: 'en',
        languageConfidence: 0.95,
        duration: 2.5,
        segments: [],
        cached: false,
        processingTimeMs: 150,
      });

      transcriptionService.transcribeAsync(message);

      // Wait for async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockMessageRepository.markTranscriptProcessing).toHaveBeenCalledWith(message.id);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledWith(
        message.mediaPath,
        { responseFormat: 'json' }
      );
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledWith(message.id, {
        transcript: 'Hello world',
        language: 'en',
        durationMs: expect.any(Number),
      });
    });

    it('should handle errors gracefully in async transcription', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockRejectedValue(
        new Error('Whisper API error')
      );

      transcriptionService.transcribeAsync(message);

      // Wait for async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockMessageRepository.markTranscriptProcessing).toHaveBeenCalledWith(message.id);
      expect(mockMessageRepository.markTranscriptFailed).toHaveBeenCalledWith(
        message.id,
        'Whisper API error'
      );
    });
  });

  describe('transcribe', () => {
    it('should return error result when mediaPath is missing', async () => {
      const message = createMockMessage({ mediaPath: null });

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No media path');
      expect(mockVoiceProcessingService.transcribe).not.toHaveBeenCalled();
    });

    it('should successfully transcribe voice message and update database', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'This is a test message',
        language: 'en',
        languageConfidence: 0.98,
        duration: 3.2,
        segments: [],
        cached: false,
        processingTimeMs: 200,
      });

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(true);
      expect(result.transcript).toBe('This is a test message');
      expect(result.language).toBe('en');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      expect(mockMessageRepository.markTranscriptProcessing).toHaveBeenCalledWith(message.id);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledWith(
        message.mediaPath,
        { responseFormat: 'json' }
      );
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledWith(message.id, {
        transcript: 'This is a test message',
        language: 'en',
        durationMs: expect.any(Number),
      });
    });

    it('should handle transcription errors and mark message as failed', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockRejectedValue(
        new Error('Audio file too large')
      );

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Audio file too large');

      expect(mockMessageRepository.markTranscriptProcessing).toHaveBeenCalledWith(message.id);
      expect(mockMessageRepository.markTranscriptFailed).toHaveBeenCalledWith(
        message.id,
        'Audio file too large'
      );
    });

    it('should handle non-Error exceptions', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockRejectedValue('String error');

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');

      expect(mockMessageRepository.markTranscriptFailed).toHaveBeenCalledWith(
        message.id,
        'Unknown error'
      );
    });

    it('should pass correct options to VoiceProcessingService', async () => {
      const message = createMockMessage({ mediaPath: '/path/to/audio.ogg' });

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Test',
        language: 'en',
        languageConfidence: 0.9,
        duration: 1.0,
        segments: [],
        cached: false,
        processingTimeMs: 100,
      });

      await transcriptionService.transcribe(message);

      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledWith(
        '/path/to/audio.ogg',
        { responseFormat: 'json' }
      );
    });

    it('should track processing time correctly', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              text: 'Delayed response',
              language: 'en',
              languageConfidence: 0.9,
              duration: 2.0,
              segments: [],
              cached: false,
              processingTimeMs: 50,
            });
          }, 100);
        });
      });

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(true);
      // Allow small timing variance (95ms instead of 100ms) to avoid flaky tests
      expect(result.durationMs).toBeGreaterThanOrEqual(95);
    });
  });

  describe('processPendingTranscriptions', () => {
    it('should return 0 when whisper is disabled', async () => {
      // Disable whisper
      (configModule.appConfig as any).whisper.enabled = false;

      const count = await transcriptionService.processPendingTranscriptions();

      expect(count).toBe(0);
      expect(mockMessageRepository.findPendingTranscriptions).not.toHaveBeenCalled();
    });

    it('should return 0 when no pending transcriptions exist', async () => {
      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue([]);

      const count = await transcriptionService.processPendingTranscriptions();

      expect(count).toBe(0);
      expect(mockMessageRepository.findPendingTranscriptions).toHaveBeenCalledWith(50);
    });

    it('should process pending transcriptions successfully', async () => {
      const pendingMessages = [
        createMockMessage({ id: 'msg-1', mediaPath: '/path/1.ogg' }),
        createMockMessage({ id: 'msg-2', mediaPath: '/path/2.ogg' }),
        createMockMessage({ id: 'msg-3', mediaPath: '/path/3.ogg' }),
      ];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Test transcription',
        language: 'en',
        languageConfidence: 0.9,
        duration: 2.0,
        segments: [],
        cached: false,
        processingTimeMs: 100,
      });

      const count = await transcriptionService.processPendingTranscriptions();

      expect(count).toBe(3);
      expect(mockMessageRepository.findPendingTranscriptions).toHaveBeenCalledWith(50);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledTimes(3);
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledTimes(3);
    });

    it('should process with custom limit', async () => {
      const pendingMessages = [createMockMessage()];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Test',
        language: 'en',
        languageConfidence: 0.9,
        duration: 1.0,
        segments: [],
        cached: false,
        processingTimeMs: 100,
      });

      await transcriptionService.processPendingTranscriptions(10);

      expect(mockMessageRepository.findPendingTranscriptions).toHaveBeenCalledWith(10);
    });

    it('should continue processing on individual failures', async () => {
      const pendingMessages = [
        createMockMessage({ id: 'msg-1', mediaPath: '/path/1.ogg' }),
        createMockMessage({ id: 'msg-2', mediaPath: '/path/2.ogg' }),
        createMockMessage({ id: 'msg-3', mediaPath: '/path/3.ogg' }),
      ];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      // First succeeds, second fails, third succeeds
      vi.mocked(mockVoiceProcessingService.transcribe)
        .mockResolvedValueOnce({
          text: 'Success 1',
          language: 'en',
          languageConfidence: 0.9,
          duration: 1.0,
          segments: [],
          cached: false,
          processingTimeMs: 100,
        })
        .mockRejectedValueOnce(new Error('Transcription failed'))
        .mockResolvedValueOnce({
          text: 'Success 3',
          language: 'en',
          languageConfidence: 0.9,
          duration: 1.0,
          segments: [],
          cached: false,
          processingTimeMs: 100,
        });

      const count = await transcriptionService.processPendingTranscriptions();

      // Should count only successful transcriptions
      expect(count).toBe(2);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledTimes(3);
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledTimes(2);
      expect(mockMessageRepository.markTranscriptFailed).toHaveBeenCalledTimes(1);
    });

    it('should handle messages with missing mediaPath', async () => {
      const pendingMessages = [
        createMockMessage({ id: 'msg-1', mediaPath: null }),
        createMockMessage({ id: 'msg-2', mediaPath: '/path/2.ogg' }),
      ];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Success',
        language: 'en',
        languageConfidence: 0.9,
        duration: 1.0,
        segments: [],
        cached: false,
        processingTimeMs: 100,
      });

      const count = await transcriptionService.processPendingTranscriptions();

      // Only the second message should be processed successfully
      // First returns { success: false } so not counted
      expect(count).toBe(1);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledTimes(1);
    });

    it('should handle exceptions during processing gracefully', async () => {
      const pendingMessages = [
        createMockMessage({ id: 'msg-1' }),
        createMockMessage({ id: 'msg-2' }),
      ];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      // First throws an exception, second succeeds
      vi.mocked(mockMessageRepository.markTranscriptProcessing)
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce();

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Success',
        language: 'en',
        languageConfidence: 0.9,
        duration: 1.0,
        segments: [],
        cached: false,
        processingTimeMs: 100,
      });

      const count = await transcriptionService.processPendingTranscriptions();

      // Second message should succeed
      expect(count).toBe(1);
    });

    it('should process all messages in batch sequentially', async () => {
      const pendingMessages = [
        createMockMessage({ id: 'msg-1' }),
        createMockMessage({ id: 'msg-2' }),
        createMockMessage({ id: 'msg-3' }),
      ];

      vi.mocked(mockMessageRepository.findPendingTranscriptions).mockResolvedValue(
        pendingMessages
      );

      const callOrder: string[] = [];

      vi.mocked(mockVoiceProcessingService.transcribe).mockImplementation(async (path) => {
        callOrder.push(path as string);
        return {
          text: 'Test',
          language: 'en',
          languageConfidence: 0.9,
          duration: 1.0,
          segments: [],
          cached: false,
          processingTimeMs: 100,
        };
      });

      await transcriptionService.processPendingTranscriptions();

      // Verify sequential processing by checking call order
      expect(callOrder).toEqual(['/path/to/voice.ogg', '/path/to/voice.ogg', '/path/to/voice.ogg']);
      expect(callOrder.length).toBe(3);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow from async trigger to completion', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Complete workflow test',
        language: 'en',
        languageConfidence: 0.95,
        duration: 2.5,
        segments: [],
        cached: false,
        processingTimeMs: 150,
      });

      // Trigger async transcription
      transcriptionService.transcribeAsync(message);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify complete workflow
      expect(mockMessageRepository.markTranscriptProcessing).toHaveBeenCalledWith(message.id);
      expect(mockVoiceProcessingService.transcribe).toHaveBeenCalledWith(
        message.mediaPath,
        { responseFormat: 'json' }
      );
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledWith(
        message.id,
        expect.objectContaining({
          transcript: 'Complete workflow test',
          language: 'en',
        })
      );
    });

    it('should handle language detection in transcription result', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockResolvedValue({
        text: 'Bonjour le monde',
        language: 'fr',
        languageConfidence: 0.92,
        duration: 1.8,
        segments: [],
        cached: false,
        processingTimeMs: 120,
      });

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(true);
      expect(result.language).toBe('fr');
      expect(mockMessageRepository.updateTranscript).toHaveBeenCalledWith(
        message.id,
        expect.objectContaining({
          language: 'fr',
        })
      );
    });

    it('should handle very long processing times', async () => {
      const message = createMockMessage();

      vi.mocked(mockVoiceProcessingService.transcribe).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              text: 'Long processing',
              language: 'en',
              languageConfidence: 0.9,
              duration: 2.0,
              segments: [],
              cached: false,
              processingTimeMs: 5000,
            });
          }, 500);
        });
      });

      const result = await transcriptionService.transcribe(message);

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(500);
    });
  });
});
