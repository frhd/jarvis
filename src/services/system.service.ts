/**
 * System Service
 *
 * Provides system information with fallback strategies for different deployment scenarios.
 * Handles permission errors gracefully by trying multiple methods.
 *
 * Methods:
 * - getSystemUptime(): Fallback chain: os.uptime() -> database tracking -> process uptime
 * - getProcessUptime(): Time since process start
 * - getMemoryUsage(): Current memory statistics
 * - getCpuUsage(): Current CPU usage percentage
 * - getDiskUsage(): Disk usage statistics
 */

import os from 'os';
import { createLogger } from '../utils/logger';
import { db, connection } from '../db/client';
import {
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
} from '../config/constants';

const logger = createLogger('SystemService');

export interface SystemUptime {
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Which method provided the uptime */
  source: 'os' | 'database' | 'process' | 'estimated';
  /** Human-readable uptime string */
  uptimeString: string;
}

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  heapUsagePercent: number;
}

export interface CpuStats {
  /** CPU usage percentage (0-100) */
  usagePercent: number;
  /** Number of CPUs */
  cpuCount: number;
}

export interface DiskStats {
  /** Used disk space in bytes */
  usedBytes: number;
  /** Available disk space in bytes */
  availableBytes: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
  /** Disk path being monitored */
  path: string;
}

// ============================================================================
// System Service
// ============================================================================

export class SystemService {
  private processStartTime: number;
  private settingsTableCreated = false;

  constructor() {
    this.processStartTime = Date.now();
  }

  private ensureSettingsTable(): void {
    if (this.settingsTableCreated) return;
    connection.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
    this.settingsTableCreated = true;
  }

