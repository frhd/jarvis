# /add-service - Generate New Service

Generate a new service following the established factory pattern with proper DI wiring.

## When to Use

- Adding new business logic
- Creating a new service class
- Implementing new functionality

## Service Pattern

Services in Jarvis follow these conventions:

1. **Service file** in `src/services/<name>.service.ts`
2. **Factory entry** in `src/services/factory/` (appropriate module)
3. **Export** from `src/services/index.ts`
4. **Test file** alongside service (optional but recommended)

## File Structure

```
src/services/
├── <name>.service.ts          # Service implementation
├── <name>.service.test.ts     # Tests (optional)
└── factory/
    ├── core-services.ts       # Base services (filter, media, telegram, llm)
    ├── ai-services.ts         # AI/ML services (memory, intent, embedding)
    ├── monitoring-services.ts # Metrics, analytics, alerting
    └── index.ts               # Re-exports all factory modules
```

## Service Template

```typescript
/**
 * <Name> Service
 *
 * <Description of what this service does>
 */

import { logger } from '../utils/logger.js';
// Import repositories, other services, config as needed
// import { SomeRepository } from '../repositories/some.repository.js';
// import { appConfig } from '../config/index.js';

export interface <Name>ServiceConfig {
  // Configuration options
  timeoutMs?: number;
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<<Name>ServiceConfig> = {
  timeoutMs: 30000,
  enabled: true,
};

export class <Name>Service {
  private config: Required<<Name>ServiceConfig>;

  constructor(
    // Inject dependencies
    // private someRepo: SomeRepository,
    config?: <Name>ServiceConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[<Name>Service] Initialized', { config: this.config });
  }

  /**
   * Main method description
   */
  async doSomething(input: string): Promise<string> {
    const startTime = Date.now();

    try {
      // Implementation
      const result = `Processed: ${input}`;

      logger.info('[<Name>Service] Operation completed', {
        input,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error('[<Name>Service] Operation failed', {
        input,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    logger.info('[<Name>Service] Shutting down');
    // Cleanup timers, connections, etc.
  }
}
```

## Factory Entry Template

Add to appropriate factory module in `src/services/factory/`:

```typescript
import { <Name>Service } from '../<name>.service.js';
// Import repositories if needed
// import { someRepository } from '../../repositories/index.js';

/**
 * <Name> service for <description>
 */
export const <name>Service = new <Name>Service(
  // someRepository,  // Inject dependencies
  // { config options }
);
```

## Export from index.ts

Add to `src/services/index.ts`:

```typescript
// In appropriate section
export { <name>Service } from './factory/<factory-module>.js';

// Or if exporting the class too
export { <Name>Service, type <Name>ServiceConfig } from './<name>.service.js';
```

## Checklist

When creating a new service:

- [ ] Create service file: `src/services/<name>.service.ts`
- [ ] Define config interface with defaults
- [ ] Implement constructor with dependency injection
- [ ] Add logging to all public methods
- [ ] Handle errors with proper logging
- [ ] Add shutdown method if needed
- [ ] Create factory entry in appropriate module
- [ ] Export from `src/services/index.ts`
- [ ] Add tests (optional but recommended)

## Factory Module Selection

| Module | Use For |
|--------|---------|
| `core-services.ts` | Base infrastructure (filter, media, telegram, llm) |
| `ai-services.ts` | AI/ML services (memory, intent, embedding, cache) |
| `monitoring-services.ts` | Metrics, analytics, alerting, experiments |
| `circuit-breakers.ts` | Resilience patterns |

## Dependencies

Common dependencies to inject:

- **Repositories**: For database access
- **Other services**: For orchestration
- **Config**: Use `appConfig` from `src/config/index.js`
- **Logger**: Use `logger` from `src/utils/logger.js`

## Example: Notification Service

```typescript
// src/services/notification.service.ts
import { logger } from '../utils/logger.js';
import { TelegramService } from './telegram.service.js';

export class NotificationService {
  constructor(private telegramService: TelegramService) {}

  async sendAlert(chatId: string, message: string): Promise<void> {
    logger.info('[NotificationService] Sending alert', { chatId });
    await this.telegramService.sendMessage(chatId, `🚨 ${message}`);
  }
}

// src/services/factory/monitoring-services.ts
import { NotificationService } from '../notification.service.js';
import { telegramService } from './core-services.js';

export const notificationService = new NotificationService(telegramService);

// src/services/index.ts
export { notificationService } from './factory/monitoring-services.js';
```

## Troubleshooting

### Import Errors After Creation
- Ensure `.js` extension is used in imports (ESM requirement)
- Run `npm run build` to verify TypeScript compilation
- Check for circular dependencies with `npm run check:circular`

### Service Not Available at Runtime
- Verify export in `src/services/index.ts`
- Check factory module instantiation order
- Ensure dependencies are available before service creation

### Test Failures
- Mock all external dependencies
- Use `vi.mock()` for module-level mocks
- Check logger mock to suppress output

## Reference

- Core services: `src/services/factory/core-services.ts`
- AI services: `src/services/factory/ai-services.ts`
- Service exports: `src/services/index.ts`
