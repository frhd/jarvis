/**
 * Voice Transcription Feedback Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceTranscriptionFeedbackService } from './voiceTranscriptionFeedback.service';

// Mock telegram service
const mockTelegramService = {
  sendMessage: vi.fn(),
} as any;

describe('VoiceTranscriptionFeedbackService', () => {
  let service: VoiceTranscriptionFeedbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VoiceTranscriptionFeedbackService(mockTelegramService);
  });

  describe('onVoiceMessageReceived', () => {
    it('should send processing feedback when enabled', async () => {
      await service.onVoiceMessageReceived('chat1', 123);

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        'chat1',
        '🎤 Voice message received. Transcribing...',
        123
      );
    });

    it('should not send feedback when disabled', async () => {
      service.updateConfig({ enabled: false, showProcessingStatus: true });

      await service.onVoiceMessageReceived('chat1', 123);

      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send feedback when showProcessingStatus is false', async () => {
      service.updateConfig({ enabled: true, showProcessingStatus: false });

      await service.onVoiceMessageReceived('chat1', 123);

      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('onTranscriptionComplete', () => {
    it('should send completion feedback with full transcript', async () => {
      await service.onTranscriptionComplete('chat1', 123, 'Hello world', 1500);

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        'chat1',
        '🎤 Transcript: Hello world\n\n⏱️ Processed in 1.5s',
        123
      );
    });

    it('should send full transcript even for long text', async () => {
      const longTranscript = 'a'.repeat(150);
      await service.onTranscriptionComplete('chat1', 123, longTranscript);

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).toContain(longTranscript);
    });

    it('should not include duration when not provided', async () => {
      await service.onTranscriptionComplete('chat1', 123, 'Test');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).not.toContain('⏱️');
    });

    it('should not send feedback when disabled', async () => {
      service.updateConfig({ enabled: false });

      await service.onTranscriptionComplete('chat1', 123, 'Test');

      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('onTranscriptionFailed', () => {
    it('should send failure feedback with error details', async () => {
      await service.onTranscriptionFailed('chat1', 123, 'Network error', 'network');

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        'chat1',
        expect.stringContaining('❌ Transcription failed'),
        123
      );
    });

    it('should include error message when showFailureDetails is true', async () => {
      await service.onTranscriptionFailed('chat1', 123, 'File not found', 'file_access');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).toContain('File not found');
    });

    it('should include suggestion based on error category', async () => {
      await service.onTranscriptionFailed('chat1', 123, 'Connection refused', 'service_unavailable');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).toContain('currently unavailable');
    });

    it('should include suggestion for file_access error', async () => {
      await service.onTranscriptionFailed('chat1', 123, 'File error', 'file_access');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).toContain('try sending the message again');
    });

    it('should include suggestion for timeout error', async () => {
      await service.onTranscriptionFailed('chat1', 123, 'Timeout', 'timeout');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).toContain('shorter voice message');
    });

    it('should not send feedback when showFailureDetails is false', async () => {
      service.updateConfig({ enabled: true, showFailureDetails: false });

      await service.onTranscriptionFailed('chat1', 123, 'Error', 'network');

      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      service.updateConfig({ showTranscriptPreview: false });

      // Re-send to test new config
      service.onTranscriptionComplete('chat1', 123, 'Test');

      const message = mockTelegramService.sendMessage.mock.calls[0][1];
      expect(message).not.toContain('"');
    });
  });
});
