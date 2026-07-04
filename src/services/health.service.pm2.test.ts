/**
 * Tests for PM2 restart health check functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mockSpawn is available when vi.mock factory runs (hoisted above imports)
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

// Create a helper to build a mock spawn result
function createMockSpawnResult(
  stdoutData: string,
  stderrData: string,
  exitCode: number
) {
  return {
    stdout: {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data' && stdoutData) {
          handler(Buffer.from(stdoutData));
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data' && stderrData) {
          handler(Buffer.from(stderrData));
        }
      }),
    },
    on: vi.fn((event: string, handler: Function) => {
      if (event === 'close') {
        Promise.resolve().then(() => handler(exitCode));
      }
    }),
    kill: vi.fn(),
  };
}

// Must import after mock declaration
import { createPM2RestartHealthCheck } from './health.service';

describe('createPM2RestartHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should be healthy when restart count is below warning threshold and no unstable restarts', async () => {
    // Mock PM2 returning low restart counts with no unstable restarts
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          {
            name: 'jarvis',
            pm2_env: { restart_time: 2, created_at: oneHourAgo },
            unstable_restarts: 0,
          },
          {
            name: 'whisper',
            pm2_env: { restart_time: 1, created_at: oneHourAgo },
            unstable_restarts: 0,
          },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('healthy');
    expect(result.metadata?.restartCounts).toBeDefined();
    expect(result.metadata?.lastChecked).toBeDefined();
  });

  it('should be degraded when restart count exceeds warning threshold and restart rate is high', async () => {
    // Mock PM2 returning high restart count with high restart rate (>10/hour)
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          {
            name: 'jarvis',
            pm2_env: { restart_time: 15, created_at: oneHourAgo },
            unstable_restarts: 0,
          },
          {
            name: 'whisper',
            pm2_env: { restart_time: 5, created_at: oneHourAgo },
            unstable_restarts: 0,
          },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      restartRateThresholdPerHour: 5,
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('degraded');
    expect(result.message).toContain('jarvis');
    expect(result.message).toContain('restart');
  });

  it('should be unhealthy when unstable restarts detected (actual crashes)', async () => {
    // Mock PM2 returning with unstable restarts (indicates actual crashes)
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          {
            name: 'jarvis',
            pm2_env: { restart_time: 25, created_at: oneHourAgo },
            unstable_restarts: 3, // 3 actual crashes!
          },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('CRITICAL');
    expect(result.error).toContain('jarvis');
    expect(result.error).toContain('unstable');
    expect(result.metadata?.severity).toBe('critical');
  });

  it('should be degraded when restart count is high but unstable restarts is 0 (high restart rate)', async () => {
    // Mock PM2 returning high restart count with 0 unstable restarts
    // This is the case where jarvis has many restarts but 0 crashes
    // However, 130 restarts over 10 hours = 13/hour, which would exceed a 10/hour threshold
    // Using explicit restartRateThresholdPerHour of 10 to trigger degraded status
    // (Default is 30/hour to tolerate Telegram TIMEOUT errors)
    const now = Date.now();
    const tenHoursAgo = now - (10 * 60 * 60 * 1000);

    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          {
            name: 'jarvis',
            pm2_env: { restart_time: 130, created_at: tenHoursAgo },
            unstable_restarts: 0, // 0 crashes - but restart rate is high!
          },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      restartRateThresholdPerHour: 10, // Use explicit threshold to trigger degraded status
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    // Degraded because restart rate is 13/hour (> 10/hour threshold)
    expect(result.status).toBe('degraded');
    expect(result.message).toContain('restart');
  });

  it('should be healthy when restart count is moderate and unstable restarts is 0', async () => {
    // Mock PM2 returning moderate restart count with 0 unstable restarts
    // 50 restarts over 10 hours = 5/hour, which is below the 10/hour threshold
    const now = Date.now();
    const tenHoursAgo = now - (10 * 60 * 60 * 1000);

    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          {
            name: 'jarvis',
            pm2_env: { restart_time: 50, created_at: tenHoursAgo },
            unstable_restarts: 0,
          },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('healthy');
  });

  it('should handle PM2 command errors gracefully', async () => {
    // Mock PM2 command failure
    mockSpawn.mockImplementation(() =>
      createMockSpawnResult('', 'PM2 not found', 1)
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      checkIntervalMs: 300000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(300001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('failed');
  });

  it('should use custom thresholds when provided', async () => {
    // Mock PM2 returning low restart counts
    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          { name: 'jarvis', pm2_env: { restart_time: 2 } },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 5,
      criticalThreshold: 10,
      checkIntervalMs: 600000,
    });

    // First call initializes state
    await healthCheck();

    // Advance time past check interval
    await vi.advanceTimersByTimeAsync(600001);

    // Second call performs actual check
    const result = await healthCheck();

    expect(result.status).toBe('healthy');
    expect(result.metadata?.lastChecked).toBeDefined();
  });

  it('should return cached results within check interval', async () => {
    // Mock PM2 returning low restart counts
    mockSpawn.mockImplementation(() =>
      createMockSpawnResult(
        JSON.stringify([
          { name: 'jarvis', pm2_env: { restart_time: 1 } },
        ]),
        '',
        0
      )
    );

    const healthCheck = createPM2RestartHealthCheck({
      warningThreshold: 10,
      criticalThreshold: 20,
      checkIntervalMs: 300000,
    });

    const result1 = await healthCheck();
    expect(result1.status).toBe('healthy');

    // Reset spawn to verify it's not called again
    mockSpawn.mockClear();

    const result2 = await healthCheck();
    expect(result2.status).toBe('healthy');

    // Should not call PM2 again within interval
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
