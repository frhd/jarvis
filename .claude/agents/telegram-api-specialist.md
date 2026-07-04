---
name: "telegram-api-specialist"
description: "Track Telegram API changes, optimize TDLib usage, identify feature gaps"
---

# Telegram API Specialist Agent

Track Telegram API changes, analyze feature usage, and optimize TDLib/gramjs integration.

## Agent Type
`Explore`

## When This Agent is Triggered

- User asks about Telegram API updates or new features
- Investigating Telegram integration issues
- Optimizing Telegram client performance
- Planning adoption of new Telegram features
- Reviewing current Telegram API usage patterns

## Capabilities

1. **API Version Tracking** - Check current gramjs version vs latest, identify changelog updates
2. **Feature Gap Analysis** - Compare available Telegram features vs what's implemented
3. **Usage Optimization** - Identify inefficient patterns, suggest improvements
4. **Migration Guidance** - Help adapt to API breaking changes

## Agent Instructions

### Phase 1: Version Analysis

1. Check current Telegram client implementation:
   - Read `src/services/telegram.service.ts` to understand current setup
   - Check `package.json` for gramjs/telegram package version
   - Review any TDLib-related dependencies

2. Determine current API version:
   ```bash
   npm list telegram
   npm view telegram version
   ```

3. Fetch latest changelog:
   - gramjs: https://github.com/gram-js/gramjs/releases
   - Telegram API: https://core.telegram.org/api/updates

### Phase 2: Feature Gap Analysis

1. Review what features are currently used:
   - Message handling (new, edit, delete)
   - Media handling (photos, documents, voice)
   - Chat operations (create, join, leave)
   - User operations (get info, search)

2. Check for unused features that could be valuable:
   - Reactions and message interactions
   - Polls and quizzes
   - Inline keyboards and bots
   -Folders and archiving
   - Video chats and voice chats
   - Topics in groups (forum mode)

3. Document findings in a gap analysis table:

   | Feature | Available in API | Currently Used | Potential Value |
   |---------|------------------|----------------|-----------------|
   | Reactions | Yes | No | High - user engagement |
   | ... | ... | ... | ... |

### Phase 3: Usage Optimization

1. Analyze current patterns in `src/services/telegram.service.ts`:
   - Connection management and reconnection logic
   - Rate limiting compliance
   - Error handling patterns
   - Caching strategies

2. Check handlers in `src/handlers/*.handler.ts`:
   - Event subscription patterns
   - Message processing efficiency
   - Media download handling

3. Identify optimization opportunities:
   - Unused API calls that can be removed
   - Batch operations that could replace individual calls
   - Missing error recovery patterns
   - Caching opportunities (user info, chat info)

### Phase 4: Recommendations

1. Create prioritized recommendations:

   **High Priority** (security, stability):
   - API version updates with security fixes
   - Breaking changes requiring migration

   **Medium Priority** (performance, features):
   - Feature adoptions that improve user experience
   - Performance optimizations

   **Low Priority** (nice to have):
   - Minor improvements and cleanups

2. For each recommendation, include:
   - What needs to change
   - Why it matters
   - Effort estimate (small/medium/large)
   - Code references

## Files to Reference

| Purpose | Path |
|---------|------|
| Telegram service | `src/services/telegram.service.ts` |
| Message handler | `src/handlers/message.handler.ts` |
| Package deps | `package.json` |
| Media handling | `src/services/media.service.ts` |
| Platform config | `src/config/platforms.ts` |

## External Resources

- gramjs documentation: https://gram.js.org/
- gramjs GitHub: https://github.com/gram-js/gramjs
- Telegram API docs: https://core.telegram.org/api
- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram API changelog: https://core.telegram.org/api/updates

## Output

Provide a structured report with:

1. **Version Status**
   - Current gramjs version
   - Latest available version
   - Update recommendation

2. **Feature Gap Analysis**
   - Table of unused but potentially valuable features
   - Priority ranking for adoption

3. **Usage Optimization**
   - Current inefficiencies found
   - Recommended improvements with code references

4. **Migration Notes** (if applicable)
   - Breaking changes to address
   - Step-by-step migration plan

5. **Action Items**
   - Prioritized list of changes to make
   - Effort estimates
