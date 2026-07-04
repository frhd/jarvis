---
name: "incident-response"
description: "Guide through incident investigation and resolution for Jarvis"
---

# Incident Response Agent

Guide through incident investigation and resolution for Jarvis.

## Agent Type
`Plan` agent with runbook knowledge

## When This Agent is Triggered

- Production incidents reported
- Alerts firing
- User-reported critical issues
- System outages
- Data integrity concerns

## Capabilities

1. **Incident Classification** - Determine severity and type
2. **Diagnostic Execution** - Run relevant checks
3. **Root Cause Analysis** - Identify underlying issues
4. **Remediation Guidance** - Execute fix procedures
5. **Documentation** - Record incident details

## Agent Instructions

When responding to an incident, follow this structured process:

### Phase 1: Triage

#### Gather Initial Information
Ask the user:
- What symptoms are observed?
- When did it start?
- What was happening before?
- Who is affected?

#### Quick Status Check
```bash
# Process running?
pgrep -fl "node.*jarvis"

# Recent errors?
tail -10 data/jarvis-error.log 2>/dev/null

# Queue status?
sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"

# Circuit breakers?
sqlite3 data/jarvis.db "SELECT name, state FROM circuitBreakerStates WHERE state != 'closed';"
```

#### Classify Severity

| Severity | Criteria |
|----------|----------|
| **P1 - Critical** | Complete outage, no messages processing, data loss risk |
| **P2 - High** | Major degradation, >50% messages failing, key features broken |
| **P3 - Medium** | Partial degradation, <50% affected, workaround exists |
| **P4 - Low** | Minor issue, cosmetic, single user affected |

### Phase 2: Investigation

#### Check Recent Changes
```bash
# Recent git commits
git log --oneline -10

# Recent config changes
git diff HEAD~5 .env.example

# Process uptime (if using PM2)
pm2 show jarvis | grep uptime
```

#### Identify Root Cause Category

| Category | Indicators | Runbook Section |
|----------|------------|-----------------|
| LLM Issues | Timeouts, model errors | High Response Time |
| Database Issues | SQLITE_BUSY, locks | Database Performance |
| Queue Issues | Backup, stuck messages | High Queue Depth |
| Connection Issues | Auth errors, disconnects | High Error Rate |
| Resource Issues | OOM, high CPU | Memory/Resource Issues |

#### Run Targeted Diagnostics
Based on category, reference the appropriate runbook in `docs/runbooks/monitoring-runbooks.md`.

### Phase 3: Remediation

#### Emergency Stabilization
If system is critically impacted:

```bash
# Option 1: Pause ingestion to prevent queue growth
# Edit .env: INGESTION_ENABLED=false

# Option 2: Disable LLM to use cached responses only
# Edit .env: LLM_ENABLED=false

# Option 3: Restart service
pm2 restart jarvis
# or
pkill -f "node.*jarvis" && npm run dev
```

#### Apply Specific Fix
Follow the resolution steps from the relevant runbook section.

Common fixes:

**Stuck Queue:**
```bash
sqlite3 data/jarvis.db "UPDATE queue SET status = 'pending', processingStartedAt = NULL WHERE status = 'processing' AND processingStartedAt < (unixepoch() - 600);"
```

**Cold LLM:**
```bash
# Replace model name with your configured OLLAMA_MODEL (check with `ollama list`)
curl http://localhost:11434/api/generate -d '{"model":"llama3.1:8b","keep_alive":"1h","prompt":"warmup"}'
```

**Database Lock:**
```bash
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

**Circuit Breaker:**
Wait 30 seconds for auto-reset, or fix underlying service.

### Phase 4: Verification

After applying fix:

```bash
# Check queue is draining
watch -n 5 'sqlite3 data/jarvis.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"'

# Check errors stopped
tail -f data/jarvis-error.log

# Check response times
sqlite3 data/jarvis.db "SELECT AVG(responseTimeMs) FROM llmResponses WHERE createdAt > datetime('now', '-5 minutes');"
```

### Phase 5: Documentation

Record the incident:

```
## Incident Report

### Summary
- **Date/Time:** [when]
- **Duration:** [how long]
- **Severity:** P1/P2/P3/P4
- **Impact:** [what was affected]

### Timeline
- [time]: Issue first observed
- [time]: Investigation started
- [time]: Root cause identified
- [time]: Fix applied
- [time]: System recovered

### Root Cause
[Description of what caused the issue]

### Resolution
[What was done to fix it]

### Prevention
[What can be done to prevent recurrence]

### Action Items
- [ ] [Follow-up task 1]
- [ ] [Follow-up task 2]
```

## Escalation Criteria

Escalate if:
- Issue persists > 30 minutes after initial remediation
- Data loss confirmed or suspected
- Multiple systems affected
- Security breach suspected
- Root cause cannot be identified

## Key Files

- Runbooks: `docs/runbooks/monitoring-runbooks.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Error codes: `src/errors/error-codes.ts`
- Health service: `src/services/health.service.ts`

## Emergency Contacts

Reference your organization's on-call rotation and escalation path.
