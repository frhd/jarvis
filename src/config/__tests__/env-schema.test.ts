import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envSchema, validateEnv } from '../env-schema.js';

describe('envSchema Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should accept valid environment variables', () => {
    process.env.LLM_TIMEOUT_MS = '30000';
    process.env.LLM_TEMPERATURE = '0.7';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });

  it('should reject negative retry attempts', () => {
    process.env.RETRY_MAX_ATTEMPTS = '-1';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(e => e.path.join('.'));
      expect(paths).toContain('RETRY_MAX_ATTEMPTS');
    }
  });

  it('should reject retry attempts above max', () => {
    process.env.RETRY_MAX_ATTEMPTS = '100';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const retryError = result.error.issues.find(e => e.path.includes('RETRY_MAX_ATTEMPTS'));
      expect(retryError).toBeDefined();
    }
  });

  it('should reject temperature > 2', () => {
    process.env.LLM_TEMPERATURE = '10';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(e => e.path.join('.'));
      expect(paths).toContain('LLM_TEMPERATURE');
    }
  });

  it('should reject warning threshold >= critical threshold', () => {
    process.env.PERF_MEMORY_WARNING_THRESHOLD = '95';
    process.env.PERF_MEMORY_CRITICAL_THRESHOLD = '90';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const thresholdError = result.error.issues.find(e =>
        e.message.includes('must be less than')
      );
      expect(thresholdError).toBeDefined();
    }
  });

  it('should reject equal warning and critical thresholds', () => {
    process.env.PERF_MEMORY_WARNING_THRESHOLD = '90';
    process.env.PERF_MEMORY_CRITICAL_THRESHOLD = '90';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
  });

  it('should require JWT_SECRET when JWT auth enabled', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_SECRET = 'short';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const jwtError = result.error.issues.find(e =>
        e.message.includes('32 characters')
      );
      expect(jwtError).toBeDefined();
    }
  });

  it('should accept valid JWT_SECRET when auth enabled', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_SECRET = 'this-is-a-very-long-secret-key-that-is-at-least-32-chars';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });

  it('should not require JWT_SECRET when auth disabled', () => {
    process.env.AUTH_ENABLED = 'false';
    process.env.AUTH_MODE = 'jwt';
    // No JWT_SECRET set

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });

  it('should reject base delay >= max delay', () => {
    process.env.RETRY_BASE_DELAY_MS = '10000';
    process.env.RETRY_MAX_DELAY_MS = '5000';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const delayError = result.error.issues.find(e =>
        e.path.includes('RETRY_BASE_DELAY_MS')
      );
      expect(delayError).toBeDefined();
    }
  });

  it('should coerce string booleans correctly for enabled fields', () => {
    // Boolean fields are stored as strings in process.env
    process.env.LLM_ENABLED = 'true';
    process.env.CACHE_ENABLED = 'false';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
    // Note: These are parsed as optional strings, not coerced booleans
    // The actual boolean conversion happens in index.ts
  });

  it('should use defaults for missing optional values', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LLM_TIMEOUT_MS).toBe(60000);
      expect(result.data.RETRY_MAX_ATTEMPTS).toBe(5);
      expect(result.data.LLM_TEMPERATURE).toBe(0.3);
      expect(result.data.PERF_MEMORY_WARNING_THRESHOLD).toBe(95);
      expect(result.data.PERF_MEMORY_CRITICAL_THRESHOLD).toBe(98);
    }
  });

  it('should validate URL format for LLM_BASE_URL', () => {
    process.env.LLM_BASE_URL = 'not-a-url';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const urlError = result.error.issues.find(e =>
        e.path.includes('LLM_BASE_URL')
      );
      expect(urlError).toBeDefined();
    }
  });

  it('should accept valid URL for LLM_BASE_URL', () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });

  it('should reject invalid AUTH_MODE values', () => {
    process.env.AUTH_MODE = 'invalid-mode';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
  });

  it('should accept valid AUTH_MODE values', () => {
    for (const mode of ['jwt', 'api-key', 'both']) {
      process.env.AUTH_MODE = mode;
      const result = envSchema.safeParse(process.env);
      expect(result.success).toBe(true);
    }
  });

  it('should reject message target length > max length', () => {
    process.env.MESSAGE_TARGET_LENGTH = '5000';
    process.env.MESSAGE_MAX_LENGTH = '4000';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const lengthError = result.error.issues.find(e =>
        e.path.includes('MESSAGE_TARGET_LENGTH')
      );
      expect(lengthError).toBeDefined();
    }
  });

  it('should validate Telegram reconnect delays ordering', () => {
    process.env.TELEGRAM_RECONNECT_BASE_DELAY_MS = '30000';
    process.env.TELEGRAM_RECONNECT_MAX_DELAY_MS = '10000';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const telegramError = result.error.issues.find(e =>
        e.path.includes('TELEGRAM_RECONNECT_BASE_DELAY_MS')
      );
      expect(telegramError).toBeDefined();
    }
  });
});

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw descriptive error on failure', () => {
    process.env.LLM_TEMPERATURE = '100';

    expect(() => validateEnv()).toThrow('Environment variable validation failed');
  });

  it('should return validated config on success', () => {
    // Use all defaults
    const result = validateEnv();
    expect(result).toBeDefined();
    expect(result.RETRY_MAX_ATTEMPTS).toBe(5);
    expect(result.LLM_TIMEOUT_MS).toBe(60000);
  });
});

describe('Production requirements', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure Telegram is enabled for production requirement tests
    delete process.env.TELEGRAM_ENABLED;
    // Clear API credentials that are in .env for production tests
    delete process.env.API_ID;
    delete process.env.API_HASH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should require API_ID in production', () => {
    process.env.NODE_ENV = 'production';
    // Ensure Telegram is enabled for this test
    delete process.env.TELEGRAM_ENABLED;
    // No API_ID set

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const apiError = result.error.issues.find(e =>
        e.message.includes('API_ID') || e.path.includes('API_ID')
      );
      expect(apiError).toBeDefined();
    }
  });

  it('should require API_HASH in production', () => {
    process.env.NODE_ENV = 'production';
    // Ensure Telegram is enabled for this test
    delete process.env.TELEGRAM_ENABLED;
    process.env.API_ID = '12345';
    // No API_HASH set

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const apiError = result.error.issues.find(e =>
        e.message.includes('API_HASH') || e.path.includes('API_HASH')
      );
      expect(apiError).toBeDefined();
    }
  });

  it('should accept valid production config', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_ID = '12345';
    process.env.API_HASH = 'abc123def456';

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });

  it('should not require Telegram credentials in development', () => {
    process.env.NODE_ENV = 'development';
    // No API_ID or API_HASH

    const result = envSchema.safeParse(process.env);
    expect(result.success).toBe(true);
  });
});
