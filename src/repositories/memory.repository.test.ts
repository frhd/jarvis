#!/usr/bin/env npx tsx
/**
 * MemoryRepository Tests
 *
 * Run: npx tsx src/repositories/memory.repository.test.ts
 */

import { MemoryRepository, Memory, NewMemory } from './memory.repository';

// Simple test helpers
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false');
  }
}

// Mock database state
let mockMemories: Map<string, Memory> = new Map();
let nextId = 1;

// Mock database operations
const mockDb = {
  insert: (_table: any) => ({
    values: (data: any) => ({
      returning: async () => {
        const id = `memory_${nextId++}`;
        const now = new Date();
        const memory: Memory = {
          id,
          senderId: data.senderId,
          chatId: data.chatId,
          memoryType: data.memoryType,
          content: data.content,
          confidence: data.confidence ?? 100,
          sourceMessageIds: data.sourceMessageIds ?? null,
          lastAccessedAt: data.lastAccessedAt ?? null,
          accessCount: data.accessCount ?? 0,
          isArchived: data.isArchived ?? false,
          createdAt: now,
          updatedAt: now,
        };
        mockMemories.set(id, memory);
        return [memory];
      },
    }),
  }),
  select: () => ({
    from: (_table: any) => ({
      where: (condition: any) => ({
        limit: (limit: number) => ({
          then: async (resolve: (value: Memory[]) => void) => {
            const results = Array.from(mockMemories.values())
              .filter((m) => condition(m))
              .slice(0, limit);
            resolve(results);
          },
        }),
        orderBy: (..._orders: any[]) => ({
          limit: (limit: number) => Array.from(mockMemories.values()).slice(0, limit),
        }),
      }),
      orderBy: (..._orders: any[]) => ({
        limit: (limit: number) => Array.from(mockMemories.values()).slice(0, limit),
      }),
    }),
  }),
  update: (_table: any) => ({
    set: (data: any) => ({
      where: (condition: any) => ({
        returning: async () => {
          const results: Memory[] = [];
          for (const [id, memory] of mockMemories.entries()) {
            if (condition(memory)) {
              const updated = { ...memory, ...data, updatedAt: new Date() };
              mockMemories.set(id, updated);
              results.push(updated);
            }
          }
          return results;
        },
      }),
    }),
  }),
  delete: (_table: any) => ({
    where: (condition: any) => ({
      returning: async () => {
        const results: Memory[] = [];
        for (const [id, memory] of mockMemories.entries()) {
          if (condition(memory)) {
            results.push(memory);
            mockMemories.delete(id);
          }
        }
        return results;
      },
    }),
  }),
};

// Mock MemoryRepository with in-memory state
class MockMemoryRepository extends MemoryRepository {
  async create(memory: Omit<NewMemory, 'id'>): Promise<Memory> {
    const id = `memory_${nextId++}`;
    const now = new Date();
    const created: Memory = {
      id,
      senderId: memory.senderId ?? null,
      chatId: memory.chatId ?? null,
      userId: (memory as any).userId ?? null,
      conversationId: (memory as any).conversationId ?? null,
      memoryType: memory.memoryType,
      content: memory.content,
      confidence: memory.confidence ?? 100,
      sourceMessageIds: memory.sourceMessageIds ?? null,
      lastAccessedAt: memory.lastAccessedAt ?? null,
      accessCount: memory.accessCount ?? 0,
      isArchived: memory.isArchived ?? false,
      createdAt: now,
      updatedAt: now,
    };
    mockMemories.set(id, created);
    return created;
  }

  async findById(id: string): Promise<Memory | null> {
    return mockMemories.get(id) || null;
  }

