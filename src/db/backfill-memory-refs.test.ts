import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMemoryBackfill, type MemoryBackfillDeps } from './backfill-memory-refs';
import type { BackfillMapping } from './backfill-unified-identity';

// ============================================================================
// Test Helpers
// ============================================================================

interface MockMemoryRow {
  id: string;
  senderId: string | null;
  chatId: string | null;
  userId?: string | null;
  conversationId?: string | null;
}

function createMockDeps(
  memoryRows: MockMemoryRow[],
  mapping: BackfillMapping,
): MemoryBackfillDeps {
  // Track updates applied to rows
  const updates = new Map<string, Record<string, string>>();

  const mockDatabase = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((condition: unknown) => ({
          all: vi.fn().mockImplementation(() => {
            // Determine which filter is being applied by checking which rows match
            // If called with isNotNull(senderId), return rows with non-null senderId
            // If called with isNotNull(chatId), return rows with non-null chatId
            // We use a simple heuristic: track call order
            return memoryRows;
          }),
        })),
        all: vi.fn().mockReturnValue(memoryRows),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values: Record<string, string>) => ({
        where: vi.fn().mockImplementation(() => ({
          run: vi.fn().mockImplementation(() => {
            // Track which memory was updated
            const lastUpdateCall = mockDatabase.update.mock.calls;
            // Find the id from the condition - we track it via the set values
            for (const row of memoryRows) {
              if (values.userId && mapping.senderToUser[row.senderId!] === values.userId) {
                updates.set(row.id, { ...updates.get(row.id), ...values });
              }
              if (values.conversationId && mapping.chatToConversation[row.chatId!] === values.conversationId) {
                updates.set(row.id, { ...updates.get(row.id), ...values });
              }
            }
          }),
        })),
      })),
    }),
    _updates: updates,
  } as unknown as MemoryBackfillDeps['database'];

  return { database: mockDatabase, mapping };
}

