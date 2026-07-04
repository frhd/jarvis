/**
 * Module Registry - Manages module lifecycle and platform registration.
 * Provides a central point for module management and platform routing.
 */

import { createLogger } from '../utils/logger.js';
import type { IModule, IModuleRegistry, ModuleContext } from '../interfaces/modules.js';
import type { IPlatform } from '../interfaces/platforms.js';

const logger = createLogger('ModuleRegistry');

/**
 * ModuleRegistry singleton implementation.
 * Manages module lifecycle and routes platforms to modules.
 */
export class ModuleRegistry implements IModuleRegistry {
  private static instance: ModuleRegistry | null = null;
  private modules: Map<string, IModule> = new Map();
  private platforms: Map<string, IPlatform> = new Map();
  private initialized = false;
  private started = false;

  private constructor() {}

  /**
   * Get the singleton instance of ModuleRegistry.
   */
  static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  /**
   * Reset the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    ModuleRegistry.instance = null;
  }

  /**
   * Register a module with the registry.
   */
  registerModule(module: IModule): void {
    if (this.modules.has(module.id)) {
      logger.warn(`Module ${module.id} already registered, skipping`);
      return;
    }

    this.modules.set(module.id, module);
    logger.info(`Module registered: ${module.name} (${module.id})`);

    // If platforms already registered, register them with this module
    if (this.platforms.size > 0) {
      for (const platform of this.platforms.values()) {
        try {
          module.registerPlatform(platform);
          logger.debug(`Registered platform ${platform.name} with late-joining module ${module.id}`);
        } catch (error) {
          logger.error(`Failed to register platform ${platform.name} with module ${module.id}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }
  }

  /**
   * Initialize all registered modules.
   */
  async initializeAll(context: ModuleContext): Promise<void> {
    if (this.initialized) {
      logger.warn('Modules already initialized');
      return;
    }

    logger.info(`Initializing ${this.modules.size} module(s)...`);

    for (const module of this.modules.values()) {
      try {
        await module.initialize(context);
        logger.debug(`Module initialized: ${module.id}`);
      } catch (error) {
        logger.error(`Failed to initialize module ${module.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    }

    this.initialized = true;
    logger.info('All modules initialized');
  }

  /**
   * Start all registered modules.
   */
  async startAll(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Modules must be initialized before starting');
    }

    if (this.started) {
      logger.warn('Modules already started');
      return;
    }

    logger.info(`Starting ${this.modules.size} module(s)...`);

    for (const module of this.modules.values()) {
      try {
        await module.start();
        logger.debug(`Module started: ${module.id}`);
      } catch (error) {
        logger.error(`Failed to start module ${module.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    }

    this.started = true;
    logger.info('All modules started');
  }

  /**
   * Stop all registered modules.
   */
  async stopAll(): Promise<void> {
    if (!this.started) {
      logger.debug('Modules not started, nothing to stop');
      return;
    }

    logger.info(`Stopping ${this.modules.size} module(s)...`);

    // Stop in reverse order of registration
    const moduleList = Array.from(this.modules.values()).reverse();

    for (const module of moduleList) {
      try {
        await module.stop();
        logger.debug(`Module stopped: ${module.id}`);
      } catch (error) {
        logger.error(`Failed to stop module ${module.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue stopping other modules
      }
    }

    this.started = false;
    logger.info('All modules stopped');
  }

  /**
   * Register a platform with all modules.
   */
  registerPlatformWithModules(platform: IPlatform): void {
    if (this.platforms.has(platform.name)) {
      logger.warn(`Platform ${platform.name} already registered`);
      return;
    }

    this.platforms.set(platform.name, platform);
    logger.info(`Platform registered: ${platform.name}`);

    // Notify all modules about the new platform
    for (const module of this.modules.values()) {
      try {
        module.registerPlatform(platform);
        logger.debug(`Platform ${platform.name} registered with module ${module.id}`);
      } catch (error) {
        logger.error(`Failed to register platform ${platform.name} with module ${module.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Unregister a platform from all modules.
   */
  unregisterPlatform(platformName: string): void {
    const platform = this.platforms.get(platformName);
    if (!platform) {
      logger.warn(`Platform ${platformName} not found`);
      return;
    }

    // Notify all modules that the platform is being removed
    for (const module of this.modules.values()) {
      try {
        module.unregisterPlatform(platformName);
        logger.debug(`Platform ${platformName} unregistered from module ${module.id}`);
      } catch (error) {
        logger.error(`Failed to unregister platform ${platformName} from module ${module.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.platforms.delete(platformName);
    logger.info(`Platform unregistered: ${platformName}`);
  }

  /**
   * Get a module by ID.
   */
  getModule(id: string): IModule | undefined {
    return this.modules.get(id);
  }

  /**
   * Get all registered modules.
   */
  getModules(): IModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get all registered platforms.
   */
  getPlatforms(): IPlatform[] {
    return Array.from(this.platforms.values());
  }

  /**
   * Get a platform by name.
   */
  getPlatform(name: string): IPlatform | undefined {
    return this.platforms.get(name);
  }

  /**
   * Check if modules have been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if modules have been started.
   */
  isStarted(): boolean {
    return this.started;
  }
}

// Export singleton getter for convenience
export const moduleRegistry = ModuleRegistry.getInstance();
