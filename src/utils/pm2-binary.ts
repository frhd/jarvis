import { existsSync } from 'fs';
import path from 'path';

/**
 * Resolves the absolute path to the `pm2` binary.
 *
 * The app shells out to `pm2 jlist` for restart monitoring and health checks.
 * Relying on `pm2` being on PATH is fragile: if the process is (re)started with
 * an environment whose PATH lacks the nvm bin dir that holds pm2 (e.g. a
 * `pm2 restart --update-env` from a shell without it), `spawn('pm2')` fails with
 * ENOENT. Because pm2 is installed alongside the Node interpreter that launched
 * this process, we resolve it relative to `process.execPath`.
 *
 * Resolution order:
 *   1. `PM2_BIN` env override (if it points at an existing file)
 *   2. `pm2` next to the current Node binary (`dirname(process.execPath)`)
 *   3. bare `pm2` (PATH lookup) as a last resort
 */
export function resolvePm2Binary(): string {
  const override = process.env.PM2_BIN;
  if (override && existsSync(override)) {
    return override;
  }

  const adjacent = path.join(path.dirname(process.execPath), 'pm2');
  if (existsSync(adjacent)) {
    return adjacent;
  }

  return 'pm2';
}
