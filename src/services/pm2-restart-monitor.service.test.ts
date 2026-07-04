import { describe, it, expect } from 'vitest';
import { extractPm2Json } from './pm2-restart-monitor.service';

describe('extractPm2Json', () => {
  it('parses plain JSON output', () => {
    const out = '[{"name":"jarvis","restarts":3}]';
    expect(JSON.parse(extractPm2Json(out))).toEqual([{ name: 'jarvis', restarts: 3 }]);
  });

  it('strips PM2 ANSI-colored update warnings before the JSON array', () => {
    const out =
      '\n[31m[1m>>>> In-memory PM2 is out-of-date, do:[22m[39m\n' +
      '[31m[1m>>>> $ pm2 update[22m[39m\n' +
      '[{"name":"jarvis","pid":1234,"restarts":0}]';
    const parsed = JSON.parse(extractPm2Json(out));
    expect(parsed[0].name).toBe('jarvis');
  });

  it('throws when no JSON array is found', () => {
    expect(() => extractPm2Json('no json here')).toThrow(/No JSON array/);
  });
});
