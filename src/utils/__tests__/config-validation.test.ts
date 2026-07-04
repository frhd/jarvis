import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseIntWithBounds,
  parseFloatWithBounds,
  ConfigParsers,
} from '../config-validation';

describe('config-validation', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('parseIntWithBounds', () => {
    it('should return parsed value when valid', () => {
      expect(parseIntWithBounds('42', 0)).toBe(42);
      expect(parseIntWithBounds('100', 50)).toBe(100);
    });

    it('should return default for undefined value', () => {
      expect(parseIntWithBounds(undefined, 10)).toBe(10);
    });

    it('should return default for empty string', () => {
      expect(parseIntWithBounds('', 10)).toBe(10);
    });

    it('should return default for NaN', () => {
      expect(parseIntWithBounds('abc', 15)).toBe(15);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should clamp to minimum', () => {
      expect(parseIntWithBounds('5', 20, { min: 10 })).toBe(10);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should clamp to maximum', () => {
      expect(parseIntWithBounds('100', 20, { max: 50 })).toBe(50);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should return value within bounds', () => {
      expect(parseIntWithBounds('25', 10, { min: 20, max: 30 })).toBe(25);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should include name in warning message', () => {
      parseIntWithBounds('abc', 10, { name: 'testValue' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('testValue')
      );
    });
  });

  describe('parseFloatWithBounds', () => {
    it('should return parsed value when valid', () => {
      expect(parseFloatWithBounds('3.14', 0)).toBeCloseTo(3.14);
      expect(parseFloatWithBounds('0.5', 1)).toBeCloseTo(0.5);
    });

    it('should return default for undefined value', () => {
      expect(parseFloatWithBounds(undefined, 1.5)).toBeCloseTo(1.5);
    });

    it('should return default for NaN', () => {
      expect(parseFloatWithBounds('xyz', 2.5)).toBeCloseTo(2.5);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should clamp to minimum', () => {
      expect(parseFloatWithBounds('-1', 0.5, { min: 0 })).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should clamp to maximum', () => {
      expect(parseFloatWithBounds('10', 1, { max: 5 })).toBe(5);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should return value within bounds', () => {
      expect(parseFloatWithBounds('0.7', 0.5, { min: 0, max: 1 })).toBeCloseTo(0.7);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('ConfigParsers', () => {
    describe('timeout', () => {
      it('should return valid timeout', () => {
        expect(ConfigParsers.timeout('5000', 30000)).toBe(5000);
      });

      it('should clamp to minimum (1000ms)', () => {
        expect(ConfigParsers.timeout('500', 30000)).toBe(1000);
      });

      it('should clamp to maximum (11700000ms)', () => {
        expect(ConfigParsers.timeout('9999999999', 30000)).toBe(11700000);
      });

      it('should return default for invalid value', () => {
        expect(ConfigParsers.timeout('invalid', 30000)).toBe(30000);
      });
    });

    describe('retryAttempts', () => {
      it('should return valid retry attempts', () => {
        expect(ConfigParsers.retryAttempts('3', 5)).toBe(3);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.retryAttempts('0', 5)).toBe(1);
      });

      it('should clamp to maximum (10)', () => {
        expect(ConfigParsers.retryAttempts('20', 5)).toBe(10);
      });
    });

    describe('temperature', () => {
      it('should return valid temperature', () => {
        expect(ConfigParsers.temperature('0.7', 0.3)).toBeCloseTo(0.7);
      });

      it('should clamp to minimum (0)', () => {
        expect(ConfigParsers.temperature('-0.5', 0.3)).toBe(0);
      });

      it('should clamp to maximum (2)', () => {
        expect(ConfigParsers.temperature('3', 0.3)).toBe(2);
      });
    });

    describe('port', () => {
      it('should return valid port', () => {
        expect(ConfigParsers.port('3000', 8080)).toBe(3000);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.port('0', 8080)).toBe(1);
      });

      it('should clamp to maximum (65535)', () => {
        expect(ConfigParsers.port('70000', 8080)).toBe(65535);
      });
    });

    describe('percentage', () => {
      it('should return valid percentage', () => {
        expect(ConfigParsers.percentage('50', 85)).toBe(50);
      });

      it('should clamp to minimum (0)', () => {
        expect(ConfigParsers.percentage('-10', 85)).toBe(0);
      });

      it('should clamp to maximum (100)', () => {
        expect(ConfigParsers.percentage('150', 85)).toBe(100);
      });
    });

    describe('maxTokens', () => {
      it('should return valid max tokens', () => {
        expect(ConfigParsers.maxTokens('2048', 1024)).toBe(2048);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.maxTokens('0', 1024)).toBe(1);
      });

      it('should clamp to maximum (100000)', () => {
        expect(ConfigParsers.maxTokens('200000', 1024)).toBe(100000);
      });
    });

    describe('retentionDays', () => {
      it('should return valid retention days', () => {
        expect(ConfigParsers.retentionDays('30', 7)).toBe(30);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.retentionDays('0', 7)).toBe(1);
      });

      it('should clamp to maximum (365)', () => {
        expect(ConfigParsers.retentionDays('500', 7)).toBe(365);
      });
    });

    describe('similarityThreshold', () => {
      it('should return valid similarity threshold', () => {
        expect(ConfigParsers.similarityThreshold('0.85', 0.7)).toBeCloseTo(0.85);
      });

      it('should clamp to minimum (0)', () => {
        expect(ConfigParsers.similarityThreshold('-0.1', 0.7)).toBe(0);
      });

      it('should clamp to maximum (1)', () => {
        expect(ConfigParsers.similarityThreshold('1.5', 0.7)).toBe(1);
      });
    });

    describe('backoffMultiplier', () => {
      it('should return valid multiplier', () => {
        expect(ConfigParsers.backoffMultiplier('2', 1.5)).toBe(2);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.backoffMultiplier('0.5', 2)).toBe(1);
      });

      it('should clamp to maximum (10)', () => {
        expect(ConfigParsers.backoffMultiplier('15', 2)).toBe(10);
      });
    });

    describe('jitterFactor', () => {
      it('should return valid jitter factor', () => {
        expect(ConfigParsers.jitterFactor('0.25', 0.1)).toBeCloseTo(0.25);
      });

      it('should clamp to minimum (0)', () => {
        expect(ConfigParsers.jitterFactor('-0.1', 0.1)).toBe(0);
      });

      it('should clamp to maximum (1)', () => {
        expect(ConfigParsers.jitterFactor('1.5', 0.1)).toBe(1);
      });
    });

    describe('positiveInt', () => {
      it('should return valid positive int', () => {
        expect(ConfigParsers.positiveInt('5', 10)).toBe(5);
      });

      it('should clamp to minimum (1)', () => {
        expect(ConfigParsers.positiveInt('0', 10)).toBe(1);
      });

      it('should respect optional max', () => {
        expect(ConfigParsers.positiveInt('100', 10, 50)).toBe(50);
      });
    });

    describe('nonNegativeInt', () => {
      it('should return valid non-negative int', () => {
        expect(ConfigParsers.nonNegativeInt('5', 10)).toBe(5);
      });

      it('should clamp to minimum (0)', () => {
        expect(ConfigParsers.nonNegativeInt('-5', 10)).toBe(0);
      });

      it('should allow zero', () => {
        expect(ConfigParsers.nonNegativeInt('0', 10)).toBe(0);
      });

      it('should respect optional max', () => {
        expect(ConfigParsers.nonNegativeInt('100', 10, 50)).toBe(50);
      });
    });
  });
});
