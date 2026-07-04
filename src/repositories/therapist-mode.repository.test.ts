/**
 * TherapistModeRepository Tests
 *
 * Covers all repository methods:
 * - findByConversationId: found, not found
 * - upsert: creates when not exists, updates when exists
 * - setEnabled: enables/disables, no-op when not found
 * - updateIntervention: updates, no-op when not found
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
  therapistModeConfig: {
    id: 'id',
    conversationId: 'conversationId',
    enabled: 'enabled',
    modeType: 'modeType',
    consentedByUserIds: 'consentedByUserIds',
    responseFrequency: 'responseFrequency',
    lastInterventionAt: 'lastInterventionAt',
    interventionsCount: 'interventionsCount',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

// ============================================================================
// Import after all vi.mock() calls
// ============================================================================

import { TherapistModeRepository } from './therapist-mode.repository';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    conversationId: 'conv-1',
    enabled: false,
    modeType: 'active_listener',
    consentedByUserIds: '[]',
    responseFrequency: 'minimal',
    lastInterventionAt: null,
    interventionsCount: 0,
    metadata: '{}',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TherapistModeRepository', () => {
  let repo: TherapistModeRepository;

  beforeEach(() => {
    repo = new TherapistModeRepository();
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
    it('should return config when found', async () => {
      const mockConfig = createMockConfig();
      selectResult = [mockConfig];

      const result = await repo.findByConversationId('conv-1');

      expect(result).toEqual(mockConfig);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when not found', async () => {
      selectResult = [];

      const result = await repo.findByConversationId('conv-nonexistent');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // upsert()
  // ==========================================================================

  describe('upsert', () => {
    it('should create when record does not exist', async () => {
      // First select returns empty (not found), then insert returns new record
      const newConfig = createMockConfig({ id: 'mock-nanoid-id' });
      selectResult = [];
      insertResult = [newConfig];

      await repo.upsert({
        id: 'ignored-id',
        conversationId: 'conv-new',
        enabled: true,
        modeType: 'active_listener',
        consentedByUserIds: '[]',
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
        metadata: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(mockInsert).toHaveBeenCalled();
    });

    it('should update when record already exists', async () => {
      const existingConfig = createMockConfig({ id: 'config-1', conversationId: 'conv-1' });
      const updatedConfig = createMockConfig({ id: 'config-1', conversationId: 'conv-1', enabled: true });
      selectResult = [existingConfig];
      updateResult = [updatedConfig];

      await repo.upsert({
        id: 'ignored-id',
        conversationId: 'conv-1',
        enabled: true,
        modeType: 'active_listener',
        consentedByUserIds: '[]',
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
        metadata: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // setEnabled()
  // ==========================================================================

  describe('setEnabled', () => {
    it('should enable therapist mode when config exists', async () => {
      const existingConfig = createMockConfig({ id: 'config-1', enabled: false });
      const updatedConfig = createMockConfig({ id: 'config-1', enabled: true });
      selectResult = [existingConfig];
      updateResult = [updatedConfig];

      await repo.setEnabled('conv-1', true);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should disable therapist mode when config exists', async () => {
      const existingConfig = createMockConfig({ id: 'config-1', enabled: true });
      const updatedConfig = createMockConfig({ id: 'config-1', enabled: false });
      selectResult = [existingConfig];
      updateResult = [updatedConfig];

      await repo.setEnabled('conv-1', false);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should do nothing when config not found', async () => {
      selectResult = [];

      await repo.setEnabled('conv-nonexistent', true);

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // updateIntervention()
  // ==========================================================================

  describe('updateIntervention', () => {
    it('should update lastInterventionAt and interventionsCount when config exists', async () => {
      const existingConfig = createMockConfig({ id: 'config-1', interventionsCount: 2 });
      const updatedConfig = createMockConfig({
        id: 'config-1',
        interventionsCount: 3,
        lastInterventionAt: new Date('2025-06-01T10:00:00Z'),
      });
      selectResult = [existingConfig];
      updateResult = [updatedConfig];

      await repo.updateIntervention({
        conversationId: 'conv-1',
        lastInterventionAt: new Date('2025-06-01T10:00:00Z'),
        interventionsCount: 3,
      });

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should do nothing when config not found', async () => {
      selectResult = [];

      await repo.updateIntervention({
        conversationId: 'conv-nonexistent',
        lastInterventionAt: new Date(),
        interventionsCount: 1,
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Inherited: create()
  // ==========================================================================

  describe('create', () => {
    it('should create a new config with generated ID and timestamps', async () => {
      const mockConfig = createMockConfig({ id: 'mock-nanoid-id' });
      insertResult = [mockConfig];

      const result = await repo.create({
        conversationId: 'conv-new',
        enabled: false,
        modeType: 'active_listener',
        consentedByUserIds: '[]',
        responseFrequency: 'minimal',
        lastInterventionAt: null,
        interventionsCount: 0,
        metadata: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(result).toEqual(mockConfig);
      expect(nanoid).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Inherited: findById()
  // ==========================================================================

  describe('findById', () => {
    it('should return config when found by ID', async () => {
      const mockConfig = createMockConfig();
      selectResult = [mockConfig];

      const result = await repo.findById('config-1');

      expect(result).toEqual(mockConfig);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when not found by ID', async () => {
      selectResult = [];

      const result = await repo.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Inherited: delete()
  // ==========================================================================

  describe('delete', () => {
    it('should return true when config is deleted', async () => {
      deleteResult = { changes: 1 };

      const result = await repo.delete('config-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return false when config does not exist', async () => {
      deleteResult = { changes: 0 };

      const result = await repo.delete('nonexistent-id');

      expect(result).toBe(false);
    });
  });
});
