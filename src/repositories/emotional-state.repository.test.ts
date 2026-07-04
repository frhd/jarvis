/**
 * EmotionalStateRepository Tests
 *
 * Covers all repository methods:
 * - findByConversationAndUser: found, not found
 * - upsert: creates when not exists, updates when exists
 * - Inherited: create, findById, delete
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock nanoid
// ============================================================================

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// ============================================================================
// Mock db client with chainable proxy pattern
// ============================================================================

let selectResult: unknown[] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
let deleteResult: { changes: number } | unknown[] = { changes: 0 };

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../db/client', () => {
  const makeThenable = (getResult: () => unknown) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(getResult()).then(resolve);
        }
        if (prop === Symbol.toStringTag) return 'Promise';
        const fn = vi.fn().mockReturnValue(new Proxy({}, handler));
        return fn;
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return makeThenable(() => selectResult);
      },
      insert: (...args: unknown[]) => {
        mockInsert(...args);
        return makeThenable(() => insertResult);
      },
      update: (...args: unknown[]) => {
        mockUpdate(...args);
        return makeThenable(() => updateResult);
      },
      delete: (...args: unknown[]) => {
        mockDelete(...args);
        return makeThenable(() => deleteResult);
      },
    },
  };
});

// ============================================================================
// Mock db schema
// ============================================================================

vi.mock('../db/schema', () => ({
  dyadEmotionalStates: {
    id: 'id',
    conversationId: 'conversationId',
    userId: 'userId',
    primaryEmotion: 'primaryEmotion',
    emotionIntensity: 'emotionIntensity',
    emotionTrend: 'emotionTrend',
    lastAnalyzedAt: 'lastAnalyzedAt',
    analysisData: 'analysisData',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

// Import AFTER all vi.mock() calls
import { EmotionalStateRepository } from './emotional-state.repository';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Fixtures
// ============================================================================

type MockState = {
  id: string;
  conversationId: string;
  userId: string;
  primaryEmotion: string;
  emotionIntensity: number;
  emotionTrend: 'improving' | 'stable' | 'declining' | 'volatile';
  lastAnalyzedAt: Date;
  analysisData: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createMockState(overrides: Partial<MockState> = {}): MockState {
  return {
    id: 'state-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    primaryEmotion: 'neutral',
    emotionIntensity: 50,
    emotionTrend: 'stable',
    lastAnalyzedAt: new Date('2025-01-01T10:00:00Z'),
    analysisData: '{}',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('EmotionalStateRepository', () => {
  let repo: EmotionalStateRepository;

  beforeEach(() => {
    repo = new EmotionalStateRepository();
    selectResult = [];
    insertResult = [];
    updateResult = [];
    deleteResult = { changes: 0 };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // create() - inherited from BaseRepository
  // ==========================================================================

  describe('create', () => {
    it('should create a new emotional state with generated ID and timestamps', async () => {
      const mockState = createMockState({ id: 'mock-nanoid-id' });
      insertResult = [mockState];

      const result = await repo.create({
        conversationId: 'conv-1',
        userId: 'user-1',
        primaryEmotion: 'neutral',
        emotionIntensity: 50,
        emotionTrend: 'stable',
        lastAnalyzedAt: new Date('2025-01-01T10:00:00Z'),
        analysisData: '{}',
      });

      expect(result).toEqual(mockState);
      expect(nanoid).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should return the first inserted row', async () => {
      const mockState = createMockState({
        id: 'mock-nanoid-id',
        primaryEmotion: 'happy',
      });
      insertResult = [mockState];

      const result = await repo.create({
        conversationId: 'conv-2',
        userId: 'user-2',
        primaryEmotion: 'happy',
        emotionIntensity: 80,
        emotionTrend: 'improving',
        lastAnalyzedAt: new Date('2025-01-01T12:00:00Z'),
        analysisData: null,
      });

      expect(result.id).toBe('mock-nanoid-id');
      expect(result.primaryEmotion).toBe('happy');
    });
  });

  // ==========================================================================
  // findById() - inherited from BaseRepository
  // ==========================================================================

  describe('findById', () => {
    it('should return a state when found', async () => {
      const mockState = createMockState();
      selectResult = [mockState];

      const result = await repo.findById('state-1');

      expect(result).toEqual(mockState);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when state not found', async () => {
      selectResult = [];

      const result = await repo.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // findByConversationAndUser()
  // ==========================================================================

  describe('findByConversationAndUser', () => {
    it('should return the emotional state when found', async () => {
      const mockState = createMockState({
        conversationId: 'conv-42',
        userId: 'user-99',
        primaryEmotion: 'anxious',
        emotionIntensity: 70,
        emotionTrend: 'declining',
      });
      selectResult = [mockState];

      const result = await repo.findByConversationAndUser('conv-42', 'user-99');

      expect(result).toEqual(mockState);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when no record exists for the conversation+user pair', async () => {
      selectResult = [];

      const result = await repo.findByConversationAndUser('conv-none', 'user-none');

      expect(result).toBeNull();
    });

    it('should return null when user exists in a different conversation', async () => {
      selectResult = [];

      const result = await repo.findByConversationAndUser('conv-different', 'user-1');

      expect(result).toBeNull();
    });

    it('should return null when conversation exists but for a different user', async () => {
      selectResult = [];

      const result = await repo.findByConversationAndUser('conv-1', 'user-different');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // upsert()
  // ==========================================================================

  describe('upsert', () => {
    it('should create a new record when none exists', async () => {
      // First call (findByConversationAndUser) returns empty
      // Second call (create) returns inserted row
      let selectCallCount = 0;
      selectResult = [];
      insertResult = [createMockState({ id: 'mock-nanoid-id' })];

      // Override selectResult to return empty for the find call
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        return undefined; // the proxy handles the actual return
      });

      await repo.upsert({
        conversationId: 'conv-1',
        userId: 'user-1',
        primaryEmotion: 'neutral',
        emotionIntensity: 50,
        emotionTrend: 'stable',
        lastAnalyzedAt: new Date('2025-01-01T10:00:00Z'),
        analysisData: '{}',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should update existing record when one is found', async () => {
      const existingState = createMockState({
        id: 'existing-id',
        conversationId: 'conv-1',
        userId: 'user-1',
        primaryEmotion: 'neutral',
        emotionIntensity: 50,
      });

      // findByConversationAndUser returns existing record
      selectResult = [existingState];
      updateResult = [{ ...existingState, primaryEmotion: 'happy', emotionIntensity: 80 }];

      await repo.upsert({
        conversationId: 'conv-1',
        userId: 'user-1',
        primaryEmotion: 'happy',
        emotionIntensity: 80,
        emotionTrend: 'improving',
        lastAnalyzedAt: new Date('2025-01-02T10:00:00Z'),
        analysisData: '{"sentiment": "positive"}',
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should not call insert when updating', async () => {
      const existingState = createMockState({ id: 'state-1' });
      selectResult = [existingState];
      updateResult = [existingState];

      await repo.upsert({
        conversationId: 'conv-1',
        userId: 'user-1',
        primaryEmotion: 'frustrated',
        emotionIntensity: 60,
        emotionTrend: 'volatile',
        lastAnalyzedAt: new Date(),
        analysisData: null,
      });

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should not call update when creating', async () => {
      selectResult = [];
      insertResult = [createMockState({ id: 'mock-nanoid-id' })];

      await repo.upsert({
        conversationId: 'conv-new',
        userId: 'user-new',
        primaryEmotion: 'happy',
        emotionIntensity: 90,
        emotionTrend: 'improving',
        lastAnalyzedAt: new Date(),
        analysisData: null,
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle all emotion trends when creating', async () => {
      const trends = ['improving', 'stable', 'declining', 'volatile'] as const;

      for (const trend of trends) {
        selectResult = [];
        insertResult = [createMockState({ id: 'mock-nanoid-id', emotionTrend: trend })];
        mockInsert.mockClear();
        mockSelect.mockClear();

        await repo.upsert({
          conversationId: 'conv-1',
          userId: 'user-1',
          primaryEmotion: 'neutral',
          emotionIntensity: 50,
          emotionTrend: trend,
          lastAnalyzedAt: new Date(),
          analysisData: null,
        });

        expect(mockInsert).toHaveBeenCalled();
      }
    });
  });

  // ==========================================================================
  // delete() - inherited from BaseRepository
  // ==========================================================================

  describe('delete', () => {
    it('should return true when emotional state is deleted', async () => {
      deleteResult = { changes: 1 };

      const result = await repo.delete('state-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return false when emotional state does not exist', async () => {
      deleteResult = { changes: 0 };

      const result = await repo.delete('non-existent-id');

      expect(result).toBe(false);
    });

    it('should return false for empty string ID', async () => {
      deleteResult = { changes: 0 };

      const result = await repo.delete('');

      expect(result).toBe(false);
    });
  });
});
