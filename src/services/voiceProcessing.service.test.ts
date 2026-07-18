import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mocks MUST be declared before importing the module under test.
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../config', () => ({
  appConfig: {
    whisper: {
      baseUrl: 'http://localhost:9000',
      model: 'base',
      defaultLanguage: 'en',
      maxAudioDurationSeconds: 300,
    },
  },
}));

vi.mock('../config/constants', () => ({
  VOICE_TRANSCRIPTION_HEALTH_CHECK_TIMEOUT_MS: 5000,
}));

vi.mock('fs', () => {
  const statSync = vi.fn(() => ({ size: 1024, mtimeMs: 1234 }));
  return {
    default: {
      existsSync: vi.fn(() => true),
      statSync,
      readFileSync: vi.fn(() => Buffer.from('fake-audio-bytes')),
    },
  };
});

import { VoiceProcessingService } from './voiceProcessing.service.js';

const AUDIO_PATH = '/tmp/note.ogg';

describe('VoiceProcessingService.transcribe timeout', () => {
  let service: VoiceProcessingService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new VoiceProcessingService({ cacheEnabled: false });
    // Avoid spawning ffprobe; provide fixed metadata under the max duration.
    vi.spyOn(service, 'getAudioMetadata').mockResolvedValue({
      duration: 10,
      sampleRate: 44100,
      channels: 1,
      bitrate: 128,
      format: 'ogg',
      size: 1024,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts and throws a clear error when the whisper request hangs', async () => {
    // fetch never resolves on its own; it only rejects when the signal aborts,
    // mirroring the real fetch/AbortController behavior.
    const fetchMock = vi.fn((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = service.transcribe(AUDIO_PATH);
    // Surface the rejection to the microtask queue so it is handled.
    const assertion = expect(promise).rejects.toThrow(/timed out after 180000ms/);

    // Advance past the transcription timeout to trigger the abort.
    await vi.advanceTimersByTimeAsync(180_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not abort a request that completes before the timeout', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'hello world', language: 'en', duration: 10 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = service.transcribe(AUDIO_PATH);
    // Flush the resolved fetch microtasks without reaching the timeout.
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.text).toBe('hello world');
  });
});
