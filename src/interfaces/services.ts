/**
 * Core service interfaces for dependency inversion
 */

import type {
  Message,
  Memory,
  Chat,
  Sender,
  SemanticCacheEntry,
  User,
  PlatformIdentity,
  Conversation,
  Contact,
  ContactCategoryType,
} from '../types/index.js';
import type { EnhancedIntentResult, ChildIntent } from '../types/intent.types.js';
import type { ComponentHealth } from '../utils/health-check-builder.js';
import type { ConversationType } from '../config/platforms.js';

export interface ExtractedFact {
  type: 'fact' | 'preference' | 'event' | 'relationship' | 'capability';
  content: string;
  confidence: number;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  processed: boolean;
  error?: string;
}

export interface RetrievalOptions {
  limit?: number;
  minSimilarity?: number;
  includeArchived?: boolean;
  userId?: string;
  conversationId?: string;
}

export interface RetrievalResult {
  memories: Array<Memory & { similarity: number; recencyBoost: number; score: number }>;
  totalFound: number;
}

export interface MemoryStats {
  totalMemories: number;
  activeMemories: number;
  byType: Record<string, number>;
}

export interface IMemoryService {
  extractAndStore(
    message: Message,
    conversationContext?: Message[],
    options?: { userId?: string; conversationId?: string }
  ): Promise<ExtractionResult>;

  retrieveRelevant(
    query: string,
    options?: RetrievalOptions
  ): Promise<RetrievalResult>;

  updateMemory(
    memoryId: string,
    updates: {
      content?: string;
      confidence?: number;
      addSourceMessageId?: string;
    }
  ): Promise<Memory | null>;

  consolidateMemories(
    memoryIds: string[],
    consolidatedContent: string,
    confidence?: number
  ): Promise<Memory | null>;

  pruneOldMemories(): Promise<number>;

  getStats(userId?: string): Promise<MemoryStats>;
}

export interface ClassifierMetrics {
  patternClassifications: number;
  llmClassifications: number;
  fallbackClassifications: number;
  timeoutCount: number;
  deduplicatedRequests: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface IIntentClassifier {
  classifyIntent(
    message: string,
    conversationContext?: string,
    previousIntents?: ChildIntent[]
  ): Promise<EnhancedIntentResult>;

  getMetrics(): ClassifierMetrics;

  destroy(): void;
  startKeepAlive(): void;
  stopKeepAlive(): void;
}

export interface CacheLookupOptions {
  intent?: string;
  model?: string;
  useSemanticSearch?: boolean;
  minSimilarity?: number;
}

export interface CacheStoreOptions {
  intent?: string;
  model?: string;
  ttlHours?: number;
  sourceMessageIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface CacheResult {
  hit: boolean;
  response?: string;
  entry?: SemanticCacheEntry;
  similarity?: number;
  matchType?: 'exact' | 'semantic';
  lookupTimeMs: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  avgHitCount: number;
  expiredEntries: number;
  entriesByIntent: Record<string, number>;
  entriesByModel: Record<string, number>;
  hitRate: number;
}

export interface CacheDetailedStats extends CacheStats {
  hitRateByIntent: Record<string, { hits: number; entries: number; rate: number }>;
  recentMissReasons: {
    notCacheableIntent: number;
    noMatch: number;
    belowSimilarityThreshold: number;
    firstMessage: number;
    personalInfo: number;
    expired: number;
  };
  health: {
    utilizationRate: number;
    avgEntriesPerIntent: number;
    oldestEntryAge: number;
    newestEntryAge: number;
    warmCacheEntries: number;
  };
  config: {
    enabled: boolean;
    similarityThreshold: number;
    maxEntries: number;
    cacheableIntents: string[];
  };
}

export interface ISemanticCache {
  lookup(prompt: string, options?: CacheLookupOptions): Promise<CacheResult>;

  store(
    prompt: string,
    response: string,
    options?: CacheStoreOptions
  ): Promise<SemanticCacheEntry | null>;

  invalidateByIntent(intent: string): Promise<number>;
  cleanup(): Promise<number>;
  getStats(): Promise<CacheStats>;
  clear(): Promise<number>;

