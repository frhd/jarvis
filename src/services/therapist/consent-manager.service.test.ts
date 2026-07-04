import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConsentManagerService } from './consent-manager.service.js';
import type { TherapistConfig } from './types.js';

// Mock repository - create a simple mock for testing
const mockTherapistConfigRepo = {
  findByConversationId: vi.fn(),
  upsert: vi.fn(),
  setEnabled: vi.fn(),
};

describe('ConsentManagerService', () => {
  let service: ConsentManagerService;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Create new service instance
    service = new ConsentManagerService(mockTherapistConfigRepo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getConsentStatus', () => {
    it('should return hasAllConsent: true when both users have consented', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1', 'user2']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);

      // Act
      const result = await service.getConsentStatus('conv1', ['user1', 'user2']);

      // Assert
      expect(result).toEqual({
        hasAllConsent: true,
        consentedByUserIds: ['user1', 'user2'],
        pendingUserIds: [],
        canEnable: true,
      });
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
    });

    it('should return hasAllConsent: false and pendingUserIds when only one user has consented', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);

      // Act
      const result = await service.getConsentStatus('conv1', ['user1', 'user2']);

      // Assert
      expect(result).toEqual({
        hasAllConsent: false,
        consentedByUserIds: ['user1'],
        pendingUserIds: ['user2'],
        canEnable: false,
      });
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
    });

    it('should return no consent when config does not exist', async () => {
      // Arrange
      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

      // Act
      const result = await service.getConsentStatus('conv1', ['user1', 'user2']);

      // Assert
      expect(result).toEqual({
        hasAllConsent: false,
        consentedByUserIds: [],
        pendingUserIds: ['user1', 'user2'],
        canEnable: false,
      });
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
    });

    it('matches consent stored as unified userIds against participants detected as senderIds', async () => {
      // Reproduces the production bug: consent is stored using unified users.id
      // values, but the dyad detector yields raw senders.id values (messages have
      // no userId column). Both map to the same Telegram IDs, so an injected
      // identity resolver must let them match.
      const senderIdToTelegram: Record<string, string> = {
        sender_alice: '111111111',
        sender_bob: '222222222',
      };
      const userIdToTelegram: Record<string, string> = {
        user_alice: '111111111',
        user_bob: '222222222',
      };
      const mockIdentityResolver = {
        toTelegramId: vi.fn(async (id: string) =>
          senderIdToTelegram[id] ?? userIdToTelegram[id] ?? null
        ),
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
        id: 'config1',
        conversationId: 'conv1',
        enabled: 1,
        modeType: 'moderator',
        consentedByUserIds: JSON.stringify(['user_alice', 'user_bob']),
        responseFrequency: 'active',
        lastInterventionAt: null,
        interventionsCount: 0,
      });

      const serviceWithResolver = new ConsentManagerService(
        mockTherapistConfigRepo,
        mockIdentityResolver
      );

      // Participants arrive as senderIds (from the dyad detector)
      const result = await serviceWithResolver.getConsentStatus('conv1', [
        'sender_alice',
        'sender_bob',
      ]);

      expect(result.hasAllConsent).toBe(true);
      expect(result.pendingUserIds).toEqual([]);
      expect(result.canEnable).toBe(true);
    });

    it('reports the participant as pending when only one side resolves to a consented identity', async () => {
      const map: Record<string, string> = {
        sender_alice: '111111111',
        user_alice: '111111111',
        sender_bob: '222222222',
        // user_bob intentionally absent from consent
      };
      const mockIdentityResolver = {
        toTelegramId: vi.fn(async (id: string) => map[id] ?? null),
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue({
        id: 'config1',
        conversationId: 'conv1',
        enabled: 1,
        modeType: 'moderator',
        consentedByUserIds: JSON.stringify(['user_alice']),
        responseFrequency: 'active',
        lastInterventionAt: null,
        interventionsCount: 0,
      });

      const serviceWithResolver = new ConsentManagerService(
        mockTherapistConfigRepo,
        mockIdentityResolver
      );

      const result = await serviceWithResolver.getConsentStatus('conv1', [
        'sender_alice',
        'sender_bob',
      ]);

      expect(result.hasAllConsent).toBe(false);
      expect(result.pendingUserIds).toEqual(['sender_bob']);
    });
  });

  describe('grantConsent', () => {
    it('should create new config and store userId when first consent is granted', async () => {
      // Arrange
      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.grantConsent('user1', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          conversationId: 'conv1',
          enabled: 0,
          modeType: 'active_listener',
          consentedByUserIds: JSON.stringify(['user1']),
          responseFrequency: 'minimal',
        })
      );
    });

    it('should update config and add userId when second consent is granted', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.grantConsent('user2', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config1',
          conversationId: 'conv1',
          enabled: 0,
          modeType: 'active_listener',
          consentedByUserIds: JSON.stringify(['user1', 'user2']),
          responseFrequency: 'minimal',
        })
      );
    });

    it('should be idempotent when duplicate consent is granted', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1', 'user2']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.grantConsent('user1', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('revokeConsent', () => {
    it('should remove userId and disable therapist when below threshold', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 1,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1', 'user2']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.revokeConsent('user1', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config1',
          conversationId: 'conv1',
          enabled: 0,
          modeType: 'active_listener',
          consentedByUserIds: JSON.stringify(['user2']),
          responseFrequency: 'minimal',
        })
      );
    });

    it('should update config without changing mode when above threshold', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 1,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1', 'user2', 'user3']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.revokeConsent('user1', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config1',
          conversationId: 'conv1',
          enabled: 1,
          modeType: 'active_listener',
          consentedByUserIds: JSON.stringify(['user2', 'user3']),
          responseFrequency: 'minimal',
        })
      );
    });

    it('should return true when no config exists (no-op)', async () => {
      // Arrange
      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

      // Act
      const result = await service.revokeConsent('user1', 'conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('enableTherapistMode', () => {
    it('should enable therapist when full consent is granted', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1', 'user2']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);
      mockTherapistConfigRepo.upsert.mockResolvedValue();

      // Act
      const result = await service.enableTherapistMode('conv1', 'moderator', 'moderate');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config1',
          conversationId: 'conv1',
          enabled: 1,
          modeType: 'moderator',
          consentedByUserIds: JSON.stringify(['user1', 'user2']),
          responseFrequency: 'moderate',
        })
      );
    });

    it('should not enable therapist when insufficient consent', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 0,
        modeType: 'active_listener',
        consentedByUserIds: JSON.stringify(['user1']),
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);

      // Act
      const result = await service.enableTherapistMode('conv1', 'moderator', 'moderate');

      // Assert
      expect(result).toBe(false);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).not.toHaveBeenCalled();
    });

    it('should not enable therapist when no config exists', async () => {
      // Arrange
      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

      // Act
      const result = await service.enableTherapistMode('conv1', 'moderator', 'moderate');

      // Assert
      expect(result).toBe(false);
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
      expect(mockTherapistConfigRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('disableTherapistMode', () => {
    it('should disable therapist successfully', async () => {
      // Arrange
      mockTherapistConfigRepo.setEnabled.mockResolvedValue();

      // Act
      const result = await service.disableTherapistMode('conv1');

      // Assert
      expect(result).toBe(true);
      expect(mockTherapistConfigRepo.setEnabled).toHaveBeenCalledWith('conv1', false);
    });
  });

  describe('getConfig', () => {
    it('should return therapist config when it exists', async () => {
      // Arrange
      const mockRepoResponse = {
        id: 'config1',
        conversationId: 'conv1',
        enabled: 1,
        modeType: 'moderator',
        consentedByUserIds: JSON.stringify(['user1', 'user2']),
        responseFrequency: 'active',
        lastInterventionAt: 1234567890, // timestamp in seconds
        interventionsCount: 5,
      };

      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(mockRepoResponse);

      // Act
      const result = await service.getConfig('conv1');

      // Assert
      expect(result).toEqual({
        conversationId: 'conv1',
        enabled: true,
        modeType: 'moderator',
        consentedByUserIds: ['user1', 'user2'],
        responseFrequency: 'active',
        lastInterventionAt: new Date(1234567890 * 1000),
        interventionsCount: 5,
      });
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
    });

    it('should return null when config does not exist', async () => {
      // Arrange
      mockTherapistConfigRepo.findByConversationId.mockResolvedValue(null);

      // Act
      const result = await service.getConfig('conv1');

      // Assert
      expect(result).toBeNull();
      expect(mockTherapistConfigRepo.findByConversationId).toHaveBeenCalledWith('conv1');
    });
  });
});