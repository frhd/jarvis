# Debugging Claude Code CLI Integration: A Journey Through Silent Timeouts

When integrating Claude Code CLI into a Telegram bot, we hit a series of issues that took some detective work to solve. Here's what went wrong and how we fixed it.

## The Setup

We built a two-tier LLM system: Ollama for fast intent classification, and Claude Code CLI for heavy lifting like web searches. The architecture looked clean on paper:

```
Message → Ollama (classify) → Route to Claude CLI → Response
```

## Problem 1: Redundant Processing (~4.5s wasted)

**Symptom:** Messages took 7+ seconds before Claude even started.

**Root cause:** We were running a full Ollama "analysis" step *before* intent classification. Both did similar work.

**Fix:** Skip analysis for private chats where response generation handles everything:

```typescript
// Before: Always analyze, then classify, then respond
// After: For private chats, go straight to response router
if (this.shouldGenerateResponse(chat, message)) {
  await this.generateAndSendResponse(message, chat, sender);
  return { success: true };
}
```

**Savings:** ~4.5 seconds

## Problem 2: Slow Intent Classification (~2.3s)

**Symptom:** Even simple "weather in Berlin" queries waited for LLM classification.

**Fix:** Pattern-based fast path for obvious intents:

```typescript
const WEB_SEARCH_PATTERNS = /\b(weather|forecast|news|price|stock)\b/i;

private fastClassify(message: string) {
  if (WEB_SEARCH_PATTERNS.test(message)) {
    return { intent: 'needs_web_search', confidence: 0.9 };
  }
  return null; // Fall back to LLM
}
```

**Savings:** ~2.3 seconds for common queries

## Problem 3: Claude CLI Asking for Permission

**Symptom:** CLI returned "I need permission to use WebSearch" and timed out.

**Root cause:** `--print` mode is non-interactive but Claude still asks for tool permissions.

**Fix:** Add `--dangerously-skip-permissions`:

```typescript
const args = [
  '--print',
  '--model', 'sonnet',
  '--dangerously-skip-permissions',  // Auto-approve tools
];
```

## Problem 4: Shell Escaping Nightmare

**Symptom:** Errors like `/bin/sh: syntax error near unexpected token '('`

**Root cause:** Using `shell: true` in spawn options caused message content (with parentheses, asterisks) to be interpreted as shell syntax.

**Fix:** Remove `shell: true`:

```typescript
// Bad: shell interprets message as commands
spawn(cli, args, { shell: true });

// Good: direct execution
spawn(cli, args, { shell: false });
```

## Problem 5: The Silent Timeout (The Sneaky One)

**Symptom:** Claude CLI spawned but produced zero output for 60 seconds, then timed out.

**Root cause:** The CLI was waiting on stdin, even though we weren't sending anything. Using `stdio: ['pipe', 'pipe', 'pipe']` kept stdin open.

**Fix:** Ignore stdin completely:

```typescript
// Before: stdin pipe kept process waiting
spawn(cli, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
});

// After: ignore stdin, process runs immediately
spawn(cli, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

This was the trickiest bug - no error messages, no stderr, just silence.

## Final Result

| Metric | Before | After |
|--------|--------|-------|
| Intent classification | 2.3s | 0ms (fast path) |
| Redundant analysis | 4.5s | 0s |
| Claude CLI | Timeout | ~22s |
| **Total** | **Timeout** | **~26s** |

## Lessons Learned

1. **Log everything during debugging** - stdout/stderr chunks helped identify the shell escaping issue
2. **stdin matters** - Even if you're not sending input, how you handle stdin affects process behavior
3. **Test CLI commands directly first** - Our direct terminal test worked; spawn didn't. That narrowed down the problem
4. **Permission flags exist for a reason** - `--dangerously-skip-permissions` is there for automated/bot use cases

The debugging session took about an hour of iterative fixes, but the result is a working Claude-powered Telegram bot that can answer weather queries with real web search results.
