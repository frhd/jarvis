import { chromium, type Browser, type BrowserContext } from 'playwright';
import { shutdownRegistry } from '../../utils/shutdown-registry.js';
import { logger } from '../../utils/logger.js';

const BROWSER_SHUTDOWN_PRIORITY = 65;
const MIN_FETCH_INTERVAL_MS = 1_000;
const DEFAULT_CONTENT_MAX_LENGTH = 50_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_FETCHES = 3;

export interface BrowserServiceConfig {
  headless?: boolean;
  contentMaxLength?: number;
  fetchTimeoutMs?: number;
}

export interface PageFetchResult {
  url: string;
  success: boolean;
  content?: string;
  error?: string;
  durationMs: number;
}

export class BrowserService {
  private browser: Browser | null = null;
  private lastFetchTime = 0;
  private readonly config: Required<BrowserServiceConfig>;

  constructor(config: BrowserServiceConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      contentMaxLength: config.contentMaxLength ?? DEFAULT_CONTENT_MAX_LENGTH,
      fetchTimeoutMs: config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    };

    shutdownRegistry.register('browser', () => this.close(), BROWSER_SHUTDOWN_PRIORITY);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.config.headless });
      logger.info('Browser launched');
    }
    return this.browser;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastFetchTime;
    if (elapsed < MIN_FETCH_INTERVAL_MS) {
      const waitMs = MIN_FETCH_INTERVAL_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastFetchTime = Date.now();
  }

  async fetchPageContent(url: string): Promise<PageFetchResult> {
    const start = Date.now();
    let context: BrowserContext | null = null;

    try {
      const browser = await this.ensureBrowser();
      await this.enforceRateLimit();

      context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.fetchTimeoutMs);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.fetchTimeoutMs });

      const text = await page.evaluate(() => {
        const selectors = ['script', 'style', 'nav', 'footer', 'header', 'aside'];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
        return document.body?.innerText?.trim() ?? '';
      });

      const content = text.slice(0, this.config.contentMaxLength);

      return {
        url,
        success: true,
        content,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Browser fetch failed for ${url}: ${message}`);
      return {
        url,
        success: false,
        error: message,
        durationMs: Date.now() - start,
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }

  async fetchMultiplePages(urls: string[]): Promise<PageFetchResult[]> {
    const results: PageFetchResult[] = [];

    // Process in batches of MAX_CONCURRENT_FETCHES
    for (let i = 0; i < urls.length; i += MAX_CONCURRENT_FETCHES) {
      const batch = urls.slice(i, i + MAX_CONCURRENT_FETCHES);
      const batchResults = await Promise.all(
        batch.map((url) => this.fetchPageContent(url)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }
}
