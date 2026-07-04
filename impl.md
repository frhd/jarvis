# Implementation Plan: Add Real Browser Capabilities via Playwright

## Overview

Add Playwright-based browser capabilities to Jarvis in two modes:
1. **MCP Browser Server** — gives Claude CLI native browser tools during agentic tasks
2. **BrowserService** — programmatic content extraction to enrich web search results

**Status**: Complete (smoke tests deferred to manual testing)

## Guidelines

- Follow [CONTRIBUTING.md](./CONTRIBUTING.md) for clean code practices (named constants, single responsibility, meaningful names, DRY)
- Test-driven: write tests before or alongside implementation in each phase
- All new env vars are opt-in (`false` by default) — zero impact when disabled
- Graceful degradation: browser failures never block existing functionality

## Architecture Changes

### New Service: `BrowserService`

```
src/services/tools/browser.service.ts
```

- Wraps Playwright Chromium for programmatic page content extraction
- Lazy browser initialization (Chromium only starts on first use, ~300MB savings when unused)
- Single `Browser` instance reused; new `BrowserContext` per fetch (isolated like incognito)
- Rate limiting: 1s minimum between fetches
- Registered in `ShutdownRegistry` at priority 65 (after services, before core)

### MCP Integration for Agentic Mode

```
config/browser-mcp.json  (new)
```

- Claude CLI spawns `@playwright/mcp` as an MCP server when `--mcp-config` is passed
- MCP server lifecycle managed by Claude CLI — no separate process management needed
- Only enabled when `BROWSER_MCP_ENABLED=true`

### Integration Points

```
LLMRouterService.executeAgenticTools()  →  pass mcpConfigPath when MCP enabled
LLMRouterService.handleWebSearchRequest()  →  enrich search results with full page content
ClaudeClient.runAgent()  →  accept and forward mcpConfigPath to CLI args
```

### Data Flow

```
Web Search Flow (enrichment):
  User query → DuckDuckGo search → top N URLs → BrowserService.fetchMultiplePages()
    → full page text appended to search context → Claude generates answer

Agentic Flow (MCP):
  User request → Claude CLI --mcp-config browser-mcp.json
    → Claude uses Playwright MCP tools (navigate, click, screenshot, etc.)
    → response returned to user
```

## Phases

| # | Phase | Description | File |
|---|-------|-------------|------|
| 1 | [Dependencies & MCP Config](./impl/phase-1-dependencies.md) | Install packages, create MCP config | `impl/phase-1-dependencies.md` |
| 2 | [Configuration Layer](./impl/phase-2-configuration.md) | Env schema, config, feature flags, .env.example | `impl/phase-2-configuration.md` |
| 3 | [Claude Client MCP Support](./impl/phase-3-claude-client.md) | Add mcpConfigPath to ClaudeClient | `impl/phase-3-claude-client.md` |
| 4 | [BrowserService Core](./impl/phase-4-browser-service.md) | Implement BrowserService with tests | `impl/phase-4-browser-service.md` |
| 5 | [Factory & Wiring](./impl/phase-5-factory-wiring.md) | Factory module, service index wiring | `impl/phase-5-factory-wiring.md` |
| 6 | [LLM Router Integration](./impl/phase-6-router-integration.md) | MCP pass-through + web search enrichment | `impl/phase-6-router-integration.md` |
| 7 | [Verification & Docs](./impl/phase-7-verification.md) | End-to-end verification, CLAUDE.md update | `impl/phase-7-verification.md` |

## Progress

- [x] Phase 1: Dependencies & MCP Config
- [x] Phase 2: Configuration Layer
- [x] Phase 3: Claude Client MCP Support
- [x] Phase 4: BrowserService Core
- [x] Phase 5: Factory & Wiring
- [x] Phase 6: LLM Router Integration
- [x] Phase 7: Verification & Docs

## Scratchpad

Shared information between phases is tracked in [impl/scratchpad.md](./impl/scratchpad.md).