  /**
   * Get system uptime with graceful fallback strategy.
   *
   * Tries methods in order of reliability:
   * 1. os.uptime() - Most accurate, works on most systems
   * 2. Database tracking - If os.uptime() fails
   * 3. Process uptime - Last resort fallback
   *
   * @returns System uptime information
   */
  async getSystemUptime(): Promise<SystemUptime> {
    // Method 1: Try os.uptime() first
    let uptimeSeconds: number | null = null;
    let source: SystemUptime['source'] = 'os';
    let error: string | null = null;

    try {
      uptimeSeconds = os.uptime();
      logger.debug('[System] Got uptime from os.uptime()', { uptimeSeconds });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn('[System] os.uptime() failed, trying database tracking', { error });
    }

    // Method 2: Fall back to database tracking if os.uptime() failed
    if (uptimeSeconds === null || uptimeSeconds < 0) {
      try {
        const dbUptime = await this.getUptimeFromDatabase();
        if (dbUptime > 0) {
          uptimeSeconds = dbUptime;
          source = 'database';
          error = null;
          logger.info('[System] Using database uptime tracking', { uptimeSeconds });
        }
      } catch (dbError) {
        logger.warn('[System] Database uptime tracking failed, using process uptime', {
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
    }

    // Method 3: Final fallback to process uptime
    if (uptimeSeconds === null || uptimeSeconds < 0) {
      uptimeSeconds = (Date.now() - this.processStartTime) / 1000;
      source = 'process';
      error = null;
      logger.warn('[System] Using process uptime as final fallback', { uptimeSeconds });
    }

    // Final validation
    if (uptimeSeconds === null || uptimeSeconds < 0) {
      uptimeSeconds = 0;
      source = 'estimated';
      logger.error('[System] All uptime methods failed, using estimated 0', { error });
    }

    return {
      uptimeSeconds,
      source,
      uptimeString: this.formatUptime(uptimeSeconds),
    };
  }

  /**
   * Get uptime from database tracking
   *
   * Checks if we have a last startup timestamp in the database
   */
  private async getUptimeFromDatabase(): Promise<number> {
    this.ensureSettingsTable();

    const result = connection
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('system_startup_time') as { value: string } | undefined;

    if (result) {
      const startupTime = parseInt(result.value, 10);
      const uptimeSeconds = (Date.now() - startupTime) / 1000;
      return Math.max(0, uptimeSeconds);
    } else {
      // Create initial startup time entry
      const now = Date.now().toString();
      connection
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('system_startup_time', now);
      return 0;
    }
  }

  /**
   * Update startup time in database (call on service startup)
   */
  async recordStartupTime(): Promise<void> {
    try {
      this.ensureSettingsTable();
      const now = Date.now().toString();
      connection
        .prepare(`
          INSERT OR REPLACE INTO settings (key, value, updatedAt)
          VALUES (?, ?, strftime('%s', 'now'))
        `)
        .run('system_startup_time', now);
      logger.info('[System] Recorded startup time in database');
    } catch (error) {
      logger.warn('[System] Failed to record startup time', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get process uptime (time since this service started)
   */
  getProcessUptime(): SystemUptime {
    const uptimeSeconds = (Date.now() - this.processStartTime) / 1000;
    return {
      uptimeSeconds,
      source: 'process',
      uptimeString: this.formatUptime(uptimeSeconds),
    };
  }

  /**
   * Get current memory usage statistics
   */
  getMemoryUsage(): MemoryStats {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const rssMB = memUsage.rss / 1024 / 1024;
    const externalMB = (memUsage.external || 0) / 1024 / 1024;
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    return {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      rssMB: Math.round(rssMB * 100) / 100,
      externalMB: Math.round(externalMB * 100) / 100,
      heapUsagePercent: Math.round(heapUsagePercent * 10) / 10,
    };
  }

  /**
   * Get current CPU usage
   */
  getCpuUsage(): CpuStats {
    const cpus = os.cpus();
    const cpuCount = cpus.length;

    // Calculate average CPU usage across all cores
    let totalUser = 0;
    let totalSystem = 0;
    let totalIdle = 0;

    for (const cpu of cpus) {
      totalUser += cpu.times.user;
      totalSystem += cpu.times.sys;
      totalIdle += cpu.times.idle;
    }

    const totalLoad = totalUser + totalSystem;
    const totalPossible = totalLoad + totalIdle;

    // Return estimated usage as percentage
    const usagePercent = totalPossible > 0
      ? Math.round((totalLoad / totalPossible) * 100 * cpuCount)
      : 0;

    return {
      usagePercent: Math.min(100, usagePercent),
      cpuCount,
    };
  }

  /**
   * Get disk usage statistics
   */
  async getDiskUsage(path: string = '/'): Promise<DiskStats> {
    try {
      const fs = await import('fs/promises');
      const stats = await fs.statfs(path);
      // StatsFs properties vary by platform, try different property names
      const availableBytes = (stats as any).available || (stats as any).blocksAvailable || 0;
      const totalBytes = (stats as any).total || (stats as any).blocks || 0;
      const usedBytes = totalBytes - availableBytes;
      const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

      return {
        usedBytes,
        availableBytes,
        usagePercent: Math.round(usagePercent * 10) / 10,
        path,
      };
    } catch (error) {
      logger.warn('[System] Failed to get disk usage', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        usedBytes: 0,
        availableBytes: 0,
        usagePercent: 0,
        path,
      };
    }
  }

  /**
   * Format uptime seconds into human-readable string
   */
  private formatUptime(seconds: number): string {
    if (seconds < SECONDS_PER_MINUTE) {
      return `${Math.floor(seconds)}s`;
    } else if (seconds < SECONDS_PER_HOUR) {
      const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
      const remainingSeconds = Math.floor(seconds % SECONDS_PER_MINUTE);
      return `${minutes}m ${remainingSeconds}s`;
    } else if (seconds < SECONDS_PER_DAY) {
      const hours = Math.floor(seconds / SECONDS_PER_HOUR);
      const remainingMinutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
      return `${hours}h ${remainingMinutes}m`;
    } else {
      const days = Math.floor(seconds / SECONDS_PER_DAY);
      const remainingHours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
      return `${days}d ${remainingHours}h`;
    }
  }

  /**
   * Get comprehensive system health snapshot
   */
  async getHealthSnapshot(): Promise<{
    uptime: SystemUptime;
    memory: MemoryStats;
    cpu: CpuStats;
    disk?: DiskStats;
  }> {
    const [uptime, disk] = await Promise.all([
      this.getSystemUptime(),
      this.getDiskUsage().catch(() => undefined),
    ]);

    return {
      uptime,
      memory: this.getMemoryUsage(),
      cpu: this.getCpuUsage(),
      disk,
    };
  }
}

// Singleton instance
export const systemService = new SystemService();
