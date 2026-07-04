import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createLogger, type Logger, type LogArg } from '../logger.js';

describe('logger type handling', () => {
  let logger: Logger;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Disable file logging during tests to prevent polluting production logs
    vi.stubEnv('LOG_TO_FILE', 'false');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    // Note: MIN_LOG_LEVEL is computed at module load time, so setting LOG_LEVEL
    // here doesn't affect the already-loaded logger module.
    // The test expectations need to account for this.

    // Create logger with test context
    logger = createLogger('TypeTest');

    // Spy on console methods to verify output
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('string messages', () => {
    it('should accept string messages', () => {
      expect(() => logger.info('Test message')).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
    });

    it('should accept empty string messages', () => {
      expect(() => logger.info('')).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should accept multi-line string messages', () => {
      const multiLine = 'Line 1\nLine 2\nLine 3';
      expect(() => logger.info(multiLine)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(multiLine)
      );
    });

    it('should accept string messages with special characters', () => {
      const specialChars = 'Test with 特殊字符 and émojis 🚀';
      expect(() => logger.info(specialChars)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(specialChars)
      );
    });
  });

  describe('primitive type arguments', () => {
    it('should accept number arguments', () => {
      expect(() => logger.info('Count:', 42)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('42')
      );
    });

    it('should accept negative numbers', () => {
      expect(() => logger.info('Temp:', -15)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('-15')
      );
    });

    it('should accept floating point numbers', () => {
      expect(() => logger.info('Pi:', 3.14159)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('3.14159')
      );
    });

    it('should accept boolean arguments', () => {
      expect(() => logger.info('Flag:', true)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('true')
      );

      consoleLogSpy.mockClear();
      expect(() => logger.info('Flag:', false)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('false')
      );
    });

    it('should accept multiple primitive arguments', () => {
      expect(() => logger.info('Values:', 42, true, 'text', 3.14)).not.toThrow();
      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('42');
      expect(call).toContain('true');
      expect(call).toContain('text');
      expect(call).toContain('3.14');
    });
  });

  describe('object arguments', () => {
    it('should accept plain objects', () => {
      const obj = { key: 'value', count: 42 };
      expect(() => logger.info('Data:', obj)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(obj))
      );
    });

    it('should accept empty objects', () => {
      expect(() => logger.info('Empty:', {})).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('{}')
      );
    });

    it('should accept nested objects', () => {
      const nested = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: 10001,
          },
        },
      };
      expect(() => logger.info('User:', nested)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(nested))
      );
    });

    it('should accept objects with mixed types', () => {
      const mixed = {
        str: 'text',
        num: 42,
        bool: true,
        nil: null,
        arr: [1, 2, 3],
        obj: { nested: true },
      };
      expect(() => logger.info('Mixed:', mixed)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(mixed))
      );
    });

    it('should accept objects with unknown values', () => {
      const obj: Record<string, unknown> = {
        data: 'value',
        unknown: undefined,
      };
      expect(() => logger.info('Object:', obj)).not.toThrow();
    });
  });

  describe('array arguments', () => {
    it('should accept arrays of primitives', () => {
      const arr = [1, 2, 3, 4, 5];
      expect(() => logger.info('Numbers:', arr)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(arr))
      );
    });

    it('should accept empty arrays', () => {
      expect(() => logger.info('Empty:', [])).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[]')
      );
    });

    it('should accept arrays of objects', () => {
      const arr = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      expect(() => logger.info('Users:', arr)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(arr))
      );
    });

    it('should accept nested arrays', () => {
      const nested = [[1, 2], [3, 4], [5, 6]];
      expect(() => logger.info('Matrix:', nested)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(nested))
      );
    });

    it('should accept arrays with mixed types', () => {
      const mixed = [1, 'two', true, null, { key: 'value' }];
      expect(() => logger.info('Mixed:', mixed)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(mixed))
      );
    });
  });

  describe('Error objects', () => {
    it('should accept Error instances', () => {
      const error = new Error('Test error');
      expect(() => logger.error('Failed:', error)).not.toThrow();
      // Error objects serialize to {} because Error properties are not enumerable
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed:')
      );
    });

    it('should accept Error instances with stack traces', () => {
      const error = new Error('Stack test');
      error.stack = 'Error: Stack test\n  at test.ts:123:45';
      expect(() => logger.error('Exception:', error)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should accept custom Error subclasses', () => {
      class CustomError extends Error {
        code = 'CUSTOM_ERROR';
      }
      const error = new CustomError('Custom error');
      expect(() => logger.error('Custom:', error)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should accept TypeError instances', () => {
      const error = new TypeError('Type mismatch');
      expect(() => logger.error('Type error:', error)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should accept RangeError instances', () => {
      const error = new RangeError('Out of range');
      expect(() => logger.error('Range error:', error)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('null and undefined handling', () => {
    it('should accept null arguments', () => {
      expect(() => logger.info('Null:', null)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('null')
      );
    });

    it('should accept undefined arguments', () => {
      expect(() => logger.info('Undefined:', undefined)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('undefined')
      );
    });

    it('should accept objects with null values', () => {
      const obj = { value: null };
      expect(() => logger.info('Object:', obj)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(obj))
      );
    });

    it('should accept objects with undefined values', () => {
      const obj = { value: undefined };
      expect(() => logger.info('Object:', obj)).not.toThrow();
    });

    it('should accept arrays with null elements', () => {
      const arr = [1, null, 3, null, 5];
      expect(() => logger.info('Array:', arr)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(arr))
      );
    });

    it('should accept arrays with undefined elements', () => {
      const arr = [1, undefined, 3, undefined, 5];
      expect(() => logger.info('Array:', arr)).not.toThrow();
    });
  });

  describe('complex nested objects', () => {
    it('should serialize deeply nested objects', () => {
      const deep = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      };
      expect(() => logger.info('Deep:', deep)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(deep))
      );
    });

    it('should serialize objects with arrays and nested objects', () => {
      const complex = {
        users: [
          { id: 1, tags: ['admin', 'user'], meta: { active: true } },
          { id: 2, tags: ['user'], meta: { active: false } },
        ],
        settings: {
          theme: 'dark',
          features: ['feature1', 'feature2'],
          limits: { max: 100, min: 0 },
        },
      };
      expect(() => logger.info('Complex:', complex)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(complex))
      );
    });

    it('should serialize objects with various data types', () => {
      const diverse = {
        string: 'text',
        number: 42,
        float: 3.14,
        boolean: true,
        null: null,
        undefined: undefined,
        array: [1, 2, 3],
        object: { nested: true },
        date: new Date('2024-01-01'),
      };
      expect(() => logger.info('Diverse:', diverse)).not.toThrow();
    });

    it('should throw on objects with circular references', () => {
      const circular: Record<string, unknown> = { name: 'circular' };
      circular.self = circular;

      // JSON.stringify will throw on circular references
      // The logger does not currently handle this edge case
      expect(() => logger.info('Circular:', circular)).toThrow(
        /circular structure/i
      );
    });
  });

  describe('multiple arguments', () => {
    it('should accept multiple mixed type arguments', () => {
      expect(() =>
        logger.info(
          'Mixed args:',
          42,
          'text',
          true,
          { obj: 'value' },
          [1, 2, 3],
          null,
          undefined
        )
      ).not.toThrow();
    });

    it('should serialize all arguments correctly', () => {
      const obj = { key: 'value' };
      const arr = [1, 2, 3];
      logger.info('Multiple:', obj, arr, 42, 'text');

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain(JSON.stringify(obj));
      expect(call).toContain(JSON.stringify(arr));
      expect(call).toContain('42');
      expect(call).toContain('text');
    });

    it('should handle many arguments', () => {
      const args: LogArg[] = Array.from({ length: 20 }, (_, i) => i);
      expect(() => logger.info('Many args:', ...args)).not.toThrow();
    });
  });

  describe('log level methods', () => {
    it('should accept typed arguments in debug method', () => {
      expect(() => logger.debug('Debug:', { data: 'value' })).not.toThrow();
      // Note: console.log may not be called if debug level is filtered out
      // This test verifies type compatibility, not log output
    });

    it('should accept typed arguments in info method', () => {
      expect(() => logger.info('Info:', { data: 'value' })).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should accept typed arguments in warn method', () => {
      expect(() => logger.warn('Warning:', { data: 'value' })).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should accept typed arguments in error method', () => {
      expect(() => logger.error('Error:', { data: 'value' })).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('LogArg type coverage', () => {
    it('should accept all LogArg union types', () => {
      const stringArg: LogArg = 'string';
      const numberArg: LogArg = 42;
      const booleanArg: LogArg = true;
      const nullArg: LogArg = null;
      const undefinedArg: LogArg = undefined;
      const errorArg: LogArg = new Error('test');
      const recordArg: LogArg = { key: 'value' };
      const arrayArg: LogArg = [1, 2, 3];

      expect(() =>
        logger.info(
          'All types:',
          stringArg,
          numberArg,
          booleanArg,
          nullArg,
          undefinedArg,
          errorArg,
          recordArg,
          arrayArg
        )
      ).not.toThrow();
    });

    it('should accept unknown type through LogArg', () => {
      const unknownValue: unknown = 'could be anything';
      const unknownArg: LogArg = unknownValue;

      expect(() => logger.info('Unknown:', unknownArg)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10000);
      expect(() => logger.info('Long:', longString)).not.toThrow();
    });

    it('should handle very large objects', () => {
      const largeObj = Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`key${i}`, `value${i}`])
      );
      expect(() => logger.info('Large:', largeObj)).not.toThrow();
    });

    it('should handle very large arrays', () => {
      const largeArr = Array.from({ length: 1000 }, (_, i) => i);
      expect(() => logger.info('Large array:', largeArr)).not.toThrow();
    });

    it('should handle objects with special property names', () => {
      const obj = {
        '__proto__': 'value1',
        'constructor': 'value2',
        'prototype': 'value3',
        '': 'empty key',
        '123': 'numeric key',
      };
      expect(() => logger.info('Special props:', obj)).not.toThrow();
    });

    it('should throw on BigInt values in objects', () => {
      const obj = { big: BigInt(9007199254740991) };
      // BigInt cannot be serialized by JSON.stringify by default
      // The logger does not currently handle this edge case
      expect(() => logger.info('BigInt:', obj)).toThrow(
        /serialize a BigInt/i
      );
    });

    it('should handle Symbol values in objects', () => {
      const sym = Symbol('test');
      const obj = { [sym]: 'symbol value', regular: 'value' };
      // Symbols are ignored by JSON.stringify
      expect(() => logger.info('Symbol:', obj)).not.toThrow();
    });

    it('should handle Function values in objects', () => {
      const obj = {
        fn: () => 'function',
        regular: 'value',
      };
      // Functions are ignored by JSON.stringify
      expect(() => logger.info('Function:', obj)).not.toThrow();
    });

    it('should handle Map objects', () => {
      const map = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      // Map serializes as {}
      expect(() => logger.info('Map:', map)).not.toThrow();
    });

    it('should handle Set objects', () => {
      const set = new Set([1, 2, 3]);
      // Set serializes as {}
      expect(() => logger.info('Set:', set)).not.toThrow();
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      expect(() => logger.info('Date:', date)).not.toThrow();
    });

    it('should handle RegExp objects', () => {
      const regex = /test/gi;
      expect(() => logger.info('RegExp:', regex)).not.toThrow();
    });
  });
});
