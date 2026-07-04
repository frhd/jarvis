/**
 * Repository interfaces for data access abstraction
 */

import type {
  Memory,
  NewMemory,
  Message,
  NewMessage,
  Embedding,
  NewEmbedding,
  SemanticCacheEntry,
  NewSemanticCacheEntry,
  QueueItem,
  NewQueueItem,
  Sender,
  NewSender,
  Chat,
  NewChat,
  User,
  NewUser,
  PlatformIdentity,
  NewPlatformIdentity,
  Conversation,
  NewConversation,
} from '../types/index.js';

export interface IRepository<T, Insert> {
  create(data: Omit<Insert, 'id'>): Promise<T>;
  findById(id: string): Promise<T | null>;
  update(id: string, data: Partial<Insert>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

export interface IMemoryRepository extends IRepository<Memory, NewMemory> {
  findByType(type: string, limit?: number): Promise<Memory[]>;
  findByUserId(userId: string, limit?: number): Promise<Memory[]>;
  findByConversationId(conversationId: string, limit?: number): Promise<Memory[]>;
  findActiveForUser(userId: string, limit?: number): Promise<Memory[]>;
  findByUserAndConversation(userId: string, conversationId: string, limit?: number): Promise<Memory[]>;
  recordAccess(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  archiveOlderThan(date: Date): Promise<number>;
  cleanupOrphanedUserIds(): Promise<number>;
}

export interface IMessageRepository extends IRepository<Message, NewMessage> {
  findByTelegramId(chatId: string, telegramMessageId: number): Promise<Message | null>;
  findRecentByChatId(chatId: string, limit: number): Promise<Message[]>;
  findByDateRange(chatId: string, start: Date, end: Date): Promise<Message[]>;
  findRecentMessages(limit: number): Promise<Message[]>;
}

export interface SimilarityResult {
  sourceType: string;
  sourceId: string;
  distance: number;
}

export interface FindSimilarOptions {
  limit?: number;
  threshold?: number;
  sourceType?: string;
}

export interface IEmbeddingRepository {
  create(embedding: Omit<NewEmbedding, 'id'>): Promise<Embedding>;
  findById(id: string): Promise<Embedding | null>;
  findBySource(sourceType: string, sourceId: string): Promise<Embedding | null>;
  findSimilar(embedding: number[], options?: FindSimilarOptions): Promise<SimilarityResult[]>;
  deleteBySource(sourceType: string, sourceId: string): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface IQueueRepository {
  enqueue(item: Omit<NewQueueItem, 'id'>): Promise<QueueItem>;
  dequeue(): Promise<QueueItem | null>;
  markComplete(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  getDepth(): Promise<number>;
  findByMessageId(messageId: string): Promise<QueueItem | null>;
  getPending(limit?: number): Promise<QueueItem[]>;
}

export interface CacheLookupResult {
  entry: SemanticCacheEntry;
  similarity: number;
}

export interface ICacheRepository {
  create(entry: Omit<NewSemanticCacheEntry, 'id'>): Promise<SemanticCacheEntry>;
  findById(id: string): Promise<SemanticCacheEntry | null>;
  findByExactMatch(promptHash: string): Promise<SemanticCacheEntry | null>;
  findBySimilarity(
    embedding: number[],
    options?: { limit?: number; minSimilarity?: number }
  ): Promise<CacheLookupResult[]>;
  recordHit(id: string): Promise<void>;
  deleteExpired(): Promise<number>;
  deleteById(id: string): Promise<boolean>;
  deleteLRU(count: number): Promise<number>;
  count(): Promise<number>;
  invalidateByIntent(intent: string): Promise<number>;
  clear(): Promise<number>;
}

export interface ISenderRepository extends IRepository<Sender, NewSender> {
  findByTelegramId(telegramId: string): Promise<Sender | null>;
  upsert(sender: Omit<NewSender, 'id'>): Promise<Sender>;
}

export interface IChatRepository extends IRepository<Chat, NewChat> {
  findByTelegramId(telegramId: string): Promise<Chat | null>;
  upsert(chat: Omit<NewChat, 'id'>): Promise<Chat>;
  updatePreferredLanguage(chatId: string, language: string): Promise<Chat | null>;
}

export interface IUserRepository extends IRepository<User, NewUser> {
  findAll(limit?: number, offset?: number): Promise<User[]>;
}

export interface IPlatformIdentityRepository extends IRepository<PlatformIdentity, NewPlatformIdentity> {
  findByPlatformUser(platform: string, platformUserId: string): Promise<PlatformIdentity | null>;
  findByUserId(userId: string): Promise<PlatformIdentity[]>;
}

export interface IConversationRepository extends IRepository<Conversation, NewConversation> {
  findByPlatformConversation(platform: string, platformConversationId: string): Promise<Conversation | null>;
  findByType(type: string): Promise<Conversation[]>;
  findByPlatform(platform: string): Promise<Conversation[]>;
}
