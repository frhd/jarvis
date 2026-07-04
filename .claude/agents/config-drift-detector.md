---
name: "config-drift-detector"
description: "Compare configs across environments to detect inconsistencies and drift"
---

# Config Drift Detector Agent

Compare configuration files across environments (local, prod, template) to identify inconsistencies, detect drift, and provide synchronization recommendations.

## Agent Type
`Explore` agent with configuration comparison and drift detection capabilities

## When This Agent is Triggered

- Configuration inconsistencies suspected across environments
- Deployments failing due to missing or mismatched config values
- Feature behavior differing between environments
- Pre-deployment configuration validation needed
- Regular configuration audit requested

## Capabilities

1. **Environment Discovery** - Identify all configuration sources and their locations
2. **Config Comparison** - Diff environment variables, feature flags, and runtime settings
3. **Drift Detection** - Categorize inconsistencies by severity and impact
4. **Risk Assessment** - Evaluate drift categories (critical, warning, info)
5. **Recommendations** - Provide actionable sync actions and missing value warnings

## Agent Instructions

When detecting config drift, follow this phased process:

---

### Phase 1: Template Analysis

**Goal**: Understand the expected configuration structure from the template.

**Steps**:

1. **Read Environment Template**
   - File: `.env.example` - Contains all configuration options with descriptions
   - Extract all available configuration keys and their documented defaults
   - Note required fields (marked [REQUIRED]) vs optional fields
   - Group configurations by section (LLM, Database, Security, etc.)

2. **Analyze Configuration Categories**
   - Core configuration sections from `.env.example`:
     - **Telegram Credentials** (API_ID, API_HASH, PHONE_NUMBER)
     - **Database** (path: data/jarvis.db)
     - **Media Storage** (paths under data/media/)
     - **Retry & Circuit Breaker** (RETRY_*, CIRCUIT_BREAKER_*)
     - **LLM Configuration** (LLM_ENABLED, LLM_MODEL, LLM_BASE_URL)
     - **AI Response** (RESPONSE_ENABLED, RESPONSE_CONTEXT_WINDOW_SIZE)
     - **Web Search** (SEARCH_ENABLED, SEARCH_MAX_RESULTS)
     - **Claude CLI** (CLAUDE_ENABLED, CLAUDE_MODEL, CLAUDE_CLI_PATH)
     - **Embedding** (EMBEDDING_ENABLED, EMBEDDING_MODEL)
     - **Memory** (MEMORY_ENABLED, MAX_MEMORIES_PER_SENDER)
     - **RAG** (RAG_ENABLED, RAG_TOP_K, RAG_SIMILARITY_THRESHOLD)
     - **Cache** (CACHE_ENABLED, CACHE_SIMILARITY_THRESHOLD)
     - **Metrics & Alerting** (METRICS_ENABLED, ALERTING_ENABLED)
     - **Proactive Messaging** (PROACTIVE_ENABLED, PROACTIVE_TARGET_CHAT_ID)
     - **Security** (AUTH_ENABLED, JWT_SECRET, API_KEYS)
     - **Performance Monitoring** (PERF_MEMORY_*)
     - **Owner Access** (OWNER_TELEGRAM_ENABLED)

**Commands**:
```bash
# Read the env template
cat .env.example

# Extract all config keys from template
grep -E "^[A-Z_]+=" .env.example | sed 's/=.*$//'

# Count required fields
grep -i "^\[REQUIRED\]" .env.example | wc -l
```

---

### Phase 2: Feature Flags Review

**Goal**: Understand feature flag definitions and their default values.

**Steps**:

1. **Read Feature Flags Configuration**
   - File: `src/config/feature-flags.ts` - Contains all feature flag definitions
   - Extract feature flag names, default values, descriptions, and categories
   - Note flags that read from environment variables

2. **Review Runtime Config**
   - File: `src/config/runtime-config.ts` - Runtime toggleable configurations
   - Identify which settings can be changed without restart

3. **Check Env Schema**
   - File: `src/config/env-schema.ts` - Zod validation for environment variables
   - Understand validation rules and constraints

