import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'test-conv-id') }));

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
  conversations: {
    id: 'id',
    platform: 'platform',
    platformConversationId: 'platform_conversation_id',
    type: 'type',
    title: 'title',
    metadata: 'metadata',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

import { ConversationRepository } from './conversation.repository.js';
import { db } from '../db/client.js';

const mockDb = db as unknown as {
  _setSelectResult: (r: unknown[]) => void;
  _setInsertResult: (r: unknown[]) => void;
  _setUpdateResult: (r: unknown[]) => void;
  _setDeleteResult: (r: { changes: number }) => void;
};

describe('ConversationRepository', () => {
  let repo: ConversationRepository;

  const mockConversation = {
    id: 'test-conv-id',
    platform: 'telegram',
    platformConversationId: 'chat-456',
    type: 'group',
    title: 'Test Group',
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    repo = new ConversationRepository();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a conversation with platform, type, and title', async () => {
      mockDb._setInsertResult([mockConversation]);
      const result = await repo.create({
        platform: 'telegram',
        platformConversationId: 'chat-456',
        type: 'group',
        title: 'Test Group',
      });
      expect(result).toEqual(mockConversation);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('findByPlatformConversation', () => {
    it('should find by platform and platformConversationId', async () => {
      mockDb._setSelectResult([mockConversation]);
      const result = await repo.findByPlatformConversation('telegram', 'chat-456');
      expect(result).toEqual(mockConversation);
    });

    it('should return null for unknown platform+conversationId combo', async () => {
      mockDb._setSelectResult([]);
      const result = await repo.findByPlatformConversation('slack', 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('findByType', () => {
    it('should find conversations by type filter', async () => {
      mockDb._setSelectResult([mockConversation]);
      const result = await repo.findByType('group');
      expect(result).toEqual([mockConversation]);
    });
  });

  describe('findByPlatform', () => {
    it('should find conversations by platform filter', async () => {
      mockDb._setSelectResult([mockConversation]);
      const result = await repo.findByPlatform('telegram');
      expect(result).toEqual([mockConversation]);
    });
  });

  describe('update', () => {
    it('should update title and metadata', async () => {
      const updated = { ...mockConversation, title: 'New Title', metadata: '{"key":"val"}' };
      mockDb._setUpdateResult([updated]);
      const result = await repo.update('test-conv-id', {
        title: 'New Title',
        metadata: '{"key":"val"}',
      });
      expect(result).toEqual(updated);
    });

    it('should return null for unknown ID', async () => {
      mockDb._setUpdateResult([]);
      const result = await repo.update('unknown-id', { title: 'New' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a conversation', async () => {
      mockDb._setDeleteResult({ changes: 1 });
      const result = await repo.delete('test-conv-id');
      expect(result).toBe(true);
    });

    it('should return false for unknown ID', async () => {
      mockDb._setDeleteResult({ changes: 0 });
      const result = await repo.delete('unknown-id');
      expect(result).toBe(false);
    });
  });
});