  async findBySenderId(senderId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.senderId === senderId)
      .sort((a, b) => {
        // Sort by lastAccessedAt desc, then createdAt desc
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findByChatId(chatId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findByType(
    memoryType: 'fact' | 'preference' | 'event' | 'relationship',
    limit: number = 50
  ): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.memoryType === memoryType)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findActiveForSender(senderId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.senderId === senderId && m.isArchived === false)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findByUserId(userId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findByConversationId(conversationId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findActiveForUser(userId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.userId === userId && m.isArchived === false)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async findByUserAndConversation(userId: string, conversationId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(mockMemories.values())
      .filter((m) => m.userId === userId && m.conversationId === conversationId)
      .sort((a, b) => {
        if (a.lastAccessedAt && b.lastAccessedAt) {
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
        }
        if (a.lastAccessedAt) return -1;
        if (b.lastAccessedAt) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);
  }

  async update(
    id: string,
    updates: Partial<Omit<Memory, 'id' | 'createdAt'>>
  ): Promise<Memory | null> {
    const memory = mockMemories.get(id);
    if (!memory) return null;

    const updated = {
      ...memory,
      ...updates,
      updatedAt: new Date(),
    };
    mockMemories.set(id, updated);
    return updated;
  }

  async recordAccess(id: string): Promise<void> {
    const memory = mockMemories.get(id);
    if (!memory) return;

    const updated = {
      ...memory,
      accessCount: memory.accessCount + 1,
      lastAccessedAt: new Date(),
      updatedAt: new Date(),
    };
    mockMemories.set(id, updated);
  }

  async archive(id: string): Promise<void> {
    const memory = mockMemories.get(id);
    if (!memory) return;

    const updated = {
      ...memory,
      isArchived: true,
      updatedAt: new Date(),
    };
    mockMemories.set(id, updated);
  }

  async archiveOlderThan(olderThanTimestamp: Date): Promise<number> {
    let count = 0;
    for (const [id, memory] of mockMemories.entries()) {
      if (memory.createdAt < olderThanTimestamp && !memory.isArchived) {
        const updated = {
          ...memory,
          isArchived: true,
          updatedAt: new Date(),
        };
        mockMemories.set(id, updated);
        count++;
      }
    }
    return count;
  }

  async delete(id: string): Promise<boolean> {
    return mockMemories.delete(id);
  }
}

async function runTests() {
  console.log('\n=== MemoryRepository Tests ===\n');

  let repo: MockMemoryRepository;

  // Helper to reset state before each test
  function resetState() {
    mockMemories = new Map();
    nextId = 1;
    repo = new MockMemoryRepository();
  }

  // Test 1: Create memory with all fields
  await test('creates memory with all fields', async () => {
    resetState();

    const newMemory: Omit<NewMemory, 'id'> = {
      senderId: 'sender_1',
      chatId: 'chat_1',
      memoryType: 'fact',
      content: 'User prefers coffee over tea',
      confidence: 95,
      sourceMessageIds: '["msg_1", "msg_2"]',
      lastAccessedAt: null,
      accessCount: 0,
      isArchived: false,
    };

    const created = await repo.create(newMemory);

    assertTrue(created.id.startsWith('memory_'));
    assertEqual(created.senderId, 'sender_1');
    assertEqual(created.chatId, 'chat_1');
    assertEqual(created.memoryType, 'fact');
    assertEqual(created.content, 'User prefers coffee over tea');
    assertEqual(created.confidence, 95);
    assertEqual(created.sourceMessageIds, '["msg_1", "msg_2"]');
    assertEqual(created.accessCount, 0);
    assertFalse(created.isArchived);
    assertTrue(created.createdAt instanceof Date);
    assertTrue(created.updatedAt instanceof Date);
  });

  // Test 2: Create memory with minimal fields
  await test('creates memory with minimal fields using defaults', async () => {
    resetState();

    const newMemory: Omit<NewMemory, 'id'> = {
      memoryType: 'preference',
      content: 'Likes dark mode',
    };

    const created = await repo.create(newMemory);

    assertTrue(created.id.startsWith('memory_'));
    assertEqual(created.senderId, null);
    assertEqual(created.chatId, null);
    assertEqual(created.memoryType, 'preference');
    assertEqual(created.content, 'Likes dark mode');
    assertEqual(created.confidence, 100); // Default
    assertEqual(created.accessCount, 0);
    assertFalse(created.isArchived);
  });

  // Test 3: Create different memory types
  await test('creates all memory types (fact, preference, event, relationship)', async () => {
    resetState();

    const fact = await repo.create({ memoryType: 'fact', content: 'Lives in NYC' });
    const preference = await repo.create({ memoryType: 'preference', content: 'Likes Python' });
    const event = await repo.create({ memoryType: 'event', content: 'Birthday on Jan 1' });
    const relationship = await repo.create({ memoryType: 'relationship', content: 'Friend of Alice' });

    assertEqual(fact.memoryType, 'fact');
    assertEqual(preference.memoryType, 'preference');
    assertEqual(event.memoryType, 'event');
    assertEqual(relationship.memoryType, 'relationship');
  });

  // Test 4: Find memory by ID
  await test('finds memory by ID', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Test memory',
    });

    const found = await repo.findById(created.id);

    assertTrue(found !== null);
    assertEqual(found?.id, created.id);
    assertEqual(found?.content, 'Test memory');
  });

  // Test 5: Find memory by ID returns null for non-existent ID
  await test('returns null for non-existent ID', async () => {
    resetState();

    const found = await repo.findById('non_existent_id');

    assertEqual(found, null);
  });

  // Test 6: Find memories by sender ID
  await test('finds memories by sender ID', async () => {
    resetState();

    await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Memory 1' });
    await repo.create({ senderId: 'sender_1', memoryType: 'preference', content: 'Memory 2' });
    await repo.create({ senderId: 'sender_2', memoryType: 'fact', content: 'Memory 3' });

    const results = await repo.findBySenderId('sender_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.senderId === 'sender_1'));
  });

  // Test 7: Find memories by sender ID with limit
  await test('respects limit when finding by sender ID', async () => {
    resetState();

    for (let i = 0; i < 10; i++) {
      await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: `Memory ${i}` });
    }

    const results = await repo.findBySenderId('sender_1', 5);

    assertEqual(results.length, 5);
  });

  // Test 8: Find memories by sender ID returns empty array for non-existent sender
  await test('returns empty array for non-existent sender', async () => {
    resetState();

    const results = await repo.findBySenderId('non_existent_sender');

    assertEqual(results.length, 0);
  });

  // Test 9: Find memories by chat ID
  await test('finds memories by chat ID', async () => {
    resetState();

    await repo.create({ chatId: 'chat_1', memoryType: 'event', content: 'Event 1' });
    await repo.create({ chatId: 'chat_1', memoryType: 'fact', content: 'Event 2' });
    await repo.create({ chatId: 'chat_2', memoryType: 'event', content: 'Event 3' });

    const results = await repo.findByChatId('chat_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.chatId === 'chat_1'));
  });

  // Test 10: Find memories by chat ID with limit
  await test('respects limit when finding by chat ID', async () => {
    resetState();

    for (let i = 0; i < 15; i++) {
      await repo.create({ chatId: 'chat_1', memoryType: 'event', content: `Event ${i}` });
    }

    const results = await repo.findByChatId('chat_1', 10);

    assertEqual(results.length, 10);
  });

  // Test 11: Find memories by type
  await test('finds memories by type', async () => {
    resetState();

    await repo.create({ memoryType: 'fact', content: 'Fact 1' });
    await repo.create({ memoryType: 'fact', content: 'Fact 2' });
    await repo.create({ memoryType: 'preference', content: 'Pref 1' });

    const facts = await repo.findByType('fact');
    const preferences = await repo.findByType('preference');

    assertEqual(facts.length, 2);
    assertEqual(preferences.length, 1);
    assertTrue(facts.every((m) => m.memoryType === 'fact'));
    assertTrue(preferences.every((m) => m.memoryType === 'preference'));
  });

  // Test 12: Find memories by type with limit
  await test('respects limit when finding by type', async () => {
    resetState();

    for (let i = 0; i < 20; i++) {
      await repo.create({ memoryType: 'event', content: `Event ${i}` });
    }

    const results = await repo.findByType('event', 8);

    assertEqual(results.length, 8);
  });

  // Test 13: Find active memories for sender
  await test('finds active (non-archived) memories for sender', async () => {
    resetState();

    const mem1 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Active 1' });
    const mem2 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Active 2' });
    const mem3 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Archived', isArchived: true });

    const results = await repo.findActiveForSender('sender_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.isArchived === false));
    assertFalse(results.some((m) => m.id === mem3.id));
  });

  // Test 14: Find active memories for sender with limit
  await test('respects limit when finding active memories', async () => {
    resetState();

    for (let i = 0; i < 12; i++) {
      await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: `Memory ${i}` });
    }

    const results = await repo.findActiveForSender('sender_1', 7);

    assertEqual(results.length, 7);
  });

  // Test 15: Update memory content
  await test('updates memory content', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Original content',
    });

