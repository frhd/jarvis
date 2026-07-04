/**
 * Encryption Service
 *
 * Provides comprehensive data encryption capabilities using Node.js crypto module.
 *
 * Features:
 * - Multiple encryption algorithms (AES-256-GCM, AES-256-CBC, ChaCha20-Poly1305)
 * - Secure key derivation using scrypt
 * - Authenticated encryption with GCM and Poly1305
 * - JSON object encryption/decryption
 * - Bulk operations with key caching
 * - Data integrity verification
 *
 * Security Considerations:
 * - Always use authenticated encryption (GCM or Poly1305) for new data
 * - CBC mode is provided for legacy compatibility only
 * - Scrypt is used for key derivation (built into Node.js crypto)
 * - Random salts and IVs are generated for each encryption operation
 * - Authentication tags prevent tampering with encrypted data
 *
 * @example
 * ```typescript
 * const service = new EncryptionService(config);
 *
 * // Encrypt data
 * const encrypted = await service.encrypt("sensitive data", "password123");
 *
 * // Decrypt data
 * const decrypted = await service.decrypt(encrypted, "password123");
 *
 * // Encrypt JSON objects
 * const user = { name: "Alice", ssn: "123-45-6789" };
 * const encryptedUser = await service.encryptObject(user, "password123");
 * const decryptedUser = await service.decryptObject<typeof user>(encryptedUser, "password123");
 * ```
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';
import type {
  EncryptionAlgorithm,
  EncryptionConfig,
  EncryptedData,
} from '../types/security.types.js';
import { SecurityError, ErrorCode } from '../errors/index.js';
import { appConfig } from '../config/index.js';

// Promisify scrypt for async/await
const scryptAsync = promisify(scrypt);

/**
 * Mapping of encryption algorithms to Node.js cipher names
 */
const CIPHER_ALGORITHMS: Record<string, string> = {
  'AES-256-GCM': 'aes-256-gcm',
  'AES-256-CBC': 'aes-256-cbc',
  'CHACHA20-POLY1305': 'chacha20-poly1305',
};

/**
 * Default scrypt parameters
 * Based on OWASP recommendations for password-based key derivation
 */
const DEFAULT_SCRYPT_PARAMS = {
  cost: 16384, // N parameter (2^14) - CPU/memory cost
  blockSize: 8, // r parameter - block size
  parallelization: 1, // p parameter - parallelization factor
};

/**
 * Encryption Service
 *
 * Handles encryption and decryption of data using various algorithms
 * with secure key derivation from passwords.
 */
export class EncryptionService {
  private readonly config: EncryptionConfig;

