import type { Memory } from '@/types/index.js';

/**
 * Formats retrieved memories into a context string for inclusion in LLM prompts.
 * Returns empty string if no memories are provided.
 */
export function formatMemoryContext(
  memories: Array<Memory & { similarity: number; recencyBoost: number; score: number }>
): string {
  if (!memories.length) return '';

  const lines = memories.map((m) => `- ${m.content}`);
  return `Relevant memories from past conversations:\n${lines.join('\n')}\n`;
}
