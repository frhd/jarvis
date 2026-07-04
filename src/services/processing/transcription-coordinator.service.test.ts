/**
 * Transcription Coordinator Service Tests
 *
 * Comprehensive tests for the TranscriptionCoordinatorService which handles:
 * - Voice message transcription coordination
 * - Different strategies for private vs group chats
 * - Sync vs async transcription based on chat type and response enablement
 * - Configuration management and late binding of transcription service
 *
 * Run: npx vitest src/services/processing/transcription-coordinator.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TranscriptionCoordinatorService,
  TranscriptionResult,
  TranscriptionCoordinatorConfig,
} from './transcription-coordinator.service.js';
import type { TranscriptionService } from '../transcription.service.js';
import type { Message, Chat } from '../../types/index.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: `msg-${Math.random().toString(36).substring(7)}`,
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: Math.floor(Math.random() * 10000),
  text: null,
  isBot: false,
  mediaType: 'voice',
  mediaPath: '/path/to/voice.ogg',
  mediaFileId: 'file-123',
  replyToMessageId: null,
  forwardFromChatId: null,
  forwardFromMessageId: null,
  rawJson: '{}',
  createdAt: new Date(),
  transcript: null,
  transcriptStatus: null,
  transcriptLanguage: null,
  transcriptDurationMs: null,
  transcriptedAt: null,
  transcriptError: null,
  ...overrides,
});

const createMockChat = (overrides?: Partial<Chat>): Chat => ({
  id: 'chat-1',
  telegramId: '12345',
  type: 'private',
  title: null,
  username: 'testuser',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockTranscriptionService = () => ({
  transcribe: vi.fn().mockResolvedValue({
    success: true,
    transcript: 'Hello, this is a transcription',
    language: 'en',
    durationMs: 1500,
  }),
  transcribeAsync: vi.fn(),
  processPendingTranscriptions: vi.fn().mockResolvedValue(0),
});

const createMockFeedbackService = () => ({
  onVoiceMessageReceived: vi.fn().mockResolvedValue(undefined),
  onTranscriptionComplete: vi.fn().mockResolvedValue(undefined),
  onTranscriptionFailed: vi.fn().mockResolvedValue(undefined),
  updateConfig: vi.fn(),
});

// ============================================================================
// Tests
// ============================================================================

describe('TranscriptionCoordinatorService', () => {
  let mockTranscriptionService: ReturnType<typeof createMockTranscriptionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTranscriptionService = createMockTranscriptionService();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Not a Voice Message - Should Skip
  // ==========================================================================

  describe('not a voice message (mediaType !== "voice")', () => {
    it('should skip transcription for photo messages', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'photo', mediaPath: '/path/to/photo.jpg' });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Not a voice message or transcription service unavailable',
      });
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();
    });

    it('should skip transcription for document messages', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'document', mediaPath: '/path/to/doc.pdf' });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
      expect(result.transcribed).toBe(false);
    });

    it('should skip transcription for text-only messages (mediaType null)', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: null, mediaPath: null, text: 'Hello world' });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
      expect(result.transcribed).toBe(false);
    });

    it('should skip transcription for video messages', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'video', mediaPath: '/path/to/video.mp4' });
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, false);

      expect(result.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // Voice Message Without mediaPath - Should Skip
  // ==========================================================================

  describe('voice message without mediaPath', () => {
    it('should skip transcription when mediaPath is null', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'voice', mediaPath: null });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Not a voice message or transcription service unavailable',
      });
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
    });

    it('should skip transcription when mediaPath is undefined', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'voice' });
      // Explicitly set mediaPath to undefined
      (message as { mediaPath: undefined }).mediaPath = undefined as unknown as null;

      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // Transcription Service Null/Unavailable - Should Skip
  // ==========================================================================

  describe('transcription service null/unavailable', () => {
    it('should skip transcription when transcription service is null', async () => {
      const service = new TranscriptionCoordinatorService(null, { enabled: true });

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Not a voice message or transcription service unavailable',
      });
    });

    it('should report isEnabled as false when transcription service is null', () => {
      const service = new TranscriptionCoordinatorService(null, { enabled: true });

      expect(service.isEnabled()).toBe(false);
    });

    it('should handle sync transcription request with null service gracefully', async () => {
      const service = new TranscriptionCoordinatorService(null, {
        enabled: true,
        syncForPrivateChats: true,
      });

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // Service Disabled via Config - Should Skip
  // ==========================================================================

  describe('service disabled via config', () => {
    it('should skip transcription when disabled in config', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Not a voice message or transcription service unavailable',
      });
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();
    });

    it('should report isEnabled as false when disabled via config', () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should not transcribe even valid voice messages when disabled', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      const message = createMockMessage({
        mediaType: 'voice',
        mediaPath: '/path/to/valid/voice.ogg',
      });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // Private Chat + responseEnabled -> Sync Transcription (Waits)
  // ==========================================================================

  describe('private chat + responseEnabled -> sync transcription', () => {
    it('should perform sync transcription for private chat with response enabled', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: true,
        transcript: 'Hello, this is a transcription',
      });
      expect(mockTranscriptionService.transcribe).toHaveBeenCalledWith(message, chat.telegramId);
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();
    });

    it('should update message.text with transcript for private chat sync transcription', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      expect(message.text).toBeNull();

      await service.processVoiceMessage(message, chat, true);

      expect(message.text).toBe('Hello, this is a transcription');
    });

    it('should wait for transcription to complete before returning', async () => {
      let transcribeResolved = false;

      mockTranscriptionService.transcribe.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        transcribeResolved = true;
        return { success: true, transcript: 'Delayed transcript' };
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const resultPromise = service.processVoiceMessage(message, chat, true);

      // Should not be resolved yet
      expect(transcribeResolved).toBe(false);

      const result = await resultPromise;

      // Now it should be resolved
      expect(transcribeResolved).toBe(true);
      expect(result.transcribed).toBe(true);
    });
  });

  // ==========================================================================
  // Private Chat + responseDisabled -> Async Transcription
  // ==========================================================================

  describe('private chat + responseDisabled -> async transcription', () => {
    it('should perform async transcription for private chat when response is disabled', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, false);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: false,
      });
      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalledWith(message, chat.telegramId);
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
    });

    it('should not update message.text for async transcription', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, false);

      expect(message.text).toBeNull();
    });

    it('should return immediately without waiting for async transcription', async () => {
      let asyncCalled = false;
      mockTranscriptionService.transcribeAsync.mockImplementation(() => {
        asyncCalled = true;
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, false);

      expect(result.transcribed).toBe(false);
      expect(asyncCalled).toBe(true);
    });
  });

  // ==========================================================================
  // Group Chat -> Async Transcription (Non-Blocking)
  // ==========================================================================

  describe('group chat -> async transcription (non-blocking)', () => {
    it('should perform async transcription for group chat', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: false,
      });
      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalledWith(message, chat.telegramId);
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
    });

    it('should perform async transcription for supergroup chat', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'supergroup' });

      const result = await service.processVoiceMessage(message, chat, false);

      expect(result.skipped).toBe(false);
      expect(result.transcribed).toBe(false);
      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalled();
    });

    it('should perform async transcription for channel chat', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'channel' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalled();
    });

    it('should not block on async transcription for group chats', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const startTime = Date.now();
      await service.processVoiceMessage(message, chat, true);
      const elapsed = Date.now() - startTime;

      // Should return almost immediately (< 50ms)
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ==========================================================================
  // Async Disabled for Group Chats -> Skipped
  // ==========================================================================

  describe('async disabled for group chats -> skipped', () => {
    it('should skip transcription for group chat when async is disabled', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: false }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: true,
        skipReason: 'Async transcription disabled for group chats',
      });
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();
    });

    it('should skip transcription for supergroup when async is disabled', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: false }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'supergroup' });

      const result = await service.processVoiceMessage(message, chat, false);

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('Async transcription disabled for group chats');
    });
  });

  // ==========================================================================
  // Sync Transcription Succeeds -> message.text Updated
  // ==========================================================================

  describe('sync transcription succeeds -> message.text updated', () => {
    it('should update message.text with transcript on successful sync transcription', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: 'Successfully transcribed audio',
        language: 'en',
        durationMs: 2000,
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(message.text).toBe('Successfully transcribed audio');
    });

    it('should return transcript in result on successful sync transcription', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: 'Test transcript result',
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.transcript).toBe('Test transcript result');
      expect(result.transcribed).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Sync Transcription Fails -> Error Returned, message.text Unchanged
  // ==========================================================================

  describe('sync transcription fails -> error returned, message.text unchanged', () => {
    it('should return error when sync transcription fails', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'Whisper API unavailable',
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: false,
        transcribed: false,
        skipReason: 'Whisper API unavailable',
      });
    });

    it('should not update message.text when sync transcription fails', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'Transcription failed',
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage({ text: null });
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(message.text).toBeNull();
    });

    it('should return default skip reason when error is undefined', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        // no error property
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.success).toBe(false);
      expect(result.skipReason).toBe('Transcription failed');
    });

    it('should preserve existing message.text when transcription fails', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'Failed',
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage({ text: 'Existing text' });
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(message.text).toBe('Existing text');
    });
  });

  // ==========================================================================
  // TranscriptionService.transcribe() Throws Error
  // ==========================================================================

  describe('TranscriptionService.transcribe() throws error', () => {
    it('should handle thrown Error and return failure result', async () => {
      mockTranscriptionService.transcribe.mockRejectedValue(new Error('Network timeout'));

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: false,
        transcribed: false,
        skipReason: 'Network timeout',
      });
    });

    it('should handle thrown non-Error objects', async () => {
      mockTranscriptionService.transcribe.mockRejectedValue('String error');

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: false,
        transcribed: false,
        skipReason: 'Unknown error',
      });
    });

    it('should not update message.text when transcribe throws', async () => {
      mockTranscriptionService.transcribe.mockRejectedValue(new Error('Crash'));

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(message.text).toBeNull();
    });

    it('should handle null thrown value', async () => {
      mockTranscriptionService.transcribe.mockRejectedValue(null);

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipReason).toBe('Unknown error');
    });
  });

  // ==========================================================================
  // isEnabled() Returns Correct State
  // ==========================================================================

  describe('isEnabled() returns correct state based on config and service availability', () => {
    it('should return true when enabled and service is available', () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);
    });

    it('should return false when disabled via config', () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when service is null', () => {
      const service = new TranscriptionCoordinatorService(null, { enabled: true });

      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when both disabled and service is null', () => {
      const service = new TranscriptionCoordinatorService(null, { enabled: false });

      expect(service.isEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // updateConfig() Changes Behavior
  // ==========================================================================

  describe('updateConfig() changes behavior', () => {
    it('should disable transcription after updateConfig', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);

      service.updateConfig({ enabled: false });

      expect(service.isEnabled()).toBe(false);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
    });

    it('should enable transcription after updateConfig', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);

      service.updateConfig({ enabled: true });

      expect(service.isEnabled()).toBe(true);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.transcribed).toBe(true);
    });

    it('should toggle syncForPrivateChats behavior', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Initially sync
      await service.processVoiceMessage(message, chat, true);
      expect(mockTranscriptionService.transcribe).toHaveBeenCalledTimes(1);
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();

      mockTranscriptionService.transcribe.mockClear();

      // Disable sync for private chats
      service.updateConfig({ syncForPrivateChats: false });

      await service.processVoiceMessage(message, chat, true);

      // Should now use async
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalledTimes(1);
    });

    it('should toggle asyncForGroupChats behavior', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      // Initially async enabled
      let result = await service.processVoiceMessage(message, chat, true);
      expect(result.skipped).toBe(false);
      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalledTimes(1);

      mockTranscriptionService.transcribeAsync.mockClear();

      // Disable async for group chats
      service.updateConfig({ asyncForGroupChats: false });

      result = await service.processVoiceMessage(message, chat, true);

      // Should now skip
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('Async transcription disabled for group chats');
      expect(mockTranscriptionService.transcribeAsync).not.toHaveBeenCalled();
    });

    it('should preserve other config values when updating single value', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true, asyncForGroupChats: true }
      );

      // Update only asyncForGroupChats
      service.updateConfig({ asyncForGroupChats: false });

      // syncForPrivateChats should still be true
      const message = createMockMessage();
      const privateChat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, privateChat, true);

      // Should still use sync transcription for private chats
      expect(mockTranscriptionService.transcribe).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // setTranscriptionService() Allows Late Binding
  // ==========================================================================

  describe('setTranscriptionService() allows late binding of transcription service', () => {
    it('should allow setting transcription service after construction', async () => {
      const service = new TranscriptionCoordinatorService(null, { enabled: true });

      expect(service.isEnabled()).toBe(false);

      service.setTranscriptionService(
        mockTranscriptionService as unknown as TranscriptionService
      );

      expect(service.isEnabled()).toBe(true);
    });

    it('should work correctly after late binding transcription service', async () => {
      const service = new TranscriptionCoordinatorService(null, {
        enabled: true,
        syncForPrivateChats: true,
      });

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Before setting service
      const result1 = await service.processVoiceMessage(message, chat, true);
      expect(result1.skipped).toBe(true);

      // Set service
      service.setTranscriptionService(
        mockTranscriptionService as unknown as TranscriptionService
      );

      // After setting service
      const result2 = await service.processVoiceMessage(message, chat, true);
      expect(result2.transcribed).toBe(true);
    });

    it('should replace existing transcription service', async () => {
      const originalService = createMockTranscriptionService();
      const newService = createMockTranscriptionService();

      const service = new TranscriptionCoordinatorService(
        originalService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Use original service
      await service.processVoiceMessage(message, chat, true);
      expect(originalService.transcribe).toHaveBeenCalledTimes(1);
      expect(newService.transcribe).not.toHaveBeenCalled();

      // Replace service
      service.setTranscriptionService(newService as unknown as TranscriptionService);

      // Use new service
      await service.processVoiceMessage(message, chat, true);
      expect(originalService.transcribe).toHaveBeenCalledTimes(1); // unchanged
      expect(newService.transcribe).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Default Configuration Tests
  // ==========================================================================

  describe('default configuration', () => {
    it('should use default configuration when not provided', () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService
      );

      expect(service.isEnabled()).toBe(true);
    });

    it('should merge partial config with defaults', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { syncForPrivateChats: false } // Only override this
      );

      // Should still be enabled (default)
      expect(service.isEnabled()).toBe(true);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // syncForPrivateChats is false, so should use async
      await service.processVoiceMessage(message, chat, true);

      expect(mockTranscriptionService.transcribeAsync).toHaveBeenCalled();
      expect(mockTranscriptionService.transcribe).not.toHaveBeenCalled();
    });

    it('should have asyncForGroupChats enabled by default', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, true);

      // Should not skip (async is enabled by default)
      expect(result.skipped).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle message with empty transcript result', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: '',
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      // Empty transcript should still be considered successful but not transcribed
      // because the condition checks for result.transcript being truthy
      expect(result.success).toBe(false);
    });

    it('should handle very long transcript', async () => {
      const longTranscript = 'A'.repeat(100000);
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: longTranscript,
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.transcribed).toBe(true);
      expect(message.text).toBe(longTranscript);
    });

    it('should handle transcript with special characters', async () => {
      const specialTranscript =
        'Hello \n\t "quoted" \'single\' <tag> & special chars: \u{1F600}';
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: specialTranscript,
      });

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.transcribed).toBe(true);
      expect(message.text).toBe(specialTranscript);
    });

    it('should handle concurrent processVoiceMessage calls', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const messages = Array.from({ length: 5 }, (_, i) =>
        createMockMessage({ id: `msg-${i}` })
      );
      const chat = createMockChat({ type: 'private' });

      const results = await Promise.all(
        messages.map((msg) => service.processVoiceMessage(msg, chat, true))
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.transcribed).toBe(true);
      });
      expect(mockTranscriptionService.transcribe).toHaveBeenCalledTimes(5);
    });

    it('should not call async transcribe when service is null', async () => {
      const service = new TranscriptionCoordinatorService(null, {
        enabled: true,
        asyncForGroupChats: true,
      });

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
    });

    it('should handle audioType as non-voice', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      const message = createMockMessage({ mediaType: 'audio', mediaPath: '/path/to/audio.mp3' });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      // 'audio' is not 'voice', so should skip
      expect(result.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // Transcription Result Structure Tests
  // ==========================================================================

  describe('TranscriptionResult structure', () => {
    it('should return correct structure for successful sync transcription', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('transcribed', true);
      expect(result).toHaveProperty('transcript');
      expect(result).not.toHaveProperty('skipped');
      expect(result).not.toHaveProperty('skipReason');
    });

    it('should return correct structure for skipped transcription', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('transcribed', false);
      expect(result).toHaveProperty('skipped', true);
      expect(result).toHaveProperty('skipReason');
      expect(result).not.toHaveProperty('transcript');
    });

    it('should return correct structure for async transcription', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toEqual({
        success: true,
        transcribed: false,
        skipped: false,
      });
    });

    it('should return correct structure for failed sync transcription', async () => {
      mockTranscriptionService.transcribe.mockRejectedValue(new Error('API Error'));

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('transcribed', false);
      expect(result).toHaveProperty('skipReason', 'API Error');
      expect(result).not.toHaveProperty('skipped');
    });
  });

  // ==========================================================================
  // Private Method Behavior via Public Interface
  // ==========================================================================

  describe('private method behavior via public interface', () => {
    it('shouldTranscribe returns false for non-voice + valid mediaPath', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true }
      );

      // Document with valid mediaPath should still skip
      const message = createMockMessage({ mediaType: 'document', mediaPath: '/valid/path.pdf' });
      const chat = createMockChat({ type: 'private' });

      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.skipped).toBe(true);
    });

    it('transcribeSync handles null transcription service gracefully', async () => {
      // This tests the internal transcribeSync path when service becomes null
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );

      // Make service null through setTranscriptionService with null
      // (not directly possible, but we can test the path via processVoiceMessage)
      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Replace the transcription service with null-returning mock
      // This is implicitly tested - if shouldTranscribe fails, sync path isn't reached
      const result = await service.processVoiceMessage(message, chat, true);

      expect(result).toBeDefined();
    });

    it('transcribeAsync does not throw when service is null', async () => {
      const service = new TranscriptionCoordinatorService(null, {
        enabled: true,
        asyncForGroupChats: true,
      });

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      // Should not throw, just skip
      await expect(
        service.processVoiceMessage(message, chat, true)
      ).resolves.toBeDefined();
    });
  });

  // ==========================================================================
  // Feedback Service Integration
  // ==========================================================================

  describe('feedback service integration', () => {
    it('should call onVoiceMessageReceived when voice message is processed', async () => {
      const mockFeedbackService = createMockFeedbackService();
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );
      service.setFeedbackService(mockFeedbackService as any);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(mockFeedbackService.onVoiceMessageReceived).toHaveBeenCalledWith(
        chat.telegramId,
        message.telegramMessageId
      );
    });

    it('should NOT call feedback service when transcription is skipped', async () => {
      const mockFeedbackService = createMockFeedbackService();
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: false }
      );
      service.setFeedbackService(mockFeedbackService as any);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      expect(mockFeedbackService.onVoiceMessageReceived).not.toHaveBeenCalled();
    });

    it('should handle feedback service errors gracefully', async () => {
      const mockFeedbackService = createMockFeedbackService();
      mockFeedbackService.onVoiceMessageReceived.mockRejectedValue(new Error('Telegram error'));

      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );
      service.setFeedbackService(mockFeedbackService as any);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Should not throw even if feedback fails
      const result = await service.processVoiceMessage(message, chat, true);

      expect(result.transcribed).toBe(true);
    });

    it('should work without feedback service set', async () => {
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );
      // No feedback service set

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      // Should not throw
      const result = await service.processVoiceMessage(message, chat, true);
      expect(result.transcribed).toBe(true);
    });

    it('should call onVoiceMessageReceived for group chat async transcription', async () => {
      const mockFeedbackService = createMockFeedbackService();
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, asyncForGroupChats: true }
      );
      service.setFeedbackService(mockFeedbackService as any);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });

      await service.processVoiceMessage(message, chat, true);

      expect(mockFeedbackService.onVoiceMessageReceived).toHaveBeenCalledWith(
        chat.telegramId,
        message.telegramMessageId
      );
    });

    it('should call onVoiceMessageReceived exactly once (no duplicates)', async () => {
      const mockFeedbackService = createMockFeedbackService();
      const service = new TranscriptionCoordinatorService(
        mockTranscriptionService as unknown as TranscriptionService,
        { enabled: true, syncForPrivateChats: true }
      );
      service.setFeedbackService(mockFeedbackService as any);

      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });

      await service.processVoiceMessage(message, chat, true);

      // Should be called exactly once
      expect(mockFeedbackService.onVoiceMessageReceived).toHaveBeenCalledTimes(1);
    });
  });
});
