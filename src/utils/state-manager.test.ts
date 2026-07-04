import { describe, it, expect, vi } from 'vitest';
import { StateManager } from './state-manager.js';

describe('StateManager', () => {
  describe('getOrCreate', () => {
    it('should create state using factory when key does not exist', () => {
      const manager = new StateManager<{ count: number }>();
      const factory = vi.fn(() => ({ count: 0 }));

      const state = manager.getOrCreate('key1', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(state).toEqual({ count: 0 });
    });

    it('should return existing state without calling factory', () => {
      const manager = new StateManager<{ count: number }>();
      const factory = vi.fn(() => ({ count: 0 }));

      const state1 = manager.getOrCreate('key1', factory);
      state1.count = 5;
      const state2 = manager.getOrCreate('key1', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(state2).toBe(state1);
      expect(state2.count).toBe(5);
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent key', () => {
      const manager = new StateManager<string>();
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('should return stored state', () => {
      const manager = new StateManager<string>();
      manager.set('key', 'value');
      expect(manager.get('key')).toBe('value');
    });
  });

  describe('set', () => {
    it('should store state', () => {
      const manager = new StateManager<number>();
      manager.set('key', 42);
      expect(manager.get('key')).toBe(42);
    });

    it('should overwrite existing state', () => {
      const manager = new StateManager<number>();
      manager.set('key', 1);
      manager.set('key', 2);
      expect(manager.get('key')).toBe(2);
    });
  });

  describe('has', () => {
    it('should return false for non-existent key', () => {
      const manager = new StateManager<string>();
      expect(manager.has('nonexistent')).toBe(false);
    });

    it('should return true for existing key', () => {
      const manager = new StateManager<string>();
      manager.set('key', 'value');
      expect(manager.has('key')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should return false when deleting non-existent key', () => {
      const manager = new StateManager<string>();
      expect(manager.delete('nonexistent')).toBe(false);
    });

    it('should delete existing key and return true', () => {
      const manager = new StateManager<string>();
      manager.set('key', 'value');
      expect(manager.delete('key')).toBe(true);
      expect(manager.has('key')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const manager = new StateManager<string>();
      manager.set('key1', 'value1');
      manager.set('key2', 'value2');

      manager.clear();

      expect(manager.has('key1')).toBe(false);
      expect(manager.has('key2')).toBe(false);
      expect(manager.size).toBe(0);
    });
  });

  describe('entries', () => {
    it('should iterate over all entries', () => {
      const manager = new StateManager<number>();
      manager.set('a', 1);
      manager.set('b', 2);
      manager.set('c', 3);

      const entries = Array.from(manager.entries());

      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
      expect(entries).toContainEqual(['c', 3]);
    });
  });

  describe('size', () => {
    it('should return 0 for empty manager', () => {
      const manager = new StateManager<string>();
      expect(manager.size).toBe(0);
    });

    it('should return correct count', () => {
      const manager = new StateManager<string>();
      manager.set('a', 'x');
      manager.set('b', 'y');
      expect(manager.size).toBe(2);
    });
  });
});
