# Phase 7: Verification & Docs

**Prerequisites**: All previous phases complete
**Outcome**: End-to-end verification, documentation updated

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for file tracking checklist.

## Tasks

### 7.1 Build & test suite

- [x] Run `npm run build` — clean compilation
- [x] Run `npm test` — all tests pass (including new browser and router tests)
- [x] Run `npm run check:circular` — no new circular dependencies introduced

### 7.2 Disabled-by-default verification

- [x] With no `BROWSER_*` env vars set, verify:
  - [x] `appConfig.browser.enabled === false`
  - [x] `appConfig.browser.mcpEnabled === false`
  - [x] `browserService` is `null` (from factory)
  - [x] No Chromium process is started
  - [x] Existing web search and agentic flows work identically to before

### 7.3 Browser enrichment smoke test

- [ ] Set `BROWSER_ENABLED=true` in `.env`
- [ ] Start Jarvis (`npm run dev` or `npm start`)
- [ ] Send a web search query (e.g., "what's the weather in Berlin")
- [ ] Check logs for:
  - [ ] `[LLMRouter] Browser content enrichment succeeded` with `fetchedPages > 0`
  - [ ] Or graceful fallback message if pages fail to load
- [ ] Verify response includes information from full page content (not just snippets)

### 7.4 MCP browser tools smoke test

- [ ] Set `BROWSER_MCP_ENABLED=true` and `BROWSER_MCP_CONFIG_PATH=config/browser-mcp.json`
- [ ] Send an agentic request like "go to example.com and tell me what's on the page"
- [ ] Verify Claude CLI receives `--mcp-config` flag (check logs for args)
- [ ] Verify Claude uses Playwright MCP tools in its response

### 7.5 Graceful shutdown verification

- [ ] With `BROWSER_ENABLED=true`, start Jarvis
- [ ] Trigger a browser fetch (send web search query)
- [ ] Stop Jarvis (SIGTERM / Ctrl+C)
- [ ] Verify logs show browser shutdown at priority 65:
  - `[Shutdown] browser - completed`

### 7.6 Update CLAUDE.md

- [x] Add Browser section to CLAUDE.md under "Configuration" or "Key Integration Points"
- [x] Add `BrowserService` to the "Tools" section under Services (already present)
- [x] Add browser shutdown priority to the Shutdown Priorities list

### 7.7 Finalize scratchpad

- [x] Check all items in `impl/scratchpad.md` file tracking are complete
- [x] Update `impl.md` — check all phase boxes

## Notes

- Smoke tests (7.3, 7.4, 7.5) require a running Jarvis instance with Telegram credentials — deferred to manual testing
- If Chromium binary is not installed, browser features will fail gracefully with logged errors
- MCP smoke test requires Claude CLI to be installed and working
