import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryStrategyService } from './retryStrategy.service';
import { RetryConfig, DEFAULT_RETRY_CONFIG } from '../types/queue.types';

describe('RetryStrategyService', () => {
  let service: RetryStrategyService;

  beforeEach(() => {
    service = new RetryStrategyService();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new RetryStrategyService();
      const config = defaultService.getConfig();

      expect(config.maxAttempts).toBe(DEFAULT_RETRY_CONFIG.maxAttempts);
      expect(config.baseDelayMs).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
      expect(config.maxDelayMs).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
      expect(config.backoffMultiplier).toBe(DEFAULT_RETRY_CONFIG.backoffMultiplier);
      expect(config.jitterFactor).toBe(DEFAULT_RETRY_CONFIG.jitterFactor);
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<RetryConfig> = {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 3,
        jitterFactor: 0.5,
      };

      const customService = new RetryStrategyService(customConfig);
      const config = customService.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelayMs).toBe(2000);
      expect(config.maxDelayMs).toBe(60000);
      expect(config.backoffMultiplier).toBe(3);
      expect(config.jitterFactor).toBe(0.5);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig: Partial<RetryConfig> = {
        maxAttempts: 10,
      };

      const customService = new RetryStrategyService(partialConfig);
      const config = customService.getConfig();

      expect(config.maxAttempts).toBe(10);
      expect(config.baseDelayMs).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
      expect(config.backoffMultiplier).toBe(DEFAULT_RETRY_CONFIG.backoffMultiplier);
    });
  });

  describe('calculateNextRetryDelay - exponential backoff', () => {
    it('should calculate exponential backoff correctly without jitter', () => {
      const noJitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      expect(noJitterService.calculateNextRetryDelay(1)).toBe(2000); // 1000 * 2^1
      expect(noJitterService.calculateNextRetryDelay(2)).toBe(4000); // 1000 * 2^2
      expect(noJitterService.calculateNextRetryDelay(3)).toBe(8000); // 1000 * 2^3
      expect(noJitterService.calculateNextRetryDelay(4)).toBe(16000); // 1000 * 2^4
      expect(noJitterService.calculateNextRetryDelay(5)).toBe(32000); // 1000 * 2^5
    });

    it('should use base delay configuration', () => {
      const customBaseService = new RetryStrategyService({
        baseDelayMs: 500,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 3,
      });

      expect(customBaseService.calculateNextRetryDelay(1)).toBe(1000); // 500 * 2^1
      expect(customBaseService.calculateNextRetryDelay(2)).toBe(2000); // 500 * 2^2
    });

    it('should use multiplier configuration', () => {
      const customMultiplierService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 3,
        jitterFactor: 0,
        maxAttempts: 4,
      });

      expect(customMultiplierService.calculateNextRetryDelay(1)).toBe(3000); // 1000 * 3^1
      expect(customMultiplierService.calculateNextRetryDelay(2)).toBe(9000); // 1000 * 3^2
      expect(customMultiplierService.calculateNextRetryDelay(3)).toBe(27000); // 1000 * 3^3
    });

    it('should handle invalid attempt numbers by treating them as attempt 1', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxDelayMs: 60000,
        maxAttempts: 5,
      });

      const delay0 = testService.calculateNextRetryDelay(0);
      const delayNegative = testService.calculateNextRetryDelay(-5);

      expect(delay0).toBeGreaterThan(0);
      expect(delayNegative).toBeGreaterThan(0);
      expect(delay0).toBe(2000); // Should be treated as attempt 1
      expect(delayNegative).toBe(2000); // Should be treated as attempt 1
    });

    it('should return rounded delay values', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1500,
        backoffMultiplier: 1.5,
        jitterFactor: 0,
        maxDelayMs: 60000,
        maxAttempts: 5,
      });

      const delay = testService.calculateNextRetryDelay(1);
      expect(delay).toBe(Math.round(1500 * 1.5)); // Should be rounded
      expect(Number.isInteger(delay)).toBe(true);
    });
  });

  describe('calculateNextRetryDelay - jitter application', () => {
    it('should apply jitter within expected bounds', () => {
      const jitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.25, // ±25%
        maxAttempts: 5,
      });

      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        delays.push(jitterService.calculateNextRetryDelay(1));
      }

      const min = Math.min(...delays);
      const max = Math.max(...delays);

      // Expected: 2000ms ± 25% = [1500, 2500]
      expect(min).toBeGreaterThanOrEqual(1500);
      expect(max).toBeLessThanOrEqual(2500);
    });

    it('should produce varying delays with jitter', () => {
      const jitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.2,
        maxAttempts: 5,
      });

      const delays = new Set<number>();
      for (let i = 0; i < 50; i++) {
        delays.add(jitterService.calculateNextRetryDelay(1));
      }

      // With jitter, we should get multiple different values
      expect(delays.size).toBeGreaterThan(5);
    });

    it('should keep jittered delays within min/max bounds', () => {
      const jitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0.5,
        maxAttempts: 5,
      });

      for (let i = 0; i < 100; i++) {
        const delay = jitterService.calculateNextRetryDelay(4); // Would be 16000 without cap
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(10000); // Should be capped
      }
    });

    it('should never produce negative delays', () => {
      const extremeJitterService = new RetryStrategyService({
        baseDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 1.0, // 100% jitter (extreme case)
        maxAttempts: 5,
      });

      for (let i = 0; i < 100; i++) {
        const delay = extremeJitterService.calculateNextRetryDelay(1);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('calculateNextRetryDelay - delay capping', () => {
    it('should cap delay at maxDelayMs', () => {
      const cappedService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 10,
      });

      // Attempt 4: 1000 * 2^4 = 16000, should be capped at 10000
      expect(cappedService.calculateNextRetryDelay(4)).toBe(10000);
      expect(cappedService.calculateNextRetryDelay(5)).toBe(10000);
      expect(cappedService.calculateNextRetryDelay(10)).toBe(10000);
    });

    it('should cap delays that exceed maximum even with jitter', () => {
      const cappedJitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0.5,
        maxAttempts: 10,
      });

      for (let i = 0; i < 100; i++) {
        const delay = cappedJitterService.calculateNextRetryDelay(5);
        expect(delay).toBeLessThanOrEqual(5000);
      }
    });

    it('should not cap delays below maximum', () => {
      const service = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 100000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      expect(service.calculateNextRetryDelay(1)).toBe(2000);
      expect(service.calculateNextRetryDelay(2)).toBe(4000);
      expect(service.calculateNextRetryDelay(3)).toBe(8000);
    });
  });

  describe('calculateNextRetryTime', () => {
    it('should return a future date', () => {
      const now = Date.now();
      const nextRetryTime = service.calculateNextRetryTime(1);

      expect(nextRetryTime.getTime()).toBeGreaterThan(now);
    });

    it('should return date offset by calculated delay', () => {
      const noJitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      const now = Date.now();
      const nextRetryTime = noJitterService.calculateNextRetryTime(1);
      const expectedTime = now + 2000; // 1000 * 2^1

      // Allow small timing difference (within 100ms)
      expect(nextRetryTime.getTime()).toBeGreaterThanOrEqual(now + 1900);
      expect(nextRetryTime.getTime()).toBeLessThanOrEqual(now + 2100);
    });

    it('should incorporate jitter into retry time', () => {
      const jitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.25,
        maxAttempts: 5,
      });

      const retryTimes: number[] = [];
      for (let i = 0; i < 50; i++) {
        retryTimes.push(jitterService.calculateNextRetryTime(1).getTime());
      }

      // Should have variation due to jitter
      const uniqueTimes = new Set(retryTimes);
      expect(uniqueTimes.size).toBeGreaterThan(5);
    });
  });

  describe('shouldRetry - maximum retry attempts', () => {
    it('should allow retry when under max attempts', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(testService.shouldRetry(1)).toBe(true);
      expect(testService.shouldRetry(2)).toBe(true);
      expect(testService.shouldRetry(3)).toBe(true);
      expect(testService.shouldRetry(4)).toBe(true);
    });

    it('should reject retry when at or over max attempts', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(testService.shouldRetry(5)).toBe(false);
      expect(testService.shouldRetry(6)).toBe(false);
      expect(testService.shouldRetry(100)).toBe(false);
    });

    it('should respect custom max attempts configuration', () => {
      const shortRetryService = new RetryStrategyService({
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(shortRetryService.shouldRetry(1)).toBe(true);
      expect(shortRetryService.shouldRetry(2)).toBe(true);
      expect(shortRetryService.shouldRetry(3)).toBe(false);
      expect(shortRetryService.shouldRetry(4)).toBe(false);
    });
  });

  describe('shouldRetry - non-retryable error detection', () => {
    it('should reject retry for VALIDATION_ERROR', () => {
      const error = new Error('VALIDATION_ERROR: invalid input format');
      expect(service.shouldRetry(1, error)).toBe(false);
    });

    it('should reject retry for INVALID_INPUT', () => {
      const error = new Error('INVALID_INPUT: malformed request');
      expect(service.shouldRetry(1, error)).toBe(false);
    });

    it('should reject retry for PERMISSION_DENIED', () => {
      const error = new Error('PERMISSION_DENIED: insufficient privileges');
      expect(service.shouldRetry(1, error)).toBe(false);
    });

    it('should reject retry for NOT_FOUND', () => {
      const error = new Error('NOT_FOUND: resource does not exist');
      expect(service.shouldRetry(1, error)).toBe(false);
    });

    it('should detect non-retryable errors case-insensitively', () => {
      const lowerCase = new Error('validation_error: bad data');
      const mixedCase = new Error('Permission_Denied: no access');

      expect(service.shouldRetry(1, lowerCase)).toBe(false);
      expect(service.shouldRetry(1, mixedCase)).toBe(false);
    });

    it('should allow retry for retryable errors', () => {
      const timeout = new Error('TIMEOUT: request timed out');
      const network = new Error('NETWORK_ERROR: connection lost');
      const unavailable = new Error('SERVICE_UNAVAILABLE: try again');

      expect(service.shouldRetry(1, timeout)).toBe(true);
      expect(service.shouldRetry(1, network)).toBe(true);
      expect(service.shouldRetry(1, unavailable)).toBe(true);
    });

    it('should allow retry when no error is provided', () => {
      expect(service.shouldRetry(1)).toBe(true);
      expect(service.shouldRetry(2)).toBe(true);
    });

    it('should prioritize max attempts check over error type', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      const retryableError = new Error('TIMEOUT: network issue');

      // Should reject due to max attempts, even with retryable error
      expect(testService.shouldRetry(3, retryableError)).toBe(false);
      expect(testService.shouldRetry(4, retryableError)).toBe(false);
    });
  });

  describe('getRetryBudgetRemaining', () => {
    it('should calculate remaining attempts correctly', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(testService.getRetryBudgetRemaining(0)).toBe(5);
      expect(testService.getRetryBudgetRemaining(1)).toBe(4);
      expect(testService.getRetryBudgetRemaining(2)).toBe(3);
      expect(testService.getRetryBudgetRemaining(3)).toBe(2);
      expect(testService.getRetryBudgetRemaining(4)).toBe(1);
      expect(testService.getRetryBudgetRemaining(5)).toBe(0);
    });

    it('should never return negative values', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(testService.getRetryBudgetRemaining(6)).toBe(0);
      expect(testService.getRetryBudgetRemaining(10)).toBe(0);
      expect(testService.getRetryBudgetRemaining(100)).toBe(0);
    });

    it('should respect custom max attempts', () => {
      const customService = new RetryStrategyService({
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      expect(customService.getRetryBudgetRemaining(0)).toBe(10);
      expect(customService.getRetryBudgetRemaining(5)).toBe(5);
      expect(customService.getRetryBudgetRemaining(10)).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const customConfig: Partial<RetryConfig> = {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 3,
        jitterFactor: 0.5,
      };

      const testService = new RetryStrategyService(customConfig);
      const config = testService.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelayMs).toBe(2000);
      expect(config.maxDelayMs).toBe(60000);
      expect(config.backoffMultiplier).toBe(3);
      expect(config.jitterFactor).toBe(0.5);
    });

    it('should return a copy of config, not reference', () => {
      const config = service.getConfig();
      config.maxAttempts = 999;

      const newConfig = service.getConfig();
      expect(newConfig.maxAttempts).not.toBe(999);
      expect(newConfig.maxAttempts).toBe(DEFAULT_RETRY_CONFIG.maxAttempts);
    });
  });

  describe('updateConfig', () => {
    it('should update config partially', () => {
      const testService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      testService.updateConfig({ maxAttempts: 10 });

      const config = testService.getConfig();
      expect(config.maxAttempts).toBe(10);
      expect(config.baseDelayMs).toBe(1000); // Unchanged
      expect(config.backoffMultiplier).toBe(2); // Unchanged
    });

    it('should update multiple config values', () => {
      const testService = new RetryStrategyService();

      testService.updateConfig({
        maxAttempts: 7,
        baseDelayMs: 3000,
        jitterFactor: 0.3,
      });

      const config = testService.getConfig();
      expect(config.maxAttempts).toBe(7);
      expect(config.baseDelayMs).toBe(3000);
      expect(config.jitterFactor).toBe(0.3);
    });

    it('should apply updated config to subsequent calculations', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxDelayMs: 60000,
        maxAttempts: 5,
      });

      const beforeDelay = testService.calculateNextRetryDelay(1);
      expect(beforeDelay).toBe(2000);

      testService.updateConfig({ baseDelayMs: 2000 });

      const afterDelay = testService.calculateNextRetryDelay(1);
      expect(afterDelay).toBe(4000); // 2000 * 2^1
    });
  });

  describe('calculateTotalRetryTime', () => {
    it('should calculate total delay across all attempts', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      const result = testService.calculateTotalRetryTime();

      // Expected delays: [2000, 4000, 8000, 16000, 32000]
      expect(result.delays).toEqual([2000, 4000, 8000, 16000, 32000]);
      expect(result.totalDelayMs).toBe(62000); // Sum: 2+4+8+16+32 = 62 seconds
      expect(result.averageDelayMs).toBe(12400); // 62000 / 5
    });

    it('should respect maxDelayMs cap in total calculation', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      const result = testService.calculateTotalRetryTime();

      // Expected delays with cap: [2000, 4000, 8000, 10000, 10000]
      expect(result.delays).toEqual([2000, 4000, 8000, 10000, 10000]);
      expect(result.totalDelayMs).toBe(34000);
      expect(result.averageDelayMs).toBe(6800);
    });

    it('should calculate for custom number of attempts', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 10,
      });

      const result = testService.calculateTotalRetryTime(3);

      expect(result.delays).toEqual([2000, 4000, 8000]);
      expect(result.totalDelayMs).toBe(14000);
      expect(result.averageDelayMs).toBeCloseTo(4666.67, 0);
    });

    it('should include jitter variation in total time', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.25,
        maxAttempts: 5,
      });

      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(testService.calculateTotalRetryTime().totalDelayMs);
      }

      // Results should vary due to jitter
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBeGreaterThan(1);
    });

    it('should return correct delays array length', () => {
      const testService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 7,
      });

      const result = testService.calculateTotalRetryTime();

      expect(result.delays).toHaveLength(7);
    });
  });

  describe('edge cases and corner scenarios', () => {
    it('should handle zero jitter factor', () => {
      const zeroJitterService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      const delays: number[] = [];
      for (let i = 0; i < 10; i++) {
        delays.push(zeroJitterService.calculateNextRetryDelay(1));
      }

      // All delays should be identical with zero jitter
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBe(1);
      expect(delays[0]).toBe(2000);
    });

    it('should handle very small base delay', () => {
      const smallDelayService = new RetryStrategyService({
        baseDelayMs: 1,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      const delay = smallDelayService.calculateNextRetryDelay(1);
      expect(delay).toBe(2); // 1 * 2^1
      expect(delay).toBeGreaterThan(0);
    });

    it('should handle very large multiplier', () => {
      const largeMultiplierService = new RetryStrategyService({
        baseDelayMs: 10,
        maxDelayMs: 1000000,
        backoffMultiplier: 10,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      expect(largeMultiplierService.calculateNextRetryDelay(1)).toBe(100); // 10 * 10^1
      expect(largeMultiplierService.calculateNextRetryDelay(2)).toBe(1000); // 10 * 10^2
      expect(largeMultiplierService.calculateNextRetryDelay(3)).toBe(10000); // 10 * 10^3
    });

    it('should handle single attempt configuration', () => {
      const singleAttemptService = new RetryStrategyService({
        maxAttempts: 1,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      });

      expect(singleAttemptService.shouldRetry(1)).toBe(false);
      expect(singleAttemptService.getRetryBudgetRemaining(0)).toBe(1);
      expect(singleAttemptService.getRetryBudgetRemaining(1)).toBe(0);
    });

    it('should handle immediate cap scenario', () => {
      const immediateCap = new RetryStrategyService({
        baseDelayMs: 10000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      // Even first retry would exceed cap
      expect(immediateCap.calculateNextRetryDelay(1)).toBe(5000);
      expect(immediateCap.calculateNextRetryDelay(2)).toBe(5000);
    });

    it('should handle multiplier of 1 (no growth)', () => {
      const noGrowthService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 1,
        jitterFactor: 0,
        maxAttempts: 5,
      });

      expect(noGrowthService.calculateNextRetryDelay(1)).toBe(1000);
      expect(noGrowthService.calculateNextRetryDelay(2)).toBe(1000);
      expect(noGrowthService.calculateNextRetryDelay(5)).toBe(1000);
    });
  });

  describe('real-world scenarios', () => {
    it('should match documented example with jitter', () => {
      const exampleService = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2,
        jitterFactor: 0.25,
        maxAttempts: 5,
      });

      // Test ranges for each attempt as documented
      const testRanges = [
        { attempt: 1, min: 1500, max: 2500 },
        { attempt: 2, min: 3000, max: 5000 },
        { attempt: 3, min: 6000, max: 10000 },
        { attempt: 4, min: 12000, max: 20000 },
        { attempt: 5, min: 24000, max: 40000 },
      ];

      for (const { attempt, min, max } of testRanges) {
        const delays: number[] = [];
        for (let i = 0; i < 20; i++) {
          delays.push(exampleService.calculateNextRetryDelay(attempt));
        }

        const minDelay = Math.min(...delays);
        const maxDelay = Math.max(...delays);

        expect(minDelay).toBeGreaterThanOrEqual(min);
        expect(maxDelay).toBeLessThanOrEqual(max);
      }
    });

    it('should prevent thundering herd with jitter', () => {
      const service = new RetryStrategyService({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.2,
        maxAttempts: 5,
      });

      // Simulate 100 concurrent failures
      const retryTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        retryTimes.push(service.calculateNextRetryDelay(1));
      }

      // Delays should be spread out (not all identical)
      const uniqueTimes = new Set(retryTimes);
      expect(uniqueTimes.size).toBeGreaterThan(10);

      // But still within reasonable bounds
      const spread = Math.max(...retryTimes) - Math.min(...retryTimes);
      expect(spread).toBeGreaterThan(100); // Should have meaningful spread
    });

    it('should handle typical network timeout scenario', () => {
      const networkService = new RetryStrategyService({
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      const timeoutError = new Error('TIMEOUT: network request timed out');

      expect(networkService.shouldRetry(1, timeoutError)).toBe(true);
      expect(networkService.shouldRetry(2, timeoutError)).toBe(true);
      expect(networkService.shouldRetry(3, timeoutError)).toBe(false);
    });

    it('should handle typical validation error scenario', () => {
      const service = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      const validationError = new Error('VALIDATION_ERROR: missing required field');

      // Should not retry validation errors even on first attempt
      expect(service.shouldRetry(1, validationError)).toBe(false);
    });

    it('should calculate reasonable total retry time for typical config', () => {
      const typicalService = new RetryStrategyService({
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });

      const result = typicalService.calculateTotalRetryTime();

      // Total should be reasonable (under 2 minutes with default config)
      expect(result.totalDelayMs).toBeGreaterThan(0);
      expect(result.totalDelayMs).toBeLessThan(120000);
      expect(result.averageDelayMs).toBeGreaterThan(0);
    });
  });
});
