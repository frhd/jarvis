import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createLogger, getFileLoggingMetrics, resetFileLogging, type Logger } from '../logger.js';
import * as fs from 'fs';

// Disable file logging during tests to prevent polluting production logs
beforeAll(() => {
  vi.stubEnv('LOG_TO_FILE', 'false');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Mock the fs module
vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 0 })),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

describe('logger error handling', () => {
  let logger: Logger;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset file logging state before each test
    resetFileLogging();

    // Create logger with test context
    logger = createLogger('ErrorTest');

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // Setup default mock behavior
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 0 } as fs.Stats);
    vi.mocked(fs.appendFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();

    // Reset file logging state after each test
    resetFileLogging();
  });

  describe('log rotation error handling', () => {
    it('should log to stderr when rotation fails', () => {
      // Setup: Make log file exceed max size to trigger rotation
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      // Make renameSync fail
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      // Trigger log rotation by logging
      logger.info('Test message');

      // Verify stderr fallback
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] Log rotation error: EACCES: permission denied')
      );

      // Verify metrics were updated
      const metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(1);
      expect(metrics.lastRotationError).toBe('EACCES: permission denied');
      expect(metrics.fileLoggingDisabled).toBe(false);
    });

    it('should track rotation error count', () => {
      // Setup: Trigger multiple rotation errors
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });

      // First rotation error
      logger.info('Message 1');
      let metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(1);

      // Second rotation error
      logger.info('Message 2');
      metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(2);

      // Third rotation error
      logger.info('Message 3');
      metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(3);

      // Verify all error messages were logged to stderr
      expect(consoleErrorSpy).toHaveBeenCalledTimes(4); // 3 rotation errors + 1 disabled message
    });

    it('should disable file logging after MAX_ROTATION_ERRORS (3) failures', () => {
      // Setup: Trigger rotation errors
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Persistent rotation error');
      });

      // Trigger 3 rotation errors
      logger.info('Message 1');
      logger.info('Message 2');
      logger.info('Message 3');

      // Verify file logging is disabled
      const metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(true);
      expect(metrics.rotationErrorCount).toBe(3);

      // Verify disabled message was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] File logging disabled after 3 rotation failures')
      );
    });

    it('should reset rotation error count on successful rotation', () => {
      // Setup: First rotation fails
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementationOnce(() => {
        throw new Error('First rotation failed');
      });

      logger.info('Message 1');
      let metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(1);

      // Second rotation succeeds
      vi.mocked(fs.renameSync).mockImplementation(() => {});
      logger.info('Message 2');

      metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(0);
      expect(metrics.lastRotationError).toBe('First rotation failed');
    });

    it('should handle non-Error rotation failures', () => {
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw 'String error'; // eslint-disable-line no-throw-literal
      });

      logger.info('Test message');

      // Verify unknown error message
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] Log rotation error: Unknown rotation error')
      );

      const metrics = getFileLoggingMetrics();
      expect(metrics.lastRotationError).toBe('Unknown rotation error');
    });
  });

  describe('file write error handling', () => {
    it('should log to stderr when write fails', () => {
      // Make appendFileSync fail
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      logger.info('Test message');

      // Verify stderr fallback
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] File write error: ENOSPC: no space left on device')
      );

      // Verify metrics were updated
      const metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(1);
      expect(metrics.lastWriteError).toBe('ENOSPC: no space left on device');
      expect(metrics.fileLoggingDisabled).toBe(false);
    });

    it('should track write error count', () => {
      // Setup: Trigger multiple write errors
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // First write error
      logger.info('Message 1');
      let metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(1);

      // Second write error
      logger.info('Message 2');
      metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(2);

      // Third write error
      logger.info('Message 3');
      metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(3);
    });

    it('should disable file logging after MAX_WRITE_ERRORS (5) failures', () => {
      // Setup: Trigger write errors
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Persistent write error');
      });

      // Trigger 5 write errors
      logger.info('Message 1');
      logger.info('Message 2');
      logger.info('Message 3');
      logger.info('Message 4');
      logger.info('Message 5');

      // Verify file logging is disabled
      const metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(true);
      expect(metrics.writeErrorCount).toBe(5);

      // Verify disabled message was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] File logging disabled after 5 write failures')
      );
    });

    it('should reset write error count on successful write', () => {
      // Setup: First write fails
      vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
        throw new Error('First write failed');
      });

      logger.info('Message 1');
      let metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(1);

      // Second write succeeds
      vi.mocked(fs.appendFileSync).mockImplementation(() => {});
      logger.info('Message 2');

      metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(0);
      expect(metrics.lastWriteError).toBe('First write failed');
    });

    it('should handle non-Error write failures', () => {
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw 'String error'; // eslint-disable-line no-throw-literal
      });

      logger.info('Test message');

      // Verify unknown error message
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] File write error: Unknown write error')
      );

      const metrics = getFileLoggingMetrics();
      expect(metrics.lastWriteError).toBe('Unknown write error');
    });

    it('should handle write errors during error logging', () => {
      // Make writes fail
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Log an error (which tries to write to both log files)
      logger.error('Error message');

      // Both writes should fail, incrementing count twice
      const metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(2); // Once for main log, once for error log

      // Verify stderr fallback for both writes
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Logger] File write error: Write failed')
      );
    });
  });

  describe('circuit breaker behavior', () => {
    it('should stop attempting file writes after circuit opens', () => {
      // Setup: Trigger enough errors to disable file logging
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Trigger 5 write errors to open circuit
      logger.info('Message 1');
      logger.info('Message 2');
      logger.info('Message 3');
      logger.info('Message 4');
      logger.info('Message 5');

      // Clear mock call history
      vi.mocked(fs.appendFileSync).mockClear();

      // Additional logs should not attempt file writes
      logger.info('Message 6');
      logger.info('Message 7');

      // Verify no file writes were attempted
      expect(fs.appendFileSync).not.toHaveBeenCalled();

      // Console output should still work
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Message 6')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Message 7')
      );
    });

    it('should open circuit after rotation errors exceed threshold', () => {
      // Setup: Trigger rotation errors
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });

      // Trigger 3 rotation errors
      logger.info('Message 1');
      logger.info('Message 2');
      logger.info('Message 3');

      const metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(true);

      // Clear mock to verify no more calls
      vi.mocked(fs.appendFileSync).mockClear();
      vi.mocked(fs.renameSync).mockClear();

      // Further logs should not attempt file operations
      logger.info('Message 4');

      expect(fs.appendFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('should maintain separate error counts for rotation and write', () => {
      // Trigger 2 rotation errors
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });
      logger.info('Message 1');
      logger.info('Message 2');

      // Reset statSync to prevent rotation, trigger write error
      vi.mocked(fs.statSync).mockReturnValue({ size: 0 } as fs.Stats);
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });
      logger.info('Message 3');
      logger.info('Message 4');

      // Verify separate counts
      const metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(2);
      expect(metrics.writeErrorCount).toBe(2);
      expect(metrics.fileLoggingDisabled).toBe(false); // Not yet disabled
    });
  });

  describe('getFileLoggingMetrics', () => {
    it('should return current error metrics', () => {
      const metrics = getFileLoggingMetrics();

      expect(metrics).toHaveProperty('rotationErrorCount');
      expect(metrics).toHaveProperty('writeErrorCount');
      expect(metrics).toHaveProperty('fileLoggingDisabled');
      expect(metrics).toHaveProperty('lastRotationError');
      expect(metrics).toHaveProperty('lastWriteError');

      expect(typeof metrics.rotationErrorCount).toBe('number');
      expect(typeof metrics.writeErrorCount).toBe('number');
      expect(typeof metrics.fileLoggingDisabled).toBe('boolean');
    });

    it('should return zero counts initially', () => {
      const metrics = getFileLoggingMetrics();

      expect(metrics.rotationErrorCount).toBe(0);
      expect(metrics.writeErrorCount).toBe(0);
      expect(metrics.fileLoggingDisabled).toBe(false);
      expect(metrics.lastRotationError).toBeNull();
      expect(metrics.lastWriteError).toBeNull();
    });

    it('should reflect updated error counts after failures', () => {
      // Trigger a write error
      vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
        throw new Error('Test write error');
      });
      logger.info('Test');

      const metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(1);
      expect(metrics.lastWriteError).toBe('Test write error');
    });

    it('should reflect disabled state after threshold exceeded', () => {
      // Trigger enough errors to disable
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`);
      }

      const metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(true);
      expect(metrics.writeErrorCount).toBe(5);
    });

    it('should return a copy of the state (not reference)', () => {
      const metrics1 = getFileLoggingMetrics();
      const metrics2 = getFileLoggingMetrics();

      // Should be equal but not same reference
      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('resetFileLogging', () => {
    it('should reset all error counts to zero', () => {
      // Trigger some errors
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });
      logger.info('Message 1');
      logger.info('Message 2');

      let metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(2);

      // Reset
      resetFileLogging();

      metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(0);
      expect(metrics.writeErrorCount).toBe(0);
    });

    it('should clear error messages', () => {
      // Trigger errors
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });

      logger.info('Test');

      let metrics = getFileLoggingMetrics();
      expect(metrics.lastWriteError).not.toBeNull();
      expect(metrics.lastRotationError).not.toBeNull();

      // Reset
      resetFileLogging();

      metrics = getFileLoggingMetrics();
      expect(metrics.lastWriteError).toBeNull();
      expect(metrics.lastRotationError).toBeNull();
    });

    it('should re-enable file logging after circuit breaker tripped', () => {
      // Disable file logging
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`);
      }

      let metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(true);

      // Reset
      resetFileLogging();

      metrics = getFileLoggingMetrics();
      expect(metrics.fileLoggingDisabled).toBe(false);
    });

    it('should log reset action to console.info', () => {
      resetFileLogging();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Logger] File logging state reset'
      );
    });

    it('should allow successful writes after reset', () => {
      // Disable file logging
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`);
      }

      expect(getFileLoggingMetrics().fileLoggingDisabled).toBe(true);

      // Reset and fix the error
      resetFileLogging();
      vi.mocked(fs.appendFileSync).mockImplementation(() => {});

      // Clear previous calls
      vi.mocked(fs.appendFileSync).mockClear();

      // Should now write successfully
      logger.info('After reset');

      expect(fs.appendFileSync).toHaveBeenCalled();
      expect(getFileLoggingMetrics().writeErrorCount).toBe(0);
    });
  });

  describe('console output during errors', () => {
    it('should always log to console even when file writes fail', () => {
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      logger.info('Test message');

      // Verify console output still works
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
    });

    it('should log rotation errors to console.error with [Logger] prefix', () => {
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });

      logger.info('Test');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[Logger\] Log rotation error:/)
      );
    });

    it('should log write errors to console.error with [Logger] prefix', () => {
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      logger.info('Test');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[Logger\] File write error:/)
      );
    });

    it('should log disabled message to console.error', () => {
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`);
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[Logger\] File logging disabled after \d+ write failures$/)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle errors during both rotation and write in same log call', () => {
      // Setup: File is large enough to trigger rotation
      vi.mocked(fs.statSync).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
      // Both rotation and write fail
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rotation failed');
      });
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      logger.info('Test');

      const metrics = getFileLoggingMetrics();
      expect(metrics.rotationErrorCount).toBe(1);
      expect(metrics.writeErrorCount).toBe(1);
      expect(metrics.lastRotationError).toBe('Rotation failed');
      expect(metrics.lastWriteError).toBe('Write failed');
    });

    it('should handle rapid successive errors', () => {
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Rapidly log multiple messages
      for (let i = 0; i < 10; i++) {
        logger.info(`Rapid message ${i}`);
      }

      const metrics = getFileLoggingMetrics();
      // Should stop at 5 and disable
      expect(metrics.writeErrorCount).toBe(5);
      expect(metrics.fileLoggingDisabled).toBe(true);
    });

    it('should maintain state across multiple logger instances', () => {
      const logger1 = createLogger('Logger1');
      const logger2 = createLogger('Logger2');

      // Trigger error with logger1
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });
      logger1.info('From logger 1');

      // Error count should affect logger2 as well (module-level state)
      let metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(1);

      logger2.info('From logger 2');
      metrics = getFileLoggingMetrics();
      expect(metrics.writeErrorCount).toBe(2);
    });

    it('should handle LOG_TO_FILE=false environment without errors', () => {
      // When LOG_TO_FILE is false, file operations should be skipped
      // This is tested implicitly - the logger should not throw errors
      // even when file operations would fail

      // Note: This test verifies that the code structure doesn't break
      // when FILE_LOGGING_ENABLED is false (set at module load time)
      expect(() => {
        logger.info('Test message');
      }).not.toThrow();
    });
  });
});
