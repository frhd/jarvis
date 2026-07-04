---
name: "platform-expansion"
description: "Generate boilerplate for new platform integrations (Discord, Matrix, etc.)"
---

# Platform Expansion Agent

Generate boilerplate for new platform integrations following established patterns. Supports adding platforms like Discord, Matrix, WhatsApp, etc.

## Agent Type
`general-purpose`

## When This Agent is Triggered

- User wants to add a new messaging platform
- Integrating a new bot framework
- Expanding Jarvis to support additional channels
- User mentions a specific platform (Discord, Matrix, WhatsApp, etc.)

## Capabilities

1. **Platform Structure** - Create `src/platforms/<platform>/` directory with proper files
2. **Service Generation** - Create platform service implementing IPlatform interface
3. **Config Generation** - Create platform-specific configuration
4. **Identity Integration** - Wire into unified identity system
5. **Module Registration** - Generate registration code for moduleRegistry

## Agent Instructions

### Phase 1: Requirements Gathering

Ask the user for:
1. **Platform name** (e.g., "discord", "matrix", "whatsapp")
2. **SDK/Library** being used (e.g., discord.js, matrix-js-sdk)
3. **Authentication method** (bot token, OAuth, etc.)
4. **Key features needed**:
   - Message receiving (required)
   - Message sending (required)
   - Mentions handling
   - Media support
   - Thread/reply support

### Phase 2: Platform Directory Structure

Create the following structure in `src/platforms/<platform>/`:

```
src/platforms/<platform>/
├── <platform>.service.ts      # Platform service (IPlatform implementation)
├── <platform>.config.ts       # Configuration types and defaults
├── <platform>.types.ts        # Platform-specific types
└── index.ts                   # Exports
```

### Phase 3: Generate Platform Service

Create `<platform>.service.ts` implementing the `IPlatform` interface.

Key elements to include:

```typescript
/**
 * <Platform> Platform Service
 * Implements IPlatform for <Platform> integration.
 */

import { createLogger } from '../../utils/logger.js';
import type {
  IPlatform,
  IPlatformHandler,
  PlatformEventType,
  SendMessageOptions,
} from '../../interfaces/platforms.js';
import type {<Platform>Config } from './<platform>.config.js';

const logger = createLogger('<Platform>Service');

export class <Platform>Service implements IPlatform {
  readonly name = '<platform>';

  // Handler registries
  private messageHandlers: Map<string, IPlatformHandler> = new Map();
  private mentionHandlers: Map<string, IPlatformHandler> = new Map();

  constructor(config: <Platform>Config) {
    // Initialize SDK client
    // Setup event handlers
  }

  private setupEventHandlers(): void {
    // Map platform events to IPlatformHandler calls
  }

  // IPlatform implementation
  async start(): Promise<void> {
    // Connect to platform
  }

  async stop(): Promise<void> {
    // Disconnect from platform
  }

  async sendMessage(channelId: string, text: string, options?: SendMessageOptions): Promise<void> {
    // Send message via platform SDK
  }

  async replyInThread(channelId: string, threadTs: string, text: string): Promise<void> {
    // Reply in thread if supported
  }

  async getConversationContext(channel: string, currentTs: string, threadTs?: string): Promise<string> {
    // Fetch recent messages for context
  }

  getDefaultChannelId(): string {
    return this.config.channelId;
  }

  registerHandler(eventType: PlatformEventType, handler: IPlatformHandler): void {
    // Register handler by type
  }

  unregisterHandler(eventType: PlatformEventType, handlerId: string): void {
    // Unregister handler
  }
}
```

### Phase 4: Generate Config File

Create `<platform>.config.ts`:

```typescript
/**
 * <Platform> Platform Configuration
 */

export interface <Platform>Config {
  // Authentication
  botToken: string;

  // Optional configuration
  channelId?: string;
  testUserId?: string;

  // Platform-specific options
  // Add based on SDK requirements
}

export function get<Platform>ConfigFromEnv(): Partial<<Platform>Config> {
  return {
    botToken: process.env.<PLATFORM_UPPER>_BOT_TOKEN,
    channelId: process.env.<PLATFORM_UPPER>_CHANNEL_ID,
    testUserId: process.env.<PLATFORM_UPPER>_TEST_USER_ID,
  };
}
```

### Phase 5: Update Platform Constants

Add to `src/config/platforms.ts`:

```typescript
export const PLATFORM_<PLATFORM_UPPER> = '<platform>' as const;

export type Platform =
  | typeof PLATFORM_TELEGRAM
  | typeof PLATFORM_SLACK
  | typeof PLATFORM_<PLATFORM_UPPER>;

/**
 * Map <Platform> chat type to ConversationType.
 */
export function map<Platform>ChatType(type: string): ConversationType {
  // Map platform-specific types to 'dm' | 'group' | 'channel'
}
```

### Phase 6: Update Index Exports

Create `src/platforms/<platform>/index.ts`:

```typescript
/**
 * <Platform> Platform Exports
 */

export { <Platform>Service } from './<platform>.service.js';
export type { <Platform>Config } from './<platform>.config.js';
```

### Phase 7: Bootstrap Integration

Provide code to add to `src/index.ts`:

```typescript
// Import platform
import { <Platform>Service, get<Platform>ConfigFromEnv } from './platforms/<platform>/index.js';

// In bootstrap, after other platforms:
if (process.env.<PLATFORM_UPPER>_BOT_TOKEN) {
  const <platform>Config = get<Platform>ConfigFromEnv();
  const <platform>Service = new <Platform>Service(<platform>Config as <Platform>Config);
  await <platform>Service.start();

  // Register with moduleRegistry if using modules
  moduleRegistry.registerPlatformWithModules(<platform>Service);
}
```

## Files to Reference

| Purpose | Path |
|---------|------|
| Platform pattern | `src/platforms/slack/` |
| IPlatform interface | `src/interfaces/platforms.ts` |
| Platform config | `src/config/platforms.ts` |
| Identity service | `src/services/identity.service.ts` |
| Bootstrap | `src/index.ts` |
| Module interface | `src/interfaces/modules.ts` |

## Pattern Reference: Slack Service

The Slack service (`src/platforms/slack/slack.service.ts`) demonstrates:
- IPlatform interface implementation
- Handler registration pattern
- Message conversion to platform-agnostic format
- Error handling in handlers
- User name caching

## Output

Provide the user with:

1. **Created Files**
   - Full content for each file in the platform directory
   - Clear file paths and purposes

2. **Integration Steps**
   - Code to add to `src/config/platforms.ts`
   - Code to add to `src/index.ts` bootstrap
   - Environment variables to add to `.env`

3. **Testing Checklist**
   - How to verify the platform connects
   - How to test message handling
   - How to verify identity resolution

4. **SDK-Specific Notes**
   - Any quirks of the chosen SDK
   - Common pitfalls to avoid
   - Rate limiting considerations

## Important Notes

- The agent provides boilerplate; user must provide SDK-specific knowledge
- Test with the actual platform before deploying
- Ensure environment variables are documented in `.env.example`
- Consider rate limits and platform-specific constraints
