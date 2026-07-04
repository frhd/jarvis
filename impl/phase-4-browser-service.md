# Phase 4: BrowserService Core

**Prerequisites**: Phase 2 (configuration layer available)
**Outcome**: `BrowserService` implemented with full test coverage

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for constants and config values.

## Tasks

### 4.1 Write tests — `src/services/tools/browser.service.test.ts`

Write tests BEFORE implementation. Mock Playwright's `chromium.launch()` to avoid real browser.

- [ ] **Test: lazy init** — browser not launched until first `fetchPageContent()` call
- [ ] **Test: fetchPageContent success** — returns trimmed text content, respects maxLength truncation
- [ ] **Test: fetchPageContent timeout** — returns error result when page load exceeds timeout
- [ ] **Test: fetchPageContent error** — returns error result on navigation failure, does not throw
- [ ] **Test: fetchMultiplePages** — fetches N URLs in parallel, returns results array
- [ ] **Test: fetchMultiplePages partial failure** — successful pages returned, failed pages have error
- [ ] **Test: rate limiting** — second fetch waits at least `MIN_FETCH_INTERVAL_MS` after first
- [ ] **Test: content stripping** — scripts, styles, nav, footer elements are removed before extraction
- [ ] **Test: close()** — closes browser instance, subsequent fetch re-initializes
- [ ] **Test: close() when no browser** — no-op, does not throw

**Mock pattern** (declare mocks before imports per project convention):

```typescript
const mockPage = {
  goto: vi.fn(),
  evaluate: vi.fn(),
  close: vi.fn(),
  setDefaultTimeout: vi.fn(),
};
const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
};
const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn(),
};

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));
```

### 4.2 Implement BrowserService — `src/services/tools/browser.service.ts`

- [ ] **Named constants** at top of file (from scratchpad):

```typescript
const BROWSER_SHUTDOWN_PRIORITY = 65;
const MIN_FETCH_INTERVAL_MS = 1_000;
const DEFAULT_CONTENT_MAX_LENGTH = 50_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_FETCHES = 3;
```

- [ ] **Config interface**:

```typescript
export interface BrowserServiceConfig {
  headless?: boolean;
  contentMaxLength?: number;
  fetchTimeoutMs?: number;
}
```

- [ ] **Fetch result type**:

```typescript
export interface PageFetchResult {
  url: string;
  success: boolean;
  content?: string;
  error?: string;
  durationMs: number;
}
```

- [ ] **Constructor**: store config, register shutdown handler, do NOT launch browser

- [ ] **`ensureBrowser()`** (private): lazy-init Chromium on first use

- [ ] **`fetchPageContent(url: string)`**:
  1. Ensure browser
  2. Rate limit check (wait if needed)
  3. Create new BrowserContext (isolated)
  4. Navigate to URL with timeout
  5. Strip scripts, styles, nav, footer, header elements via `page.evaluate()`
  6. Extract `document.body.innerText`
  7. Truncate to `contentMaxLength`
  8. Close context
  9. Return `PageFetchResult`
  10. Catch errors → return error result (never throw)

- [ ] **`fetchMultiplePages(urls: string[])`**:
  1. Limit to `MAX_CONCURRENT_FETCHES` concurrent fetches using a simple semaphore/batching
  2. Return `PageFetchResult[]`

- [ ] **`close()`**: close browser if initialized, reset instance to null

- [ ] **Shutdown registration**: in constructor, register with `ShutdownRegistry`

### 4.3 Verify

- [ ] Run `npx vitest src/services/tools/browser.service.test.ts` — all tests pass
- [ ] Run `npm run build` — compiles cleanly
- [ ] Run `npm test` — all existing tests still pass

## Design Decisions

- **New BrowserContext per fetch**: Provides isolation (cookies, storage). Cheaper than full browser instance but still isolated.
- **Rate limiting**: Simple timestamp check with `Date.now()` — no need for token bucket complexity.
- **Error handling**: All errors caught and returned in `PageFetchResult.error` — callers never need try/catch.
- **Content stripping**: Done via `page.evaluate()` in-browser (remove `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<aside>` elements, then get `body.innerText`).
