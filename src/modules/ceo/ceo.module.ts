/**
 * CEO Module
 * Implements IModule for the CEO functionality.
 * Manages CEO handlers and workers, registers with platforms.
 */

import { createLogger } from '../../utils/logger.js';
import type { IModule, ModuleContext } from '../../interfaces/modules.js';
import type { IPlatform } from '../../interfaces/platforms.js';
import { CeoResponseService } from './ceo-response.service.js';
import { CeoScheduledService } from './ceo-scheduled.service.js';
import { CeoMonitorService } from './ceo-monitor.service.js';
import { CeoHandler } from './handlers/ceo.handler.js';
import { CeoScheduledWorker } from './workers/ceo-scheduled.worker.js';
import { CeoMonitorWorker } from './workers/ceo-monitor.worker.js';
import type { CeoModuleConfig } from './ceo-config.js';

const logger = createLogger('CeoModule');

/**
 * CEO Module - Provides CEO persona functionality.
 * Handles responses to messages and posts scheduled content.
 */
export class CeoModule implements IModule {
  readonly id = 'ceo';
  readonly name = 'CEO Module';

  private config: CeoModuleConfig | null = null;
  private context: ModuleContext | null = null;
  private platforms: Map<string, IPlatform> = new Map();

  // Services
  private ceoResponseService: CeoResponseService | null = null;
  private ceoScheduledService: CeoScheduledService | null = null;
  private ceoMonitorService: CeoMonitorService | null = null;

  // Handlers
  private ceoHandler: CeoHandler | null = null;

  // Workers
  private ceoScheduledWorker: CeoScheduledWorker | null = null;
  private ceoMonitorWorker: CeoMonitorWorker | null = null;

  /**
   * Initialize the CEO module with configuration.
   */
  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    this.config = context.config as unknown as CeoModuleConfig;

    if (!this.config?.enabled) {
      logger.info('CEO module is disabled');
      return;
    }

    const claudeCliPath = context.claudeCliPath || this.config.claudeCliPath || 'claude';
    const mcpConfigPath = context.mcpConfigPath || this.config.mcpConfigPath || '';

    if (!mcpConfigPath) {
      logger.warn('CEO module enabled but no MCP config path provided');
    }

    // Initialize services
    this.ceoResponseService = new CeoResponseService({
      claudeCliPath,
      mcpConfigPath,
      timeoutMs: this.config?.responseTimeoutMs,
    });

    this.ceoScheduledService = new CeoScheduledService();

    this.ceoMonitorService = new CeoMonitorService({
      claudeCliPath,
      mcpConfigPath,
    });

    // Initialize handler
    this.ceoHandler = new CeoHandler(this.ceoResponseService);

    // Initialize workers
    if (this.config.scheduledEnabled) {
      this.ceoScheduledWorker = new CeoScheduledWorker(this.ceoScheduledService);
    }

    if (this.config.monitorEnabled) {
      this.ceoMonitorWorker = new CeoMonitorWorker(this.ceoMonitorService);
    }

    logger.info('CEO module initialized', {
      scheduledEnabled: this.config.scheduledEnabled,
      monitorEnabled: this.config.monitorEnabled,
    });

    // Set up any platforms that were registered before initialization
    if (this.config.enabled) {
      for (const platform of this.platforms.values()) {
        this.setupPlatformHandlers(platform);
        logger.info(`Platform ${platform.name} configured with CEO module (deferred)`);
      }
    }
  }

  /**
   * Start the CEO module.
   */
  async start(): Promise<void> {
    if (!this.config?.enabled) {
      logger.debug('CEO module not enabled, skipping start');
      return;
    }

    // Start workers (they need platforms to be set first)
    if (this.ceoScheduledWorker) {
      this.ceoScheduledWorker.start();
    }

    if (this.ceoMonitorWorker) {
      this.ceoMonitorWorker.start();
    }

    logger.info('CEO module started');
  }

  /**
   * Stop the CEO module.
   */
  async stop(): Promise<void> {
    // Stop workers
    if (this.ceoScheduledWorker) {
      this.ceoScheduledWorker.stop();
    }

    if (this.ceoMonitorWorker) {
      this.ceoMonitorWorker.stop();
    }

    // Unregister handlers from all platforms
    for (const platform of this.platforms.values()) {
      try {
        platform.unregisterHandler('message', this.ceoHandler?.id || 'ceo-handler');
        platform.unregisterHandler('mention', this.ceoHandler?.id || 'ceo-handler');
      } catch (error) {
        logger.debug(`Error unregistering handlers from ${platform.name}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('CEO module stopped');
  }

  /**
   * Register a platform with the CEO module.
   * This can be called before initialize() - the platform will be stored
   * and workers will be updated after initialization.
   */
  registerPlatform(platform: IPlatform): void {
    if (this.platforms.has(platform.name)) {
      logger.debug(`Platform ${platform.name} already registered with CEO module`);
      return;
    }

    // Store the platform regardless of enabled state - we need it available
    // for when initialize() is called (order of operations is not guaranteed)
    this.platforms.set(platform.name, platform);

    // If not yet initialized, defer handler/worker setup until after init
    if (!this.config) {
      logger.debug(`Platform ${platform.name} registered with CEO module (pending initialization)`);
      return;
    }

    if (!this.config.enabled) {
      logger.debug(`CEO module disabled, not setting up handlers for ${platform.name}`);
      return;
    }

    this.setupPlatformHandlers(platform);
    logger.info(`Platform ${platform.name} registered with CEO module`);
  }

  /**
   * Set up handlers and workers for a platform.
   * Called after initialization when config is available.
   */
  private setupPlatformHandlers(platform: IPlatform): void {
    // Register handler with the platform
    if (this.ceoHandler) {
      this.ceoHandler.setPlatform(platform);
      platform.registerHandler('message', this.ceoHandler);
      platform.registerHandler('mention', this.ceoHandler);
    }

    // Set platform for workers
    if (this.ceoScheduledWorker) {
      this.ceoScheduledWorker.setPlatform(platform);
    }

    if (this.ceoMonitorWorker) {
      this.ceoMonitorWorker.setPlatform(platform);
    }
  }

  /**
   * Unregister a platform from the CEO module.
   */
  unregisterPlatform(platformName: string): void {
    const platform = this.platforms.get(platformName);
    if (!platform) {
      return;
    }

    // Unregister handlers
    if (this.ceoHandler) {
      try {
        platform.unregisterHandler('message', this.ceoHandler.id);
        platform.unregisterHandler('mention', this.ceoHandler.id);
      } catch (error) {
        logger.debug(`Error unregistering handlers from ${platformName}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Clear platform from workers
    if (this.ceoScheduledWorker) {
      this.ceoScheduledWorker.setPlatform(null as unknown as IPlatform);
    }

    if (this.ceoMonitorWorker) {
      this.ceoMonitorWorker.setPlatform(null as unknown as IPlatform);
    }

    this.platforms.delete(platformName);
    logger.info(`Platform ${platformName} unregistered from CEO module`);
  }
}
