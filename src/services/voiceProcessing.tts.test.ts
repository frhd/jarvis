import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VoiceProcessingService,
  TTSRequest,
  TTSResult,
  TTSErrorResult,
  TTSSuccessResult,
} from './voiceProcessing.service';

// ============================================================================
// Mocks
// ============================================================================

// Mock the config module
vi.mock('../config/index', () => ({
  appConfig: {
    whisper: {
      enabled: true,
      baseUrl: 'http://localhost:9000',
      model: 'base',
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
// Type Guards
// ============================================================================

function isTTSError(result: TTSResult): result is TTSErrorResult {
  return result.success === false;
}

function isTTSSuccess(result: TTSResult): result is TTSSuccessResult {
  return result.success === true;
}

// ============================================================================
// Tests
// ============================================================================

describe('VoiceProcessingService TTS Graceful Fallback', () => {
  describe('TTS Disabled Handling', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      // Create service with TTS disabled (default)
      service = new VoiceProcessingService({ ttsEnabled: false });
    });

    it('should return error response when TTS disabled', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      expect(result.success).toBe(false);
      expect(isTTSError(result)).toBe(true);
    });

    it('should not throw when TTS disabled', async () => {
      const request: TTSRequest = { text: 'Hello world' };

      // Should not throw
      await expect(service.textToSpeech(request)).resolves.not.toThrow();
    });

    it('should include helpful error message', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.message).toContain('not enabled');
        expect(result.error.suggestion).toBeDefined();
        expect(result.error.suggestion).toContain('ttsEnabled');
      } else {
        throw new Error('Expected error result');
      }
    });

    it('should return proper error code TTS_DISABLED', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.code).toBe('TTS_DISABLED');
      } else {
        throw new Error('Expected error result');
      }
    });
  });

  describe('TTS Not Implemented Handling', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      // Create service with TTS enabled but not implemented
      service = new VoiceProcessingService({ ttsEnabled: true });
    });

    it('should return TTS_NOT_IMPLEMENTED error type', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.code).toBe('TTS_NOT_IMPLEMENTED');
      } else {
        throw new Error('Expected error result');
      }
    });

    it('should not crash the service', async () => {
      const request: TTSRequest = { text: 'Test message' };

      // Should not throw
      await expect(service.textToSpeech(request)).resolves.toBeDefined();
    });

    it('should allow service to continue operating after TTS error', async () => {
      const request: TTSRequest = { text: 'First request' };
      const result1 = await service.textToSpeech(request);

      // Second request should also work
      const result2 = await service.textToSpeech({ text: 'Second request' });

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);

      // Service should still report healthy for other operations
      const health = service.getHealthStatus();
      expect(health).toBeDefined();
    });

    it('should include suggestion for TTS not implemented', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.suggestion).toBeDefined();
        expect(result.error.suggestion).toContain('future');
      } else {
        throw new Error('Expected error result');
      }
    });
  });

  describe('TTS Error Response Format', () => {
    let service: VoiceProcessingService;

    beforeEach(() => {
      service = new VoiceProcessingService({ ttsEnabled: false });
    });

    it('should return consistent error structure', async () => {
      const request: TTSRequest = { text: 'Hello world' };
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
      }
    });

    it('should include suggestion for enabling TTS', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      if (isTTSError(result)) {
        expect(result.error.suggestion).toBeDefined();
        expect(typeof result.error.suggestion).toBe('string');
      }
    });

    it('should be serializable to JSON', async () => {
      const request: TTSRequest = { text: 'Hello world' };
      const result = await service.textToSpeech(request);

      // Should not throw when serializing
      const json = JSON.stringify(result);
      expect(json).toBeDefined();

      // Should deserialize back to same structure
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(result.success);
      if (isTTSError(result)) {
        expect(parsed.error.code).toBe(result.error.code);
        expect(parsed.error.message).toBe(result.error.message);
      }
    });

    it('should handle various TTSRequest options', async () => {
      const requestWithOptions: TTSRequest = {
        text: 'Hello world',
        voice: 'alloy',
        speed: 1.5,
        format: 'mp3',
      };

      const result = await service.textToSpeech(requestWithOptions);

      expect(result.success).toBe(false);
      if (isTTSError(result)) {
        expect(result.error.code).toBe('TTS_DISABLED');
      }
    });
  });

  describe('Type narrowing with TTSResult', () => {
    it('should support type narrowing with success property', async () => {
      const service = new VoiceProcessingService({ ttsEnabled: false });
      const result = await service.textToSpeech({ text: 'test' });

      if (result.success) {
        // This branch won't execute but TypeScript should type narrow to TTSSuccessResult
        const audioPath: string = result.audioPath;
        expect(audioPath).toBeDefined();
      } else {
        // TypeScript should narrow to TTSErrorResult
        const errorCode = result.error.code;
        expect(errorCode).toBe('TTS_DISABLED');
      }
    });

    it('should have mutually exclusive success types', async () => {
      const service = new VoiceProcessingService({ ttsEnabled: true });
      const result = await service.textToSpeech({ text: 'test' });

      // Exactly one of these should be true
      const isSuccess = isTTSSuccess(result);
      const isError = isTTSError(result);

      expect(isSuccess !== isError).toBe(true);
    });
  });
});
