import type { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client.js';
import type { LoopPatternRepository } from '../repositories/loopPattern.repository.js';
import type { Message } from '../types/index.js';

// --- Mocks must be declared BEFORE importing the module under test ---

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../config/index.js', () => ({
  appConfig: {
    llm: {
      extractionMaxTokens: 512,
    },
    loopDetection: {
      enabled: true,
    },
  },
}));

import {
  LoopPreventionService,
  LOOP_DETECTION_LLM_TIMEOUT_MS,
  LOOP_DETECTION_FAILURE_THRESHOLD,
  LOOP_DETECTION_BREAKER_COOLDOWN_MS,
} from './loopPrevention.service.js';
import { logger } from '../utils/logger.js';

/**
 * Build a conversation long enough to pass the minimum-length gate and with
 * distinct, similarly-sized user messages so heuristic frustration/pattern
 * checks stay quiet — forcing detectLoop() down to the LLM step.
 */
function makeMessages(): Message[] {
  const base = Date.now();
  const texts = [
    'can you tell me about the weather today',
    'sure, it is sunny with a light breeze right now',
    'what about the forecast for tomorrow morning',
    'tomorrow will be partly cloudy with mild temps',
    'thanks, and how about the weekend outlook please',
    'the weekend looks dry with a chance of sun both days',
  ];
  return texts.map((text, idx) => ({
    id: `msg-${idx}`,
    text,
    isBot: idx % 2 === 1,
    // Spread messages ~1 minute apart so no time-compression signal fires.
    createdAt: new Date(base + idx * 60_000),
  })) as unknown as Message[];
}

function makeRepository(): LoopPatternRepository {
  return {
    findPatternByHash: vi.fn().mockResolvedValue(null),
    createPattern: vi.fn().mockResolvedValue({ id: 'p1' }),
    findActivePatterns: vi.fn().mockResolvedValue([]),
    createDetection: vi.fn().mockResolvedValue({ id: 'd1' }),
    updateAverages: vi.fn().mockResolvedValue(undefined),
    updateDetectionResolution: vi.fn().mockResolvedValue(undefined),
    getOverallStats: vi.fn().mockResolvedValue({}),
  } as unknown as LoopPatternRepository;
}

function makeLLMClient(chat: LLMClient['chat']): LLMClient {
  return {
    chat,
    cancelRequest: vi.fn(),
  } as unknown as LLMClient;
}

const CHAT_ID = 'chat-1';

describe('LoopPreventionService LLM hardening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a short dedicated timeout and fails open when the LLM hangs', async () => {
    // chat() never resolves — only the internal timeout can end the call.
    const chat = vi.fn(() => new Promise<LLMResponse>(() => {})) as unknown as LLMClient['chat'];
    const llmClient = makeLLMClient(chat);
    const service = new LoopPreventionService(llmClient, makeRepository());

    const resultPromise = service.detectLoop(makeMessages(), CHAT_ID);

    // Advance past the dedicated timeout; this must abort the hung request.
    await vi.advanceTimersByTimeAsync(LOOP_DETECTION_LLM_TIMEOUT_MS);
    const result = await resultPromise;

    expect(chat).toHaveBeenCalledTimes(1);
    // Timeout aborts the underlying request via cancelRequest.
    expect(llmClient.cancelRequest).toHaveBeenCalledTimes(1);
    // Fail-open shape is exactly { detected: false, confidence: 0 }.
    expect(result).toEqual({ detected: false, confidence: 0 });
  });

  it('trips the breaker after N consecutive failures and then skips the LLM', async () => {
    const chat = vi
      .fn()
      .mockRejectedValue(new Error('LLM request timed out after 60000ms')) as unknown as LLMClient['chat'];
    const llmClient = makeLLMClient(chat);
    const service = new LoopPreventionService(llmClient, makeRepository());

    // Drive exactly N failing calls to trip the breaker.
    for (let i = 0; i < LOOP_DETECTION_FAILURE_THRESHOLD; i++) {
      const result = await service.detectLoop(makeMessages(), CHAT_ID);
      expect(result).toEqual({ detected: false, confidence: 0 });
    }
    expect(chat).toHaveBeenCalledTimes(LOOP_DETECTION_FAILURE_THRESHOLD);

    // Breaker is now open: subsequent calls must not touch the LLM.
    const skipped = await service.detectLoop(makeMessages(), CHAT_ID);
    expect(skipped).toEqual({ detected: false, confidence: 0 });
    expect(chat).toHaveBeenCalledTimes(LOOP_DETECTION_FAILURE_THRESHOLD);

    // The trip is logged exactly once at warn level.
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('circuit breaker tripped')
    );
    expect(warnCalls).toHaveLength(1);
  });

  it('closes the breaker and probes the LLM again after the cooldown', async () => {
    const chat = vi.fn() as unknown as LLMClient['chat'];
    const chatMock = chat as unknown as ReturnType<typeof vi.fn>;
    // First N calls fail (trip the breaker); the probe afterwards succeeds.
    for (let i = 0; i < LOOP_DETECTION_FAILURE_THRESHOLD; i++) {
      chatMock.mockRejectedValueOnce(new Error('boom'));
    }
    chatMock.mockResolvedValue({ content: '{"isLoop": false}', model: 'test' } as LLMResponse);

    const llmClient = makeLLMClient(chat);
    const service = new LoopPreventionService(llmClient, makeRepository());

    for (let i = 0; i < LOOP_DETECTION_FAILURE_THRESHOLD; i++) {
      await service.detectLoop(makeMessages(), CHAT_ID);
    }
    expect(chatMock).toHaveBeenCalledTimes(LOOP_DETECTION_FAILURE_THRESHOLD);

    // While still within cooldown, the LLM stays skipped.
    await service.detectLoop(makeMessages(), CHAT_ID);
    expect(chatMock).toHaveBeenCalledTimes(LOOP_DETECTION_FAILURE_THRESHOLD);

    // Advance past the cooldown; the next call probes the LLM again.
    await vi.advanceTimersByTimeAsync(LOOP_DETECTION_BREAKER_COOLDOWN_MS);
    const result = await service.detectLoop(makeMessages(), CHAT_ID);

    expect(chatMock).toHaveBeenCalledTimes(LOOP_DETECTION_FAILURE_THRESHOLD + 1);
    expect(result).toEqual({ detected: false, confidence: 0 });
  });

  it('preserves the fail-open result shape on LLM failure', async () => {
    const chat = vi
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as LLMClient['chat'];
    const service = new LoopPreventionService(makeLLMClient(chat), makeRepository());

    const result = await service.detectLoop(makeMessages(), CHAT_ID);

    // No extra keys leak into the fail-open result.
    expect(result).toEqual({ detected: false, confidence: 0 });
    expect(Object.keys(result).sort()).toEqual(['confidence', 'detected']);
  });
});
