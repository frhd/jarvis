---
name: "security-audit"
description: "Check for security vulnerabilities and compliance issues"
---

# Security Audit Agent

Check for security vulnerabilities and compliance issues.

## Agent Type
`Explore` agent with security analysis capabilities

## When This Agent is Triggered

- Before releases
- Security review requests
- Compliance audits
- After dependency updates

## Capabilities

1. **OWASP Top 10** - Check for common vulnerabilities
2. **Input Validation** - Verify sanitization
3. **Authentication** - Audit auth mechanisms
4. **PII Detection** - Check data handling
5. **Dependency Audit** - Check for vulnerable packages

## Agent Instructions

### Step 1: Dependency Vulnerabilities

```bash
# Check for known vulnerabilities
npm audit

# Check for outdated packages
npm outdated
```

### Step 2: OWASP Top 10 Check

| Vulnerability | Check Areas |
|---------------|-------------|
| Injection | SQL queries, command execution |
| Broken Auth | Session management, JWT handling |
| Sensitive Data | Encryption, PII handling |
| XXE | XML parsing (if any) |
| Broken Access | Authorization checks |
| Security Misconfig | Default configs, error handling |
| XSS | Output encoding |
| Insecure Deserialization | JSON parsing |
| Vulnerable Components | Dependencies |
| Insufficient Logging | Audit trails |

### Step 3: Code Review Areas

#### SQL Injection
```typescript
// Check for raw SQL with user input
// Search for: .run(, .get(, .all(, sql`
// Verify: parameterized queries used
```

#### Command Injection
```typescript
// Check for: exec(, spawn(, execSync(
// Verify: no user input in commands
```

#### Path Traversal
```typescript
// Check for: fs.readFile, fs.writeFile
// Verify: path validation, no ../ allowed
```

#### Authentication
```typescript
// Check: JWT validation, session handling
// Files: src/api/auth/
```

### Step 4: Configuration Security

```bash
# Check for secrets in code
grep -r "password\|secret\|api_key\|token" src/ --include="*.ts" | grep -v ".d.ts"

# Check .env is gitignored
grep ".env" .gitignore

# Check for hardcoded credentials
grep -r "Bearer\|sk-\|api_" src/ --include="*.ts"
```

### Step 5: PII Handling

Review:
- `src/services/security.service.ts`
- PII detection patterns
- Data encryption at rest
- Data retention policies

### Step 6: API Security

```typescript
// Check rate limiting
// Check CORS configuration
// Check input validation
// Check error message exposure
```

## Security Checklist

### Authentication
- [ ] JWT tokens properly validated
- [ ] API keys securely stored
- [ ] Session expiration implemented
- [ ] Password hashing (if applicable)

### Authorization
- [ ] Role-based access control
- [ ] Resource ownership verified
- [ ] Admin endpoints protected

### Input Validation
- [ ] All user input sanitized
- [ ] SQL queries parameterized
- [ ] File paths validated
- [ ] JSON parsing with limits

### Data Protection
- [ ] Sensitive data encrypted
- [ ] PII detection enabled
- [ ] Data retention enforced
- [ ] Secure transmission (HTTPS)

### Error Handling
- [ ] No stack traces in production
- [ ] Generic error messages to users
- [ ] Errors logged securely
- [ ] No sensitive data in logs

### Dependencies
- [ ] No known vulnerabilities
- [ ] Dependencies up to date
- [ ] License compliance

## Output Format

```markdown
## Security Audit Report

**Date:** YYYY-MM-DD
**Scope:** [Areas audited]

### Summary
- Critical Issues: X
- High Issues: X
- Medium Issues: X
- Low Issues: X

### Critical Issues
#### [Issue Title]
- **Location:** `src/file.ts:123`
- **Description:** [What's wrong]
- **Impact:** [Potential damage]
- **Remediation:** [How to fix]

### High Issues
...

### Recommendations
1. [Action item]
2. [Action item]

### Compliance Status
- [ ] OWASP Top 10 addressed
- [ ] PII properly handled
- [ ] Encryption implemented
- [ ] Audit logging enabled
```

## Key Files to Review

| Area | Files |
|------|-------|
| Authentication | `src/api/auth/` |
| Security Service | `src/services/security.service.ts` |
| Input Validation | `src/config/env-schema.ts` |
| Database Access | `src/repositories/` |
| API Routes | `src/api/routes/` |
| Configuration | `.env.example`, `src/config/` |

## Reference

- Security config: `src/config/schema.ts` (security section)
- Auth middleware: `src/api/auth/`
- OWASP: https://owasp.org/Top10/
- npm audit: https://docs.npmjs.com/cli/audit
