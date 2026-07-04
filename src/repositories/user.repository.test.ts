import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-user-id') }));

// Mock database with chainable builder
vi.mock('../db/client.js', () => {
  let selectResult: unknown[] = [];
  let insertResult: unknown[] = [];
  let updateResult: unknown[] = [];
  let deleteResult = { changes: 0 };

  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResult)),
        })),
        limit: vi.fn(() => ({
          offset: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(selectResult)),
          })),
        })),
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
  users: {
    id: 'id',
    displayName: 'display_name',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

import { UserRepository } from './user.repository.js';
import { db } from '../db/client.js';

const mockDb = db as unknown as {
  _setSelectResult: (r: unknown[]) => void;
  _setInsertResult: (r: unknown[]) => void;
  _setUpdateResult: (r: unknown[]) => void;
  _setDeleteResult: (r: { changes: number }) => void;
};

describe('UserRepository', () => {
  let repo: UserRepository;

  const mockUser = {
    id: 'test-user-id',
    displayName: 'Test User',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    repo = new UserRepository();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a user with displayName', async () => {
      mockDb._setInsertResult([mockUser]);
      const result = await repo.create({ displayName: 'Test User' });
      expect(result).toEqual(mockUser);
      expect(db.insert).toHaveBeenCalled();
    });

    it('should create a user with null displayName', async () => {
      const userNoName = { ...mockUser, displayName: null };
      mockDb._setInsertResult([userNoName]);
      const result = await repo.create({ displayName: null });
      expect(result).toEqual(userNoName);
    });
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      mockDb._setSelectResult([mockUser]);
      const result = await repo.findById('test-user-id');
      expect(result).toEqual(mockUser);
    });

    it('should return null for unknown ID', async () => {
      mockDb._setSelectResult([]);
      const result = await repo.findById('unknown-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update displayName', async () => {
      const updated = { ...mockUser, displayName: 'Updated Name' };
      mockDb._setUpdateResult([updated]);
      const result = await repo.update('test-user-id', { displayName: 'Updated Name' });
      expect(result).toEqual(updated);
    });

    it('should return null for unknown ID', async () => {
      mockDb._setUpdateResult([]);
      const result = await repo.update('unknown-id', { displayName: 'Name' });
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should list users with limit/offset', async () => {
      mockDb._setSelectResult([mockUser]);
      const result = await repo.findAll(10, 0);
      expect(result).toEqual([mockUser]);
    });
  });

  describe('delete', () => {
    it('should delete a user', async () => {
      mockDb._setDeleteResult({ changes: 1 });
      const result = await repo.delete('test-user-id');
      expect(result).toBe(true);
    });

    it('should return false for unknown ID', async () => {
      mockDb._setDeleteResult({ changes: 0 });
      const result = await repo.delete('unknown-id');
      expect(result).toBe(false);
    });
  });
});
