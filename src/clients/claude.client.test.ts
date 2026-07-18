import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process before importing ClaudeClient
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { spawn } from 'child_process';
import { ClaudeClient, type ClaudeConfig } from './claude.client.js';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: Mock;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const defaultConfig: ClaudeConfig = {
  cliPath: 'claude',
  timeoutMs: 5000,
  model: 'sonnet',
  systemPrompt: '',
};

describe('ClaudeClient', () => {
  let client: ClaudeClient;
  let mockSpawn: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ClaudeClient(defaultConfig);
    mockSpawn = spawn as unknown as Mock;
  });

  describe('runAgent - MCP config support', () => {
    it('passes --mcp-config flag when mcpConfigPath is provided', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = client.runAgent('test task', {
        mcpConfigPath: '/path/to/mcp.json',
      });

      // Simulate successful completion
      proc.stdout.emit('data', Buffer.from('result'));
      proc.emit('close', 0);

      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const mcpIndex = spawnArgs.indexOf('--mcp-config');
      expect(mcpIndex).toBeGreaterThan(-1);
      expect(spawnArgs[mcpIndex + 1]).toBe('/path/to/mcp.json');
    });

    it('does NOT add --mcp-config when mcpConfigPath is undefined', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = client.runAgent('test task', {});

      proc.stdout.emit('data', Buffer.from('result'));
      proc.emit('close', 0);

      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--mcp-config');
    });

    it('does NOT add --mcp-config when mcpConfigPath is empty string', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = client.runAgent('test task', {
        mcpConfigPath: '',
      });

      proc.stdout.emit('data', Buffer.from('result'));
      proc.emit('close', 0);

      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--mcp-config');
    });

    it('places --mcp-config before the task argument', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const task = 'do something complex';
      const promise = client.runAgent(task, {
        mcpConfigPath: '/path/to/mcp.json',
      });

      proc.stdout.emit('data', Buffer.from('result'));
      proc.emit('close', 0);

      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const mcpIndex = spawnArgs.indexOf('--mcp-config');
      const taskIndex = spawnArgs.indexOf(task);
      expect(mcpIndex).toBeLessThan(taskIndex);
    });
  });

  describe('spawn environment sanitization', () => {
    const sessionVars: Record<string, string> = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'dead-session-id',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_EXECPATH: '/nonexistent/version',
      CLAUDE_EFFORT: 'high',
    };
    let originalValues: Record<string, string | undefined>;

    beforeEach(() => {
      originalValues = {};
      for (const [key, value] of Object.entries(sessionVars)) {
        originalValues[key] = process.env[key];
        process.env[key] = value;
      }
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('strips all inherited Claude Code session variables from the spawned CLI environment', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = client.runAgent('test task', {});
      proc.stdout.emit('data', Buffer.from('result'));
      proc.emit('close', 0);
      await promise;

      const spawnOptions = mockSpawn.mock.calls[0][2] as { env: Record<string, string | undefined> };
      for (const key of Object.keys(sessionVars)) {
        expect(spawnOptions.env, `expected ${key} to be stripped`).not.toHaveProperty(key);
      }
      // Non-session variables must pass through untouched
      expect(spawnOptions.env.PATH).toBe(process.env.PATH);
    });
  });
});
