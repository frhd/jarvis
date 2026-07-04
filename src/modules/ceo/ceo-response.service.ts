/**
 * CEO Response Service
 * Generates responses using Claude CLI with CEO persona.
 */

import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { CEO_SYSTEM_PROMPT } from './ceo-config.js';
import { appConfig } from '../../config/index.js';

const logger = createLogger('CeoResponse');

export class CeoResponseService {
  private claudeCliPath: string;
  private mcpConfigPath: string;
  private timeoutMs: number;

  constructor(opts: { claudeCliPath: string; mcpConfigPath: string; timeoutMs?: number }) {
    this.claudeCliPath = opts.claudeCliPath;
    this.mcpConfigPath = opts.mcpConfigPath;
    this.timeoutMs = opts.timeoutMs ?? appConfig.ceo.responseTimeoutMs;
  }

  async generateResponse(
    userMessage: string,
    context: string = '',
    memoryContext: string = ''
  ): Promise<string> {
    return new Promise((resolve) => {
      const parts = [memoryContext, context, userMessage].filter(Boolean);
      const fullMessage = parts.join('\n');
      const args = [
        '--print',
        '--model', 'sonnet',
        '--dangerously-skip-permissions',
        '--mcp-config', this.mcpConfigPath,
        '--system-prompt', CEO_SYSTEM_PROMPT,
        fullMessage,
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
        logger.warn('Claude CLI timed out for CEO response', { timeoutMs: this.timeoutMs });
        resolve('Sorry, the request timed out. Please try again.');
      }, this.timeoutMs);

      proc.on('close', (code: number | null) => {
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          logger.error('Claude CLI error', { code, stderr: stderr.substring(0, 500) });
          resolve('Sorry, I\'m experiencing technical difficulties. Please try again later.');
        }
      });

      proc.on('error', (error: Error) => {
        clearTimeout(timeout);
        logger.error('Claude CLI spawn error', { error: error.message });
        resolve('Sorry, I\'m experiencing technical difficulties. Please try again later.');
      });
    });
  }
}