  constructor(config: EncryptionConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * Validate encryption configuration
   *
   * @throws {SecurityError} If configuration is invalid
   */
  private validateConfig(): void {
    if (!this.config.algorithm) {
      throw new SecurityError(
        'Encryption algorithm is required',
        ErrorCode.CONFIGURATION_MISSING,
        { action: 'validate_config' }
      );
    }

    if (!CIPHER_ALGORITHMS[this.config.algorithm]) {
      throw new SecurityError(
        `Unsupported encryption algorithm: ${this.config.algorithm}`,
        ErrorCode.CONFIGURATION_INVALID,
        {
          action: 'validate_config',
          context: { algorithm: this.config.algorithm },
        }
      );
    }

    if (this.config.keyLength < 32) {
      throw new SecurityError(
        'Key length must be at least 32 bytes (256 bits)',
        ErrorCode.CONFIGURATION_INVALID,
        {
          action: 'validate_config',
          context: { keyLength: this.config.keyLength },
        }
      );
    }

    if (this.config.saltLength < 16) {
      throw new SecurityError(
        'Salt length must be at least 16 bytes',
        ErrorCode.CONFIGURATION_INVALID,
        {
          action: 'validate_config',
          context: { saltLength: this.config.saltLength },
        }
      );
    }
  }

  /**
   * Derive a cryptographic key from a password using scrypt
   *
   * Scrypt is a memory-hard key derivation function that is resistant to
   * hardware brute-force attacks. It's built into Node.js crypto module.
   *
   * @param password - Password to derive key from
   * @param salt - Random salt (use generateSalt() to create)
   * @returns Derived key as Buffer
   *
   * @example
   * ```typescript
   * const salt = service.generateSalt();
   * const key = await service.deriveKey("password123", salt);
   * ```
   */
  public async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    try {
      // Use scrypt with recommended parameters
      // Note: Node.js scrypt signature is (password, salt, keylen, options)
      const key = (await scryptAsync(
        password,
        salt,
        this.config.keyLength
      )) as Buffer;

      return key;
    } catch (error) {
      throw new SecurityError(
        'Failed to derive encryption key',
        ErrorCode.SECURITY_KEY_DERIVATION_FAILED,
        {
          action: 'derive_key',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Generate a random salt for key derivation
   *
   * Salts prevent rainbow table attacks and ensure the same password
   * produces different keys each time.
   *
   * @returns Random salt buffer
   *
   * @example
   * ```typescript
   * const salt = service.generateSalt();
   * ```
   */
  public generateSalt(): Buffer {
    return randomBytes(this.config.saltLength);
  }

  /**
   * Generate a random initialization vector (IV)
   *
   * IVs ensure the same plaintext encrypted with the same key
   * produces different ciphertext each time.
   *
   * @returns Random IV buffer
   *
   * @example
   * ```typescript
   * const iv = service.generateIV();
   * ```
   */
  public generateIV(): Buffer {
    return randomBytes(this.config.ivLength);
  }

  /**
   * Encrypt plaintext data with a password
   *
   * This method handles the complete encryption pipeline:
   * 1. Generate random salt and IV
   * 2. Derive key from password using scrypt
   * 3. Encrypt data with derived key
   * 4. Return encrypted data with metadata
   *
   * @param plaintext - Data to encrypt
   * @param password - Password for encryption
   * @returns Encrypted data with all necessary metadata for decryption
   *
   * @throws {SecurityError} If encryption fails
   *
   * @example
   * ```typescript
   * const encrypted = await service.encrypt("sensitive data", "password123");
   * ```
   */
  public async encrypt(plaintext: string, password: string): Promise<EncryptedData> {
    try {
      // Generate random salt and IV
      const salt = this.generateSalt();
      const iv = this.generateIV();

      // Derive key from password
      const key = await this.deriveKey(password, salt);

      // Encrypt the data
      const ciphertext = this.encryptWithKey(plaintext, key, iv);

      // Build encrypted data structure
      const encryptedData: EncryptedData = {
        ciphertext,
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        algorithm: this.config.algorithm,
        version: 1,
        encryptedAt: new Date().toISOString(),
        keyDerivation: this.config.keyDerivation,
      };

      return encryptedData;
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError(
        'Failed to encrypt data',
        ErrorCode.SECURITY_ENCRYPTION_FAILED,
        {
          action: 'encrypt',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Decrypt encrypted data with a password
   *
   * This method handles the complete decryption pipeline:
   * 1. Extract salt and IV from encrypted data
   * 2. Derive key from password using same parameters
   * 3. Decrypt ciphertext with derived key
   * 4. Return plaintext
   *
   * @param encryptedData - Encrypted data structure
   * @param password - Password for decryption
   * @returns Decrypted plaintext
   *
   * @throws {SecurityError} If decryption fails or authentication fails
   *
   * @example
   * ```typescript
   * const decrypted = await service.decrypt(encrypted, "password123");
   * ```
   */
  public async decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
    try {
      // Verify algorithm matches
      if (encryptedData.algorithm !== this.config.algorithm) {
        throw new SecurityError(
          `Algorithm mismatch: expected ${this.config.algorithm}, got ${encryptedData.algorithm}`,
          ErrorCode.SECURITY_DECRYPTION_FAILED,
          {
            action: 'decrypt',
            context: {
              expected: this.config.algorithm,
              actual: encryptedData.algorithm,
            },
          }
        );
      }

      // Extract salt and IV
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const iv = Buffer.from(encryptedData.iv, 'base64');

      // Derive key from password (using same salt)
      const key = await this.deriveKey(password, salt);

      // Decrypt the data
      const plaintext = this.decryptWithKey(encryptedData.ciphertext, key, iv, encryptedData.authTag);

      return plaintext;
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError(
        'Failed to decrypt data',
        ErrorCode.SECURITY_DECRYPTION_FAILED,
        {
          action: 'decrypt',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Encrypt data with an existing key
   *
   * Useful for bulk operations where you want to derive the key once
   * and reuse it for multiple encryption operations.
   *
   * @param plaintext - Data to encrypt
   * @param key - Encryption key (derived from password)
   * @param iv - Initialization vector
   * @returns Base64-encoded ciphertext (with auth tag for authenticated algorithms)
   *
   * @throws {SecurityError} If encryption fails
   *
   * @example
   * ```typescript
   * const key = await service.deriveKey("password123", salt);
   * const iv = service.generateIV();
   * const ciphertext = service.encryptWithKey("data", key, iv);
   * ```
   */
  public encryptWithKey(plaintext: string, key: Buffer, iv: Buffer): string {
    try {
      const cipherName = CIPHER_ALGORITHMS[this.config.algorithm];
      const cipher = createCipheriv(cipherName, key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      // For authenticated encryption (GCM, Poly1305), append auth tag
      if (this.config.algorithm === 'AES-256-GCM' || this.config.algorithm === 'CHACHA20-POLY1305') {
        // Type assertion needed as getAuthTag is not in base Cipheriv type
        const authTag = (cipher as any).getAuthTag() as Buffer;
        encrypted += ':' + authTag.toString('base64');
      }

      return encrypted;
    } catch (error) {
      throw new SecurityError(
        'Failed to encrypt data with key',
        ErrorCode.SECURITY_ENCRYPTION_FAILED,
        {
          action: 'encrypt_with_key',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Decrypt data with an existing key
   *
   * Useful for bulk operations where you want to derive the key once
   * and reuse it for multiple decryption operations.
   *
   * @param ciphertext - Base64-encoded ciphertext
   * @param key - Encryption key (derived from password)
   * @param iv - Initialization vector
   * @param authTag - Authentication tag (optional, for authenticated encryption)
   * @returns Decrypted plaintext
   *
   * @throws {SecurityError} If decryption fails or authentication fails
   *
   * @example
   * ```typescript
   * const key = await service.deriveKey("password123", salt);
   * const plaintext = service.decryptWithKey(ciphertext, key, iv);
   * ```
   */
  public decryptWithKey(
    ciphertext: string,
    key: Buffer,
    iv: Buffer,
    authTag?: string
  ): string {
    try {
      const cipherName = CIPHER_ALGORITHMS[this.config.algorithm];

      // For authenticated encryption, extract auth tag from ciphertext
      let actualCiphertext = ciphertext;
      let actualAuthTag: Buffer | undefined;

      if (this.config.algorithm === 'AES-256-GCM' || this.config.algorithm === 'CHACHA20-POLY1305') {
        if (authTag) {
          actualAuthTag = Buffer.from(authTag, 'base64');
        } else if (ciphertext.includes(':')) {
          // Auth tag appended to ciphertext
          const parts = ciphertext.split(':');
          actualCiphertext = parts[0];
          actualAuthTag = Buffer.from(parts[1], 'base64');
        } else {
          throw new SecurityError(
            'Authentication tag is required for authenticated encryption',
            ErrorCode.SECURITY_DECRYPTION_FAILED,
            { action: 'decrypt_with_key' }
          );
        }
      }

      const decipher = createDecipheriv(cipherName, key, iv);

      // Set auth tag for authenticated encryption
      if (actualAuthTag) {
        // Type assertion needed as setAuthTag is not in base Decipheriv type
        (decipher as any).setAuthTag(actualAuthTag);
      }

      let decrypted = decipher.update(actualCiphertext, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // Authentication failures throw errors with specific messages
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('auth') || message.includes('tag')) {
        throw new SecurityError(
          'Authentication failed - data may have been tampered with',
          ErrorCode.SECURITY_DECRYPTION_FAILED,
          {
            action: 'decrypt_with_key',
            reason: 'authentication_failed',
            cause: error instanceof Error ? error : undefined,
          }
        );
      }

      throw new SecurityError(
        'Failed to decrypt data with key',
        ErrorCode.SECURITY_DECRYPTION_FAILED,
        {
          action: 'decrypt_with_key',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Verify the integrity of encrypted data
   *
   * Checks that all required fields are present and properly formatted.
   * For authenticated encryption, the authentication tag is verified during decryption.
   *
   * @param encryptedData - Encrypted data to verify
   * @returns true if data structure is valid
   *
   * @example
   * ```typescript
   * if (service.verifyIntegrity(encrypted)) {
   *   // Safe to decrypt
   * }
   * ```
   */
  public verifyIntegrity(encryptedData: EncryptedData): boolean {
    try {
      // Check required fields
      if (!encryptedData.ciphertext || !encryptedData.iv || !encryptedData.salt) {
        return false;
      }

      // Verify algorithm is supported
      if (!CIPHER_ALGORITHMS[encryptedData.algorithm]) {
        return false;
      }

      // Verify base64 encoding
      try {
        Buffer.from(encryptedData.ciphertext.split(':')[0], 'base64');
        Buffer.from(encryptedData.iv, 'base64');
        Buffer.from(encryptedData.salt, 'base64');
      } catch {
        return false;
      }

      // For authenticated encryption, verify auth tag is present
      if (
        (encryptedData.algorithm === 'AES-256-GCM' ||
          encryptedData.algorithm === 'CHACHA20-POLY1305') &&
        !encryptedData.authTag &&
        !encryptedData.ciphertext.includes(':')
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt a JSON object
   *
   * Serializes the object to JSON, encrypts it, and returns encrypted data.
   *
   * @param obj - Object to encrypt
   * @param password - Password for encryption
   * @returns Encrypted data
   *
   * @throws {SecurityError} If encryption fails
   *
   * @example
   * ```typescript
   * const user = { name: "Alice", email: "alice@example.com" };
   * const encrypted = await service.encryptObject(user, "password123");
   * ```
   */
  public async encryptObject<T>(obj: T, password: string): Promise<EncryptedData> {
    try {
      const json = JSON.stringify(obj);
      return await this.encrypt(json, password);
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError(
        'Failed to encrypt object',
        ErrorCode.SECURITY_ENCRYPTION_FAILED,
        {
          action: 'encrypt_object',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * Decrypt to a JSON object
   *
   * Decrypts the data and parses it as JSON.
   *
   * @param encryptedData - Encrypted data
   * @param password - Password for decryption
   * @returns Decrypted and parsed object
   *
   * @throws {SecurityError} If decryption or parsing fails
   *
   * @example
   * ```typescript
   * const decrypted = await service.decryptObject<User>(encrypted, "password123");
   * console.log(decrypted.name); // "Alice"
   * ```
   */
  public async decryptObject<T>(encryptedData: EncryptedData, password: string): Promise<T> {
    try {
      const json = await this.decrypt(encryptedData, password);
      return JSON.parse(json) as T;
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new SecurityError(
          'Failed to parse decrypted data as JSON',
          ErrorCode.SECURITY_DECRYPTION_FAILED,
          {
            action: 'decrypt_object',
            reason: 'invalid_json',
            cause: error,
          }
        );
      }
      throw new SecurityError(
        'Failed to decrypt object',
        ErrorCode.SECURITY_DECRYPTION_FAILED,
        {
          action: 'decrypt_object',
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Singleton encryption service instance
 *
 * Configured from appConfig.security.encryption settings.
 * Uses scrypt for key derivation (built into Node.js).
 *
 * @example
 * ```typescript
 * import { encryptionService } from './services/encryption.service';
 *
 * const encrypted = await encryptionService.encrypt("data", "password");
 * const decrypted = await encryptionService.decrypt(encrypted, "password");
 * ```
 */
export const encryptionService = new EncryptionService({
  algorithm: appConfig.security.encryption.algorithm as EncryptionAlgorithm,
  keyDerivation: 'scrypt', // Use scrypt for Node.js built-in support
  keyLength: 32, // 256 bits
  ivLength: 16, // 128 bits (standard for AES and ChaCha20)
  saltLength: 32, // 256 bits (recommended for scrypt)
});
