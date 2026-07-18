import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger';
import {
  RESPONSE_PREVIEW_LENGTH,
  LONG_CONTENT_PREVIEW_LENGTH,
  SECOND_MS,
  TEN_SECONDS_MS,
  FIVE_MINUTES_MS,
} from '../config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface ClaudeConfig {
  cliPath: string; // Default: 'claude'
  timeoutMs: number; // Default: 60000
  model: string; // Default: 'sonnet'
  systemPrompt: string;
}

export interface ClaudeResponse {
  success: boolean;
  content: string;
  error?: string;
  durationMs: number;
}

export interface ClaudeAgentOptions {
  timeoutMs?: number;  // Default: 300000 (5 minutes)
  allowedTools?: string[];  // e.g., ['Read', 'Write', 'Edit']
  mcpConfigPath?: string;  // Path to MCP config JSON for browser/tool servers
}

export interface ClaudeHealthStatus {
  healthy: boolean;
  error?: string;
}

export class ClaudeClient {
  private config: ClaudeConfig;

  constructor(config: ClaudeConfig) {
    this.config = config;
  }

  async chat(message: string, context?: string): Promise<ClaudeResponse> {
    const startTime = Date.now();

    const fullMessage = context ? `${context}\n\nUser: ${message}` : message;

    const args = [
      '--print',
      '--model', this.config.model,
      '--dangerously-skip-permissions',
    ];

    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }

    args.push(fullMessage);

    logger.debug('[Claude] Starting CLI call', {
      model: this.config.model,
      messageLength: message.length,
      hasContext: !!context,
      timeoutMs: this.config.timeoutMs,
      message: message.substring(0, RESPONSE_PREVIEW_LENGTH) +
        (message.length > RESPONSE_PREVIEW_LENGTH ? '...' : ''),
      args: args.slice(0, -1),  // Log args without the message
    });

    try {
      const result = await this.executeClaudeCli(args);
      const durationMs = Date.now() - startTime;

      logger.info('[Claude] CLI response received', {
        model: this.config.model,
        durationMs,
        responseLength: result.length,
      });

      logger.debug('[Claude] Response content', {
        response: result.substring(0, LONG_CONTENT_PREVIEW_LENGTH) +
          (result.length > LONG_CONTENT_PREVIEW_LENGTH ? '...' : ''),
      });

      return {
        success: true,
        content: result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Claude CLI error: ${errorMessage} (took ${durationMs}ms)`);

      return {
        success: false,
        content: '',
        error: errorMessage,
        durationMs,
      };
    }
  }

  async healthCheck(): Promise<ClaudeHealthStatus> {
    try {
      const result = await this.executeClaudeCli(
        ['--print', '--model', this.config.model, 'Respond with only: OK'],
        TEN_SECONDS_MS
      );

      if (result.toLowerCase().includes('ok')) {
        return { healthy: true };
      }

      return { healthy: true }; // Got a response, consider it healthy
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Run Claude in agentic mode where it can use tools (Read, Write, Edit, Bash, etc.)
   * This is for complex tasks that require file operations or multi-step reasoning.
   * Uses --print with --tools to enable tool access in non-interactive mode.
   */
  async runAgent(task: string, options?: ClaudeAgentOptions): Promise<ClaudeResponse> {
    const startTime = Date.now();
    const timeout = options?.timeoutMs ?? FIVE_MINUTES_MS;

    const args = [
      '--print',  // Non-interactive mode (required for programmatic use)
      '--model', this.config.model,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ];

    // Add tools for agentic capabilities (--tools works with --print)
    if (options?.allowedTools?.length) {
      args.push('--tools', options.allowedTools.join(','));
    }

    if (options?.mcpConfigPath) {
      args.push('--mcp-config', options.mcpConfigPath);
    }

    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }

    // Pass task as positional argument (last)
    args.push(task);

    logger.info('[Claude] Starting agentic task', {
      model: this.config.model,
      taskLength: task.length,
      timeoutMs: timeout,
      taskPreview: task.substring(0, LONG_CONTENT_PREVIEW_LENGTH) +
        (task.length > LONG_CONTENT_PREVIEW_LENGTH ? '...' : ''),
      allowedTools: options?.allowedTools,
      mcpConfigPath: options?.mcpConfigPath,
    });

    try {
      const result = await this.executeClaudeCli(args, timeout);
      const durationMs = Date.now() - startTime;

      logger.info('[Claude] Agentic task completed', {
        model: this.config.model,
        durationMs,
        responseLength: result.length,
      });

      return {
        success: true,
        content: result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`[Claude] Agentic task failed: ${errorMessage} (took ${durationMs}ms)`);

      return {
        success: false,
        content: '',
        error: errorMessage,
        durationMs,
      };
    }
  }

  private executeClaudeCli(args: string[], timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.config.timeoutMs;

    return new Promise((resolve, reject) => {
      logger.debug('[Claude] Spawning CLI', { cliPath: this.config.cliPath, args });

      // Strip all inherited Claude Code session variables so the CLI runs as
      // a fresh top-level invocation with its own stored credentials. Leaked
      // session vars cause nested-session errors and can bind the CLI to a
      // dead session's expired OAuth token (401s on every request).
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            key !== 'CLAUDECODE' && key !== 'CLAUDE_EFFORT' && !key.startsWith('CLAUDE_CODE_')
        )
      );

      const childProcess = spawn(this.config.cliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin completely
        env: cleanEnv,
        cwd: PROJECT_ROOT,  // Use project root as working directory
      });

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        childProcess.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${timeout}ms`));
      }, timeout);

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        logger.debug('[Claude] stdout chunk', { chunk: data.toString().substring(0, LONG_CONTENT_PREVIEW_LENGTH) });
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.debug('[Claude] stderr chunk', { chunk: data.toString().substring(0, LONG_CONTENT_PREVIEW_LENGTH) });
      });

      childProcess.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMsg = stderr.trim() || `Process exited with code ${code}`;
          reject(new Error(errorMsg));
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });
    });
  }
}
