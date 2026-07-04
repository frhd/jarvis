import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock service instances - must be before imports
const mockIdentityService = {
  resolveUser: vi.fn(),
  resolveConversation: vi.fn(),
};

const mockMemoryService = {
  retrieveRelevant: vi.fn(),
  extractAndStore: vi.fn(),
};

vi.mock('../../../services/instances/core.js', () => ({
  getIdentityService: () => mockIdentityService,
}));

vi.mock('../../../services/instances/ai.js', () => ({
  getMemoryService: () => mockMemoryService,
}));

import { CeoHandler } from './ceo.handler.js';
import type { IPlatform, PlatformMessage } from '../../../interfaces/platforms.js';
import type { CeoResponseService } from '../ceo-response.service.js';

function createMockPlatform(): IPlatform {
  return {
    name: 'slack',
    sendMessage: vi.fn().mockResolvedValue(undefined),
    replyInThread: vi.fn().mockResolvedValue(undefined),
    getConversationContext: vi.fn().mockResolvedValue('Previous context'),
    getUserName: vi.fn().mockResolvedValue('Test User'),
    getDefaultChannelId: vi.fn().mockReturnValue('C01DEFAULT'),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMessage(overrides: Partial<PlatformMessage> = {}): PlatformMessage {
  return {
    id: '1709123456.789000',
    userId: 'U01ABCDEF',
    channelId: 'C01CHANNEL',
    text: 'Hello CEO',
    timestamp: '1709123456.789000',
    isDM: false,
    isMention: false,
    ...overrides,
  };
}

function createMockResponseService(): CeoResponseService {
  return {
    generateResponse: vi.fn().mockResolvedValue('CEO response'),
  } as unknown as CeoResponseService;
}

const mockUser = { id: 'user-abc', displayName: 'Test User', createdAt: new Date(), updatedAt: new Date() };
const mockConversation = { id: 'conv-xyz', platform: 'slack', platformConversationId: 'C01CHANNEL', type: 'channel', title: null, metadata: null, createdAt: new Date(), updatedAt: new Date() };
const mockRetrievalResult = {
  memories: [
    { id: 'mem-1', content: 'User likes TypeScript', type: 'fact', confidence: 0.8, status: 'active', senderId: null, chatId: null, userId: 'user-abc', conversationId: 'conv-xyz', sourceMessageIds: '[]', createdAt: new Date(), updatedAt: new Date(), consolidatedInto: null, archivedAt: null, similarity: 0.85, recencyBoost: 0.1, score: 0.9 },
  ],
  totalFound: 1,
};

describe('CeoHandler', () => {
  let handler: CeoHandler;
  let responseService: CeoResponseService;
  let platform: IPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    responseService = createMockResponseService();
    handler = new CeoHandler(responseService);
    platform = createMockPlatform();

    mockIdentityService.resolveUser.mockResolvedValue(mockUser);
    mockIdentityService.resolveConversation.mockResolvedValue(mockConversation);
    mockMemoryService.retrieveRelevant.mockResolvedValue(mockRetrievalResult);
    mockMemoryService.extractAndStore.mockResolvedValue({ facts: [], processed: true });
  });

  describe('identity resolution', () => {
    it('resolves Slack user identity', async () => {
      const message = createMockMessage({ userId: 'U01ABCDEF' });
      await handler.handleMessage(platform, message);

      expect(mockIdentityService.resolveUser).toHaveBeenCalledWith(
        'slack',
        'U01ABCDEF',
        expect.any(Object)
      );
    });

    it('resolves Slack conversation identity for channels', async () => {
      const message = createMockMessage({ channelId: 'C01CHANNEL', isDM: false });
      await handler.handleMessage(platform, message);

      expect(mockIdentityService.resolveConversation).toHaveBeenCalledWith(
        'slack',
        'C01CHANNEL',
        'channel',
        expect.any(Object)
      );
    });

    it('resolves conversation type as dm for direct messages', async () => {
      const message = createMockMessage({ isDM: true });
      await handler.handleMessage(platform, message);

      expect(mockIdentityService.resolveConversation).toHaveBeenCalledWith(
        'slack',
        expect.any(String),
        'dm',
        expect.any(Object)
      );
    });
  });

  describe('memory retrieval', () => {
    it('retrieves relevant memories before response generation', async () => {
      const message = createMockMessage({ text: 'Tell me about our project' });
      await handler.handleMessage(platform, message);

      expect(mockMemoryService.retrieveRelevant).toHaveBeenCalledWith(
        'Tell me about our project',
        { userId: 'user-abc' }
      );
    });

    it('passes memory context to generateResponse', async () => {
      const message = createMockMessage({ text: 'Hello CEO' });
      await handler.handleMessage(platform, message);

      const generateCall = (responseService.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(generateCall[0]).toBe('Hello CEO');
      // context string (arg 1) should be present
      expect(typeof generateCall[1]).toBe('string');
      // memoryContext (arg 2) should contain the memory
      expect(generateCall[2]).toContain('User likes TypeScript');
    });

    it('falls back to no memory context on retrieval failure', async () => {
      mockMemoryService.retrieveRelevant.mockRejectedValue(new Error('DB error'));
      const message = createMockMessage();
      await handler.handleMessage(platform, message);

      // Should still generate a response
      expect(responseService.generateResponse).toHaveBeenCalled();
      const generateCall = (responseService.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      // memoryContext should be empty string on failure
      expect(generateCall[2]).toBe('');
    });
  });

  describe('memory extraction', () => {
    it('calls extractAndStore after sending response', async () => {
      const message = createMockMessage();
      await handler.handleMessage(platform, message);

      // Wait for fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockMemoryService.extractAndStore).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hello CEO' }),
        [],
        { userId: 'user-abc', conversationId: 'conv-xyz' }
      );
    });

    it('passes correct userId and conversationId to extractAndStore', async () => {
      const message = createMockMessage();
      await handler.handleMessage(platform, message);
      await new Promise((r) => setTimeout(r, 10));

      const extractCall = mockMemoryService.extractAndStore.mock.calls[0];
      expect(extractCall[2]).toEqual({ userId: 'user-abc', conversationId: 'conv-xyz' });
    });

    it('does not break response delivery on extraction failure', async () => {
      mockMemoryService.extractAndStore.mockRejectedValue(new Error('Extraction failed'));
      const message = createMockMessage();

      // Should not throw
      await handler.handleMessage(platform, message);
      await new Promise((r) => setTimeout(r, 10));

      // Response was still sent
      expect(platform.replyInThread).toHaveBeenCalled();
    });
  });

  describe('graceful degradation', () => {
    it('works when identity service fails', async () => {
      mockIdentityService.resolveUser.mockRejectedValue(new Error('Identity service down'));
      const message = createMockMessage();

      await handler.handleMessage(platform, message);

      // Should still generate and send response
      expect(responseService.generateResponse).toHaveBeenCalled();
      expect(platform.replyInThread).toHaveBeenCalled();
    });

    it('skips memory retrieval when identity resolution fails', async () => {
      mockIdentityService.resolveUser.mockRejectedValue(new Error('Identity service down'));
      const message = createMockMessage();
      await handler.handleMessage(platform, message);

      // Memory retrieval should not be called (no user to scope it with)
      expect(mockMemoryService.retrieveRelevant).not.toHaveBeenCalled();
    });

    it('skips memory extraction when identity resolution fails', async () => {
      mockIdentityService.resolveUser.mockRejectedValue(new Error('Identity service down'));
      const message = createMockMessage();
      await handler.handleMessage(platform, message);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockMemoryService.extractAndStore).not.toHaveBeenCalled();
    });
  });

  describe('existing behavior preserved', () => {
    it('deduplicates messages', async () => {
      const message = createMockMessage({ id: 'same-id' });
      await handler.handleMessage(platform, message);
      await handler.handleMessage(platform, message);

      expect(responseService.generateResponse).toHaveBeenCalledTimes(1);
    });

    it('handles mentions through handleMessage', async () => {
      const message = createMockMessage({ text: '<@U01BOT> Hello CEO' });
      await handler.handleMention(platform, message);

      const generateCall = (responseService.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(generateCall[0]).toBe('Hello CEO');
    });

    it('sends default response for empty messages', async () => {
      const message = createMockMessage({ text: '', isDM: true });
      await handler.handleMessage(platform, message);

      expect(platform.sendMessage).toHaveBeenCalledWith(
        expect.any(String),
        'Hey! What can I help you with?'
      );
    });
  });
});
