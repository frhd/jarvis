/**
 * Module system interfaces for pluggable functionality.
 * Modules can register with platforms and respond to messages
 * independently of specific platform implementations.
 */

import type { IPlatform } from './platforms.js';

/**
 * Configuration passed to modules during initialization.
 */
export interface ModuleConfig {
  /** Module-specific configuration from config file */
  [key: string]: unknown;
}

/**
 * Context provided to modules during initialization.
 */
export interface ModuleContext {
  /** Module-specific configuration */
  config: ModuleConfig;
  /** Claude CLI path (if available) */
  claudeCliPath?: string;
  /** MCP config path (if available) */
  mcpConfigPath?: string;
  /** Logger instance for the module */
  logger: {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    debug(message: string, data?: Record<string, unknown>): void;
  };
}

/**
 * Module interface for pluggable functionality.
 * Modules can register with platforms and handle messages independently.
 */
export interface IModule {
  /** Unique module identifier */
  readonly id: string;

  /** Human-readable module name */
  readonly name: string;

  /**
   * Initialize the module with configuration.
   * Called once during application bootstrap.
   * @param context Initialization context with config and utilities
   */
  initialize(context: ModuleContext): Promise<void>;

  /**
   * Start the module.
   * Called after all modules are initialized.
   */
  start(): Promise<void>;

  /**
   * Stop the module.
   * Called during graceful shutdown.
   */
  stop(): Promise<void>;

  /**
   * Register a platform with this module.
   * Called when a platform becomes available.
   * Modules can register handlers with the platform here.
   * @param platform Platform to register with
   */
  registerPlatform(platform: IPlatform): void;

  /**
   * Unregister a platform from this module.
   * Called when a platform is stopped.
   * @param platformName Name of platform being unregistered
   */
  unregisterPlatform(platformName: string): void;
}

/**
 * Registry for managing modules.
 */
export interface IModuleRegistry {
  /**
   * Register a module with the registry.
   * @param module Module to register
   */
  registerModule(module: IModule): void;

  /**
   * Initialize all registered modules.
   * @param context Shared context for all modules
   */
  initializeAll(context: ModuleContext): Promise<void>;

  /**
   * Start all registered modules.
   */
  startAll(): Promise<void>;

  /**
   * Stop all registered modules.
   */
  stopAll(): Promise<void>;

  /**
   * Register a platform with all modules.
   * @param platform Platform to register
   */
  registerPlatformWithModules(platform: IPlatform): void;

  /**
   * Get a module by ID.
   * @param id Module ID
   * @returns Module instance or undefined
   */
  getModule(id: string): IModule | undefined;

  /**
   * Get all registered modules.
   * @returns Array of modules
   */
  getModules(): IModule[];
}
