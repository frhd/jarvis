const { mockPage, mockContext, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn(),
    evaluate: vi.fn(),
    close: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn(),
  };
  return { mockPage, mockContext, mockBrowser };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

vi.mock('../../utils/shutdown-registry.js', () => ({
  shutdownRegistry: {
    register: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { BrowserService } from './browser.service.js';
import { chromium } from 'playwright';

describe('BrowserService', () => {
  let service: BrowserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrowserService();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('lazy init', () => {
    it('should not launch browser until first fetchPageContent call', () => {
      expect(chromium.launch).not.toHaveBeenCalled();
    });

    it('should launch browser on first fetchPageContent call', async () => {
      mockPage.evaluate.mockResolvedValue('page content');
      await service.fetchPageContent('https://example.com');
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchPageContent', () => {
    it('should return trimmed text content and respect maxLength truncation', async () => {
      const longContent = 'a'.repeat(200);
      mockPage.evaluate.mockResolvedValue(longContent);

      const svc = new BrowserService({ contentMaxLength: 100 });
      const result = await svc.fetchPageContent('https://example.com');

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(100);
      expect(result.url).toBe('https://example.com');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      await svc.close();
    });

    it('should return error result when page load exceeds timeout', async () => {
      mockPage.goto.mockRejectedValue(new Error('Timeout exceeded'));

      const result = await service.fetchPageContent('https://slow.example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout exceeded');
      expect(result.content).toBeUndefined();
    });

    it('should return error result on navigation failure and not throw', async () => {
      mockPage.goto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

      const result = await service.fetchPageContent('https://nonexistent.example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ERR_NAME_NOT_RESOLVED');
    });
  });

  describe('fetchMultiplePages', () => {
    it('should fetch N URLs and return results array', async () => {
      mockPage.evaluate.mockResolvedValue('content');
      mockPage.goto.mockResolvedValue(undefined);

      const urls = ['https://a.com', 'https://b.com', 'https://c.com'];
      const results = await service.fetchMultiplePages(urls);

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.success).toBe(true);
      });
    });

    it('should return successful pages and error for failed pages', async () => {
      mockPage.goto.mockImplementation(async (url: string) => {
        if (url === 'https://fail.com') {
          throw new Error('Connection refused');
        }
      });
      mockPage.evaluate.mockResolvedValue('content');

      const results = await service.fetchMultiplePages([
        'https://ok.com',
        'https://fail.com',
        'https://ok2.com',
      ]);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(successes.length).toBe(2);
      expect(failures.length).toBe(1);
      expect(failures[0].url).toBe('https://fail.com');
    });
  });

  describe('rate limiting', () => {
    it('should enforce minimum interval between fetches', async () => {
      mockPage.evaluate.mockResolvedValue('content');
      mockPage.goto.mockResolvedValue(undefined);

      const start = Date.now();
      await service.fetchPageContent('https://a.com');
      await service.fetchPageContent('https://b.com');
      const elapsed = Date.now() - start;

      // Second fetch should have waited at least MIN_FETCH_INTERVAL_MS (1000ms)
      expect(elapsed).toBeGreaterThanOrEqual(900);
    });
  });

  describe('content stripping', () => {
    it('should call page.evaluate to strip unwanted elements', async () => {
      mockPage.evaluate.mockResolvedValue('clean text');
      mockPage.goto.mockResolvedValue(undefined);

      await service.fetchPageContent('https://example.com');

      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      const evaluateFn = mockPage.evaluate.mock.calls[0][0];
      expect(typeof evaluateFn).toBe('function');
    });
  });

  describe('close', () => {
    it('should close browser instance and allow re-initialization', async () => {
      mockPage.evaluate.mockResolvedValue('content');
      mockPage.goto.mockResolvedValue(undefined);

      await service.fetchPageContent('https://example.com');
      expect(chromium.launch).toHaveBeenCalledTimes(1);

      await service.close();
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);

      // Subsequent fetch should re-initialize
      await service.fetchPageContent('https://example.com');
      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });

    it('should be a no-op when no browser is initialized', async () => {
      await expect(service.close()).resolves.not.toThrow();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });
  });
});