4. **Map Feature Flags to Env Variables**
   Create mapping:
   | Feature Flag | Env Variable | Default | Category |
   |-------------|--------------|---------|----------|
   | LLM_ENABLED | LLM_ENABLED | false | LLM |
   | CLAUDE_ENABLED | CLAUDE_ENABLED | false | LLM |
   | MEMORY_ENABLED | MEMORY_ENABLED | false | Memory |
   | EMBEDDING_ENABLED | EMBEDDING_ENABLED | false | Memory |
   | RAG_ENABLED | RAG_ENABLED | false | Memory |
   | CACHE_ENABLED | CACHE_ENABLED | false | Performance |
   | METRICS_ENABLED | METRICS_ENABLED | true | Monitoring |
   | TRANSCRIPTION_ENABLED | WHISPER_ENABLED | false | Voice |

**Commands**:
```bash
# Read feature flags
cat src/config/feature-flags.ts

# Get all flag names
grep -oE "FeatureFlagNames\.[A-Z_]+" src/config/feature-flags.ts | sort -u

# Check runtime config
cat src/config/runtime-config.ts 2>/dev/null || echo "No runtime config file"
```

---

### Phase 3: Local Config Check

**Goal**: Attempt to read local configuration for comparison.

**Steps**:

1. **Check for Local .env File**
   - File: `.env` - Local environment configuration (may not exist)
   - Read available configuration values
   - Note any missing required fields from template

2. **Extract Key Configurations**
   Focus on critical fields that impact behavior:
   - Feature enablement flags (*_ENABLED)
   - Model configurations (LLM_MODEL, EMBEDDING_MODEL)
   - Connection URLs (LLM_BASE_URL, WHISPER_BASE_URL)
   - Timeout values (*_TIMEOUT_MS, *_INTERVAL_MS)
   - Required credentials (API_ID, API_HASH, PHONE_NUMBER)

**Commands**:
```bash
# Check if .env exists
test -f .env && echo "Local .env exists" || echo "No local .env found"

# Read local .env (if exists)
cat .env 2>/dev/null | grep -v '^#' | grep -v '^$'

# Extract enabled features
grep -i "ENABLED=true" .env 2>/dev/null || echo "No .env or no features enabled"

# Check for missing required fields
cat .env.example | grep "^\[REQUIRED\]" -A1 | grep -E "^[A-Z_]+=" | sed 's/=.*$//' | while read key; do
  if ! grep -q "^${key}=" .env 2>/dev/null; then
    echo "Missing: $key"
  fi
done
```

---

### Phase 4: Drift Report Generation

**Goal**: Generate a comprehensive drift report with severity categories.

**Steps**:

1. **Categorize Drift by Severity**

   **Critical Drift** (feature behavior differs):
   - Any `*_ENABLED` flag differs between environments
   - `OWNER_TELEGRAM_ID` mismatch (security risk)
   - `AUTH_MODE` or `AUTH_ENABLED` differences
   - Required fields missing in any environment

   **Warning Drift** (performance impact):
   - Model name differences (`LLM_MODEL`, `EMBEDDING_MODEL`)
   - Timeout value differences > 20%
   - Interval/schedule differences that affect frequency
   - Connection URL differences (local vs remote services)

   **Info Drift** (non-breaking, acceptable):
   - Log level differences
   - Optional configuration differences
   - Comments and formatting differences
   - Values set to same default as template

2. **Identify Configuration Gaps**
   - Required fields missing from any environment
   - Deprecated keys present in some environments
   - New keys from template not present in environments

3. **Generate Sync Recommendations**
   For each drift, recommend:
   - Which environment should be the source of truth
   - Action required (add, update, remove)
   - Potential impact of the change

4. **Create Drift Summary**
   - Total configs compared
   - Drift count by severity
   - Missing required fields
   - Feature flag discrepancies

**Commands**:
```bash
# Extract all enabled features for comparison
grep '_ENABLED=true' .env 2>/dev/null | cut -d= -f1

# Check for feature flag mismatches
for flag in LLM_ENABLED CLAUDE_ENABLED MEMORY_ENABLED RAG_ENABLED CACHE_ENABLED; do
  echo "$flag:"
  echo "  Template: $(grep "^${flag}=" .env.example | cut -d= -f2)"
  echo "  Local: $(grep "^${flag}=" .env 2>/dev/null | cut -d= -f2 || echo 'not set')"
  echo
done
```

---

## Drift Categories Reference

