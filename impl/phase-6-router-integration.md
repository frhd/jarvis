# Phase 6: LLM Router Integration

**Prerequisites**: Phase 3 (MCP support in ClaudeClient), Phase 5 (BrowserService wired)
**Outcome**: Agentic mode passes MCP config, web search enriches with full page content

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for shared constants and config values.

## Tasks

### 6.1 Write/extend tests — `src/services/routing/llm-router.service.test.ts`

- [x] **Test: executeAgenticTools passes mcpConfigPath** when `isBrowserMCPEnabled()` returns true
- [x] **Test: executeAgenticTools omits mcpConfigPath** when `isBrowserMCPEnabled()` returns false
- [x] **Test: handleWebSearchRequest enriches with browser content** when browserService is set and returns results
- [x] **Test: handleWebSearchRequest falls back to snippets** when browserService fetch fails
- [x] **Test: handleWebSearchRequest works without browserService** (browserService is null — existing behavior preserved)

**Mock pattern**: Mock `isBrowserMCPEnabled` from feature flags, mock `browserService.fetchMultiplePages()`.

### 6.2 Add browserService field + setter to LLMRouterService

- [x] In `src/services/routing/llm-router.service.ts`, add:

```typescript
import type { BrowserService, PageFetchResult } from '../tools/browser.service.js';
import { isBrowserMCPEnabled } from '../../config/feature-flags.js';
import { appConfig } from '../../config/index.js';
```

- [x] Add private field:

```typescript
private browserService: BrowserService | null = null;
```

- [x] Add setter method (following `setComicGeneratorService` pattern):

```typescript
setBrowserService(service: BrowserService): void {
  this.browserService = service;
}
```

### 6.3 MCP pass-through in `executeAgenticTools()`

- [x] Modify `executeAgenticTools()` (around line 589) to include MCP config:

```typescript
private async executeAgenticTools(
  taskPrompt: string
): Promise<Awaited<ReturnType<typeof this.claudeClient.runAgent>>> {
  const agentOptions = {
    timeoutMs: AGENTIC_TIMEOUT_MS,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    mcpConfigPath: isBrowserMCPEnabled() ? appConfig.browser.mcpConfigPath : undefined,
  };

  // ... rest unchanged
}
```

- [x] Add `mcpConfigPath` to the log line for `executeAgenticTools` if not already logged

### 6.4 Web search content enrichment in `handleWebSearchRequest()`

- [x] After the `formatForLLM()` call (around line 754), add browser enrichment:

```typescript
// Enrich search results with full page content via browser
let browserContent = '';
if (this.browserService && searchResult.results.length > 0) {
  try {
    const urlsToFetch = searchResult.results
      .slice(0, appConfig.browser.fetchTopN)
      .map(r => r.url);

    const pageResults = await this.browserService.fetchMultiplePages(urlsToFetch);
    const successfulPages = pageResults.filter(r => r.success && r.content);

    if (successfulPages.length > 0) {
      browserContent = '\n\n[Full Page Content]:\n' +
        successfulPages
          .map(r => `--- ${r.url} ---\n${r.content}`)
          .join('\n\n');

      logger.info('[LLMRouter] Browser content enrichment succeeded', {
        messageId: message.id,
        fetchedPages: successfulPages.length,
        totalPages: urlsToFetch.length,
      });
    }
  } catch (error) {
    // Graceful fallback: browser failure never blocks web search
    logger.warn('[LLMRouter] Browser content enrichment failed, using snippets only', {
      messageId: message.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
```

- [x] Append `browserContent` to the enhanced context string:

```typescript
const enhancedContext = `${context}\n\n[Web Search Results - Retrieved ${new Date().toISOString()}]:\n${searchContext}${browserContent}\n\n[Instructions]: ...`;
```

### 6.5 Verify

- [x] Run LLM router tests: `npx vitest src/services/routing/llm-router.service.test.ts`
- [x] Run `npm run build` — compiles cleanly
- [x] Run `npm test` — all tests pass

## Notes

- Browser enrichment is wrapped in try/catch — failure falls back to snippet-only context (existing behavior)
- MCP config path is only passed when `isBrowserMCPEnabled()` returns true AND `appConfig.browser.mcpConfigPath` is set
- The `fetchTopN` config controls how many URLs are fetched — set to 0 to disable enrichment while keeping browser enabled for other uses
