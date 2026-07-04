/**
 * Security Types
 *
 * Comprehensive type definitions for security features including:
 * - Data retention policies
 * - PII detection and redaction
 * - Encryption configuration
 * - Data export and deletion (GDPR compliance)
 * - Security audit logging
 */

// ============================================================================
// Data Retention Policy Types
// ============================================================================

/**
 * Entity types that can have retention policies applied
 */
export type RetentionEntityType =
  | 'message'
  | 'memory'
  | 'media'
  | 'cache'
  | 'metrics'
  | 'embeddings';

/**
 * Data retention policy configuration
 *
 * Defines how long different types of data should be kept
 * and whether archival or user consent is required.
 *
 * @example
 * ```typescript
 * const messagePolicy: RetentionPolicy = {
 *   entityType: 'message',
 *   retentionDays: 90,
 *   archiveBeforeDelete: true,
 *   requiresUserConsent: false
 * };
 * ```
 */
export interface RetentionPolicy {
  /** The type of entity this policy applies to */
  entityType: RetentionEntityType;

  /** Number of days to retain the data before deletion */
  retentionDays: number;

  /** Whether to archive data before deletion (for compliance) */
  archiveBeforeDelete: boolean;

  /** Whether user consent is required before deletion */
  requiresUserConsent: boolean;
}

// ============================================================================
// PII Detection and Redaction Types
// ============================================================================

/**
 * Types of Personally Identifiable Information (PII) that can be detected
 */
export enum PIIType {
  PHONE_NUMBER = 'PHONE_NUMBER',
  EMAIL = 'EMAIL',
  NAME = 'NAME',
  ADDRESS = 'ADDRESS',
  CREDIT_CARD = 'CREDIT_CARD',
  SSN = 'SSN',
  IP_ADDRESS = 'IP_ADDRESS',
  TELEGRAM_ID = 'TELEGRAM_ID',
  USERNAME = 'USERNAME',
  CUSTOM = 'CUSTOM',
}

/**
 * Detected PII instance with location and redaction information
 *
 * @example
 * ```typescript
 * const detection: PIIDetection = {
 *   type: PIIType.PHONE_NUMBER,
 *   value: '+1-555-123-4567',
 *   startIndex: 15,
 *   endIndex: 30,
 *   confidence: 0.95,
 *   redactedValue: '+1-***-***-4567'
 * };
 * ```
 */
export interface PIIDetection {
  /** The type of PII detected */
  type: PIIType;

  /** The original detected value */
  value: string;

  /** Starting character index in the original text */
  startIndex: number;

  /** Ending character index in the original text */
  endIndex: number;

  /** Confidence score of the detection (0.0 to 1.0) */
  confidence: number;

  /** The value after redaction has been applied */
  redactedValue: string;
}

/**
 * Configuration for PII redaction behavior
 *
 * @example
 * ```typescript
 * const config: PIIRedactionConfig = {
 *   types: [PIIType.PHONE_NUMBER, PIIType.EMAIL, PIIType.SSN],
 *   preserveFormat: true,
 *   redactionChar: '*',
 *   minConfidence: 0.8
 * };
 * ```
 */
export interface PIIRedactionConfig {
  /** Types of PII to detect and redact */
  types: PIIType[];

  /** Whether to preserve format (e.g., ***-***-1234) or fully redact */
  preserveFormat: boolean;

  /** Character to use for redaction (typically '*' or 'X') */
  redactionChar: string;

  /** Minimum confidence threshold for applying redaction (0.0 to 1.0) */
  minConfidence: number;
}

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Supported encryption algorithms for data at rest
 */
export enum EncryptionAlgorithm {
  /** AES-256 with Galois/Counter Mode (authenticated encryption) */
  AES_256_GCM = 'AES-256-GCM',

  /** AES-256 with Cipher Block Chaining (legacy support) */
  AES_256_CBC = 'AES-256-CBC',

  /** ChaCha20-Poly1305 (modern alternative to AES-GCM) */
  CHACHA20_POLY1305 = 'CHACHA20-POLY1305',
}

/**
 * Key derivation function types
 */
export type KeyDerivationFunction = 'argon2id' | 'pbkdf2' | 'scrypt';

/**
 * Encryption configuration for cryptographic operations
 *
 * @example
 * ```typescript
 * const config: EncryptionConfig = {
 *   algorithm: EncryptionAlgorithm.AES_256_GCM,
 *   keyDerivation: 'argon2id',
 *   keyLength: 32,
 *   ivLength: 16,
 *   saltLength: 32,
 *   memoryCost: 65536
 * };
 * ```
 */
