import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock nanoid
// ============================================================================

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// ============================================================================
// Mock db client with proxy-based chainable builder pattern
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
      select: (...args: unknown[]) => { mockSelect(...args); return makeThenable(() => selectResult); },
      insert: (...args: unknown[]) => { mockInsert(...args); return makeThenable(() => insertResult); },
      update: (...args: unknown[]) => { mockUpdate(...args); return makeThenable(() => updateResult); },
      delete: (...args: unknown[]) => { mockDelete(...args); return makeThenable(() => deleteResult); },
    },
  };
});

// ============================================================================
// Mock schema
// ============================================================================

vi.mock('../db/schema', () => ({
  conversationDynamics: {
    id: 'id',
    conversationId: 'conversationId',
    tensionLevel: 'tensionLevel',
    conflictDetected: 'conflictDetected',
    conflictType: 'conflictType',
    positiveMomentsCount: 'positiveMomentsCount',
    turnTakingBalance: 'turnTakingBalance',
    topicCoherence: 'topicCoherence',
    supportPatterns: 'supportPatterns',
    lastAnalyzedAt: 'lastAnalyzedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

// Import AFTER all vi.mock() calls
import { ConversationDynamicsRepository } from './conversation-dynamics.repository';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockDynamics(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'dynamics-1',
    conversationId: 'conv-1',
    tensionLevel: 10,
    conflictDetected: false,
    conflictType: null,
    positiveMomentsCount: 3,
    turnTakingBalance: 0.5,
    topicCoherence: 0.8,
    supportPatterns: '[]',
    lastAnalyzedAt: new Date('2026-01-01T12:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ConversationDynamicsRepository', () => {
  let repo: ConversationDynamicsRepository;

  beforeEach(() => {
    repo = new ConversationDynamicsRepository();
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
  // findByConversationId()
  // ==========================================================================

  describe('findByConversationId', () => {
    it('should return dynamics row when found', async () => {
      const mockDynamics = createMockDynamics();
      selectResult = [mockDynamics];

      const result = await repo.findByConversationId('conv-1');

      expect(result).toEqual(mockDynamics);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when no record matches the conversationId', async () => {
      selectResult = [];

      const result = await repo.findByConversationId('non-existent-conv');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // upsert()
  // ==========================================================================

  describe('upsert', () => {
    it('should create a new record when no existing record is found', async () => {
      // First select (findByConversationId) returns empty, then insert returns the row
      selectResult = [];
      insertResult = [createMockDynamics({ id: 'mock-nanoid-id' })];

      await repo.upsert({
        conversationId: 'conv-new',
        tensionLevel: 20,
        conflictDetected: false,
        conflictType: null,
        positiveMomentsCount: 1,
        turnTakingBalance: 0.6,
        topicCoherence: 0.7,
        supportPatterns: '[]',
        lastAnalyzedAt: new Date('2026-01-01T12:00:00Z'),
      } as Parameters<typeof repo.upsert>[0]);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should update an existing record when one is found', async () => {
      const existing = createMockDynamics({ id: 'existing-id', conversationId: 'conv-1' });
      // First select (findByConversationId) returns the existing row
      selectResult = [existing];
      updateResult = [{ ...existing, tensionLevel: 50 }];

      await repo.upsert({
        conversationId: 'conv-1',
        tensionLevel: 50,
        conflictDetected: false,
        conflictType: null,
        positiveMomentsCount: 5,
        turnTakingBalance: 0.4,
        topicCoherence: 0.9,
        supportPatterns: '["support"]',
        lastAnalyzedAt: new Date('2026-01-02T12:00:00Z'),
      } as Parameters<typeof repo.upsert>[0]);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // create() (inherited from BaseRepository)
  // ==========================================================================

  describe('create', () => {
    it('should create a new record with generated ID and timestamps', async () => {
      const mockDynamics = createMockDynamics({ id: 'mock-nanoid-id' });
      insertResult = [mockDynamics];

      const result = await repo.create({
        conversationId: 'conv-1',
        tensionLevel: 10,
        conflictDetected: false,
        conflictType: null,
        positiveMomentsCount: 3,
        turnTakingBalance: 0.5,
        topicCoherence: 0.8,
        supportPatterns: '[]',
        lastAnalyzedAt: new Date('2026-01-01T12:00:00Z'),
      });

      expect(result).toEqual(mockDynamics);
      expect(nanoid).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should return the first inserted row', async () => {
      const mockDynamics = createMockDynamics({ id: 'mock-nanoid-id', conversationId: 'conv-99' });
      insertResult = [mockDynamics];

      const result = await repo.create({
        conversationId: 'conv-99',
        tensionLevel: 0,
        conflictDetected: false,
        conflictType: null,
        positiveMomentsCount: 0,
        turnTakingBalance: 0.5,
        topicCoherence: 0.5,
        supportPatterns: '[]',
        lastAnalyzedAt: new Date(),
      });

      expect(result.id).toBe('mock-nanoid-id');
      expect(result.conversationId).toBe('conv-99');
    });
  });

  // ==========================================================================
  // findById() (inherited from BaseRepository)
  // ==========================================================================

  describe('findById', () => {
    it('should return a row when found by ID', async () => {
      const mockDynamics = createMockDynamics();
      selectResult = [mockDynamics];

      const result = await repo.findById('dynamics-1');

      expect(result).toEqual(mockDynamics);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when record is not found', async () => {
      selectResult = [];

      const result = await repo.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // delete() (inherited from BaseRepository)
  // ==========================================================================

  describe('delete', () => {
    it('should return true when a record is deleted', async () => {
      deleteResult = { changes: 1 };

      const result = await repo.delete('dynamics-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return false when no record matches', async () => {
      deleteResult = { changes: 0 };

      const result = await repo.delete('non-existent-id');

      expect(result).toBe(false);
    });
  });
});
