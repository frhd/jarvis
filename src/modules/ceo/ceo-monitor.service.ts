/**
 * CEO Monitor Service
 * Runs YouTrack checks via Claude CLI to generate status reports.
 */

import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { MONITOR_PROMPT } from './ceo-config.js';

const logger = createLogger('CeoMonitor');

export class CeoMonitorService {
  private claudeCliPath: string;
  private mcpConfigPath: string;

  constructor(opts: { claudeCliPath: string; mcpConfigPath: string }) {
    this.claudeCliPath = opts.claudeCliPath;
    this.mcpConfigPath = opts.mcpConfigPath;
  }

  async runMonitorCheck(): Promise<string> {
    return new Promise((resolve) => {
      const args = [
        '--print',
        '--model', 'opus',
        '--dangerously-skip-permissions',
        '--mcp-config', this.mcpConfigPath,
        MONITOR_PROMPT,
      ];

      const proc = spawn(this.claudeCliPath, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        logger.warn('Monitor check timed out');
        resolve('Monitor check timed out.');
      }, 300000); // 5 min timeout

      proc.on('close', (code: number | null) => {
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          logger.error('Monitor check error', { code, stderr: stderr.substring(0, 500) });
          resolve('Monitor check failed - check logs for details.');
        }
      });

      proc.on('error', (error: Error) => {
        clearTimeout(timeout);
        logger.error('Monitor spawn error', { error: error.message });
        resolve('Monitor check failed to start.');
      });
    });
  }
}
