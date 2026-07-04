/**
 * PM2 Restart Monitoring Service
 *
 * Monitors PM2 process restarts and triggers alerts when
 * restart count exceeds thresholds. This helps detect
 * stability issues like the 45 restarts in 2 days issue.
 */

import { spawn } from 'child_process';
import type { TelegramService } from './telegram.service';
import { logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import { resolvePm2Binary } from '../utils/pm2-binary.js';

const pm2Logger = createLogger('PM2RestartMonitor');

export interface PM2ProcessStatus {
  name: string;
  status: string;
  pid: number | null;
  uptime: number;
  restarts: number;
  unstable_restarts: number;
  created_at: number;
}

export interface PM2AlertConfig {
  restartThreshold: number; // Alert if restarts exceed this count
  timeWindowMs: number; // Time window to check restarts
  cooldownMs: number; // Cooldown between alerts
}

const DEFAULT_ALERT_CONFIG: PM2AlertConfig = {
  restartThreshold: 5, // Alert if >5 restarts in window
  timeWindowMs: 60 * 60 * 1000, // 1 hour
  cooldownMs: 30 * 60 * 1000, // 30 minutes
};

const ANSI_ESCAPE_REGEX = /\[[0-9;]*m/g;

// PM2 prepends human-readable warnings (e.g. "In-memory PM2 is out-of-date")
// to stdout before the JSON array. Strip ANSI codes and slice from the first '['.
export function extractPm2Json(stdout: string): string {
  const cleaned = stdout.replace(ANSI_ESCAPE_REGEX, '');
  const start = cleaned.indexOf('[');
  if (start === -1) {
    throw new Error('No JSON array found in pm2 jlist output');
  }
  return cleaned.slice(start);
}

export class PM2RestartMonitorService {
  private config: PM2AlertConfig;
  private lastAlertTime: number = 0;
  private lastProcessStatus: PM2ProcessStatus | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isEnabled: boolean;
  private telegramService: TelegramService | null = null;
  private ownerTelegramId: string | null = null;

  constructor(config?: Partial<PM2AlertConfig>) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    this.isEnabled = true;
  }

  /**
   * Set Telegram service for sending alerts
   */
  setTelegramService(telegramService: TelegramService | null): void {
    this.telegramService = telegramService;
    pm2Logger.info('[PM2] Telegram service set', { hasService: !!telegramService });
  }

  /**
   * Set owner Telegram ID for sending alerts to
   */
  setOwnerTelegramId(ownerId: string | null): void {
    this.ownerTelegramId = ownerId;
    pm2Logger.info('[PM2] Owner Telegram ID set', { hasOwnerId: !!ownerId });
  }

  /**
   * Get PM2 process status
   */
  async getProcessStatus(): Promise<PM2ProcessStatus | null> {
    try {
      const proc = spawn(resolvePm2Binary(), ['jlist'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      return new Promise((resolve) => {
        // Without this handler a spawn failure (e.g. pm2 not found) emits an
        // 'error' event with no listener, which Node throws as an uncaught
        // exception and crashes the process.
        proc.on('error', (error: Error) => {
          pm2Logger.warn('[PM2] Failed to spawn pm2 for status check', {
            error: error.message,
          });
          resolve(null);
        });

        proc.on('close', (code: number | null) => {
          if (code !== 0) {
            pm2Logger.warn('[PM2] Failed to get process status', {
              code,
              stderr,
            });
            resolve(null);
            return;
          }

          try {
            const processes = JSON.parse(extractPm2Json(stdout)) as PM2ProcessStatus[];
            const jarvisProcess = processes.find(p => p.name === 'jarvis');
            resolve(jarvisProcess || null);
          } catch (error) {
            pm2Logger.error('[PM2] Failed to parse process status', {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            resolve(null);
          }
        });
      });
    } catch (error) {
      pm2Logger.error('[PM2] Error getting process status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Check for restart alert condition
   */
  private async checkForRestartAlert(): Promise<boolean> {
    const status = await this.getProcessStatus();
    if (!status) {
      return false;
    }

    // Check if restart count exceeds threshold
    if (status.restarts > this.config.restartThreshold) {
      const now = Date.now();

      // Check cooldown
      if (now - this.lastAlertTime < this.config.cooldownMs) {
        pm2Logger.debug('[PM2] Alert in cooldown, skipping', {
          lastAlertTime: this.lastAlertTime,
          now,
          cooldownMs: this.config.cooldownMs,
        });
        return false;
      }

      this.lastAlertTime = now;
      this.lastProcessStatus = status;

      pm2Logger.error('[PM2] HIGH RESTART COUNT DETECTED', {
        processName: status.name,
        restarts: status.restarts,
        unstableRestarts: status.unstable_restarts,
        uptime: status.uptime,
        threshold: this.config.restartThreshold,
      });

      // Send Telegram alert to owner
      await this.sendTelegramAlert(status);

      return true;
    }

    return false;
  }

  /**
   * Send Telegram alert to owner about high restart count
   */
  private async sendTelegramAlert(status: PM2ProcessStatus): Promise<void> {
    if (!this.telegramService || !this.ownerTelegramId) {
      pm2Logger.warn('[PM2] Cannot send Telegram alert - missing service or owner ID', {
        hasTelegramService: !!this.telegramService,
        hasOwnerTelegramId: !!this.ownerTelegramId,
      });
      return;
    }

    try {
      const uptimeMinutes = Math.floor(status.uptime / 60);
      const uptimeHours = Math.floor(uptimeMinutes / 60);
      const uptimeStr = uptimeHours > 0
        ? `${uptimeHours}h ${uptimeMinutes % 60}m`
        : `${uptimeMinutes}m`;

      const message = `🚨 *PM2 Restart Alert*

Process: ${status.name}
Status: ${status.status}
Restarts: ${status.restarts}
Unstable Restarts: ${status.unstable_restarts}
Uptime: ${uptimeStr}

⚠️ This indicates a stability issue. Check error logs.`;

      await this.telegramService.sendMessage(this.ownerTelegramId, message);
      pm2Logger.info('[PM2] Telegram alert sent to owner', { ownerTelegramId: this.ownerTelegramId });
    } catch (error) {
      pm2Logger.error('[PM2] Failed to send Telegram alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get formatted restart status message
   */
  getRestartStatusMessage(): string {
    if (!this.lastProcessStatus) {
      return 'PM2 restart monitoring is active. No alerts yet.';
    }

    const status = this.lastProcessStatus;
    const uptimeMinutes = Math.floor(status.uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeStr = uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;

    const lines = [
      '🚨 *PM2 Restart Alert*',
      '',
      `Process: ${status.name}`,
      `Status: ${status.status}`,
      `Restarts: ${status.restarts}`,
      `Unstable Restarts: ${status.unstable_restarts}`,
      `Uptime: ${uptimeStr}`,
      '',
      '⚠️  This indicates a stability issue. Check error logs.',
    ];

    return lines.join('\n');
  }

  /**
   * Start periodic monitoring
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (!this.isEnabled) {
      pm2Logger.info('[PM2] Monitoring disabled via config');
      return;
    }

    if (this.monitoringInterval) {
      pm2Logger.warn('[PM2] Monitoring already running');
      return;
    }

    pm2Logger.info('[PM2] Starting restart monitoring', {
      intervalMs,
      threshold: this.config.restartThreshold,
      timeWindowMs: this.config.timeWindowMs,
    });

    // Run initial check
    this.checkForRestartAlert().catch((error) => {
      pm2Logger.error('[PM2] Initial check failed', { error });
    });

    // Start periodic checks
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkForRestartAlert();
      } catch (error) {
        pm2Logger.error('[PM2] Monitoring check failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, intervalMs);
  }

  /**
   * Stop periodic monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      pm2Logger.info('[PM2] Restart monitoring stopped');
    }
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    pm2Logger.info('[PM2] Monitoring enabled status changed', { enabled });
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<PM2AlertConfig>): void {
    this.config = { ...this.config, ...updates };
    pm2Logger.info('[PM2] Configuration updated', { config: this.config });
  }

  /**
   * Get current status
   */
  async getCurrentStatus(): Promise<{
    isEnabled: boolean;
    lastAlertTime: number;
    lastProcessStatus: PM2ProcessStatus | null;
  }> {
    return {
      isEnabled: this.isEnabled,
      lastAlertTime: this.lastAlertTime,
      lastProcessStatus: this.lastProcessStatus,
    };
  }
}

// Singleton instance
export const pm2RestartMonitorService = new PM2RestartMonitorService();