export interface EncryptionConfig {
  /** The encryption algorithm to use */
  algorithm: EncryptionAlgorithm;

  /** Key derivation function for password-based encryption */
  keyDerivation: KeyDerivationFunction;

  /** Length of the encryption key in bytes (typically 32 for AES-256) */
  keyLength: number;

  /** Length of the initialization vector in bytes */
  ivLength: number;

  /** Length of the salt for key derivation in bytes */
  saltLength: number;

  /** Number of iterations for PBKDF2 */
  iterations?: number;

  /** Memory cost parameter for Argon2 (in KB) */
  memoryCost?: number;

  /** Time cost parameter for Argon2 (number of iterations) */
  timeCost?: number;

  /** Parallelism parameter for Argon2 (number of threads) */
  parallelism?: number;
}

/**
 * Encrypted data container with all necessary metadata for decryption
 *
 * @example
 * ```typescript
 * const encrypted: EncryptedData = {
 *   ciphertext: 'base64encodedciphertext==',
 *   iv: 'base64encodediv==',
 *   salt: 'base64encodedsalt==',
 *   algorithm: EncryptionAlgorithm.AES_256_GCM,
 *   version: 1
 * };
 * ```
 */
export interface EncryptedData {
  /** The encrypted data, base64 encoded */
  ciphertext: string;

  /** Initialization vector, base64 encoded */
  iv: string;

  /** Salt used for key derivation, base64 encoded */
  salt: string;

  /** The algorithm used for encryption */
  algorithm: EncryptionAlgorithm;

  /** Version number for encryption scheme (supports future migrations) */
  version?: number;

  /** Timestamp when the data was encrypted (ISO 8601 format) */
  encryptedAt?: string;

  /** Key derivation function used for password-based encryption */
  keyDerivation?: KeyDerivationFunction;

  /** Authentication tag for authenticated encryption (e.g., GCM mode) */
  authTag?: string;
}

/**
 * Configuration for field-level encryption in database tables
 *
 * @example
 * ```typescript
 * const fieldConfig: FieldEncryptionConfig = {
 *   table: 'messages',
 *   field: 'content',
 *   enabled: true,
 *   algorithm: EncryptionAlgorithm.AES_256_GCM
 * };
 * ```
 */
export interface FieldEncryptionConfig {
  /** Database table name */
  table: string;

  /** Field/column name to encrypt */
  field: string;

  /** Whether encryption is enabled for this field */
  enabled: boolean;

  /** Encryption algorithm to use for this field */
  algorithm: EncryptionAlgorithm;
}

// ============================================================================
// Data Export and Deletion Types (GDPR Compliance)
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv' | 'zip';

/**
 * User data export request (GDPR Article 20: Right to Data Portability)
 *
 * @example
 * ```typescript
 * const request: DataExportRequest = {
 *   userId: 'user-123',
 *   telegramId: 123456789n,
 *   requestedAt: new Date(),
 *   includeMessages: true,
 *   includeMemories: true,
 *   includePreferences: true,
 *   includeMedia: false,
 *   format: 'json'
 * };
 * ```
 */
export interface DataExportRequest {
  /** Internal user ID */
  userId: string;

  /** Telegram user ID */
  telegramId: bigint;

  /** Timestamp when the export was requested */
  requestedAt: Date;

  /** Whether to include message history */
  includeMessages: boolean;

  /** Whether to include extracted memories */
  includeMemories: boolean;

  /** Whether to include user preferences */
  includePreferences: boolean;

  /** Whether to include media files */
  includeMedia: boolean;

  /** Output format for the export */
  format: ExportFormat;
}

/**
 * Result of a data export operation
 *
 * @example
 * ```typescript
 * const result: DataExportResult = {
 *   requestId: 'export-456',
 *   userId: 'user-123',
 *   exportedAt: new Date(),
 *   filePath: '/exports/user-123-20230615.zip',
 *   sizeBytes: 1048576,
 *   recordCounts: {
 *     messages: 1500,
 *     memories: 75,
 *     preferences: 12,
 *     mediaFiles: 45
 *   }
 * };
 * ```
 */
export interface DataExportResult {
  /** Unique identifier for this export request */
  requestId: string;

  /** Internal user ID */
  userId: string;

  /** Timestamp when the export was completed */
  exportedAt: Date;

  /** File system path to the exported data */
  filePath: string;

  /** Total size of the export in bytes */
  sizeBytes: number;

  /** Count of records exported by type */
  recordCounts: {
    messages: number;
    memories: number;
    preferences: number;
    mediaFiles: number;
  };
}

