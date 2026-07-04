# Phase 3: Claude Client MCP Support

**Prerequisites**: Phase 2 (configuration available)
**Outcome**: `ClaudeClient.runAgent()` accepts and forwards `mcpConfigPath` to Claude CLI

Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for code style guidelines.
Reference [impl/scratchpad.md](./scratchpad.md) for shared patterns.

## Tasks

### 3.1 Write tests first — `src/clients/claude.client.test.ts`

- [ ] Check if test file exists; create or extend it
- [ ] Add test: `runAgent` passes `--mcp-config` flag when `mcpConfigPath` is provided
- [ ] Add test: `runAgent` does NOT add `--mcp-config` when `mcpConfigPath` is undefined
- [ ] Add test: `runAgent` does NOT add `--mcp-config` when `mcpConfigPath` is empty string

**Test approach**: Mock `child_process.spawn` to capture the args array and assert flag presence/absence. Follow the existing mock pattern in the codebase (mocks declared before imports).

### 3.2 Extend `ClaudeAgentOptions` interface

- [ ] In `src/clients/claude.client.ts` (line 30), add:

```typescript
export interface ClaudeAgentOptions {
  timeoutMs?: number;
  allowedTools?: string[];
  mcpConfigPath?: string;  // Path to MCP config JSON for browser/tool servers
}
```

### 3.3 Forward `mcpConfigPath` in `runAgent()`

- [ ] In `runAgent()` method (around line 148, after the tools block), add:

```typescript
// Add MCP config for external tool servers (e.g., Playwright browser)
if (options?.mcpConfigPath) {
  args.push('--mcp-config', options.mcpConfigPath);
}
```

- [ ] Ensure it's placed BEFORE the task argument push (`args.push(task)`)
- [ ] Add `mcpConfigPath` to the logger.info call in the method

### 3.4 Verify

- [ ] Run `npx vitest src/clients/claude.client.test.ts` — new tests pass
- [ ] Run `npm run build` — compiles cleanly
- [ ] Run `npm test` — all existing tests still pass

## Notes

- This follows the exact same pattern used by the CEO bot in `ceo-response.service.ts` for passing MCP configs
- The `--mcp-config` flag tells Claude CLI to spawn and manage the MCP server process; no separate lifecycle management needed
