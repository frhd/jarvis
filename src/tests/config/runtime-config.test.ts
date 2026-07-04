import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuntimeConfigManager } from '../../config/runtime-config';

// Mock config for testing
const mockConfig = {
  database: {
    path: '/test/db.sqlite',
    poolSize: 10,
  },
  llm: {
    enabled: true,
    baseUrl: 'http://localhost:11434',
    model: 'mistral',
    timeoutMs: 30000,
    maxRetries: 3,
    temperature: 0.7,
  },
  retry: {
    maxAttempts: 5,
    retryIntervalMs: 60000,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
  },
  priority: {
    chatIds: ['chat1', 'chat2', 'chat3'],
  },
  features: {
    cache: {
      enabled: false,
      ttl: 3600,
    },
  },
};

describe('RuntimeConfigManager', () => {
  let manager: RuntimeConfigManager;

  beforeEach(() => {
    manager = new RuntimeConfigManager(mockConfig as any);
  });

  describe('get()', () => {
    it('should get top-level config values', () => {
      const database = manager.get('database');
      expect(database).toEqual({
        path: '/test/db.sqlite',
        poolSize: 10,
      });
    });

    it('should get nested config values using dot notation', () => {
      expect(manager.get('llm.enabled')).toBe(true);
      expect(manager.get('llm.baseUrl')).toBe('http://localhost:11434');
      expect(manager.get('llm.timeoutMs')).toBe(30000);
      expect(manager.get('database.poolSize')).toBe(10);
    });

    it('should get deeply nested values', () => {
      expect(manager.get('features.cache.enabled')).toBe(false);
      expect(manager.get('features.cache.ttl')).toBe(3600);
    });

    it('should get array values', () => {
      const chatIds = manager.get('priority.chatIds');
      expect(chatIds).toEqual(['chat1', 'chat2', 'chat3']);
    });

    it('should return undefined for invalid paths', () => {
      expect(manager.get('invalid.path')).toBeUndefined();
      expect(manager.get('llm.nonexistent')).toBeUndefined();
    });
  });

  describe('set()', () => {
    it('should set primitive values', () => {
      manager.set('llm.timeoutMs', 60000);
      expect(manager.get('llm.timeoutMs')).toBe(60000);

      manager.set('llm.enabled', false);
      expect(manager.get('llm.enabled')).toBe(false);

      manager.set('llm.model', 'llama2');
      expect(manager.get('llm.model')).toBe('llama2');
    });

    it('should set nested values', () => {
      manager.set('features.cache.enabled', true);
      expect(manager.get('features.cache.enabled')).toBe(true);

      manager.set('features.cache.ttl', 7200);
      expect(manager.get('features.cache.ttl')).toBe(7200);
    });

    it('should set array values', () => {
      const newChatIds = ['chat4', 'chat5'];
      manager.set('priority.chatIds', newChatIds);
      expect(manager.get('priority.chatIds')).toEqual(newChatIds);
    });

    it('should throw error for invalid paths', () => {
      expect(() => manager.set('invalid.path', 123)).toThrow('Invalid config path');
    });

    it('should throw error for type mismatches', () => {
      expect(() => manager.set('llm.timeoutMs', 'not a number')).toThrow('Type mismatch');
      expect(() => manager.set('llm.enabled', 123)).toThrow('Type mismatch');
      expect(() => manager.set('priority.chatIds', 'not an array')).toThrow('Type mismatch');
    });

    it('should track changes', () => {
      expect(manager.hasChanges()).toBe(false);
      expect(manager.getChangeCount()).toBe(0);

      manager.set('llm.timeoutMs', 60000);

      expect(manager.hasChanges()).toBe(true);
      expect(manager.getChangeCount()).toBe(1);
      expect(manager.isModified('llm.timeoutMs')).toBe(true);
      expect(manager.isModified('llm.enabled')).toBe(false);
    });

    it('should update existing changes', () => {
      manager.set('llm.timeoutMs', 60000);
      expect(manager.getChangeCount()).toBe(1);

      manager.set('llm.timeoutMs', 90000);
      expect(manager.getChangeCount()).toBe(1); // Still only 1 change tracked
      expect(manager.get('llm.timeoutMs')).toBe(90000);
    });

    it('should emit change events', () => {
      const changeListener = vi.fn();
      manager.on('change', changeListener);

      manager.set('llm.timeoutMs', 60000);

      expect(changeListener).toHaveBeenCalledWith('llm.timeoutMs', 60000, 30000);
    });
  });

  describe('reset()', () => {
    it('should reset single values to original', () => {
      manager.set('llm.timeoutMs', 60000);
      expect(manager.get('llm.timeoutMs')).toBe(60000);

      manager.reset('llm.timeoutMs');
      expect(manager.get('llm.timeoutMs')).toBe(30000);
    });

    it('should reset nested values', () => {
      manager.set('features.cache.enabled', true);
      expect(manager.get('features.cache.enabled')).toBe(true);

      manager.reset('features.cache.enabled');
      expect(manager.get('features.cache.enabled')).toBe(false);
    });

    it('should remove from changes tracking', () => {
      manager.set('llm.timeoutMs', 60000);
      expect(manager.isModified('llm.timeoutMs')).toBe(true);

      manager.reset('llm.timeoutMs');
      expect(manager.isModified('llm.timeoutMs')).toBe(false);
      expect(manager.hasChanges()).toBe(false);
    });

    it('should throw error for invalid paths', () => {
      expect(() => manager.reset('invalid.path')).toThrow('Invalid config path');
    });

    it('should emit reset and change events', () => {
      const resetListener = vi.fn();
      const changeListener = vi.fn();
      manager.on('reset', resetListener);
      manager.on('change', changeListener);

      manager.set('llm.timeoutMs', 60000);
      resetListener.mockClear();
      changeListener.mockClear();

      manager.reset('llm.timeoutMs');

      expect(resetListener).toHaveBeenCalledWith('llm.timeoutMs', 30000, 60000);
      expect(changeListener).toHaveBeenCalledWith('llm.timeoutMs', 30000, 60000);
    });
  });

  describe('resetAll()', () => {
    it('should reset all modified values', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);
      manager.set('features.cache.enabled', true);

      expect(manager.getChangeCount()).toBe(3);

      manager.resetAll();

      expect(manager.get('llm.timeoutMs')).toBe(30000);
      expect(manager.get('llm.enabled')).toBe(true);
      expect(manager.get('features.cache.enabled')).toBe(false);
      expect(manager.hasChanges()).toBe(false);
    });

    it('should emit resetAll event', () => {
      const resetAllListener = vi.fn();
      manager.on('resetAll', resetAllListener);

      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);

      manager.resetAll();

      expect(resetAllListener).toHaveBeenCalled();
    });
  });

  describe('subscribe() / unsubscribe()', () => {
    it('should notify subscribers on value changes', () => {
      const listener = vi.fn();
      manager.subscribe('llm.timeoutMs', listener);

      manager.set('llm.timeoutMs', 60000);

      expect(listener).toHaveBeenCalledWith(60000, 30000, 'llm.timeoutMs');
    });

    it('should support multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      manager.subscribe('llm.timeoutMs', listener1);
      manager.subscribe('llm.timeoutMs', listener2);

      manager.set('llm.timeoutMs', 60000);

      expect(listener1).toHaveBeenCalledWith(60000, 30000, 'llm.timeoutMs');
      expect(listener2).toHaveBeenCalledWith(60000, 30000, 'llm.timeoutMs');
    });

    it('should notify on reset', () => {
      const listener = vi.fn();
      manager.subscribe('llm.timeoutMs', listener);

      manager.set('llm.timeoutMs', 60000);
      listener.mockClear();

      manager.reset('llm.timeoutMs');

      expect(listener).toHaveBeenCalledWith(30000, 60000, 'llm.timeoutMs');
    });

    it('should unsubscribe listeners', () => {
      const listener = vi.fn();
      manager.subscribe('llm.timeoutMs', listener);

      manager.set('llm.timeoutMs', 60000);
      expect(listener).toHaveBeenCalledTimes(1);

      listener.mockClear();
      manager.unsubscribe('llm.timeoutMs', listener);

      manager.set('llm.timeoutMs', 90000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe('llm.timeoutMs', listener);

      manager.set('llm.timeoutMs', 60000);
      expect(listener).toHaveBeenCalledTimes(1);

      listener.mockClear();
      unsubscribe();

      manager.set('llm.timeoutMs', 90000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle errors in listeners gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      manager.subscribe('llm.timeoutMs', errorListener);
      manager.subscribe('llm.timeoutMs', goodListener);

      manager.set('llm.timeoutMs', 60000);

      expect(errorListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not notify listeners of other paths', () => {
      const listener = vi.fn();
      manager.subscribe('llm.timeoutMs', listener);

      manager.set('llm.enabled', false);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getSnapshot()', () => {
    it('should return a deep clone of current config', () => {
      const snapshot = manager.getSnapshot();

      expect(snapshot).toEqual(mockConfig);
      expect(snapshot).not.toBe(mockConfig); // Different object reference

      // Verify it's a deep clone
      snapshot.llm.timeoutMs = 99999;
      expect(manager.get('llm.timeoutMs')).toBe(30000);
    });

    it('should reflect runtime changes', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);

      const snapshot = manager.getSnapshot();

      expect(snapshot.llm.timeoutMs).toBe(60000);
      expect(snapshot.llm.enabled).toBe(false);
    });
  });

  describe('getOriginal()', () => {
    it('should return original config', () => {
      const original = manager.getOriginal();
      expect(original).toEqual(mockConfig);
    });

    it('should not be affected by runtime changes', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);

      const original = manager.getOriginal();

      expect(original.llm.timeoutMs).toBe(30000);
      expect(original.llm.enabled).toBe(true);
    });

    it('should return a deep clone', () => {
      const original = manager.getOriginal();

      original.llm.timeoutMs = 99999;
      expect(manager.get('llm.timeoutMs')).toBe(30000);
    });
  });

  describe('getDiff()', () => {
    it('should return empty array when no changes', () => {
      const diff = manager.getDiff();
      expect(diff).toEqual([]);
    });

    it('should return changes with original and current values', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);

      const diff = manager.getDiff();

      expect(diff).toHaveLength(2);

      const timeoutChange = diff.find((c) => c.path === 'llm.timeoutMs');
      expect(timeoutChange).toMatchObject({
        path: 'llm.timeoutMs',
        originalValue: 30000,
        currentValue: 60000,
      });
      expect(timeoutChange?.timestamp).toBeInstanceOf(Date);

      const enabledChange = diff.find((c) => c.path === 'llm.enabled');
      expect(enabledChange).toMatchObject({
        path: 'llm.enabled',
        originalValue: true,
        currentValue: false,
      });
    });

    it('should show latest value for multiple updates', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.timeoutMs', 90000);

      const diff = manager.getDiff();

      expect(diff).toHaveLength(1);
      expect(diff[0]).toMatchObject({
        path: 'llm.timeoutMs',
        originalValue: 30000,
        currentValue: 90000,
      });
    });

    it('should not include reset values', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);

      manager.reset('llm.timeoutMs');

      const diff = manager.getDiff();

      expect(diff).toHaveLength(1);
      expect(diff[0].path).toBe('llm.enabled');
    });

    it('should return deep clones', () => {
      manager.set('llm.timeoutMs', 60000);

      const diff = manager.getDiff();
      diff[0].currentValue = 99999;

      expect(manager.get('llm.timeoutMs')).toBe(60000);
    });
  });

  describe('hasChanges() / getChangeCount() / isModified()', () => {
    it('should track change state correctly', () => {
      expect(manager.hasChanges()).toBe(false);
      expect(manager.getChangeCount()).toBe(0);

      manager.set('llm.timeoutMs', 60000);

      expect(manager.hasChanges()).toBe(true);
      expect(manager.getChangeCount()).toBe(1);
      expect(manager.isModified('llm.timeoutMs')).toBe(true);

      manager.set('llm.enabled', false);

      expect(manager.getChangeCount()).toBe(2);
      expect(manager.isModified('llm.enabled')).toBe(true);

      manager.reset('llm.timeoutMs');

      expect(manager.hasChanges()).toBe(true);
      expect(manager.getChangeCount()).toBe(1);
      expect(manager.isModified('llm.timeoutMs')).toBe(false);
      expect(manager.isModified('llm.enabled')).toBe(true);

      manager.resetAll();

      expect(manager.hasChanges()).toBe(false);
      expect(manager.getChangeCount()).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle array modifications correctly', () => {
      const originalChatIds = manager.get('priority.chatIds');
      expect(originalChatIds).toEqual(['chat1', 'chat2', 'chat3']);

      manager.set('priority.chatIds', ['chat4', 'chat5']);

      const diff = manager.getDiff();
      expect(diff[0].originalValue).toEqual(['chat1', 'chat2', 'chat3']);
      expect(diff[0].currentValue).toEqual(['chat4', 'chat5']);

      manager.reset('priority.chatIds');
      expect(manager.get('priority.chatIds')).toEqual(['chat1', 'chat2', 'chat3']);
    });

    it('should handle multiple changes and partial resets', () => {
      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);
      manager.set('llm.maxRetries', 10);
      manager.set('features.cache.enabled', true);

      expect(manager.getChangeCount()).toBe(4);

      manager.reset('llm.timeoutMs');
      manager.reset('features.cache.enabled');

      expect(manager.getChangeCount()).toBe(2);

      const diff = manager.getDiff();
      const paths = diff.map((c) => c.path);
      expect(paths).toContain('llm.enabled');
      expect(paths).toContain('llm.maxRetries');
      expect(paths).not.toContain('llm.timeoutMs');
      expect(paths).not.toContain('features.cache.enabled');
    });

    it('should maintain independent config isolation', () => {
      const snapshot1 = manager.getSnapshot();

      manager.set('llm.timeoutMs', 60000);

      const snapshot2 = manager.getSnapshot();

      expect(snapshot1.llm.timeoutMs).toBe(30000);
      expect(snapshot2.llm.timeoutMs).toBe(60000);

      // Modifying snapshots shouldn't affect manager
      snapshot1.llm.timeoutMs = 11111;
      snapshot2.llm.timeoutMs = 22222;

      expect(manager.get('llm.timeoutMs')).toBe(60000);
    });

    it('should handle subscribers during resetAll', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      manager.subscribe('llm.timeoutMs', listener1);
      manager.subscribe('llm.enabled', listener2);
      manager.subscribe('features.cache.enabled', listener3);

      manager.set('llm.timeoutMs', 60000);
      manager.set('llm.enabled', false);
      manager.set('features.cache.enabled', true);

      listener1.mockClear();
      listener2.mockClear();
      listener3.mockClear();

      manager.resetAll();

      expect(listener1).toHaveBeenCalledWith(30000, 60000, 'llm.timeoutMs');
      expect(listener2).toHaveBeenCalledWith(true, false, 'llm.enabled');
      expect(listener3).toHaveBeenCalledWith(false, true, 'features.cache.enabled');
    });
  });
});
