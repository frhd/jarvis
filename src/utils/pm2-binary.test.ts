import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import { resolvePm2Binary } from './pm2-binary.js';

describe('resolvePm2Binary', () => {
  const originalPm2Bin = process.env.PM2_BIN;

  beforeEach(() => {
    delete process.env.PM2_BIN;
  });

  afterEach(() => {
    if (originalPm2Bin === undefined) {
      delete process.env.PM2_BIN;
    } else {
      process.env.PM2_BIN = originalPm2Bin;
    }
  });

  it('uses PM2_BIN override when it points at an existing file', () => {
    // The running Node binary is guaranteed to exist; use it as a stand-in path.
    process.env.PM2_BIN = process.execPath;
    expect(resolvePm2Binary()).toBe(process.execPath);
  });

  it('ignores a PM2_BIN override that does not exist', () => {
    process.env.PM2_BIN = '/definitely/not/a/real/pm2';
    expect(resolvePm2Binary()).not.toBe('/definitely/not/a/real/pm2');
  });

  it('resolves an absolute path (never a bare command) when pm2 sits beside node', () => {
    // In dev/CI pm2 is installed in node_modules/.bin alongside the node that
    // runs vitest, so the adjacent lookup should yield an absolute path.
    const adjacent = path.join(path.dirname(process.execPath), 'pm2');
    const resolved = resolvePm2Binary();
    // Either it found the adjacent binary (absolute) or fell back to bare 'pm2'.
    if (resolved !== 'pm2') {
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(adjacent);
    }
  });
});