// Simpler mock that tracks calls precisely
function createSimpleMockDeps(
  memoryRows: MockMemoryRow[],
  mapping: BackfillMapping,
): { deps: MemoryBackfillDeps; getUpdateCalls: () => Array<{ id: string; values: Record<string, string> }> } {
  const updateCalls: Array<{ id: string; values: Record<string, string> }> = [];
  let selectCallCount = 0;

  const senderRows = memoryRows.filter((r) => r.senderId !== null);
  const chatRows = memoryRows.filter((r) => r.chatId !== null);

  const mockDatabase = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        selectCallCount++;
        const currentCall = selectCallCount;
        return {
          where: vi.fn().mockImplementation(() => ({
            all: vi.fn().mockImplementation(() => {
              // First where() call = senderId query, second = chatId query
              if (currentCall === 2) return senderRows;
              if (currentCall === 3) return chatRows;
              return memoryRows;
            }),
          })),
          all: vi.fn().mockReturnValue(memoryRows),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((values: Record<string, string>) => ({
        where: vi.fn().mockImplementation(() => ({
          run: vi.fn().mockImplementation(() => {
            updateCalls.push({ id: 'tracked', values });
          }),
        })),
      })),
    })),
  } as unknown as MemoryBackfillDeps['database'];

  return {
    deps: { database: mockDatabase, mapping },
    getUpdateCalls: () => updateCalls,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('runMemoryBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates userId for memories with senderId in mapping', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'sender-1', chatId: null },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1' },
      chatToConversation: {},
    };

    const { deps, getUpdateCalls } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.userIdUpdated).toBe(1);
    expect(getUpdateCalls().some((c) => c.values.userId === 'user-1')).toBe(true);
  });

  it('updates conversationId for memories with chatId in mapping', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: null, chatId: 'chat-1' },
    ];
    const mapping: BackfillMapping = {
      senderToUser: {},
      chatToConversation: { 'chat-1': 'conv-1' },
    };

    const { deps, getUpdateCalls } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.conversationIdUpdated).toBe(1);
    expect(getUpdateCalls().some((c) => c.values.conversationId === 'conv-1')).toBe(true);
  });

  it('does not update userId when senderId is null', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: null, chatId: null },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1' },
      chatToConversation: {},
    };

    const { deps, getUpdateCalls } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.userIdUpdated).toBe(0);
    expect(getUpdateCalls()).toHaveLength(0);
  });

  it('skips and warns when senderId has no mapping', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'unmapped-sender', chatId: null },
    ];
    const mapping: BackfillMapping = {
      senderToUser: {},
      chatToConversation: {},
    };

    const { deps } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.userIdSkipped).toBe(1);
    expect(result.userIdUpdated).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No user mapping for senderId'),
    );

    warnSpy.mockRestore();
  });

  it('skips and warns when chatId has no mapping', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: null, chatId: 'unmapped-chat' },
    ];
    const mapping: BackfillMapping = {
      senderToUser: {},
      chatToConversation: {},
    };

    const { deps } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.conversationIdSkipped).toBe(1);
    expect(result.conversationIdUpdated).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No conversation mapping for chatId'),
    );

    warnSpy.mockRestore();
  });

  it('handles both senderId and chatId on same memory', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'sender-1', chatId: 'chat-1' },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1' },
      chatToConversation: { 'chat-1': 'conv-1' },
    };

    const { deps, getUpdateCalls } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.userIdUpdated).toBe(1);
    expect(result.conversationIdUpdated).toBe(1);
    expect(getUpdateCalls()).toHaveLength(2);
  });

  it('handles empty memories table', async () => {
    const mapping: BackfillMapping = {
      senderToUser: {},
      chatToConversation: {},
    };

    const { deps } = createSimpleMockDeps([], mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.totalMemories).toBe(0);
    expect(result.userIdUpdated).toBe(0);
    expect(result.conversationIdUpdated).toBe(0);
  });

  it('is idempotent: running twice produces same result', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'sender-1', chatId: 'chat-1' },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1' },
      chatToConversation: { 'chat-1': 'conv-1' },
    };

    const { deps: deps1 } = createSimpleMockDeps(rows, mapping);
    const result1 = await runMemoryBackfill(deps1);

    const { deps: deps2 } = createSimpleMockDeps(rows, mapping);
    const result2 = await runMemoryBackfill(deps2);

    expect(result1.userIdUpdated).toBe(result2.userIdUpdated);
    expect(result1.conversationIdUpdated).toBe(result2.conversationIdUpdated);
  });

  it('dry-run does not execute database updates', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'sender-1', chatId: 'chat-1' },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1' },
      chatToConversation: { 'chat-1': 'conv-1' },
    };

    const { deps, getUpdateCalls } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps, { dryRun: true });

    expect(result.userIdUpdated).toBe(1);
    expect(result.conversationIdUpdated).toBe(1);
    // No actual DB updates in dry-run
    expect(getUpdateCalls()).toHaveLength(0);
  });

  it('processes multiple memories correctly', async () => {
    const rows: MockMemoryRow[] = [
      { id: 'mem-1', senderId: 'sender-1', chatId: 'chat-1' },
      { id: 'mem-2', senderId: 'sender-2', chatId: null },
      { id: 'mem-3', senderId: null, chatId: 'chat-2' },
      { id: 'mem-4', senderId: null, chatId: null },
    ];
    const mapping: BackfillMapping = {
      senderToUser: { 'sender-1': 'user-1', 'sender-2': 'user-2' },
      chatToConversation: { 'chat-1': 'conv-1', 'chat-2': 'conv-2' },
    };

    const { deps } = createSimpleMockDeps(rows, mapping);
    const result = await runMemoryBackfill(deps);

    expect(result.totalMemories).toBe(4);
    expect(result.userIdUpdated).toBe(2);
    expect(result.conversationIdUpdated).toBe(2);
    expect(result.userIdSkipped).toBe(0);
    expect(result.conversationIdSkipped).toBe(0);
  });
});
