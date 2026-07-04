import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb() {
  const connection = new Database(':memory:');
  connection.pragma('journal_mode = WAL');
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
  return { db, connection };
}

describe('Unified Identity Schema', () => {
  let db: ReturnType<typeof drizzle>;
  let connection: Database.Database;

  beforeEach(() => {
    ({ db, connection } = createTestDb());
  });

  afterEach(() => {
    connection.close();
  });

  describe('users table', () => {
    it('creates a user with id and displayName', () => {
      const id = randomUUID();
      db.insert(schema.users).values({ id, displayName: 'Test User' }).run();

      const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all();
      expect(user).toBeDefined();
      expect(user.id).toBe(id);
      expect(user.displayName).toBe('Test User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('allows null displayName', () => {
      const id = randomUUID();
      db.insert(schema.users).values({ id }).run();

      const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all();
      expect(user.displayName).toBeNull();
    });
  });

  describe('platformIdentities table', () => {
    it('creates a platform identity linked to a user', () => {
      const userId = randomUUID();
      const identityId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();
      db.insert(schema.platformIdentities).values({
        id: identityId,
        userId,
        platform: 'telegram',
        platformUserId: '12345',
        metadata: JSON.stringify({ firstName: 'Test' }),
      }).run();

      const [identity] = db.select().from(schema.platformIdentities)
        .where(eq(schema.platformIdentities.id, identityId)).all();
      expect(identity).toBeDefined();
      expect(identity.userId).toBe(userId);
      expect(identity.platform).toBe('telegram');
      expect(identity.platformUserId).toBe('12345');
      expect(JSON.parse(identity.metadata!)).toEqual({ firstName: 'Test' });
    });

    it('enforces FK constraint to users table', () => {
      expect(() => {
        db.insert(schema.platformIdentities).values({
          id: randomUUID(),
          userId: 'nonexistent-user',
          platform: 'telegram',
          platformUserId: '12345',
        }).run();
      }).toThrow();
    });

    it('enforces unique constraint on (platform, platformUserId)', () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      db.insert(schema.platformIdentities).values({
        id: randomUUID(),
        userId,
        platform: 'telegram',
        platformUserId: '12345',
      }).run();

      expect(() => {
        db.insert(schema.platformIdentities).values({
          id: randomUUID(),
          userId,
          platform: 'telegram',
          platformUserId: '12345',
        }).run();
      }).toThrow();
    });

    it('allows same platformUserId on different platforms', () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      db.insert(schema.platformIdentities).values({
        id: randomUUID(),
        userId,
        platform: 'telegram',
        platformUserId: '12345',
      }).run();

      expect(() => {
        db.insert(schema.platformIdentities).values({
          id: randomUUID(),
          userId,
          platform: 'slack',
          platformUserId: '12345',
        }).run();
      }).not.toThrow();
    });
  });

  describe('conversations table', () => {
    it('creates a conversation with correct fields', () => {
      const id = randomUUID();
      db.insert(schema.conversations).values({
        id,
        platform: 'telegram',
        platformConversationId: 'chat-789',
        type: 'dm',
        title: 'DM with User',
        metadata: JSON.stringify({ telegramType: 'private' }),
      }).run();

      const [conv] = db.select().from(schema.conversations)
        .where(eq(schema.conversations.id, id)).all();
      expect(conv).toBeDefined();
      expect(conv.platform).toBe('telegram');
      expect(conv.platformConversationId).toBe('chat-789');
      expect(conv.type).toBe('dm');
      expect(conv.title).toBe('DM with User');
    });

    it('enforces unique constraint on (platform, platformConversationId)', () => {
      db.insert(schema.conversations).values({
        id: randomUUID(),
        platform: 'telegram',
        platformConversationId: 'chat-789',
        type: 'dm',
      }).run();

      expect(() => {
        db.insert(schema.conversations).values({
          id: randomUUID(),
          platform: 'telegram',
          platformConversationId: 'chat-789',
          type: 'group',
        }).run();
      }).toThrow();
    });

    it('allows same platformConversationId on different platforms', () => {
      db.insert(schema.conversations).values({
        id: randomUUID(),
        platform: 'telegram',
        platformConversationId: 'channel-1',
        type: 'channel',
      }).run();

      expect(() => {
        db.insert(schema.conversations).values({
          id: randomUUID(),
          platform: 'slack',
          platformConversationId: 'channel-1',
          type: 'channel',
        }).run();
      }).not.toThrow();
    });
  });
});