  isEnabled(): boolean;
  isCacheable(intent: string): boolean;
  getTTLForIntent(intent: string): number;
}

export interface AnalysisResult {
  success: boolean;
  content?: string;
  responseId?: string;
  error?: string;
  skipped?: boolean;
  routedTo?: 'ollama' | 'claude' | 'cache' | 'last_resort';
  intent?: string;
  intentConfidence?: number;
  enhancedIntent?: EnhancedIntentResult;
  cacheHit?: boolean;
  cacheSimilarity?: number;
}

export interface IResponseRouter {
  generateResponse(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    conversationHistory: Message[],
    identityOptions?: { userId?: string; conversationId?: string }
  ): Promise<AnalysisResult>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
}

export interface ILLMProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  isAvailable(): Promise<boolean>;
  getName(): string;
}

export interface IHealthCheck {
  check(): Promise<ComponentHealth>;
  getName(): string;
}

export interface ICacheService<T = unknown> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
}

export interface IIdentityService {
  /** Find or create a unified user for this platform identity */
  resolveUser(
    platform: string,
    platformUserId: string,
    metadata?: Record<string, unknown>
  ): Promise<User>;

  /** Find or create a conversation */
  resolveConversation(
    platform: string,
    platformConversationId: string,
    type: ConversationType,
    metadata?: Record<string, unknown>
  ): Promise<Conversation>;

  /** Link a new platform identity to an existing user (cross-platform) */
  linkIdentities(
    userId: string,
    platform: string,
    platformUserId: string
  ): Promise<PlatformIdentity>;

  /** Lookup without creating */
  findUser(platform: string, platformUserId: string): Promise<User | null>;
  findConversation(platform: string, platformConversationId: string): Promise<Conversation | null>;

  /** Get all platform identities for a user */
  getIdentitiesForUser(userId: string): Promise<PlatformIdentity[]>;
}

export interface ContactLookupResult {
  found: boolean;
  contact?: Contact;
  matchScore?: number;
  suggestions?: Contact[];
  errorMessage?: string;
}

export interface ContactSaveResult {
  success: boolean;
  contact?: Contact;
  error?: string;
}

export interface PhoneNumberResolutionResult {
  resolved: boolean;
  contact?: Contact;
  guidanceMessage?: string;
}

export interface IContactService {
  /** Find a contact by name or phone number */
  findContact(query: string, senderId: string): Promise<ContactLookupResult>;

  /** Save or update a contact */
  saveContact(data: {
    senderId: string;
    name: string;
    phoneNumber: string;
    category?: ContactCategoryType;
    originalInput?: string;
    preferredFormat?: string;
    confidence?: number;
  }): Promise<ContactSaveResult>;

  /** List all contacts for a sender */
  listContacts(senderId: string): Promise<Contact[]>;

  /** Delete a contact by phone number */
  deleteContact(phoneNumber: string, senderId: string): Promise<boolean>;

  /** Update the last contacted timestamp for a contact */
  updateLastContacted(contactId: string): Promise<void>;

  /** Build context string for LLM with all contacts */
  buildContextString(senderId: string): Promise<string>;

  /** Format a contact query result for user-friendly display */
  formatLookupResult(result: ContactLookupResult, query: string): string;

  /** Resolve a phone number to a contact for message sending */
  resolvePhoneNumberToTelegram(
    phoneNumber: string,
    senderId: string
  ): Promise<PhoneNumberResolutionResult>;
}

/**
 * A normalized calendar event exposed to routing/handlers.
 * Times are ISO-8601 strings (UTC).
 */
export interface CalendarEventInfo {
  title: string;
  startISO: string;
  endISO: string;
  location?: string;
  notes?: string;
}

/**
 * Calendar service (Apple/iCloud via CalDAV).
 *
 * Read + create only. Event creation is gated behind a confirm-first flow: a
 * proposed event is held per-conversation until the owner confirms, at which
 * point the exact stored event is written (immune to LLM argument drift).
 */
export interface ICalendarService {
  /** Whether the calendar integration is enabled and configured. */
  isEnabled(): boolean;

  /** List events overlapping [startISO, endISO). */
  getEvents(startISO: string, endISO: string): Promise<CalendarEventInfo[]>;

  /**
   * Parse a natural-language creation request into a structured event.
   * Returns null when the text cannot be understood as an event.
   */
  extractEventFromText(text: string): Promise<CalendarEventInfo | null>;

  /** Hold a proposed event for a conversation, pending confirmation. */
  proposeEvent(conversationKey: string, event: CalendarEventInfo): void;

  /** Return the pending proposal for a conversation, or null if none/expired. */
  getPendingProposal(conversationKey: string): CalendarEventInfo | null;

  /** Write the pending proposal to the calendar and clear it. */
  commitPending(conversationKey: string): Promise<CalendarEventInfo>;

  /** Discard any pending proposal. Returns true if one existed. */
  discardPending(conversationKey: string): boolean;
}

