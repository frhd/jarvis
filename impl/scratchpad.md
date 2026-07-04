# Scratchpad — Browser Capabilities Implementation

Shared state and decisions across phases. Update as implementation progresses.

## Key Constants (use these exact names in code)

```typescript
// BrowserService constants (phase 4)
const BROWSER_SHUTDOWN_PRIORITY = 65;
const MIN_FETCH_INTERVAL_MS = 1000;           // Rate limit between fetches
const DEFAULT_CONTENT_MAX_LENGTH = 50_000;     // Max chars extracted per page
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;       // Per-page timeout
const DEFAULT_FETCH_TOP_N = 3;                 // URLs to fetch from search results
const MAX_CONCURRENT_FETCHES = 3;              // Parallel page fetches
```

## Existing Patterns to Follow

### Factory pattern (see `src/services/factory/comic-services.ts`)
- Instantiate service with config from `appConfig`
- Export singleton; conditionally create based on feature flag
- Register in `src/services/factory/index.ts`

### Service wiring (see `src/services/index.ts:261-275`)
- Import from factory, re-export
- Wire with setter methods: `llmRouterService.setBrowserService(browserService)`
- Guard with `if (browserService) { ... }`

### Feature flags (see `src/config/feature-flags.ts`)
- Add to `FeatureFlagNames` const
- Add `FeatureFlagConfig` entry in `featureFlagConfigs` array
- Export convenience helper: `export const isBrowserEnabled = (): boolean => ...`

### ClaudeClient options (see `src/clients/claude.client.ts:30-33`)
- Extend `ClaudeAgentOptions` interface
- Use in `runAgent()` to push CLI args

### Shutdown registration (see `src/utils/shutdown-registry.ts`)
- Priority 65 for browser (between services at 40-60 and core at 70-80)
- Register: `shutdownRegistry.register('browser', () => this.close(), BROWSER_SHUTDOWN_PRIORITY)`

## Config Values Summary

| Env Var | Type | Default | Schema Range |
|---------|------|---------|--------------|
| `BROWSER_ENABLED` | boolean | `false` | - |
| `BROWSER_HEADLESS` | boolean | `true` | - |
| `BROWSER_CONTENT_MAX_LENGTH` | int | `50000` | 1000-500000 |
| `BROWSER_FETCH_TIMEOUT_MS` | int | `30000` | 5000-120000 |
| `BROWSER_FETCH_TOP_N` | int | `3` | 0-10 |
| `BROWSER_MCP_ENABLED` | boolean | `false` | - |
| `BROWSER_MCP_CONFIG_PATH` | string | `''` | - |

## Files Created/Modified (track as completed)

### New files
- [x] `config/browser-mcp.json`
- [x] `src/services/tools/browser.service.ts`
- [x] `src/services/tools/browser.service.test.ts`
- [x] `src/services/factory/browser-services.ts`

### Modified files
- [x] `package.json` — add deps
- [x] `src/config/env-schema.ts` — add BROWSER_* vars
- [x] `src/config/schema.ts` — add browserSchema + to configSchema
- [x] `src/config/index.ts` — add browser section to rawConfig
- [x] `src/config/feature-flags.ts` — add BROWSER_ENABLED, BROWSER_MCP_ENABLED
- [x] `.env.example` — document new vars
- [x] `src/clients/claude.client.ts` — add mcpConfigPath
- [x] `src/services/factory/index.ts` — export browserService
- [x] `src/services/index.ts` — import/wire browserService
- [x] `src/services/routing/llm-router.service.ts` — MCP + enrichment

## Decisions Log

- **No database changes**: Content fetched on-demand, not persisted
- **Lazy init**: Browser only starts on first `fetchPageContent()` call
- **Both features off by default**: Opt-in via env vars
- **MCP config path**: Resolved at startup via `appConfig.browser.mcpConfigPath`, defaults to `config/browser-mcp.json` if MCP enabled but path not set
