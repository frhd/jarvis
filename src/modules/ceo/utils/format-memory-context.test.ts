import { describe, it, expect } from 'vitest';
import { formatMemoryContext } from './format-memory-context.js';

function createMemory(content: string, score = 0.9) {
  return {
    id: 'mem-1',
    content,
    type: 'fact',
    confidence: 0.8,
    status: 'active' as const,
    senderId: null,
    chatId: null,
    userId: 'user-1',
    conversationId: 'conv-1',
    sourceMessageIds: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
    consolidatedInto: null,
    archivedAt: null,
    similarity: 0.85,
    recencyBoost: 0.1,
    score,
  };
}

describe('formatMemoryContext', () => {
  it('returns empty string for empty array', () => {
    expect(formatMemoryContext([])).toBe('');
  });

  it('formats single memory', () => {
    const result = formatMemoryContext([createMemory('User prefers TypeScript')]);
    expect(result).toBe(
      'Relevant memories from past conversations:\n- User prefers TypeScript\n'
    );
  });

  it('formats multiple memories', () => {
    const memories = [
      createMemory('User prefers TypeScript'),
      createMemory('User works on Jarvis project'),
    ];
    const result = formatMemoryContext(memories);
    expect(result).toContain('- User prefers TypeScript');
    expect(result).toContain('- User works on Jarvis project');
    expect(result).toMatch(/^Relevant memories from past conversations:\n/);
  });
});
