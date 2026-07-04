# Security Configuration Guide

This document describes the security configuration system added to Jarvis.

## Overview

The security configuration provides centralized management of:
- **Encryption** - Data encryption at rest with multiple algorithm options
- **PII Detection & Redaction** - Automatically detect and redact personally identifiable information
- **Data Retention** - Configurable retention periods for different data types
- **Audit Logging** - Security audit trails for compliance
- **GDPR Compliance** - Data export and deletion capabilities

## Configuration Files

Three files have been modified to support security configuration:

1. **`src/config/schema.ts`** - Zod schema validation for security settings
2. **`src/config/index.ts`** - Environment variable parsing and configuration loading
3. **`src/config/feature-flags.ts`** - Runtime feature flags for security features

## Environment Variables

### Security Master Switch

```bash
# Enable/disable all security features (default: true)
SECURITY_ENABLED=true
```

### Encryption Settings

```bash
# Enable data encryption at rest (default: false)
ENCRYPTION_ENABLED=true

# Encryption algorithm: AES-256-GCM, AES-256-CBC, or CHACHA20-POLY1305 (default: AES-256-GCM)
ENCRYPTION_ALGORITHM=AES-256-GCM

# Key derivation function: argon2id, pbkdf2, or scrypt (default: argon2id)
KEY_DERIVATION=argon2id
```

### PII (Personally Identifiable Information) Settings

```bash
# Enable PII detection (default: true)
PII_DETECTION_ENABLED=true

# Enable PII redaction in storage (default: true)
PII_REDACTION_ENABLED=true

# Redact PII in logs (default: true)
PII_REDACT_LOGS=true

# Minimum confidence threshold for PII detection (0.0-1.0, default: 0.8)
PII_MIN_CONFIDENCE=0.8
```

### Data Retention Settings

```bash
# Days to retain messages (default: 90)
MESSAGE_RETENTION_DAYS=90

# Days to retain memories (default: 180)
MEMORY_RETENTION_DAYS=180

# Days to retain media files (default: 30)
MEDIA_RETENTION_DAYS=30

# Days to retain cache entries (default: 7)
CACHE_RETENTION_DAYS=7

# Days to retain metrics (default: 30)
METRICS_RETENTION_DAYS=30

# Days to retain audit logs (default: 365)
AUDIT_LOG_RETENTION_DAYS=365
```

### Audit Settings

```bash
# Enable security audit logging (default: true)
SECURITY_AUDIT_ENABLED=true

# Log data access events (default: true)
AUDIT_LOG_DATA_ACCESS=true

# Log PII detection events (default: true)
AUDIT_LOG_PII=true

# Log configuration changes (default: true)
AUDIT_LOG_CONFIG=true
```

### GDPR Compliance Settings

```bash
# Enable GDPR compliance features (default: true)
GDPR_ENABLED=true

# Allow users to export their data (default: true)
GDPR_ALLOW_EXPORT=true

# Allow users to delete their data (default: true)
GDPR_ALLOW_DELETION=true

# Enable data minimization (default: false)
GDPR_DATA_MINIMIZATION=false
```

## Usage in Code

### Accessing Configuration

```typescript
import { appConfig } from './config';

// Access security configuration
const { security } = appConfig;

// Check if encryption is enabled
if (security.encryption.enabled) {
  console.log(`Using ${security.encryption.algorithm} encryption`);
  console.log(`Key derivation: ${security.encryption.keyDerivation}`);
}

// Check PII settings
if (security.pii.detectionEnabled) {
  console.log(`PII detection enabled with ${security.pii.minConfidence} confidence threshold`);
}

// Get retention periods
console.log(`Message retention: ${security.retention.messageRetentionDays} days`);
console.log(`Memory retention: ${security.retention.memoryRetentionDays} days`);

// Check GDPR settings
if (security.gdpr.enabled) {
  console.log('GDPR compliance features enabled');
  if (security.gdpr.allowDataExport) {
    console.log('Data export available');
  }
  if (security.gdpr.allowDataDeletion) {
    console.log('Data deletion available');
  }
}
```

### Using Feature Flags

```typescript
import {
  isSecurityEnabled,
  isEncryptionEnabled,
  isPiiDetectionEnabled,
  isPiiRedactionEnabled,
  isAuditEnabled,
  isGdprEnabled,
  featureFlags,
  FeatureFlagNames
} from './config/feature-flags';

// Use convenience helpers
if (isSecurityEnabled()) {
  console.log('Security features are enabled');
}

if (isEncryptionEnabled()) {
  console.log('Encryption is enabled');
}

if (isPiiDetectionEnabled() && isPiiRedactionEnabled()) {
  console.log('PII detection and redaction are active');
}

// Or use the feature flags directly
if (featureFlags.isEnabled(FeatureFlagNames.AUDIT_ENABLED)) {
  console.log('Audit logging is enabled');
}

if (featureFlags.isEnabled(FeatureFlagNames.GDPR_ENABLED)) {
  console.log('GDPR compliance is enabled');
}

// Toggle flags at runtime (in-memory only, not persisted)
featureFlags.setFlag(FeatureFlagNames.ENCRYPTION_ENABLED, true);

// Get all security flags
const allFlags = featureFlags.getAllFlags();
console.log('Security flags:', {
  security: allFlags['security.enabled'],
  encryption: allFlags['security.encryption'],
  piiDetection: allFlags['security.piiDetection'],
  piiRedaction: allFlags['security.piiRedaction'],
  audit: allFlags['security.audit'],
  gdpr: allFlags['security.gdpr']
});

// Get flags by category
const securityFlags = featureFlags.getFlagsByCategory()['Security'];
console.log('All security category flags:', securityFlags);
```

