import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('./ceo-config.js', () => ({
  CEO_SYSTEM_PROMPT: 'You are a CEO.',
}));

import { CeoResponseService } from './ceo-response.service.js';
import { EventEmitter } from 'events';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('CeoResponseService', () => {
  let service: CeoResponseService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CeoResponseService({
      claudeCliPath: '/usr/bin/claude',
      mcpConfigPath: '/path/to/mcp.json',
    });
  });

  it('includes memory context in system prompt when provided', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const responsePromise = service.generateResponse(
      'Hello',
      'Some context',
      'Relevant memories from past conversations:\n- User likes TypeScript\n'
    );

    // The spawn args should include the memory context in the full message
    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const fullMessage = args[args.length - 1];
    expect(fullMessage).toContain('Relevant memories from past conversations:');
    expect(fullMessage).toContain('User likes TypeScript');

    proc.stdout.emit('data', Buffer.from('CEO response'));
    proc.emit('close', 0);

    const response = await responsePromise;
    expect(response).toBe('CEO response');
  });

  it('works without memory context (backward compat)', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const responsePromise = service.generateResponse('Hello', 'Some context');

    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const fullMessage = args[args.length - 1];
    expect(fullMessage).toBe('Some context\nHello');
    expect(fullMessage).not.toContain('Relevant memories');

    proc.stdout.emit('data', Buffer.from('CEO response'));
    proc.emit('close', 0);

    const response = await responsePromise;
    expect(response).toBe('CEO response');
  });

  it('works with memory context but no conversation context', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const responsePromise = service.generateResponse(
      'Hello',
      '',
      'Relevant memories from past conversations:\n- Fact 1\n'
    );

    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const fullMessage = args[args.length - 1];
    expect(fullMessage).toContain('Relevant memories from past conversations:');
    expect(fullMessage).toContain('Hello');

    proc.stdout.emit('data', Buffer.from('CEO response'));
    proc.emit('close', 0);

    await responsePromise;
  });

  it('memory context format is clear and structured', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const memoryContext = 'Relevant memories from past conversations:\n- User prefers TypeScript\n- User works at Acme Corp\n';
    const responsePromise = service.generateResponse('Hello', '', memoryContext);

    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const fullMessage = args[args.length - 1];

    // Memory context should appear before the user message
    const memIdx = fullMessage.indexOf('Relevant memories');
    const msgIdx = fullMessage.indexOf('Hello');
    expect(memIdx).toBeLessThan(msgIdx);

    proc.stdout.emit('data', Buffer.from('CEO response'));
    proc.emit('close', 0);

    await responsePromise;
  });
});