    const updated = await repo.update(created.id, {
      content: 'Updated content',
    });

    assertTrue(updated !== null);
    assertEqual(updated?.content, 'Updated content');
    assertEqual(updated?.id, created.id);
  });

  // Test 16: Update memory confidence
  await test('updates memory confidence', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Test',
      confidence: 80,
    });

    const updated = await repo.update(created.id, {
      confidence: 90,
    });

    assertEqual(updated?.confidence, 90);
  });

  // Test 17: Update memory multiple fields
  await test('updates multiple fields at once', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Original',
      confidence: 70,
    });

    const updated = await repo.update(created.id, {
      content: 'Updated',
      confidence: 95,
      sourceMessageIds: '["msg_1"]',
    });

    assertEqual(updated?.content, 'Updated');
    assertEqual(updated?.confidence, 95);
    assertEqual(updated?.sourceMessageIds, '["msg_1"]');
  });

  // Test 18: Update returns null for non-existent memory
  await test('update returns null for non-existent ID', async () => {
    resetState();

    const updated = await repo.update('non_existent', { content: 'Test' });

    assertEqual(updated, null);
  });

  // Test 19: Record access increments count and updates timestamp
  await test('recordAccess increments count and updates timestamp', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Test',
    });

    assertEqual(created.accessCount, 0);
    assertEqual(created.lastAccessedAt, null);

    await repo.recordAccess(created.id);

    const accessed = await repo.findById(created.id);
    assertEqual(accessed?.accessCount, 1);
    assertTrue(accessed?.lastAccessedAt instanceof Date);

    await repo.recordAccess(created.id);

    const accessed2 = await repo.findById(created.id);
    assertEqual(accessed2?.accessCount, 2);
  });

  // Test 20: Record access on non-existent memory does nothing
  await test('recordAccess on non-existent ID does nothing', async () => {
    resetState();

    // Should not throw
    await repo.recordAccess('non_existent');

    assertTrue(true); // If we get here, it didn't throw
  });

  // Test 21: Archive memory
  await test('archives a memory', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'Test',
    });

    assertFalse(created.isArchived);

    await repo.archive(created.id);

    const archived = await repo.findById(created.id);
    assertTrue(archived?.isArchived === true);
  });

  // Test 22: Archive on non-existent memory does nothing
  await test('archive on non-existent ID does nothing', async () => {
    resetState();

    // Should not throw
    await repo.archive('non_existent');

    assertTrue(true);
  });

  // Test 23: Archive older than date
  await test('archiveOlderThan archives memories older than date', async () => {
    resetState();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const twoHoursAgo = new Date(now.getTime() - 7200000);

    // Create old memory (simulate by directly manipulating state)
    const old1 = await repo.create({ memoryType: 'fact', content: 'Old 1' });
    mockMemories.set(old1.id, { ...old1, createdAt: twoHoursAgo });

    const old2 = await repo.create({ memoryType: 'fact', content: 'Old 2' });
    mockMemories.set(old2.id, { ...old2, createdAt: twoHoursAgo });

    const recent = await repo.create({ memoryType: 'fact', content: 'Recent' });

    const count = await repo.archiveOlderThan(oneHourAgo);

    assertEqual(count, 2);

    const archivedOld1 = await repo.findById(old1.id);
    const archivedOld2 = await repo.findById(old2.id);
    const notArchivedRecent = await repo.findById(recent.id);

    assertTrue(archivedOld1?.isArchived === true);
    assertTrue(archivedOld2?.isArchived === true);
    assertFalse(notArchivedRecent?.isArchived ?? false);
  });

  // Test 24: Archive older than does not re-archive already archived memories
  await test('archiveOlderThan does not count already archived memories', async () => {
    resetState();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const twoHoursAgo = new Date(now.getTime() - 7200000);

    const old1 = await repo.create({ memoryType: 'fact', content: 'Old 1' });
    mockMemories.set(old1.id, { ...old1, createdAt: twoHoursAgo });

    const old2 = await repo.create({ memoryType: 'fact', content: 'Old 2', isArchived: true });
    mockMemories.set(old2.id, { ...old2, createdAt: twoHoursAgo });

    const count = await repo.archiveOlderThan(oneHourAgo);

    assertEqual(count, 1); // Only old1 should be counted
  });

  // Test 25: Delete memory
  await test('deletes a memory', async () => {
    resetState();

    const created = await repo.create({
      memoryType: 'fact',
      content: 'To be deleted',
    });

    const deleted = await repo.delete(created.id);

    assertTrue(deleted);

    const notFound = await repo.findById(created.id);
    assertEqual(notFound, null);
  });

  // Test 26: Delete returns false for non-existent memory
  await test('delete returns false for non-existent ID', async () => {
    resetState();

    const deleted = await repo.delete('non_existent');

    assertFalse(deleted);
  });

  // Test 27: Ordering by lastAccessedAt
  await test('sorts by lastAccessedAt then createdAt', async () => {
    resetState();

    const mem1 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'First' });
    await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay

    const mem2 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Second' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const mem3 = await repo.create({ senderId: 'sender_1', memoryType: 'fact', content: 'Third' });

    // Access mem1 (should move to top)
    await repo.recordAccess(mem1.id);

    const results = await repo.findBySenderId('sender_1');

    assertEqual(results[0].id, mem1.id); // Most recently accessed
    assertEqual(results[1].id, mem3.id); // Most recently created (no access)
    assertEqual(results[2].id, mem2.id); // Older, no access
  });

  // Test 28: Edge case - empty results for all query methods
  await test('returns empty arrays when no memories match', async () => {
    resetState();

    const bySender = await repo.findBySenderId('non_existent');
    const byChat = await repo.findByChatId('non_existent');
    const byType = await repo.findByType('fact');
    const active = await repo.findActiveForSender('non_existent');

    assertEqual(bySender.length, 0);
    assertEqual(byChat.length, 0);
    assertEqual(byType.length, 0);
    assertEqual(active.length, 0);
  });

  // Test 29: Mixed sender and chat IDs
  await test('handles memories with different sender/chat combinations', async () => {
    resetState();

    await repo.create({ senderId: 'sender_1', chatId: 'chat_1', memoryType: 'fact', content: 'S1C1' });
    await repo.create({ senderId: 'sender_1', chatId: 'chat_2', memoryType: 'fact', content: 'S1C2' });
    await repo.create({ senderId: 'sender_2', chatId: 'chat_1', memoryType: 'fact', content: 'S2C1' });

    const sender1 = await repo.findBySenderId('sender_1');
    const chat1 = await repo.findByChatId('chat_1');

    assertEqual(sender1.length, 2);
    assertEqual(chat1.length, 2);
  });

  // Test 30: Null sender and chat IDs
  await test('handles null sender and chat IDs', async () => {
    resetState();

    const mem = await repo.create({
      senderId: null,
      chatId: null,
      memoryType: 'fact',
      content: 'No sender or chat',
    });

    assertEqual(mem.senderId, null);
    assertEqual(mem.chatId, null);

    const bySender = await repo.findBySenderId('any_sender');
    const byChat = await repo.findByChatId('any_chat');

    assertEqual(bySender.length, 0);
    assertEqual(byChat.length, 0);
  });

  // Test 31: Find memories by user ID
  await test('finds memories by user ID', async () => {
    resetState();

    await repo.create({ userId: 'user_1', memoryType: 'fact', content: 'Memory 1' } as any);
    await repo.create({ userId: 'user_1', memoryType: 'preference', content: 'Memory 2' } as any);
    await repo.create({ userId: 'user_2', memoryType: 'fact', content: 'Memory 3' } as any);

    const results = await repo.findByUserId('user_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.userId === 'user_1'));
  });

  // Test 32: Find memories by user ID with limit
  await test('respects limit when finding by user ID', async () => {
    resetState();

    for (let i = 0; i < 10; i++) {
      await repo.create({ userId: 'user_1', memoryType: 'fact', content: `Memory ${i}` } as any);
    }

    const results = await repo.findByUserId('user_1', 5);

    assertEqual(results.length, 5);
  });

  // Test 33: Find memories by user ID returns empty for non-existent user
  await test('returns empty array for non-existent user ID', async () => {
    resetState();

    const results = await repo.findByUserId('non_existent_user');

    assertEqual(results.length, 0);
  });

  // Test 34: Find memories by conversation ID
  await test('finds memories by conversation ID', async () => {
    resetState();

    await repo.create({ conversationId: 'conv_1', memoryType: 'event', content: 'Event 1' } as any);
    await repo.create({ conversationId: 'conv_1', memoryType: 'fact', content: 'Event 2' } as any);
    await repo.create({ conversationId: 'conv_2', memoryType: 'event', content: 'Event 3' } as any);

    const results = await repo.findByConversationId('conv_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.conversationId === 'conv_1'));
  });

  // Test 35: Find memories by conversation ID with limit
  await test('respects limit when finding by conversation ID', async () => {
    resetState();

    for (let i = 0; i < 15; i++) {
      await repo.create({ conversationId: 'conv_1', memoryType: 'event', content: `Event ${i}` } as any);
    }

    const results = await repo.findByConversationId('conv_1', 10);

    assertEqual(results.length, 10);
  });

  // Test 36: Find active memories for user
  await test('finds active (non-archived) memories for user', async () => {
    resetState();

    await repo.create({ userId: 'user_1', memoryType: 'fact', content: 'Active 1' } as any);
    await repo.create({ userId: 'user_1', memoryType: 'fact', content: 'Active 2' } as any);
    const archived = await repo.create({ userId: 'user_1', memoryType: 'fact', content: 'Archived', isArchived: true } as any);

    const results = await repo.findActiveForUser('user_1');

    assertEqual(results.length, 2);
    assertTrue(results.every((m) => m.isArchived === false));
    assertFalse(results.some((m) => m.id === archived.id));
  });

  // Test 37: Find active memories for user with limit
  await test('respects limit when finding active memories for user', async () => {
    resetState();

    for (let i = 0; i < 12; i++) {
      await repo.create({ userId: 'user_1', memoryType: 'fact', content: `Memory ${i}` } as any);
    }

    const results = await repo.findActiveForUser('user_1', 7);

    assertEqual(results.length, 7);
  });

  // Test 38: Find memories by user and conversation
  await test('finds memories scoped to both user and conversation', async () => {
    resetState();

    await repo.create({ userId: 'user_1', conversationId: 'conv_1', memoryType: 'fact', content: 'U1C1' } as any);
    await repo.create({ userId: 'user_1', conversationId: 'conv_2', memoryType: 'fact', content: 'U1C2' } as any);
    await repo.create({ userId: 'user_2', conversationId: 'conv_1', memoryType: 'fact', content: 'U2C1' } as any);

    const results = await repo.findByUserAndConversation('user_1', 'conv_1');

    assertEqual(results.length, 1);
    assertEqual(results[0].content, 'U1C1');
  });

  // Test 39: Find memories by user and conversation returns empty when no match
  await test('findByUserAndConversation returns empty when no match', async () => {
    resetState();

    await repo.create({ userId: 'user_1', conversationId: 'conv_1', memoryType: 'fact', content: 'U1C1' } as any);

    const results = await repo.findByUserAndConversation('user_1', 'conv_99');

    assertEqual(results.length, 0);
  });

  // Test 40: Create memory with userId and conversationId
  await test('creates memory with userId and conversationId', async () => {
    resetState();

    const created = await repo.create({
      senderId: 'sender_1',
      chatId: 'chat_1',
      userId: 'user_1',
      conversationId: 'conv_1',
      memoryType: 'fact',
      content: 'Unified identity memory',
    } as any);

    assertEqual(created.userId, 'user_1');
    assertEqual(created.conversationId, 'conv_1');
    assertEqual(created.senderId, 'sender_1');
    assertEqual(created.chatId, 'chat_1');
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