### Runtime Configuration Updates

```typescript
import { runtimeConfig } from './config';

// Subscribe to security config changes
runtimeConfig.subscribe('security.encryption.enabled', (newValue, oldValue) => {
  console.log(`Encryption toggled from ${oldValue} to ${newValue}`);
});

runtimeConfig.subscribe('security.pii.minConfidence', (newValue, oldValue) => {
  console.log(`PII confidence threshold changed from ${oldValue} to ${newValue}`);
});

// Update configuration at runtime
runtimeConfig.set('security.pii.minConfidence', 0.9);
runtimeConfig.set('security.retention.messageRetentionDays', 120);
```

## TypeScript Types

The security configuration is fully typed through Zod schema inference:

```typescript
import type { AppConfig } from './config/schema';

// The AppConfig type includes the security configuration
type SecurityConfig = AppConfig['security'];

// TypeScript will provide autocomplete and type checking:
const config: SecurityConfig = {
  enabled: true,
  encryption: {
    enabled: false,
    algorithm: 'AES-256-GCM', // Only valid enum values allowed
    keyDerivation: 'argon2id'  // Only valid enum values allowed
  },
  pii: {
    detectionEnabled: true,
    redactionEnabled: true,
    redactInLogs: true,
    minConfidence: 0.8 // Must be between 0 and 1
  },
  retention: {
    messageRetentionDays: 90,    // Must be positive integer
    memoryRetentionDays: 180,
    mediaRetentionDays: 30,
    cacheRetentionDays: 7,
    metricsRetentionDays: 30,
    auditLogRetentionDays: 365
  },
  audit: {
    enabled: true,
    logDataAccess: true,
    logPiiDetection: true,
    logConfigChanges: true
  },
  gdpr: {
    enabled: true,
    allowDataExport: true,
    allowDataDeletion: true,
    dataMinimization: false
  }
};
```

## Validation

The configuration is validated at application startup using Zod schemas. Invalid values will cause the application to fail with a clear error message:

- `algorithm` must be one of: `'AES-256-GCM'`, `'AES-256-CBC'`, `'CHACHA20-POLY1305'`
- `keyDerivation` must be one of: `'argon2id'`, `'pbkdf2'`, `'scrypt'`
- `minConfidence` must be a number between 0 and 1
- All retention days must be positive integers
- All boolean flags default to sensible values

## Default Values

All security settings have sensible defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `security.enabled` | `true` | Security features enabled by default |
| `encryption.enabled` | `false` | Encryption off by default (must explicitly enable) |
| `encryption.algorithm` | `AES-256-GCM` | Most secure and performant option |
| `encryption.keyDerivation` | `argon2id` | Most secure key derivation function |
| `pii.detectionEnabled` | `true` | PII detection on by default |
| `pii.redactionEnabled` | `true` | PII redaction on by default |
| `pii.redactInLogs` | `true` | Log redaction on by default |
| `pii.minConfidence` | `0.8` | High confidence threshold |
| `retention.messageRetentionDays` | `90` | 3 months |
| `retention.memoryRetentionDays` | `180` | 6 months |
| `retention.mediaRetentionDays` | `30` | 1 month |
| `retention.cacheRetentionDays` | `7` | 1 week |
| `retention.metricsRetentionDays` | `30` | 1 month |
| `retention.auditLogRetentionDays` | `365` | 1 year |
| `audit.enabled` | `true` | Audit logging on by default |
| `audit.logDataAccess` | `true` | Log data access |
| `audit.logPiiDetection` | `true` | Log PII detections |
| `audit.logConfigChanges` | `true` | Log config changes |
| `gdpr.enabled` | `true` | GDPR compliance on by default |
| `gdpr.allowDataExport` | `true` | Allow data export |
| `gdpr.allowDataDeletion` | `true` | Allow data deletion |
| `gdpr.dataMinimization` | `false` | Data minimization off (must explicitly enable) |

## Feature Flags

Six security-related feature flags are available:

| Flag Name | Flag Path | Default | Category | Description |
|-----------|-----------|---------|----------|-------------|
| `SECURITY_ENABLED` | `security.enabled` | `true` | Security | Master switch for security features |
| `ENCRYPTION_ENABLED` | `security.encryption` | `false` | Security | Data encryption at rest |
| `PII_DETECTION_ENABLED` | `security.piiDetection` | `true` | Security | PII detection |
| `PII_REDACTION_ENABLED` | `security.piiRedaction` | `true` | Security | PII redaction |
| `AUDIT_ENABLED` | `security.audit` | `true` | Security | Security audit logging |
| `GDPR_ENABLED` | `security.gdpr` | `true` | Security | GDPR compliance features |

These flags can be toggled at runtime without restarting the application (changes are in-memory only and not persisted to `.env`).

## Next Steps

To implement the actual security features, you'll need to create:

1. **Encryption Service** - Implement the encryption/decryption logic
2. **PII Detection Service** - Implement PII detection using pattern matching or ML
3. **PII Redaction Service** - Implement redaction logic
4. **Retention Service** - Implement data cleanup based on retention periods
5. **Audit Service** - Implement audit logging
6. **GDPR Service** - Implement data export and deletion
7. **Database Schema** - Add audit log tables and encrypted field support

The configuration system is now ready to support these services.