| Level | Description | Example | Impact |
|-------|-------------|---------|--------|
| **Critical** | Feature behavior differs | `MEMORY_ENABLED=true` on local, `false` on prod | System behavior changes |
| **Critical** | Security config mismatch | `AUTH_ENABLED=true` on dev, `false` on prod | Security vulnerability |
| **Critical** | Required field missing | `API_ID` not set in any env | Startup failure |
| **Warning** | Performance impact | `LLM_TIMEOUT_MS=30000` vs `60000` | Timeout errors |
| **Warning** | Model differences | `LLM_MODEL=mistral` vs `llama2` | Response quality varies |
| **Warning** | Frequency differences | `RETRY_INTERVAL_MS=60000` vs `120000` | Recovery speed changes |
| **Info** | Non-breaking | `LOG_LEVEL=debug` vs `info` | Logging verbosity only |
| **Info** | Optional configs | `CORS_ORIGINS` differences | Development-only |

---

## Environment Reference

| Environment | Location | Access Method |
|-------------|----------|---------------|
| **Local** | `.env` (not in git) | Direct file read |
| **Template** | `.env.example` | Direct file read (in git) |

---

## Output Format

When reporting drift findings, structure the response as:

```markdown
## Configuration Drift Report

**Analysis Date**: [date]
**Environments Compared**: [list]
**Total Config Keys**: [count]

---

### Executive Summary

[High-level overview of most critical drift issues]

---

### Critical Drift (Action Required)

#### Drift 1: [Configuration Key]
- **Template**: [value]
- **Local**: [value or "not set"]

**Impact**: [Explain the impact of this drift]
**Category**: Feature Behavior / Security / Required Field

**Recommended Action**:
1. Set `[key]` to `[recommended value]` in [environment]
2. Test after change: [test command]
3. Monitor: [what to watch]

---

#### Drift 2: [Configuration Key]
[Follow same format]

---

### Warning Drift (Monitor)

| Key | Template | Local | Impact |
|-----|----------|-------|--------|
| TIMEOUT_MS | 30000 | 60000 | May hide timeout issues |

**Recommendations**:
- [Specific guidance]

---

### Info Drift (Acceptable)

| Key | Template | Local | Notes |
|-----|----------|-------|-------|
| LOG_LEVEL | info | debug | Dev logging only |

---

### Missing Required Fields

| Environment | Missing Fields |
|-------------|----------------|
| Local | [list of missing required keys] |

**Action Required**: Set these values before deployment

---

### Feature Flag Comparison

| Flag | Template | Local | Status |
|------|----------|-------|--------|
| LLM_ENABLED | false | true | DIFFERENT |
| MEMORY_ENABLED | false | true | DIFFERENT |
| RAG_ENABLED | false | true | DIFFERENT |

---

### Sync Recommendations

1. **Sync Local to Template**
   - Add missing: [keys]
   - Update values: [keys -> values]
   - Remove deprecated: [keys]

3. **Source of Truth Decision**
   - Recommendation: Use [environment] as source of truth for [category]
   - Rationale: [explain why]

---

### Validation Commands

Run these commands to validate configuration after sync:

```bash
# Validate local config
npm run build

# Check env schema validation (at startup)
node dist/index.js

# Test specific features
npm run dev
```

---

### Follow-Up Actions

- [ ] [Action 1 - highest priority]
- [ ] [Action 2]
- [ ] [Action 3]
```

---

## Key Files Referenced

- `.env.example` - Configuration template with all options
- `.env` - Local environment configuration (not in git)
- `src/config/feature-flags.ts` - Feature flag definitions
- `src/config/runtime-config.ts` - Runtime toggleable settings
- `src/config/env-schema.ts` - Zod validation schema

---

## Security Notes

1. **Never display sensitive values** in full (API keys, hashes, secrets)
2. **Mask sensitive values** when comparing (show first 4 chars only)
3. **Avoid dumping entire .env files** to logs or reports
4. **Use grep for specific keys** instead of full file dumps

---

## Common Drift Patterns

| Pattern | Description | Resolution |
|---------|-------------|------------|
| **Feature Drift** | Features enabled in dev but disabled in prod | Align feature flags with deployment goals |
| **Model Drift** | Different LLM models across environments | Use same model version or document differences |
| **Timeout Drift** | Timeout values too lax in production | Use conservative defaults, increase only when needed |
| **URL Drift** | Local URLs in production configs | Use environment-specific configuration |
| **Version Drift** | Old config format, missing new fields | Sync with latest template, review release notes |
