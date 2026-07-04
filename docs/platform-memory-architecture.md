# Platform Memory Architecture

**Updated**: 2026-02-27
**Status**: Phase 10 Complete

## Executive Summary

Jarvis supports multiple messaging platforms (Telegram, Slack) with a unified identity and memory system. All platforms share the same memory system with proper user attribution through the unified identity tables (`users`, `platformIdentities`, `conversations`).

---

## 1. Architecture Overview

### Unified Identity System

All platform users and conversations are mapped to platform-agnostic identifiers:

```
users (displayName, createdAt)
  ↑ FK
platformIdentities (platform, platformUserId, userId FK, metadata)
  │   platform: 'telegram' | 'slack' | ...
  │   platformUserId: telegramId or slackUserId
  │
memories.userId ──────────────────── Platform-agnostic
memories.conversationId ─────────── Platform-agnostic
  │
conversations (platform, platformConversationId, type, title)
  │   type: 'dm' | 'group' | 'channel'
```

### Key Benefits

1. **User attribution across platforms** — Slack memories linked to real users
2. **Cross-platform memory** — Same user on Telegram and Slack shares memories if linked
3. **Proper conversation scoping** — Memories scoped to conversations
4. **Extensible** — Adding Discord, WhatsApp, etc. requires zero schema changes

---

## 2. Connector Architecture

### Telegram Connector

**Location**: No dedicated platform class; handled directly via handlers.

**Implementation**:
- Uses TDLib wrapper via `telegram` npm package
- Events flow through `src/handlers/message.handler.ts`
- Processing via `IngestionService`
- Identity resolution via `IdentityService.resolveUser()` / `resolveConversation()`

**Data Flow**:
```
Telegram Event → Handler → IngestionService →
  ├─ Resolve identity (telegramId → userId/conversationId)
  ├─ Store in senders/chats/messages tables (legacy, still used for messages)
  └─ MemoryService.extractAndStore() with userId/conversationId
```

### Slack Connector

**Location**: `src/platforms/slack/`

**Implementation**:
- `SlackService` class implementing `IPlatform` interface
- Uses Slack Bolt SDK with Socket Mode
- Handles events: `app_mention` (mentions) and `message` (DMs)
- Identity resolution via `IdentityService.resolveUser()` / `resolveConversation()`

**Data Flow**:
```
Slack Event → SlackService → CEO Handler →
  ├─ Resolve identity (slackUserId → userId, channelId → conversationId)
  ├─ Retrieve memories by userId
  ├─ Response generation via Claude CLI
  └─ Memory extraction with userId/conversationId
```

---

## 3. Memory System

### Shared Components

Both platforms use:
- Single `MemoryService` instance (`src/services/memory.service.ts`)
- Single `ContextManagerService` for building context
- Unified identity tables (`users`, `platformIdentities`, `conversations`)

### Memory Interface

```typescript
interface IMemoryService {
  extractAndStore(
    message: Message,
    conversationContext?: Message[],
    options?: { userId?: string; conversationId?: string }
  ): Promise<ExtractionResult>;

  retrieveRelevant(
    query: string,
    options?: RetrievalOptions
  ): Promise<RetrievalResult>;
}

interface RetrievalOptions {
  limit?: number;
  minSimilarity?: number;
  includeArchived?: boolean;
  userId?: string;           // Unified user ID
  conversationId?: string;   // Unified conversation ID
}
```

### Legacy Columns (Deprecated)

The `memories` table still contains `senderId` and `chatId` columns for backward compatibility, but new code should use `userId` and `conversationId`:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  senderId TEXT NULL REFERENCES senders(id),    -- @deprecated Use userId
  chatId TEXT NULL REFERENCES chats(id),        -- @deprecated Use conversationId
  user_id TEXT REFERENCES users(id),            -- Unified user ID
  conversation_id TEXT REFERENCES conversations(id), -- Unified conversation ID
  memoryType TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence INTEGER DEFAULT 100,
  sourceMessageIds TEXT,
  isArchived INTEGER DEFAULT 0,
  createdAt DATETIME,
  updatedAt DATETIME
);
```

---

## 4. Identity Resolution

### IdentityService

Central service for resolving platform-specific IDs to unified IDs:

```typescript
interface IIdentityService {
  // Find or create a unified user for this platform identity
  resolveUser(platform: string, platformUserId: string, metadata?: Record<string, unknown>): Promise<User>;

  // Find or create a conversation
  resolveConversation(platform: string, platformConversationId: string, type: ConversationType, metadata?: Record<string, unknown>): Promise<Conversation>;

  // Link a new platform identity to an existing user (cross-platform)
  linkIdentities(userId: string, platform: string, platformUserId: string): Promise<PlatformIdentity>;

  // Lookup without creating
  findUser(platform: string, platformUserId: string): Promise<User | null>;
  findConversation(platform: string, platformConversationId: string): Promise<Conversation | null>;
}
```

### Usage Pattern

```typescript
// In platform handler
const user = await identityService.resolveUser(PLATFORM_SLACK, slackUserId, {
  slackDisplayName: 'John Doe',
});
const conversation = await identityService.resolveConversation(PLATFORM_SLACK, channelId, 'channel', {
  channelId: channelId,
});

// Use unified IDs for memory operations
await memoryService.extractAndStore(message, [], {
  userId: user.id,
  conversationId: conversation.id,
});
```

---

## 5. Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Unified Identity Schema | ✅ Complete |
| 2 | Identity Repositories | ✅ Complete |
| 3 | Identity Resolution Service | ✅ Complete |
| 4 | Data Backfill Migration | ✅ Complete |
| 5 | Memory Schema Migration | ✅ Complete |
| 6 | Memory Service Refactor | ✅ Complete |
| 7 | Context Manager Refactor | ✅ Complete |
| 8 | CEO Memory Integration | ✅ Complete |
| 9 | Telegram Handler Migration | ✅ Complete |
| 10 | Cleanup & Deprecation | ✅ Complete |

---

## 6. Future Work (Out of Scope)

- **Messages table migration**: Add `userId`/`conversationId` columns to `messages` table
- **User linking UI**: Interface for manually linking identities across platforms
- **Cross-platform context**: Build context from all platforms a user interacts with
- **senders/chats table removal**: Blocked by messages table migration

---

## 7. File References

| Component | Path |
|-----------|------|
| Identity Service | `src/services/identity.service.ts` |
| User Repository | `src/repositories/user.repository.ts` |
| Platform Identity Repository | `src/repositories/platformIdentity.repository.ts` |
| Conversation Repository | `src/repositories/conversation.repository.ts` |
| Memory Service | `src/services/memory.service.ts` |
| Context Manager | `src/services/contextManager.service.ts` |
| CEO Handler | `src/modules/ceo/handlers/ceo.handler.ts` |
| Telegram Handler | `src/handlers/message.handler.ts` |
| Database Schema | `src/db/schema.ts` |
| Service Interfaces | `src/interfaces/services.ts` |
| Repository Interfaces | `src/interfaces/repositories.ts` |
