import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShutdownRegistry } from './shutdown-registry.js';

// Mock logger before importing
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ShutdownRegistry', () => {
  let registry: ShutdownRegistry;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useRealTimers();
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    registry = new ShutdownRegistry(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('register', () => {
    it('should register a handler', () => {
      registry.register('test', () => {});
      expect(registry.size).toBe(1);
      expect(registry.handlerNames).toContain('test');
    });

    it('should register multiple handlers', () => {
      registry.register('first', () => {}, 10);
      registry.register('second', () => {}, 20);
      registry.register('third', () => {}, 5);

      expect(registry.size).toBe(3);
      // Should be sorted by priority
      expect(registry.handlerNames).toEqual(['third', 'first', 'second']);
    });

    it('should sort handlers by priority', () => {
      registry.register('low', () => {}, 100);
      registry.register('high', () => {}, 1);
      registry.register('medium', () => {}, 50);

      expect(registry.handlerNames).toEqual(['high', 'medium', 'low']);
    });
  });

  describe('unregister', () => {
    it('should remove a registered handler', () => {
      registry.register('test', () => {});
      expect(registry.size).toBe(1);

      registry.unregister('test');
      expect(registry.size).toBe(0);
      expect(registry.handlerNames).not.toContain('test');
    });

    it('should do nothing if handler does not exist', () => {
      registry.register('test', () => {});
      registry.unregister('nonexistent');
      expect(registry.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all handlers', () => {
      registry.register('first', () => {});
      registry.register('second', () => {});
      registry.register('third', () => {});

      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe('shutdownAll', () => {
    it('should execute handlers in priority order', async () => {
      const executionOrder: string[] = [];

      registry.register('first', () => {
        executionOrder.push('first');
      }, 10);
      registry.register('second', () => {
        executionOrder.push('second');
      }, 20);
      registry.register('third', () => {
        executionOrder.push('third');
      }, 5);

      // The shutdown will throw due to our mock
      await expect(registry.shutdownAll('SIGTERM')).rejects.toThrow('process.exit called');

      expect(executionOrder).toEqual(['third', 'first', 'second']);
    });

    it('should handle async handlers', async () => {
      const executionOrder: string[] = [];

      registry.register('async', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        executionOrder.push('async');
      }, 10);

      registry.register('sync', () => {
        executionOrder.push('sync');
      }, 20);

      await expect(registry.shutdownAll('SIGTERM')).rejects.toThrow('process.exit called');

      expect(executionOrder).toEqual(['async', 'sync']);
    });

    it('should continue even if a handler throws an error', async () => {
      const executionOrder: string[] = [];

      registry.register('failing', () => {
        executionOrder.push('failing');
        throw new Error('Handler error');
      }, 10);

      registry.register('after', () => {
        executionOrder.push('after');
      }, 20);

      await expect(registry.shutdownAll('SIGTERM')).rejects.toThrow('process.exit called');

      expect(executionOrder).toEqual(['failing', 'after']);
    });

    it('should prevent multiple shutdown calls', async () => {
      const callCount = { value: 0 };

      registry.register('test', () => {
        callCount.value++;
      });

      // Start first shutdown
      const firstShutdown = registry.shutdownAll('SIGTERM').catch(() => {});

      // Try second shutdown (should be ignored)
      const secondShutdown = registry.shutdownAll('SIGINT').catch(() => {});

      await Promise.all([firstShutdown, secondShutdown]);

      expect(callCount.value).toBe(1);
    });

    it('should call process.exit(0) on success', async () => {
      registry.register('test', () => {});

      await expect(registry.shutdownAll('SIGTERM')).rejects.toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should skip handler that exceeds per-handler timeout and continue', async () => {
      const perHandlerTimeout = 100;
      const timeoutRegistry = new ShutdownRegistry(5000, perHandlerTimeout);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const executionOrder: string[] = [];

      timeoutRegistry.register('slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        executionOrder.push('slow');
      }, 10);

      timeoutRegistry.register('fast', () => {
        executionOrder.push('fast');
      }, 20);

      await expect(timeoutRegistry.shutdownAll('SIGTERM')).rejects.toThrow('process.exit called');

      // 'slow' should have been skipped due to timeout, 'fast' should still run
      expect(executionOrder).toEqual(['fast']);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('size', () => {
    it('should return the number of registered handlers', () => {
      expect(registry.size).toBe(0);

      registry.register('first', () => {});
      expect(registry.size).toBe(1);

      registry.register('second', () => {});
      expect(registry.size).toBe(2);
    });
  });

  describe('handlerNames', () => {
    it('should return handler names in priority order', () => {
      registry.register('c', () => {}, 30);
      registry.register('a', () => {}, 10);
      registry.register('b', () => {}, 20);

      expect(registry.handlerNames).toEqual(['a', 'b', 'c']);
    });
  });
});
