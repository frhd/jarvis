/**
 * User Identity Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserIdentityService, IdentityExtractionResult } from './userIdentity.service';

// Mock sender repository
const mockSenderRepo = {
  findById: vi.fn(),
  updateDisplayName: vi.fn(),
} as any;

describe('UserIdentityService', () => {
  let service: UserIdentityService;

  beforeEach(() => {
    // Clear all mocks and reset call counts
    vi.clearAllMocks();
    service = new UserIdentityService(mockSenderRepo);
  });

  afterEach(() => {
    // Ensure all mocks are cleared after each test
    vi.clearAllMocks();
  });

  describe('extractIdentity', () => {
    it('should extract name from "my name is [name]"', () => {
      const result = service.extractIdentity('my name is Alex');
      expect(result.extractedName).toBe('alex');
      expect(result.confidence).toBe(0.9);
    });

    it('should extract name from "I am [name]"', () => {
      const result = service.extractIdentity('I am John Smith');
      expect(result.extractedName).toBe('john smith');
      expect(result.confidence).toBe(0.9);
    });

    it('should extract name from "call me [name]"', () => {
      const result = service.extractIdentity('please call me Dave');
      expect(result.extractedName).toBe('dave');
      expect(result.confidence).toBe(0.9);
    });

    it('should extract name from "this is [name]"', () => {
      const result = service.extractIdentity('this is Sarah');
      expect(result.extractedName).toBe('sarah');
      expect(result.confidence).toBe(0.7);
    });

    it('should return null for empty message', () => {
      const result = service.extractIdentity('');
      expect(result.extractedName).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should return null for message without identity pattern', () => {
      const result = service.extractIdentity('hello how are you today');
      expect(result.extractedName).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should filter out common words that are not names', () => {
      const result = service.extractIdentity('my name is hi');
      expect(result.extractedName).toBeNull();
    });

    it('should filter out greetings as names', () => {
      const result = service.extractIdentity('my name is hello');
      expect(result.extractedName).toBeNull();
    });
  });

  describe('updateIdentityFromMessage', () => {
    it('should update displayName when new name is extracted with high confidence', async () => {
      mockSenderRepo.findById.mockResolvedValueOnce({
        id: 'sender1',
        displayName: null,
      });
      mockSenderRepo.updateDisplayName.mockResolvedValueOnce({
        id: 'sender1',
        displayName: 'Alice',
      });

      const result = await service.updateIdentityFromMessage('sender1', 'my name is Alice');

      expect(result.updated).toBe(true);
      expect(result.name).toBe('alice');
      expect(mockSenderRepo.updateDisplayName).toHaveBeenCalledWith('sender1', 'alice');
    });

    it('should not update when extracted name matches existing displayName', async () => {
      mockSenderRepo.findById.mockResolvedValueOnce({
        id: 'sender1',
        displayName: 'bob',
      });

      const result = await service.updateIdentityFromMessage('sender1', 'my name is Bob');

      expect(result.updated).toBe(false);
      expect(mockSenderRepo.updateDisplayName).not.toHaveBeenCalled();
    });

    it('should not update when confidence is below threshold', async () => {
      mockSenderRepo.findById.mockResolvedValueOnce({
        id: 'sender1',
        displayName: null,
      });

      // Message with no identity pattern at all
      const result = await service.updateIdentityFromMessage('sender1', 'how are you doing today');

      expect(result.updated).toBe(false);
      expect(mockSenderRepo.updateDisplayName).not.toHaveBeenCalled();
    });

    it('should return false when sender is not found', async () => {
      mockSenderRepo.findById.mockResolvedValueOnce(null);

      // Use a message that doesn't extract a name at all
      const result = await service.updateIdentityFromMessage('sender1', 'hello there');

      expect(result.updated).toBe(false);
      expect(mockSenderRepo.updateDisplayName).not.toHaveBeenCalled();
    });
  });

  describe('getDisplayAddressing', () => {
    it('should use displayName when available', () => {
      const sender = {
        displayName: 'Charlie',
        firstName: 'Charles',
        lastName: 'Brown',
      };

      const result = service.getDisplayAddressing(sender);
      expect(result).toBe('Charlie');
    });

    it('should use firstName when displayName is not available', () => {
      const sender = {
        displayName: null,
        firstName: 'Diana',
        lastName: 'Prince',
      };

      const result = service.getDisplayAddressing(sender);
      expect(result).toBe('Diana Prince');
    });

    it('should use firstName only when lastName is not available', () => {
      const sender = {
        displayName: null,
        firstName: 'Edward',
        lastName: null,
      };

      const result = service.getDisplayAddressing(sender);
      expect(result).toBe('Edward');
    });

    it('should return "friend" when no name is available', () => {
      const sender = {
        displayName: null,
        firstName: null,
        lastName: null,
      };

      const result = service.getDisplayAddressing(sender);
      expect(result).toBe('friend');
    });
  });
});
