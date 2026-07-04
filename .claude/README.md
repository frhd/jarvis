# Claude Code Configuration

This directory contains configuration and documentation for Claude Code (Anthropic's CLI tool).

## Directory Structure

```
.claude/
├── settings.local.json   # Local permissions and settings
├── agents/               # Agent instruction templates
├── skills/               # Skill documentation (manual workflows)
└── README.md             # This file
```

## Agents (`agents/`)

Agent files are **instruction templates** that guide Claude Code when performing specific types of tasks. They are NOT automatically invocable but serve as reference documentation.

### Usage

When you need Claude to perform a task covered by an agent, you can:
1. Ask Claude to "follow the log-analysis agent instructions"
2. Reference the agent file directly: "Use `.claude/agents/health-monitor.md` to check system health"
3. Copy relevant instructions into your prompt

### Available Agents

| Agent | Purpose | Type |
|-------|---------|------|
| `log-analysis.md` | Debug logs and find error patterns | Explore |
| `metrics-analysis.md` | Analyze performance metrics | Explore |
| `health-monitor.md` | Comprehensive system health check | general-purpose |
| `incident-response.md` | Guide incident investigation | Plan |
| `service-generator.md` | Generate new services | general-purpose |
| `test-generator.md` | Generate test files | general-purpose |
| `llm-provider.md` | Add new LLM providers | general-purpose |
| `migration-generator.md` | Create database migrations | general-purpose |
| `rag-optimization.md` | Optimize RAG pipeline | Explore |
| `security-audit.md` | Security vulnerability check | Explore |

## Skills (`skills/`)

Skill files are **workflow documentation** that describe step-by-step procedures. They are reference guides, not automatically executable commands.

### Usage

Reference skills when performing specific operations:
- "Follow the `/health` skill to check system status"
- "Use the `/add-service` skill to create a new service"

### Available Skills

#### Operations
| Skill | Purpose |
|-------|---------|
| `/health` | System health check |
| `/debug-logs` | Log analysis |
| `/metrics` | Metrics export and analysis |
| `/diagnose` | Symptom-based diagnosis |

#### Development
| Skill | Purpose |
|-------|---------|
| `/add-service` | Generate new service |
| `/add-tool` | Create LLM tool |
| `/add-worker` | Create background worker |
| `/add-error` | Add error types |
| `/add-provider` | Add LLM provider |
| `/add-intent` | Extend intent taxonomy |
| `/db-migrate` | Create database migration |

#### Testing
| Skill | Purpose |
|-------|---------|
| `/regression` | Run regression tests |
| `/chaos-test` | Run chaos engineering tests |
| `/circular-check` | Check circular dependencies |

## Settings (`settings.local.json`)

Local settings including:
- **Permissions**: Pre-approved bash commands and web fetch domains
- **Output Style**: Response formatting preferences

### Permissions Format

```json
{
  "permissions": {
    "allow": [
      "Bash(command:*)",      // Allow command with any args
      "WebFetch(domain:x.com)" // Allow fetching from domain
    ]
  }
}
```

## Best Practices

1. **Keep agents focused**: Each agent should have a single, clear purpose
2. **Include examples**: Provide bash commands and SQL queries that can be directly used
3. **Reference source files**: Link to relevant code files for context
4. **Add troubleshooting**: Include common issues and solutions
5. **Avoid time estimates**: Focus on steps, not duration
