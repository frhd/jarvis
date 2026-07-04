# Phase 1: Dependencies & MCP Config

**Prerequisites**: None
**Outcome**: Playwright and MCP packages installed, MCP config file created

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for shared constants and decisions.

## Tasks

### 1.1 Install npm packages

- [ ] Run `npm install playwright @playwright/mcp`
- [ ] Verify `package.json` updated with both deps
- [ ] Verify `package-lock.json` regenerated

### 1.2 Install Chromium browser binary

- [ ] Run `npx playwright install chromium`
- [ ] Verify Chromium installed (check `npx playwright install --list`)

### 1.3 Create MCP config file

- [ ] Create `config/browser-mcp.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--browser", "chromium"]
    }
  }
}
```

- [ ] Verify JSON is valid (`node -e "require('./config/browser-mcp.json')"`)

### 1.4 Verify no build breakage

- [ ] Run `npm run build` — must succeed with no new errors
- [ ] Run `npm test` — existing tests must still pass

## Notes

- `playwright` is the core browser automation library (~2MB npm package; browser binary is ~300MB downloaded separately)
- `@playwright/mcp` is the Model Context Protocol server that exposes Playwright as tools to Claude CLI
- The MCP config is only used when Claude CLI is invoked with `--mcp-config` flag — it doesn't start any process at import time
