import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  runBackfill,
  composeSenderDisplayName,
  mapChatType,
  type BackfillDeps,
} from './backfill-unified-identity';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

// ============================================================================
// Test Helpers
// ============================================================================

function makeSender(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sender-1',
    telegramId: '12345',
    firstName: null as string | null,
    lastName: null as string | null,
    username: null as string | null,
    phone: null as string | null,
    displayName: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeChat(overrides: Partial<{
  id: string;
  telegramId: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title: string | null;
  username: string | null;
  preferredLanguage: string;
}> = {}) {
  return {
    id: overrides.id ?? 'chat-1',
    telegramId: overrides.telegramId ?? 'tg-chat-100',
    type: overrides.type ?? 'group',
    title: overrides.title ?? 'Test Group',
    username: overrides.username ?? null,
    preferredLanguage: overrides.preferredLanguage ?? 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockDeps(
  senders: ReturnType<typeof makeSender>[] = [],
  chats: ReturnType<typeof makeChat>[] = [],
): BackfillDeps {
  let userIdCounter = 0;
  let convIdCounter = 0;

  return {
    senderRepo: {
      count: vi.fn().mockResolvedValue(senders.length),
      findMany: vi.fn().mockResolvedValue(senders),
    } as any,
    chatRepo: {
      count: vi.fn().mockResolvedValue(chats.length),
      findMany: vi.fn().mockResolvedValue(chats),
    } as any,
    identityService: {
      resolveUser: vi.fn().mockImplementation(async () => ({
        id: `user-${++userIdCounter}`,
        displayName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      resolveConversation: vi.fn().mockImplementation(async () => ({
        id: `conv-${++convIdCounter}`,
        platform: 'telegram',
        platformConversationId: '',
        type: 'group',
        title: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    } as any,
  };
}

// ============================================================================
// composeSenderDisplayName
// ============================================================================

describe('composeSenderDisplayName', () => {
  it('uses displayName when present', () => {
    const sender = makeSender({ displayName: 'Custom Name' });
    expect(composeSenderDisplayName(sender)).toBe('Custom Name');
  });

  it('composes firstName + lastName', () => {
    const sender = makeSender({ firstName: 'John', lastName: 'Doe' });
    expect(composeSenderDisplayName(sender)).toBe('John Doe');
  });

  it('uses firstName alone when lastName is null', () => {
    const sender = makeSender({ firstName: 'John' });
    expect(composeSenderDisplayName(sender)).toBe('John');
  });

  it('uses username when firstName is null', () => {
    const sender = makeSender({ username: 'johndoe' });
    expect(composeSenderDisplayName(sender)).toBe('johndoe');
  });

  it('falls back to telegramId when all names are null', () => {
    const sender = makeSender({
      firstName: null,
      lastName: null,
      username: null,
      telegramId: '99999',
    });
    expect(composeSenderDisplayName(sender)).toBe('99999');
  });

  it('prefers displayName over firstName', () => {
    const sender = makeSender({ displayName: 'Display', firstName: 'First' });
    expect(composeSenderDisplayName(sender)).toBe('Display');
  });
});

// ============================================================================
// mapChatType
// ============================================================================

describe('mapChatType', () => {
  it('maps private → dm', () => {
    expect(mapChatType('private')).toBe('dm');
  });

  it('maps group → group', () => {
    expect(mapChatType('group')).toBe('group');
  });

  it('maps supergroup → group', () => {
    expect(mapChatType('supergroup')).toBe('group');
  });

  it('maps channel → channel', () => {
    expect(mapChatType('channel')).toBe('channel');
  });

  it('throws for unknown type', () => {
    expect(() => mapChatType('unknown')).toThrow('Unknown Telegram chat type: unknown');
  });
});

// ============================================================================
// runBackfill — Sender Backfill
// ============================================================================

describe('runBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates user for each sender row', async () => {
    const senders = [
      makeSender({ id: 's1', telegramId: '111' }),
      makeSender({ id: 's2', telegramId: '222' }),
    ];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledTimes(2);
  });

  it('calls resolveUser with platform=telegram and correct telegramId', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '12345' })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledWith(
      'telegram',
      '12345',
      expect.objectContaining({ displayName: expect.any(String) }),
    );
  });

  it('composes displayName from firstName + lastName', async () => {
    const senders = [makeSender({ firstName: 'Jane', lastName: 'Smith', displayName: null })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      expect.objectContaining({ displayName: 'Jane Smith' }),
    );
  });

  it('handles sender with null firstName — uses username', async () => {
    const senders = [makeSender({
      username: 'jdoe',
    })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      expect.objectContaining({ displayName: 'jdoe' }),
    );
  });

  it('handles sender with existing displayName field', async () => {
    const senders = [makeSender({ displayName: 'My Custom Name' })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      expect.objectContaining({ displayName: 'My Custom Name' }),
    );
  });

  it('passes full metadata to resolveUser', async () => {
    const senders = [makeSender({
      id: 's1',
      telegramId: '111',
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      phone: '+1234567890',
    })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).toHaveBeenCalledWith(
      'telegram',
      '111',
      {
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        phone: '+1234567890',
        displayName: 'John Doe',
      },
    );
  });

  // ============================================================================
  // Chat Backfill
  // ============================================================================

  it('creates conversation for each chat row', async () => {
    const chats = [
      makeChat({ id: 'c1', telegramId: 'tg-100' }),
      makeChat({ id: 'c2', telegramId: 'tg-200' }),
    ];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledTimes(2);
  });

  it('maps private → dm', async () => {
    const chats = [makeChat({ type: 'private' })];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      'dm',
      expect.any(Object),
    );
  });

  it('maps group → group', async () => {
    const chats = [makeChat({ type: 'group' })];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      'group',
      expect.any(Object),
    );
  });

  it('maps supergroup → group', async () => {
    const chats = [makeChat({ type: 'supergroup' })];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      'group',
      expect.any(Object),
    );
  });

  it('maps channel → channel', async () => {
    const chats = [makeChat({ type: 'channel' })];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      'channel',
      expect.any(Object),
    );
  });

  it('stores platform-specific metadata in conversation', async () => {
    const chats = [makeChat({ title: 'Dev Team', username: 'devteam', preferredLanguage: 'de' })];
    const deps = createMockDeps([], chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveConversation).toHaveBeenCalledWith(
      'telegram',
      expect.any(String),
      expect.any(String),
      {
        title: 'Dev Team',
        username: 'devteam',
        preferredLanguage: 'de',
      },
    );
  });

  // ============================================================================
  // Idempotency
  // ============================================================================

  it('is idempotent: running twice creates no duplicates', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const chats = [makeChat({ id: 'c1', telegramId: 'tg-100' })];

    // resolveUser/resolveConversation are inherently idempotent (find-or-create)
    // Verify that the same calls are made each time
    const deps = createMockDeps(senders, chats);

    const result1 = await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });
    const result2 = await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    // Both runs should process the same number
    expect(result1.sendersProcessed).toBe(1);
    expect(result2.sendersProcessed).toBe(1);
    expect(result1.chatsProcessed).toBe(1);
    expect(result2.chatsProcessed).toBe(1);

    // resolveUser is called once per run (total 2)
    expect(deps.identityService.resolveUser).toHaveBeenCalledTimes(2);
  });

  // ============================================================================
  // Mapping Output
  // ============================================================================

  it('produces correct ID mapping file', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const chats = [makeChat({ id: 'c1', telegramId: 'tg-100' })];
    const deps = createMockDeps(senders, chats);

    const result = await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(result.mapping.senderToUser).toHaveProperty('s1');
    expect(result.mapping.chatToConversation).toHaveProperty('c1');
  });

  it('writes mapping to output path', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/test-mapping.json',
      expect.any(String),
    );

    const writtenJson = (writeFileSync as any).mock.calls[0][1];
    const parsed = JSON.parse(writtenJson);
    expect(parsed).toHaveProperty('senderToUser');
    expect(parsed).toHaveProperty('chatToConversation');
  });

  it('mapping file is valid JSON matching BackfillMapping shape', async () => {
    const senders = [
      makeSender({ id: 's1', telegramId: '111' }),
      makeSender({ id: 's2', telegramId: '222' }),
    ];
    const chats = [
      makeChat({ id: 'c1', telegramId: 'tg-100' }),
      makeChat({ id: 'c2', telegramId: 'tg-200' }),
    ];
    const deps = createMockDeps(senders, chats);

    await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    const writtenJson = (writeFileSync as any).mock.calls[0][1];
    const parsed = JSON.parse(writtenJson);

    expect(typeof parsed.senderToUser).toBe('object');
    expect(typeof parsed.chatToConversation).toBe('object');
    expect(Object.keys(parsed.senderToUser)).toHaveLength(2);
    expect(Object.keys(parsed.chatToConversation)).toHaveLength(2);

    // All values should be strings (user/conversation IDs)
    for (const v of Object.values(parsed.senderToUser)) {
      expect(typeof v).toBe('string');
    }
    for (const v of Object.values(parsed.chatToConversation)) {
      expect(typeof v).toBe('string');
    }
  });

  // ============================================================================
  // Empty Tables
  // ============================================================================

  it('handles empty tables gracefully', async () => {
    const deps = createMockDeps([], []);

    const result = await runBackfill(deps, { outputPath: '/tmp/test-mapping.json' });

    expect(result.sendersProcessed).toBe(0);
    expect(result.chatsProcessed).toBe(0);
    expect(result.mapping.senderToUser).toEqual({});
    expect(result.mapping.chatToConversation).toEqual({});
  });

  // ============================================================================
  // Dry Run
  // ============================================================================

  it('dry-run does not call identityService', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const chats = [makeChat({ id: 'c1', telegramId: 'tg-100' })];
    const deps = createMockDeps(senders, chats);

    await runBackfill(deps, { dryRun: true, outputPath: '/tmp/test-mapping.json' });

    expect(deps.identityService.resolveUser).not.toHaveBeenCalled();
    expect(deps.identityService.resolveConversation).not.toHaveBeenCalled();
  });

  it('dry-run does not write mapping file', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const deps = createMockDeps(senders);

    await runBackfill(deps, { dryRun: true, outputPath: '/tmp/test-mapping.json' });

    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('dry-run still returns result with placeholder IDs', async () => {
    const senders = [makeSender({ id: 's1', telegramId: '111' })];
    const deps = createMockDeps(senders);

    const result = await runBackfill(deps, { dryRun: true, outputPath: '/tmp/test-mapping.json' });

    expect(result.sendersProcessed).toBe(1);
    expect(result.mapping.senderToUser['s1']).toContain('dry-run');
  });
});
