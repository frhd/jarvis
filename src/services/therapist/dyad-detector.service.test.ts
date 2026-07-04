import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DyadDetectorService } from './dyad-detector.service.js';

// Mock dependencies - must be declared before importing the service
const mockMessageRepo = {
  findRecentByConversationId: vi.fn(),
};

const mockConversationRepo = {
  findById: vi.fn(),
  updateParticipantCount: vi.fn(),
};

const mockIdentityService = {
  getIdentitiesForUser: vi.fn(),
};

const mockTherapistConfigRepo = {
  findByConversationId: vi.fn(),
};

// Create service instance
let service: DyadDetectorService;

beforeEach(() => {
  service = new DyadDetectorService(
    mockMessageRepo,
    mockConversationRepo,
    mockIdentityService,
    mockTherapistConfigRepo
  );

  // Clear all mocks between tests
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DyadDetectorService', () => {
  describe('isDyad', () => {
    it('should return true for conversation with participantCount === 2', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: 2,
      } as any);

      // Act
      const result = await service.isDyad(conversationId);

      // Assert
      expect(result).toBe(true);
      expect(mockConversationRepo.findById).toHaveBeenCalledWith(conversationId);
    });

    it('should return false for conversation with participantCount === 3', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: 3,
      } as any);

      // Act
      const result = await service.isDyad(conversationId);

      // Assert
      expect(result).toBe(false);
      expect(mockConversationRepo.findById).toHaveBeenCalledWith(conversationId);
    });

    it('should fall back to message analysis when no stored participant count', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: undefined,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', senderId: 'user1', createdAt: new Date() },
        { id: 'msg2', senderId: 'user2', createdAt: new Date() },
      ] as any);

      // Act
      const result = await service.isDyad(conversationId);

      // Assert
      expect(result).toBe(true);
      expect(mockConversationRepo.findById).toHaveBeenCalledWith(conversationId);
      expect(mockMessageRepo.findRecentByConversationId).toHaveBeenCalledWith(
        conversationId,
        50
      );
    });

    it('should return false when conversation is not found', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue(null);

      // Act
      const result = await service.isDyad(conversationId);

      // Assert
      expect(result).toBe(false);
      expect(mockConversationRepo.findById).toHaveBeenCalledWith(conversationId);
    });

    it('should return false when message analysis detects > 2 participants', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: undefined,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', senderId: 'user1', createdAt: new Date() },
        { id: 'msg2', senderId: 'user2', createdAt: new Date() },
        { id: 'msg3', userId: 'user3', createdAt: new Date() },
      ] as any);

      // Act
      const result = await service.isDyad(conversationId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getDyadInfo', () => {
    it('should return complete DyadInfo for valid dyad with consent', async () => {
      // Arrange
      const conversationId = 'conv_123';
      const participant1Id = 'user1';
      const participant2Id = 'user2';

      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: 2,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: participant1Id, createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: participant2Id, createdAt: new Date('2024-01-01T10:01:00Z') },
      ] as any);

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
        enabled: true,
        consentedByUserIds: JSON.stringify([participant1Id, participant2Id]),
      } as any);

      // Act
      const result = await service.getDyadInfo(conversationId);

      // Assert
      expect(result).toEqual({
        isDyad: true,
        conversationId,
        participants: [
          {
            userId: participant1Id,
            platformUserId: '',
            recentMessageCount: 1,
            lastMessageAt: new Date('2024-01-01T10:00:00Z'),
          },
          {
            userId: participant2Id,
            platformUserId: '',
            recentMessageCount: 1,
            lastMessageAt: new Date('2024-01-01T10:01:00Z'),
          },
        ],
        participantCount: 2,
        therapistEnabled: true,
        hasConsent: true,
        consentedByUserIds: [participant1Id, participant2Id],
      });
    });

    it('should return isDyad: false for non-dyad', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: undefined,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', senderId: 'user1', createdAt: new Date() },
        { id: 'msg2', senderId: 'user2', createdAt: new Date() },
        { id: 'msg3', senderId: 'user3', createdAt: new Date() },
      ] as any);

      // Act
      const result = await service.getDyadInfo(conversationId);

      // Assert
      expect(result!.isDyad).toBe(false);
      expect(result!.participantCount).toBe(3);
      expect(result!.hasConsent).toBe(false);
    });

    it('should parse consentedByUserIds JSON correctly', async () => {
      // Arrange
      const conversationId = 'conv_123';
      const participant1Id = 'user1';
      const participant2Id = 'user2';

      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: 2,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: participant1Id, createdAt: new Date() },
        { id: 'msg2', userId: participant2Id, createdAt: new Date() },
      ] as any);

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
        enabled: true,
        consentedByUserIds: JSON.stringify([participant1Id, participant2Id]),
      } as any);

      // Act
      const result = await service.getDyadInfo(conversationId);

      // Assert
      expect(result!.consentedByUserIds).toEqual([participant1Id, participant2Id]);
    });

    it('should return null when conversation is not found', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockConversationRepo.findById.mockResolvedValue(null);

      // Act
      const result = await service.getDyadInfo(conversationId);

      // Assert
      expect(result).toBe(null);
    });

    it('should handle therapist config with null consent', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockConversationRepo.findById.mockResolvedValue({
        id: conversationId,
        participantCount: 2,
      } as any);

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: 'user1', createdAt: new Date() },
        { id: 'msg2', userId: 'user2', createdAt: new Date() },
      ] as any);

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

      // Act
      const result = await service.getDyadInfo(conversationId);

      // Assert
      expect(result!.therapistEnabled).toBe(false);
      expect(result!.hasConsent).toBe(false);
      expect(result!.consentedByUserIds).toEqual([]);
    });
  });

  describe('getParticipants', () => {
    it('should return two distinct users in messages', async () => {
      // Arrange
      const conversationId = 'conv_123';
      const participant1Id = 'user1';
      const participant2Id = 'user2';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: participant1Id, createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: participant2Id, createdAt: new Date('2024-01-01T10:01:00Z') },
        { id: 'msg3', userId: participant1Id, createdAt: new Date('2024-01-01T10:02:00Z') },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe(participant1Id);
      expect(result[0].recentMessageCount).toBe(2);
      expect(result[0].lastMessageAt).toEqual(new Date('2024-01-01T10:02:00Z'));

      expect(result[1].userId).toBe(participant2Id);
      expect(result[1].recentMessageCount).toBe(1);
      expect(result[1].lastMessageAt).toEqual(new Date('2024-01-01T10:01:00Z'));
    });

    it('should handle messages with userId vs senderId (legacy)', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', senderId: 'user1', createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: 'user2', createdAt: new Date('2024-01-01T10:01:00Z') },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('user1');
      expect(result[1].userId).toBe('user2');
    });

    it('should return empty array for empty messages', async () => {
      // Arrange
      const conversationId = 'conv_123';
      mockMessageRepo.findRecentByConversationId.mockResolvedValue([]);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should skip messages with no userId or senderId', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: 'user1', createdAt: new Date('2024-01-01T10:01:00Z') },
        { id: 'msg3', senderId: 'user2', createdAt: new Date('2024-01-01T10:02:00Z') },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);
    });

    it('should update lastMessageAt correctly', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: 'user1', createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: 'user1', createdAt: new Date('2024-01-01T10:30:00Z') },
        { id: 'msg3', userId: 'user2', createdAt: new Date('2024-01-01T10:15:00Z') },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);

      const user1 = result.find(p => p.userId === 'user1');
      expect(user1!.lastMessageAt).toEqual(new Date('2024-01-01T10:30:00Z'));

      const user2 = result.find(p => p.userId === 'user2');
      expect(user2!.lastMessageAt).toEqual(new Date('2024-01-01T10:15:00Z'));
    });

    it('should update lastMessageAt correctly', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: 'user1', createdAt: new Date('2024-01-01T10:00:00Z') },
        { id: 'msg2', userId: 'user1', createdAt: new Date('2024-01-01T10:30:00Z') },
        { id: 'msg3', userId: 'user2', createdAt: new Date('2024-01-01T10:15:00Z') },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);

      const user1 = result.find(p => p.userId === 'user1');
      expect(user1!.lastMessageAt).toEqual(new Date('2024-01-01T10:30:00Z'));

      const user2 = result.find(p => p.userId === 'user2');
      expect(user2!.lastMessageAt).toEqual(new Date('2024-01-01T10:15:00Z'));
    });

    it('should track message counts correctly for multiple participants', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: 'user1', createdAt: new Date() },
        { id: 'msg2', userId: 'user2', createdAt: new Date() },
        { id: 'msg3', userId: 'user1', createdAt: new Date() },
        { id: 'msg4', userId: 'user1', createdAt: new Date() },
        { id: 'msg5', userId: 'user2', createdAt: new Date() },
      ] as any);

      // Act
      const result = await service.getParticipants(conversationId);

      // Assert
      expect(result).toHaveLength(2);

      const user1 = result.find(p => p.userId === 'user1');
      const user2 = result.find(p => p.userId === 'user2');

      expect(user1!.recentMessageCount).toBe(3);
      expect(user2!.recentMessageCount).toBe(2);
    });
  });

  describe('updateParticipantCount', () => {
    it('should call conversation repository to update participant count', async () => {
      // Arrange
      const conversationId = 'conv_123';
      const count = 2;

      // Act
      await service.updateParticipantCount(conversationId, count);

      // Assert
      expect(mockConversationRepo.updateParticipantCount).toHaveBeenCalledWith(conversationId, count);
    });
  });

  describe('Edge cases', () => {
    it('should handle large number of messages efficiently', async () => {
      // Arrange
      const conversationId = 'conv_123';
      const messages = [];

      // Create 100 messages with 2 participants
      for (let i = 0; i < 50; i++) {
        messages.push({
          id: `msg${i}`,
          userId: i % 2 === 0 ? 'user1' : 'user2',
          createdAt: new Date(`2024-01-01T10:${i % 60}:00Z`)
        });
      }

      mockMessageRepo.findRecentByConversationId.mockResolvedValue(messages as any);

      // Act
      const startTime = Date.now();
      const result = await service.getParticipants(conversationId);
      const endTime = Date.now();

      // Assert
      expect(result).toHaveLength(2);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });

    it('should handle concurrent participant detection', async () => {
      // Arrange
      const conversationId = 'conv_123';

      mockMessageRepo.findRecentByConversationId.mockResolvedValue([
        { id: 'msg1', userId: 'user1', createdAt: new Date() },
        { id: 'msg2', userId: 'user2', createdAt: new Date() },
      ] as any);

      // Act - run multiple calls concurrently
      const promises = [
        service.getParticipants(conversationId),
        service.getParticipants(conversationId),
        service.getParticipants(conversationId),
      ];

      const results = await Promise.all(promises);

      // Assert
      results.forEach(result => {
        expect(result).toHaveLength(2);
      });
    });
  });
});