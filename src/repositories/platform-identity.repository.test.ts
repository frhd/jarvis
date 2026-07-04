import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-identity-id') }));

// Mock database with chainable builder
vi.mock('../db/client.js', () => {
  let selectResult: unknown[] = [];
  let insertResult: unknown[] = [];
  let updateResult: unknown[] = [];
  let deleteResult = { changes: 0 };

  // where() must be thenable (for findManyWhere without limit) AND have .limit() (for findOneWhere)
  const makeWhereResult = () => {
    const obj = {
      limit: vi.fn(() => Promise.resolve(selectResult)),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(selectResult).then(resolve),
    };
    return obj;
  };

  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => makeWhereResult()),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertResult)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateResult)),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(deleteResult)),
    })),
    _setSelectResult: (r: unknown[]) => { selectResult = r; },
    _setInsertResult: (r: unknown[]) => { insertResult = r; },
    _setUpdateResult: (r: unknown[]) => { updateResult = r; },
    _setDeleteResult: (r: { changes: number }) => { deleteResult = r; },
  };
  return { db: mockDb };
});

vi.mock('../db/schema.js', () => ({
  platformIdentities: {
    id: 'id',
    userId: 'user_id',
    platform: 'platform',
    platformUserId: 'platform_user_id',
    metadata: 'metadata',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

import { PlatformIdentityRepository } from './platform-identity.repository.js';
import { db } from '../db/client.js';

const mockDb = db as unknown as {
  _setSelectResult: (r: unknown[]) => void;
  _setInsertResult: (r: unknown[]) => void;
  _setUpdateResult: (r: unknown[]) => void;
  _setDeleteResult: (r: { changes: number }) => void;
};

describe('PlatformIdentityRepository', () => {
  let repo: PlatformIdentityRepository;

  const mockIdentity = {
    id: 'test-identity-id',
    userId: 'user-1',
    platform: 'telegram',
    platformUserId: '12345',
    metadata: JSON.stringify({ firstName: 'Test' }),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    repo = new PlatformIdentityRepository();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a platform identity linked to user', async () => {
      mockDb._setInsertResult([mockIdentity]);
      const result = await repo.create({
        userId: 'user-1',
        platform: 'telegram',
        platformUserId: '12345',
        metadata: JSON.stringify({ firstName: 'Test' }),
      });
      expect(result).toEqual(mockIdentity);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('findByPlatformUser', () => {
    it('should find by platform and platformUserId', async () => {
      mockDb._setSelectResult([mockIdentity]);
      const result = await repo.findByPlatformUser('telegram', '12345');
      expect(result).toEqual(mockIdentity);
    });

    it('should return null for unknown platform+userId combo', async () => {
      mockDb._setSelectResult([]);
      const result = await repo.findByPlatformUser('slack', 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all identities for a userId', async () => {
      const slackIdentity = { ...mockIdentity, id: 'id-2', platform: 'slack', platformUserId: 'U123' };
      mockDb._setSelectResult([mockIdentity, slackIdentity]);
      const result = await repo.findByUserId('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].platform).toBe('telegram');
      expect(result[1].platform).toBe('slack');
    });
  });

  describe('update', () => {
    it('should update metadata on existing identity', async () => {
      const updated = { ...mockIdentity, metadata: JSON.stringify({ firstName: 'Updated' }) };
      mockDb._setUpdateResult([updated]);
      const result = await repo.update('test-identity-id', {
        metadata: JSON.stringify({ firstName: 'Updated' }),
      });
      expect(result).toEqual(updated);
    });
  });

  describe('delete', () => {
    it('should delete a platform identity', async () => {
      mockDb._setDeleteResult({ changes: 1 });
      const result = await repo.delete('test-identity-id');
      expect(result).toBe(true);
    });
  });
});
