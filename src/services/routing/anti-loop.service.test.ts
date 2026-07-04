import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AntiLoopService, AntiLoopResult } from './anti-loop.service.js';
import type { Message, Chat, Sender } from '../../types/index.js';
import type { FrustrationDetectorService, FrustrationMetrics } from '../frustrationDetector.service.js';
import type {
  ImperativeDetectionService,
  ImperativeDetectionResult,
} from '../imperativeDetection.service.js';
import type { LoopPreventionService, LoopDetectionResult } from '../loopPrevention.service.js';

// ============================================================================
// Mock Helpers
// ============================================================================

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: `msg-${Math.random().toString(36).substring(7)}`,
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: Math.floor(Math.random() * 10000),
  text: 'Hello',
  isBot: false,
  mediaType: null,
  mediaPath: null,
  mediaFileId: null,
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
  telegramChatId: 12345,
  type: 'private',
  title: null,
  username: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockSender = (overrides?: Partial<Sender>): Sender => ({
  id: 'sender-1',
  telegramId: 12345,
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  isBot: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockFrustrationMetrics = (
  overrides?: Partial<FrustrationMetrics>
): FrustrationMetrics => ({
  level: 0,
  indicators: {
    repeatedMessages: 0,
    shorterMessages: false,
    capsUsage: 0,
    punctuationDensity: 0,
    timeCompression: false,
  },
  threshold: 5,
  needsAction: false,
  reasoning: ['No frustration detected'],
  ...overrides,
});

const createMockImperativeResult = (
  overrides?: Partial<ImperativeDetectionResult>
): ImperativeDetectionResult => ({
  isImperative: false,
  confidence: 'none',
  shouldExecute: false,
  reasoning: 'No imperative detected',
  frustrationLevel: 0,
  ...overrides,
});

const createMockLoopResult = (
  overrides?: Partial<LoopDetectionResult>
): LoopDetectionResult => ({
  detected: false,
  confidence: 0,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('AntiLoopService', () => {
  let service: AntiLoopService;
  let mockFrustrationDetector: {
    analyze: ReturnType<typeof vi.fn>;
  };
  let mockImperativeDetector: {
    detect: ReturnType<typeof vi.fn>;
  };
  let mockLoopPreventionService: {
    detectLoop: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create mock services
    mockFrustrationDetector = {
      analyze: vi.fn().mockResolvedValue(createMockFrustrationMetrics()),
    };

    mockImperativeDetector = {
      detect: vi.fn().mockReturnValue(createMockImperativeResult()),
    };

    mockLoopPreventionService = {
      detectLoop: vi.fn().mockResolvedValue(createMockLoopResult()),
    };

    service = new AntiLoopService(
      mockFrustrationDetector as unknown as FrustrationDetectorService,
      mockImperativeDetector as unknown as ImperativeDetectionService,
      mockLoopPreventionService as unknown as LoopPreventionService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Constructor and Configuration Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new AntiLoopService();
      const config = defaultService.getConfig();

      expect(config.frustrationThreshold).toBe(5);
      expect(config.loopConfidenceThreshold).toBe(0.7);
      expect(config.enabled).toBe(true);
    });

    it('should initialize with custom configuration', () => {
      const customService = new AntiLoopService(undefined, undefined, undefined, {
        frustrationThreshold: 7,
        loopConfidenceThreshold: 0.9,
        enabled: false,
      });
      const config = customService.getConfig();

      expect(config.frustrationThreshold).toBe(7);
      expect(config.loopConfidenceThreshold).toBe(0.9);
      expect(config.enabled).toBe(false);
    });

    it('should initialize with null services when not provided', () => {
      const noServicesService = new AntiLoopService();
      // Verify service was created without throwing
      expect(noServicesService.getConfig()).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the configuration', () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object references
    });
  });

  describe('updateConfig', () => {
    it('should update configuration partially', () => {
      service.updateConfig({ frustrationThreshold: 8 });
      const config = service.getConfig();

      expect(config.frustrationThreshold).toBe(8);
      expect(config.loopConfidenceThreshold).toBe(0.7); // Unchanged
      expect(config.enabled).toBe(true); // Unchanged
    });

    it('should update multiple configuration values', () => {
      service.updateConfig({
        frustrationThreshold: 6,
        loopConfidenceThreshold: 0.85,
        enabled: false,
      });
      const config = service.getConfig();

      expect(config.frustrationThreshold).toBe(6);
      expect(config.loopConfidenceThreshold).toBe(0.85);
      expect(config.enabled).toBe(false);
    });
  });

  // ==========================================================================
  // Service Setters Tests
  // ==========================================================================

  describe('setFrustrationDetector', () => {
    it('should set the frustration detector', async () => {
      const noServicesService = new AntiLoopService();
      const newDetector = {
        analyze: vi.fn().mockResolvedValue(
          createMockFrustrationMetrics({ level: 7, needsAction: true })
        ),
      };

      noServicesService.setFrustrationDetector(
        newDetector as unknown as FrustrationDetectorService
      );

      const message = createMockMessage({ text: 'Just do it!' });
      const chat = createMockChat();

      // Also need to set imperative detector for the override to trigger
      const imperativeDetector = {
        detect: vi.fn().mockReturnValue(
          createMockImperativeResult({ shouldExecute: true, confidence: 'high' })
        ),
      };
      noServicesService.setImperativeDetector(
        imperativeDetector as unknown as ImperativeDetectionService
      );

      const result = await noServicesService.checkForOverride(message, chat, null, []);

      expect(newDetector.analyze).toHaveBeenCalled();
      expect(result.shouldExecuteImmediately).toBe(true);
    });
  });

  describe('setImperativeDetector', () => {
    it('should set the imperative detector', async () => {
      const noServicesService = new AntiLoopService();
      const newDetector = {
        detect: vi.fn().mockReturnValue(createMockImperativeResult()),
      };

      noServicesService.setImperativeDetector(
        newDetector as unknown as ImperativeDetectionService
      );

      const message = createMockMessage();
      const chat = createMockChat();

      await noServicesService.checkForOverride(message, chat, null, []);

      expect(newDetector.detect).toHaveBeenCalled();
    });
  });

  describe('setLoopPreventionService', () => {
    it('should set the loop prevention service', async () => {
      const noServicesService = new AntiLoopService();
      const newService = {
        detectLoop: vi.fn().mockResolvedValue(createMockLoopResult()),
      };

      noServicesService.setLoopPreventionService(
        newService as unknown as LoopPreventionService
      );

      const message = createMockMessage();
      const chat = createMockChat();

      await noServicesService.checkForOverride(message, chat, null, []);

      expect(newService.detectLoop).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // checkForOverride Tests - Disabled State
  // ==========================================================================

  describe('checkForOverride - disabled state', () => {
    it('should return no override when disabled', async () => {
      service.updateConfig({ enabled: false });

      const message = createMockMessage({ text: 'JUST DO IT NOW!!!' });
      const chat = createMockChat();
      const sender = createMockSender();

      const result = await service.checkForOverride(message, chat, sender, []);

      expect(result.shouldExecuteImmediately).toBe(false);
      expect(result.reason).toBe('Anti-loop detection disabled');
      expect(mockFrustrationDetector.analyze).not.toHaveBeenCalled();
      expect(mockImperativeDetector.detect).not.toHaveBeenCalled();
      expect(mockLoopPreventionService.detectLoop).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // checkForOverride Tests - No Services Configured
  // ==========================================================================

  describe('checkForOverride - no services configured', () => {
    it('should return no override when no services are configured', async () => {
      const noServicesService = new AntiLoopService();

      const message = createMockMessage({ text: 'Do it!' });
      const chat = createMockChat();

      const result = await noServicesService.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
      expect(result.reason).toBe('No anti-loop conditions detected');
    });
  });

  // ==========================================================================
  // checkForOverride Tests - Frustration + Imperative
  // ==========================================================================

  describe('checkForOverride - frustration + imperative', () => {
    it('should execute immediately when frustration >= 5 AND imperative shouldExecute', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          frustrationLevel: 6,
        })
      );

      const message = createMockMessage({ text: 'Yes do it!' });
      const chat = createMockChat();
      const sender = createMockSender();

      const result = await service.checkForOverride(message, chat, sender, []);

      expect(result.shouldExecuteImmediately).toBe(true);
      expect(result.frustrationLevel).toBe(6);
      expect(result.imperativeConfidence).toBe('high');
      expect(result.reason).toContain('Frustration');
      expect(result.reason).toContain('imperative');
    });

    it('should NOT execute when frustration < 5 even with imperative', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 3, needsAction: false })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          frustrationLevel: 3,
        })
      );

      const message = createMockMessage({ text: 'Do it' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should NOT execute when imperative shouldExecute is false even with high frustration', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 8, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'low',
          shouldExecute: false,
          frustrationLevel: 8,
        })
      );

      const message = createMockMessage({ text: 'y' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should use imperative frustrationLevel when frustrationMetrics is not available', async () => {
      // Create service with only imperative detector
      const partialService = new AntiLoopService(
        undefined,
        mockImperativeDetector as unknown as ImperativeDetectionService
      );

      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          frustrationLevel: 7,
        })
      );

      const message = createMockMessage({ text: 'Just do it!' });
      const chat = createMockChat();

      const result = await partialService.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(true);
      expect(result.frustrationLevel).toBe(7);
    });
  });

  // ==========================================================================
  // checkForOverride Tests - Loop Detection + Frustration
  // ==========================================================================

  describe('checkForOverride - loop detection + frustration', () => {
    it('should execute immediately when loop detected (>0.7 confidence) AND frustration >= 5', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 5, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({ shouldExecute: false })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.85,
          loopType: 'imperative_repeat',
        })
      );

      const message = createMockMessage({ text: 'Again?' });
      const chat = createMockChat();
      const sender = createMockSender();

      const result = await service.checkForOverride(message, chat, sender, []);

      expect(result.shouldExecuteImmediately).toBe(true);
      expect(result.loopDetected).toBe(true);
      expect(result.reason).toContain('Loop detected');
      expect(result.reason).toContain('85%');
    });

    it('should NOT execute when loop confidence <= 0.7', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.65, // Below threshold
        })
      );

      const message = createMockMessage({ text: 'Hello' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should NOT execute when loop detected but frustration < 5', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 4, needsAction: false })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.9,
        })
      );

      const message = createMockMessage({ text: 'Hello' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should NOT execute when loop not detected even with high frustration', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 9, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: false,
          confidence: 0.1,
        })
      );

      const message = createMockMessage({ text: 'Ugh!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });
  });

  // ==========================================================================
  // checkForOverride Tests - Edge Cases
  // ==========================================================================

  describe('checkForOverride - edge cases', () => {
    it('should handle null sender', async () => {
      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toBeDefined();
      expect(mockFrustrationDetector.analyze).toHaveBeenCalledWith(
        expect.any(Array),
        undefined
      );
    });

    it('should handle empty conversation history', async () => {
      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toBeDefined();
      expect(mockImperativeDetector.detect).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({
          userId: 'unknown',
          recentMessages: [],
        })
      );
    });

    it('should handle message with null text', async () => {
      const message = createMockMessage({ text: null });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toBeDefined();
      expect(mockImperativeDetector.detect).toHaveBeenCalledWith(
        '',
        expect.any(Object)
      );
    });

    it('should limit conversation history to 10 messages', async () => {
      const conversationHistory = Array.from({ length: 15 }, (_, i) =>
        createMockMessage({ text: `Message ${i}` })
      );

      const message = createMockMessage({ text: 'Current' });
      const chat = createMockChat();

      await service.checkForOverride(message, chat, null, conversationHistory);

      expect(mockImperativeDetector.detect).toHaveBeenCalledWith(
        'Current',
        expect.objectContaining({
          recentMessages: expect.arrayContaining([
            expect.objectContaining({ content: 'Message 0' }),
          ]),
        })
      );

      // Verify only first 10 messages were included
      const callArg = mockImperativeDetector.detect.mock.calls[0][1];
      expect(callArg.recentMessages).toHaveLength(10);
    });
  });

  // ==========================================================================
  // checkForOverride Tests - Error Handling
  // ==========================================================================

  describe('checkForOverride - error handling', () => {
    it('should return no override when frustration detector throws', async () => {
      mockFrustrationDetector.analyze.mockRejectedValue(
        new Error('Frustration analysis failed')
      );

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
      expect(result.reason).toBe('No anti-loop conditions detected');
    });

    it('should return no override when imperative detector throws', async () => {
      mockImperativeDetector.detect.mockImplementation(() => {
        throw new Error('Imperative detection failed');
      });

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should return no override when loop prevention service throws', async () => {
      mockLoopPreventionService.detectLoop.mockRejectedValue(
        new Error('Loop detection failed')
      );

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });
  });

  // ==========================================================================
  // detectPendingAction Tests
  // ==========================================================================

  describe('detectPendingAction', () => {
    it('should detect "would you like me to" pattern', () => {
      const history = [
        createMockMessage({
          text: 'Would you like me to save this file?',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('save this file');
      expect(result?.confidence).toBe(0.8);
    });

    it('should detect "should i" pattern', () => {
      const history = [
        createMockMessage({
          text: 'Should I run the tests now?',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('run the tests now');
    });

    it('should detect "do you want me to" pattern', () => {
      const history = [
        createMockMessage({
          text: 'Do you want me to delete these files?',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('delete these files');
    });

    it('should detect "shall i" pattern', () => {
      const history = [
        createMockMessage({
          text: 'Shall I proceed with the deployment?',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('proceed with the deployment');
    });

    it('should detect "can i" pattern', () => {
      const history = [
        createMockMessage({
          text: 'Can I help you with something else?',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('help you with something else');
    });

    it('should return undefined when no pending action patterns found', () => {
      const history = [
        createMockMessage({
          text: 'Here is the information you requested.',
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeUndefined();
    });

    it('should only check bot messages', () => {
      const history = [
        createMockMessage({
          text: 'Would you like me to do something?',
          isBot: false, // User message
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeUndefined();
    });

    it('should only check first 3 bot messages', () => {
      const history = [
        createMockMessage({
          text: 'Bot message 1',
          isBot: true,
        }),
        createMockMessage({
          text: 'Bot message 2',
          isBot: true,
        }),
        createMockMessage({
          text: 'Bot message 3',
          isBot: true,
        }),
        createMockMessage({
          text: 'Would you like me to do this?', // 4th bot message
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeUndefined();
    });

    it('should return default description when pattern matches but no capture', () => {
      const history = [
        createMockMessage({
          text: 'WOULD YOU LIKE ME TO', // All caps, no action description
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeDefined();
      expect(result?.description).toBe('perform the suggested action');
    });

    it('should handle empty conversation history', () => {
      const result = service.detectPendingAction([]);

      expect(result).toBeUndefined();
    });

    it('should handle messages with null text', () => {
      const history = [
        createMockMessage({
          text: null,
          isBot: true,
        }),
      ];

      const result = service.detectPendingAction(history);

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // Integration Tests - Full Flow
  // ==========================================================================

  describe('integration - full override flow', () => {
    it('should correctly build conversation state for imperative detection', async () => {
      const now = new Date();
      const conversationHistory = [
        createMockMessage({
          text: 'Previous user message',
          isBot: false,
          createdAt: new Date(now.getTime() - 2000),
        }),
        createMockMessage({
          text: 'Would you like me to proceed?',
          isBot: true,
          createdAt: new Date(now.getTime() - 1000),
        }),
      ];

      const message = createMockMessage({
        text: 'Yes do it!',
        createdAt: now,
      });
      const chat = createMockChat();
      const sender = createMockSender({ id: 'user-123' });

      await service.checkForOverride(message, chat, sender, conversationHistory);

      expect(mockImperativeDetector.detect).toHaveBeenCalledWith(
        'Yes do it!',
        expect.objectContaining({
          userId: 'user-123',
          recentMessages: expect.arrayContaining([
            expect.objectContaining({
              content: 'Previous user message',
              isFromUser: true,
            }),
            expect.objectContaining({
              content: 'Would you like me to proceed?',
              isFromUser: false,
            }),
          ]),
          pendingAction: expect.objectContaining({
            description: 'proceed',
            confidence: 0.8,
          }),
        })
      );
    });

    it('should prefer frustration metrics level over imperative frustration level', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 8, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          frustrationLevel: 3, // Lower than frustration metrics
        })
      );

      const message = createMockMessage({ text: 'Do it!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(true);
      expect(result.frustrationLevel).toBe(8); // Uses frustrationMetrics level
    });

    it('should correctly pass messages to frustration detector', async () => {
      const conversationHistory = [
        createMockMessage({ text: 'History message 1' }),
        createMockMessage({ text: 'History message 2' }),
      ];

      const message = createMockMessage({ text: 'Current message' });
      const chat = createMockChat();
      const sender = createMockSender({ id: 'sender-1' });

      await service.checkForOverride(message, chat, sender, conversationHistory);

      // Frustration detector should receive [current message, ...history]
      expect(mockFrustrationDetector.analyze).toHaveBeenCalledWith(
        [message, ...conversationHistory],
        'sender-1'
      );
    });

    it('should correctly pass messages to loop prevention service', async () => {
      const conversationHistory = [
        createMockMessage({ text: 'History message 1' }),
      ];

      const message = createMockMessage({ text: 'Current message' });
      const chat = createMockChat({ id: 'chat-123' });
      const sender = createMockSender({ id: 'sender-456' });

      await service.checkForOverride(message, chat, sender, conversationHistory);

      expect(mockLoopPreventionService.detectLoop).toHaveBeenCalledWith(
        [message, ...conversationHistory],
        'chat-123',
        'sender-456'
      );
    });
  });

  // ==========================================================================
  // Result Structure Tests
  // ==========================================================================

  describe('result structure', () => {
    it('should return correct result structure for no override', async () => {
      const message = createMockMessage({ text: 'Hello' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toEqual<AntiLoopResult>({
        shouldExecuteImmediately: false,
        frustrationLevel: 0,
        imperativeConfidence: 'none',
        loopDetected: false,
        reason: expect.any(String),
      });
    });

    it('should return correct result structure for frustration + imperative override', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 7, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          frustrationLevel: 7,
        })
      );

      const message = createMockMessage({ text: 'Just do it!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toEqual<AntiLoopResult>({
        shouldExecuteImmediately: true,
        frustrationLevel: 7,
        imperativeConfidence: 'high',
        loopDetected: false,
        reason: expect.stringContaining('Frustration'),
      });
    });

    it('should return correct result structure for loop override', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.9,
          loopType: 'clarification_loop',
        })
      );

      const message = createMockMessage({ text: 'Again?' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result).toEqual<AntiLoopResult>({
        shouldExecuteImmediately: true,
        frustrationLevel: 6,
        imperativeConfidence: 'none',
        loopDetected: true,
        reason: expect.stringContaining('Loop detected'),
      });
    });
  });

  // ==========================================================================
  // Threshold Boundary Tests
  // ==========================================================================

  describe('threshold boundaries', () => {
    it('should execute at exactly frustration threshold (5)', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 5, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          shouldExecute: true,
          confidence: 'high',
        })
      );

      const message = createMockMessage({ text: 'Do it!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(true);
    });

    it('should NOT execute at frustration level 4 (below threshold)', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 4, needsAction: false })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          shouldExecute: true,
          confidence: 'high',
        })
      );

      const message = createMockMessage({ text: 'Do it!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should execute at loop confidence just above threshold (0.71)', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 5, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.71,
        })
      );

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(true);
    });

    it('should NOT execute at loop confidence exactly at threshold (0.7)', async () => {
      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.7, // Exactly at threshold (not above)
        })
      );

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });

    it('should respect custom frustration threshold', async () => {
      service.updateConfig({ frustrationThreshold: 7 });

      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockImperativeDetector.detect.mockReturnValue(
        createMockImperativeResult({
          shouldExecute: true,
          confidence: 'high',
        })
      );

      const message = createMockMessage({ text: 'Do it!' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false); // 6 < 7
    });

    it('should respect custom loop confidence threshold', async () => {
      service.updateConfig({ loopConfidenceThreshold: 0.9 });

      mockFrustrationDetector.analyze.mockResolvedValue(
        createMockFrustrationMetrics({ level: 6, needsAction: true })
      );
      mockLoopPreventionService.detectLoop.mockResolvedValue(
        createMockLoopResult({
          detected: true,
          confidence: 0.85, // Below custom threshold
        })
      );

      const message = createMockMessage({ text: 'Test' });
      const chat = createMockChat();

      const result = await service.checkForOverride(message, chat, null, []);

      expect(result.shouldExecuteImmediately).toBe(false);
    });
  });
});
