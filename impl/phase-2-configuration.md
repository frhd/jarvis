# Phase 2: Configuration Layer

**Prerequisites**: Phase 1 (dependencies installed)
**Outcome**: All `BROWSER_*` env vars validated, parsed, and exposed via `appConfig.browser` and feature flags

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for config values table and exact ranges.

## Tasks

### 2.1 Add env var schema — `src/config/env-schema.ts`

- [x] Add browser env vars after the `SEARCH_*` block (around line 112):

```typescript
// Browser Configuration
BROWSER_ENABLED: z.string().optional(),
BROWSER_HEADLESS: z.string().optional(),
BROWSER_CONTENT_MAX_LENGTH: z.coerce.number().int().min(1000).max(500000).optional(),
BROWSER_FETCH_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).optional(),
BROWSER_FETCH_TOP_N: z.coerce.number().int().min(0).max(10).optional(),
BROWSER_MCP_ENABLED: z.string().optional(),
BROWSER_MCP_CONFIG_PATH: z.string().optional(),
```

- [x]No cross-field validations needed for browser config

### 2.2 Add config schema — `src/config/schema.ts`

- [x]Add `browserSchema` Zod object (after `searchSchema`, around line 173):

```typescript
const browserSchema = z.object({
  enabled: z.boolean().default(false),
  headless: z.boolean().default(true),
  contentMaxLength: positiveInt.default(50000),
  fetchTimeoutMs: positiveInt.default(30000),
  fetchTopN: nonNegativeInt.default(3),
  mcpEnabled: z.boolean().default(false),
  mcpConfigPath: z.string().default(''),
});
```

- [x]Add `browser: browserSchema` to `configSchema` object (after `search`)

### 2.3 Add config parsing — `src/config/index.ts`

- [x]Add `browser` section to `rawConfig` (after `search` block, around line 177):

```typescript
// Browser Configuration
browser: {
  enabled: process.env.BROWSER_ENABLED === 'true',
  headless: process.env.BROWSER_HEADLESS !== 'false',
  contentMaxLength: ConfigParsers.positiveInt(process.env.BROWSER_CONTENT_MAX_LENGTH, 50000, 500000),
  fetchTimeoutMs: ConfigParsers.timeout(process.env.BROWSER_FETCH_TIMEOUT_MS, 30000),
  fetchTopN: ConfigParsers.positiveInt(process.env.BROWSER_FETCH_TOP_N, 3, 10),
  mcpEnabled: process.env.BROWSER_MCP_ENABLED === 'true',
  mcpConfigPath: process.env.BROWSER_MCP_CONFIG_PATH || '',
},
```

### 2.4 Add feature flags — `src/config/feature-flags.ts`

- [x]Add to `FeatureFlagNames` object:

```typescript
// Browser flags
BROWSER_ENABLED: 'browser.enabled',
BROWSER_MCP_ENABLED: 'browser.mcpEnabled',
```

- [x]Add two `FeatureFlagConfig` entries in `featureFlagConfigs` array:

```typescript
// Browser flags
{
  name: FeatureFlagNames.BROWSER_ENABLED,
  defaultValue: process.env.BROWSER_ENABLED === 'true',
  description: 'Enable/disable Playwright browser for content extraction',
  category: 'Tools',
},
{
  name: FeatureFlagNames.BROWSER_MCP_ENABLED,
  defaultValue: process.env.BROWSER_MCP_ENABLED === 'true',
  description: 'Enable/disable Playwright MCP server for agentic browser tools',
  category: 'Tools',
},
```

- [x]Add convenience helpers at bottom of file:

```typescript
export const isBrowserEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.BROWSER_ENABLED);
export const isBrowserMCPEnabled = (): boolean =>
  featureFlags.isEnabled(FeatureFlagNames.BROWSER_MCP_ENABLED);
```

### 2.5 Document in `.env.example`

- [x]Add browser section after the "WEB SEARCH CONFIGURATION" block:

```bash
# ==============================================================================
# BROWSER CONFIGURATION
# ==============================================================================
# Playwright-based browser for full page content extraction and agentic browsing.
# Both features are OFF by default and opt-in only.

# [OPTIONAL] Enable browser content extraction for web search enrichment (default: false)
# When enabled, top search results are fetched with a real browser to extract full page text
BROWSER_ENABLED=false

# [OPTIONAL] Run browser in headless mode (default: true)
# Set to false for debugging (shows browser window)
BROWSER_HEADLESS=true

# [OPTIONAL] Maximum characters to extract per page (default: 50000, range: 1000-500000)
BROWSER_CONTENT_MAX_LENGTH=50000

# [OPTIONAL] Per-page fetch timeout in ms (default: 30000, range: 5000-120000)
BROWSER_FETCH_TIMEOUT_MS=30000

# [OPTIONAL] Number of top search result URLs to fetch (default: 3, range: 0-10)
BROWSER_FETCH_TOP_N=3

# [OPTIONAL] Enable Playwright MCP server for agentic browser tools (default: false)
# When enabled, Claude CLI gets access to browser tools (navigate, click, screenshot, etc.)
BROWSER_MCP_ENABLED=false

# [OPTIONAL] Path to MCP config file (default: config/browser-mcp.json when MCP enabled)
# BROWSER_MCP_CONFIG_PATH=config/browser-mcp.json
```

### 2.6 Verify configuration

- [x]Run `npm run build` — must compile cleanly
- [x]Run `npm test` — existing tests must pass
- [x]Verify `appConfig.browser` is accessible in a quick script or test:
  ```bash
  node -e "import('./dist/config/index.js').then(m => console.log(m.appConfig.browser))"
  ```
