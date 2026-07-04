import { describe, it, expect, vi } from 'vitest';
import { HealthCheckBuilder } from './health-check-builder.js';

describe('HealthCheckBuilder', () => {
  describe('execute', () => {
    it('should return healthy result with timing', async () => {
      const result = await HealthCheckBuilder.execute('test', async () => {
        return HealthCheckBuilder.healthy({ key: 'value' });
      });

      expect(result.name).toBe('test');
      expect(result.status).toBe('healthy');
      expect(result.metadata).toEqual({ key: 'value' });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.lastChecked).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('should return degraded result with message', async () => {
      const result = await HealthCheckBuilder.execute('test', async () => {
        return HealthCheckBuilder.degraded('Service is slow', { latency: 5000 });
      });

      expect(result.name).toBe('test');
      expect(result.status).toBe('degraded');
      expect(result.message).toBe('Service is slow');
      expect(result.metadata).toEqual({ latency: 5000 });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy result with error', async () => {
      const result = await HealthCheckBuilder.execute('test', async () => {
        return HealthCheckBuilder.unhealthy('Connection failed', { attempts: 3 });
      });

      expect(result.name).toBe('test');
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection failed');
      expect(result.metadata).toEqual({ attempts: 3 });
    });

    it('should catch thrown errors and return unhealthy', async () => {
      const result = await HealthCheckBuilder.execute('test', async () => {
        throw new Error('Unexpected failure');
      });

      expect(result.name).toBe('test');
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Unexpected failure');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.lastChecked).toBeInstanceOf(Date);
    });

    it('should handle non-Error thrown values', async () => {
      const result = await HealthCheckBuilder.execute('test', async () => {
        throw 'String error';
      });

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('String error');
    });

    it('should measure elapsed time correctly', async () => {
      const delay = 50;
      const result = await HealthCheckBuilder.execute('test', async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return HealthCheckBuilder.healthy();
      });

      // Allow for some timing variance
      expect(result.latencyMs).toBeGreaterThanOrEqual(delay - 10);
      expect(result.latencyMs).toBeLessThan(delay + 100);
    });
  });

  describe('healthy', () => {
    it('should create healthy result without metadata', () => {
      const result = HealthCheckBuilder.healthy();

      expect(result.status).toBe('healthy');
      expect(result.metadata).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.message).toBeUndefined();
    });

    it('should create healthy result with metadata', () => {
      const result = HealthCheckBuilder.healthy({ version: '1.0', connections: 5 });

      expect(result.status).toBe('healthy');
      expect(result.metadata).toEqual({ version: '1.0', connections: 5 });
    });
  });

  describe('degraded', () => {
    it('should create degraded result with message', () => {
      const result = HealthCheckBuilder.degraded('High latency detected');

      expect(result.status).toBe('degraded');
      expect(result.message).toBe('High latency detected');
      expect(result.metadata).toBeUndefined();
    });

    it('should create degraded result with message and metadata', () => {
      const result = HealthCheckBuilder.degraded('Cache hit rate low', { hitRate: 0.5 });

      expect(result.status).toBe('degraded');
      expect(result.message).toBe('Cache hit rate low');
      expect(result.metadata).toEqual({ hitRate: 0.5 });
    });
  });

  describe('unhealthy', () => {
    it('should create unhealthy result with error', () => {
      const result = HealthCheckBuilder.unhealthy('Database connection failed');

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Database connection failed');
      expect(result.metadata).toBeUndefined();
    });

    it('should create unhealthy result with error and metadata', () => {
      const result = HealthCheckBuilder.unhealthy('Timeout', { timeoutMs: 5000 });

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Timeout');
      expect(result.metadata).toEqual({ timeoutMs: 5000 });
    });
  });

  describe('fromCondition', () => {
    it('should return healthy when condition is true', () => {
      const result = HealthCheckBuilder.fromCondition(true, 'Error message', { key: 'value' });

      expect(result.status).toBe('healthy');
      expect(result.metadata).toEqual({ key: 'value' });
      expect(result.error).toBeUndefined();
    });

    it('should return unhealthy when condition is false', () => {
      const result = HealthCheckBuilder.fromCondition(false, 'Connection lost', { key: 'value' });

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection lost');
      expect(result.metadata).toEqual({ key: 'value' });
    });
  });

  describe('fromThresholds', () => {
    const warningThreshold = 80;
    const criticalThreshold = 95;

    it('should return healthy when value is below warning threshold', () => {
      const result = HealthCheckBuilder.fromThresholds(50, warningThreshold, criticalThreshold, 'cpu_usage');

      expect(result.status).toBe('healthy');
      expect(result.metadata).toEqual({ cpu_usage: 50 });
    });

    it('should return degraded when value is at warning threshold', () => {
      const result = HealthCheckBuilder.fromThresholds(80, warningThreshold, criticalThreshold, 'cpu_usage');

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('cpu_usage');
      expect(result.message).toContain('80');
      expect(result.message).toContain('warning');
      expect(result.metadata).toEqual({ cpu_usage: 80 });
    });

    it('should return degraded when value is between warning and critical', () => {
      const result = HealthCheckBuilder.fromThresholds(90, warningThreshold, criticalThreshold, 'memory_pct');

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('memory_pct');
      expect(result.message).toContain('90');
    });

    it('should return unhealthy when value is at critical threshold', () => {
      const result = HealthCheckBuilder.fromThresholds(95, warningThreshold, criticalThreshold, 'disk_usage');

      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('disk_usage');
      expect(result.error).toContain('95');
      expect(result.error).toContain('critical');
    });

    it('should return unhealthy when value exceeds critical threshold', () => {
      const result = HealthCheckBuilder.fromThresholds(100, warningThreshold, criticalThreshold, 'queue_depth');

      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('queue_depth');
      expect(result.metadata).toEqual({ queue_depth: 100 });
    });

    it('should include additional metadata', () => {
      const result = HealthCheckBuilder.fromThresholds(50, warningThreshold, criticalThreshold, 'cpu_usage', {
        host: 'server-1',
        timestamp: 12345,
      });

      expect(result.status).toBe('healthy');
      expect(result.metadata).toEqual({
        cpu_usage: 50,
        host: 'server-1',
        timestamp: 12345,
      });
    });
  });
});
