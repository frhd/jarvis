# Phase 5: Factory & Wiring

**Prerequisites**: Phase 4 (BrowserService implemented)
**Outcome**: BrowserService instantiated via factory, wired to LLMRouterService

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for factory pattern reference.

## Tasks

### 5.1 Create factory — `src/services/factory/browser-services.ts`

- [ ] Create file following the pattern in `comic-services.ts`:

```typescript
/**
 * Browser Services Factory
 *
 * Conditionally instantiates BrowserService based on configuration.
 * Browser is only created when BROWSER_ENABLED=true.
 */

import { BrowserService } from '../tools/browser.service.js';
import { appConfig } from '../../config/index.js';

export const browserService = appConfig.browser.enabled
  ? new BrowserService({
      headless: appConfig.browser.headless,
      contentMaxLength: appConfig.browser.contentMaxLength,
      fetchTimeoutMs: appConfig.browser.fetchTimeoutMs,
    })
  : null;
```

### 5.2 Export from factory index — `src/services/factory/index.ts`

- [ ] Add export block after therapist services:

```typescript
// Browser services
export {
  browserService,
} from './browser-services.js';
```

### 5.3 Wire in service index — `src/services/index.ts`

- [ ] Add `browserService` to the factory import (around line 48):

```typescript
import {
  // ... existing imports ...
  browserService,
} from './factory/index';
```

- [ ] Add `browserService` to the re-export block:

```typescript
export {
  // ... existing exports ...
  browserService,
};
```

- [ ] Wire to `llmRouterService` (after line 275, following `setChatRepository` pattern):

```typescript
if (browserService) {
  llmRouterService.setBrowserService(browserService);
}
```

### 5.4 Verify

- [ ] Run `npm run build` — compiles cleanly
- [ ] Run `npm test` — all existing tests still pass
- [ ] Verify with `BROWSER_ENABLED=false` (default): `browserService` is `null`, no browser launched
