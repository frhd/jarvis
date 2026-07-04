/**
 * Browser Services Factory
 *
 * Conditionally instantiates BrowserService based on configuration.
 * Browser is only created when BROWSER_ENABLED=true.
 */

import { BrowserService } from '../tools/browser.service.js';
import { appConfig } from '../../config/index.js';

export const browserService = appConfig.browser.enabled
  ? new BrowserService({
      headless: appConfig.browser.headless,
      contentMaxLength: appConfig.browser.contentMaxLength,
      fetchTimeoutMs: appConfig.browser.fetchTimeoutMs,
    })
  : null;
