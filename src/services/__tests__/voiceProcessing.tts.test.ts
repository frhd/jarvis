import { describe, it, expect, beforeEach } from 'vitest';
import {
  VoiceProcessingService,
  TTSRequest,
  TTSResult,
  TTSErrorResult,
} from '../voiceProcessing.service';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTTSRequest(overrides: Partial<TTSRequest> = {}): TTSRequest {
  return {
    text: 'Hello, this is a test message.',
    voice: 'default',
    speed: 1.0,
    format: 'mp3',
    ...overrides,
  };
}

function isTTSError(result: TTSResult): result is TTSErrorResult {
  return result.success === false;
}

// ============================================================================
// Tests
// ============================================================================

describe('VoiceProcessingService TTS Graceful Error Handling', () => {
  describe('TTS Disabled Handling', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      service = new VoiceProcessingService({
        whisperEnabled: false,
        whisperBaseUrl: 'http://localhost:9000',
        ttsEnabled: false, // TTS disabled
      });
    });

    it('should return error response when TTS disabled', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      expect(result.success).toBe(false);
      expect(isTTSError(result)).toBe(true);
    });

    it('should not throw when TTS disabled', async () => {
      const request = createTTSRequest();

      // Should not throw
      await expect(service.textToSpeech(request)).resolves.not.toThrow();
    });

    it('should include helpful error message', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.message).toContain('not enabled');
        expect(result.error.suggestion).toBeDefined();
        expect(result.error.suggestion).toContain('ttsEnabled');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return proper error code', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.code).toBe('TTS_DISABLED');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('TTS Not Implemented Handling', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      service = new VoiceProcessingService({
        whisperEnabled: false,
        whisperBaseUrl: 'http://localhost:9000',
        ttsEnabled: true, // TTS enabled but not implemented
      });
    });

    it('should return NotImplemented error type', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.code).toBe('TTS_NOT_IMPLEMENTED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should not crash the service', async () => {
      const request = createTTSRequest();

      // Should not throw
      await expect(service.textToSpeech(request)).resolves.not.toThrow();

      // Service should still be usable
      const result = await service.textToSpeech(request);
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should include suggestion for TTS availability', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.message).toContain('not yet implemented');
        expect(result.error.suggestion).toBeDefined();
        expect(result.error.suggestion).toContain('planned');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should allow service to continue operating after TTS error', async () => {
      const request = createTTSRequest();

      // First call
      const result1 = await service.textToSpeech(request);
      expect(result1.success).toBe(false);

      // Second call - should still work
      const result2 = await service.textToSpeech(request);
      expect(result2.success).toBe(false);

      // Service is still operational
      expect(result2).toBeDefined();
    });
  });

  describe('TTS Error Response Format', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      service = new VoiceProcessingService({
        whisperEnabled: false,
        whisperBaseUrl: 'http://localhost:9000',
        ttsEnabled: false,
      });
    });

    it('should return consistent error structure', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      // Check structure
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);

      if (isTTSError(result)) {
        expect(result).toHaveProperty('error');
        expect(result.error).toHaveProperty('code');
        expect(result.error).toHaveProperty('message');
        expect(typeof result.error.code).toBe('string');
        expect(typeof result.error.message).toBe('string');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should include suggestion for enabling TTS', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.suggestion).toBeDefined();
        expect(typeof result.error.suggestion).toBe('string');
        expect(result.error.suggestion!.length).toBeGreaterThan(0);
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should be serializable to JSON', async () => {
      const request = createTTSRequest();
      const result = await service.textToSpeech(request);

      // Should not throw when serializing
      const serialized = JSON.stringify(result);
      expect(serialized).toBeDefined();

      // Should deserialize correctly
      const deserialized = JSON.parse(serialized);
      expect(deserialized.success).toBe(false);
      expect(deserialized.error).toBeDefined();
      expect(deserialized.error.code).toBe('TTS_DISABLED');
    });
  });

  describe('TTS with various request parameters', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      service = new VoiceProcessingService({
        whisperEnabled: false,
        whisperBaseUrl: 'http://localhost:9000',
        ttsEnabled: false,
      });
    });

    it('should handle empty text gracefully', async () => {
      const request = createTTSRequest({ text: '' });
      const result = await service.textToSpeech(request);

      // Should still return error (not crash)
      expect(result.success).toBe(false);
    });

    it('should handle long text gracefully', async () => {
      const longText = 'Hello world. '.repeat(1000);
      const request = createTTSRequest({ text: longText });
      const result = await service.textToSpeech(request);

      // Should still return error (not crash)
      expect(result.success).toBe(false);
    });

    it('should handle various audio formats', async () => {
      const formats = ['mp3', 'wav', 'ogg', 'flac'] as const;

      for (const format of formats) {
        const request = createTTSRequest({ format });
        const result = await service.textToSpeech(request);
        expect(result.success).toBe(false);
      }
    });

    it('should handle different voice options', async () => {
      const voices = ['default', 'alloy', 'echo', 'fable'];

      for (const voice of voices) {
        const request = createTTSRequest({ voice });
        const result = await service.textToSpeech(request);
        expect(result.success).toBe(false);
      }
    });
  });
});
