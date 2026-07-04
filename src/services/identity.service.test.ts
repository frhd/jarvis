import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IdentityService } from './identity.service';
import { IdentityError } from '../errors/error-classes';
import { ErrorCode } from '../errors/error-codes';

describe('IdentityService', () => {
  let service: IdentityService;
  let mockUserRepo: any;
  let mockPlatformIdentityRepo: any;
  let mockConversationRepo: any;

  const mockUser = {
    id: 'user-1',
    displayName: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockIdentity = {
    id: 'pi-1',
    userId: 'user-1',
    platform: 'telegram',
    platformUserId: '12345',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConversation = {
    id: 'conv-1',
    platform: 'telegram',
    platformConversationId: 'chat-100',
    type: 'group',
    title: 'Test Group',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockUserRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findAll: vi.fn(),
    };

    mockPlatformIdentityRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findByPlatformUser: vi.fn(),
      findByUserId: vi.fn(),
    };

    mockConversationRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findByPlatformConversation: vi.fn(),
      findByType: vi.fn(),
      findByPlatform: vi.fn(),
    };

    service = new IdentityService(mockUserRepo, mockPlatformIdentityRepo, mockConversationRepo);
  });

  describe('resolveUser', () => {
    it('creates new user + platformIdentity on first call', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue(mockUser);
      mockPlatformIdentityRepo.create.mockResolvedValue(mockIdentity);

      const result = await service.resolveUser('telegram', '12345', { firstName: 'Test' });

      expect(result).toEqual(mockUser);
      expect(mockUserRepo.create).toHaveBeenCalledWith({ displayName: 'Test' });
      expect(mockPlatformIdentityRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        platform: 'telegram',
        platformUserId: '12345',
        metadata: JSON.stringify({ firstName: 'Test' }),
      });
    });

    it('returns same user on subsequent calls (idempotent)', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await service.resolveUser('telegram', '12345');

      expect(result).toEqual(mockUser);
      expect(mockUserRepo.create).not.toHaveBeenCalled();
      expect(mockPlatformIdentityRepo.create).not.toHaveBeenCalled();
    });

    it('updates metadata on existing identity if changed', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockPlatformIdentityRepo.update.mockResolvedValue({ ...mockIdentity, metadata: '{"firstName":"Updated"}' });

      await service.resolveUser('telegram', '12345', { firstName: 'Updated' });

      expect(mockPlatformIdentityRepo.update).toHaveBeenCalledWith('pi-1', {
        metadata: JSON.stringify({ firstName: 'Updated' }),
      });
    });

    it('preserves metadata if none provided on subsequent call', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);
      mockUserRepo.findById.mockResolvedValue(mockUser);

      await service.resolveUser('telegram', '12345');

      expect(mockPlatformIdentityRepo.update).not.toHaveBeenCalled();
    });

    it('updates display name from metadata if changed', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, displayName: 'New Name' };
      mockUserRepo.update.mockResolvedValue(updatedUser);

      const result = await service.resolveUser('telegram', '12345', { displayName: 'New Name' });

      expect(result).toEqual(updatedUser);
      expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', { displayName: 'New Name' });
    });

    it('handles race condition via unique constraint retry', async () => {
      mockPlatformIdentityRepo.findByPlatformUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockIdentity);
      mockUserRepo.create.mockRejectedValue(new Error('UNIQUE constraint failed'));
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await service.resolveUser('telegram', '12345');

      expect(result).toEqual(mockUser);
    });

    it('uses displayName from metadata preferring displayName over firstName', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue(mockUser);
      mockPlatformIdentityRepo.create.mockResolvedValue(mockIdentity);

      await service.resolveUser('telegram', '12345', { displayName: 'Display', firstName: 'First' });

      expect(mockUserRepo.create).toHaveBeenCalledWith({ displayName: 'Display' });
    });
  });

  describe('resolveConversation', () => {
    it('creates new conversation on first call', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(null);
      mockConversationRepo.create.mockResolvedValue(mockConversation);

      const result = await service.resolveConversation('telegram', 'chat-100', 'group', { title: 'Test Group' });

      expect(result).toEqual(mockConversation);
      expect(mockConversationRepo.create).toHaveBeenCalledWith({
        platform: 'telegram',
        platformConversationId: 'chat-100',
        type: 'group',
        title: 'Test Group',
        metadata: JSON.stringify({ title: 'Test Group' }),
      });
    });

    it('returns same conversation on subsequent calls', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(mockConversation);

      const result = await service.resolveConversation('telegram', 'chat-100', 'group');

      expect(result).toEqual(mockConversation);
      expect(mockConversationRepo.create).not.toHaveBeenCalled();
    });

    it('updates title on existing conversation if changed', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(mockConversation);
      const updated = { ...mockConversation, title: 'New Title' };
      mockConversationRepo.update.mockResolvedValue(updated);

      const result = await service.resolveConversation('telegram', 'chat-100', 'group', { title: 'New Title' });

      expect(result).toEqual(updated);
      expect(mockConversationRepo.update).toHaveBeenCalledWith('conv-1', {
        title: 'New Title',
        metadata: JSON.stringify({ title: 'New Title' }),
      });
    });

    it('updates metadata on existing conversation even without title change', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(mockConversation);
      mockConversationRepo.update.mockResolvedValue(mockConversation);

      await service.resolveConversation('telegram', 'chat-100', 'group', { customField: 'value' });

      expect(mockConversationRepo.update).toHaveBeenCalledWith('conv-1', {
        metadata: JSON.stringify({ customField: 'value' }),
      });
    });

    it('handles race condition via unique constraint retry', async () => {
      mockConversationRepo.findByPlatformConversation
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockConversation);
      mockConversationRepo.create.mockRejectedValue(new Error('UNIQUE constraint failed'));

      const result = await service.resolveConversation('telegram', 'chat-100', 'group');

      expect(result).toEqual(mockConversation);
    });
  });

  describe('linkIdentities', () => {
    it('adds new platform identity to existing user', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(null);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      const newIdentity = { ...mockIdentity, platform: 'slack', platformUserId: 'U123' };
      mockPlatformIdentityRepo.create.mockResolvedValue(newIdentity);

      const result = await service.linkIdentities('user-1', 'slack', 'U123');

      expect(result).toEqual(newIdentity);
      expect(mockPlatformIdentityRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        platform: 'slack',
        platformUserId: 'U123',
        metadata: null,
      });
    });

    it('rejects if platformUserId already linked to a different user', async () => {
      const otherIdentity = { ...mockIdentity, userId: 'user-2' };
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(otherIdentity);

      await expect(
        service.linkIdentities('user-1', 'telegram', '12345')
      ).rejects.toThrow(IdentityError);

      await expect(
        service.linkIdentities('user-1', 'telegram', '12345')
      ).rejects.toMatchObject({
        code: ErrorCode.IDENTITY_DUPLICATE_PLATFORM_USER,
      });
    });

    it('is no-op if identity already linked to same user', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);

      const result = await service.linkIdentities('user-1', 'telegram', '12345');

      expect(result).toEqual(mockIdentity);
      expect(mockPlatformIdentityRepo.create).not.toHaveBeenCalled();
    });

    it('throws if target user does not exist', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(null);
      mockUserRepo.findById.mockResolvedValue(null);

      await expect(
        service.linkIdentities('nonexistent', 'slack', 'U123')
      ).rejects.toThrow(IdentityError);
    });
  });

  describe('findUser', () => {
    it('returns null for unknown platform identity', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(null);

      const result = await service.findUser('telegram', 'unknown');

      expect(result).toBeNull();
    });

    it('returns user for known identity', async () => {
      mockPlatformIdentityRepo.findByPlatformUser.mockResolvedValue(mockIdentity);
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await service.findUser('telegram', '12345');

      expect(result).toEqual(mockUser);
    });
  });

  describe('findConversation', () => {
    it('returns null for unknown conversation', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(null);

      const result = await service.findConversation('telegram', 'unknown');

      expect(result).toBeNull();
    });

    it('returns conversation for known platform conversation', async () => {
      mockConversationRepo.findByPlatformConversation.mockResolvedValue(mockConversation);

      const result = await service.findConversation('telegram', 'chat-100');

      expect(result).toEqual(mockConversation);
    });
  });

  describe('getIdentitiesForUser', () => {
    it('returns all linked identities', async () => {
      const identities = [
        mockIdentity,
        { ...mockIdentity, id: 'pi-2', platform: 'slack', platformUserId: 'U123' },
      ];
      mockPlatformIdentityRepo.findByUserId.mockResolvedValue(identities);

      const result = await service.getIdentitiesForUser('user-1');

      expect(result).toEqual(identities);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for unknown user', async () => {
      mockPlatformIdentityRepo.findByUserId.mockResolvedValue([]);

      const result = await service.getIdentitiesForUser('unknown');

      expect(result).toEqual([]);
    });
  });
});