/**
 * User data deletion request (GDPR Article 17: Right to Erasure)
 *
 * @example
 * ```typescript
 * const request: DataDeletionRequest = {
 *   userId: 'user-123',
 *   telegramId: 123456789n,
 *   requestedAt: new Date(),
 *   deleteMessages: true,
 *   deleteMemories: true,
 *   deletePreferences: true,
 *   deleteMedia: true,
 *   reason: 'User requested account deletion'
 * };
 * ```
 */
export interface DataDeletionRequest {
  /** Internal user ID */
  userId: string;

  /** Telegram user ID */
  telegramId: bigint;

  /** Timestamp when deletion was requested */
  requestedAt: Date;

  /** Whether to delete message history */
  deleteMessages: boolean;

  /** Whether to delete extracted memories */
  deleteMemories: boolean;

  /** Whether to delete user preferences */
  deletePreferences: boolean;

  /** Whether to delete media files */
  deleteMedia: boolean;

  /** Optional reason for deletion request */
  reason?: string;
}

/**
 * Result of a data deletion operation
 *
 * @example
 * ```typescript
 * const result: DataDeletionResult = {
 *   requestId: 'delete-789',
 *   userId: 'user-123',
 *   deletedAt: new Date(),
 *   deletedCounts: {
 *     messages: 1500,
 *     memories: 75,
 *     preferences: 12,
 *     mediaFiles: 45,
 *     embeddings: 150,
 *     cacheEntries: 23
 *   },
 *   auditLogId: 'audit-101112'
 * };
 * ```
 */
export interface DataDeletionResult {
  /** Unique identifier for this deletion request */
  requestId: string;

  /** Internal user ID */
  userId: string;

  /** Timestamp when deletion was completed */
  deletedAt: Date;

  /** Count of records deleted by type */
  deletedCounts: {
    messages: number;
    memories: number;
    preferences: number;
    mediaFiles: number;
    embeddings: number;
    cacheEntries: number;
  };

  /** Reference to the audit log entry for this deletion */
  auditLogId: string;
}

// ============================================================================
// Security Audit Types
// ============================================================================

/**
 * Types of security events that can be audited
 */
export enum SecurityEventType {
  /** User login attempt initiated */
  LOGIN_ATTEMPT = 'LOGIN_ATTEMPT',

  /** User successfully authenticated */
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',

  /** User authentication failed */
  LOGIN_FAILURE = 'LOGIN_FAILURE',

  /** User accessed sensitive data */
  DATA_ACCESS = 'DATA_ACCESS',

  /** User exported their data */
  DATA_EXPORT = 'DATA_EXPORT',

  /** User requested data deletion */
  DATA_DELETION = 'DATA_DELETION',

  /** PII was detected in content */
  PII_DETECTION = 'PII_DETECTION',

  /** Rate limit threshold was reached */
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',

  /** Suspicious activity pattern detected */
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',

  /** Error during encryption/decryption */
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',

  /** Security configuration was changed */
  CONFIG_CHANGE = 'CONFIG_CHANGE',
}

/**
 * Severity levels for security events
 */
export type SecuritySeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * Security audit log entry
 *
 * Records security-relevant events for compliance, forensics, and monitoring.
 *
 * @example
 * ```typescript
 * const auditLog: SecurityAuditLog = {
 *   id: 'audit-123',
 *   eventType: SecurityEventType.DATA_EXPORT,
 *   userId: 'user-456',
 *   telegramId: 123456789n,
 *   action: 'User requested full data export',
 *   details: {
 *     format: 'json',
 *     includeMedia: true,
 *     sizeBytes: 1048576
 *   },
 *   ipAddress: '192.168.1.100',
 *   userAgent: 'TelegramBot/1.0',
 *   timestamp: new Date(),
 *   severity: 'INFO',
 *   correlationId: 'req-789'
 * };
 * ```
 */
export interface SecurityAuditLog {
  /** Unique identifier for this audit log entry */
  id: string;

  /** Type of security event */
  eventType: SecurityEventType;

  /** Internal user ID (if applicable) */
  userId?: string;

  /** Telegram user ID (if applicable) */
  telegramId?: bigint;

  /** Human-readable description of the action taken */
  action: string;

  /** Additional context and metadata about the event */
  details: Record<string, unknown>;

  /** IP address of the requester (if available) */
  ipAddress?: string;

  /** User agent string (if available) */
  userAgent?: string;

  /** Timestamp when the event occurred */
  timestamp: Date;

  /** Severity level of the event */
  severity: SecuritySeverity;

  /** Correlation ID for linking related events */
  correlationId?: string;
}

// All types and enums are already exported via their declarations above
