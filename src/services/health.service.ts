// ============================================================================
// Health Service — Facade
//
// This file preserves the original public API of the health service while the
// implementation now lives in focused modules under `./health/`. All previous
// exports (types, the `HealthService` class, the singleton, and every
// `create*HealthCheck` factory) are re-exported here unchanged so importers
// require no modification.
// ============================================================================

// Types (Re-export from utils for backward compatibility)
export type { HealthStatus, ComponentHealth } from '../utils/index.js';
export type { SystemHealth, HealthCheckOptions, HealthCheckFn } from './health/types.js';

// Health Check Service class + singleton instance
import { healthService } from './health/health-monitor.service.js';
export { HealthService, healthService } from './health/health-monitor.service.js';

// Built-in Health Check Factories (external service / repository dependent)
export {
  createDatabaseHealthCheck,
  createQueueHealthCheck,
  createLLMHealthCheck,
  createWhisperHealthCheck,
  createClaudeHealthCheck,
  createTelegramHealthCheck,
  createDLQHealthCheck,
  createCircuitBreakersHealthCheck,
} from './health/service-checks.js';

// Built-in Health Check Factories (runtime / system resource dependent)
export {
  createOllamaWarmthHealthCheck,
  createStuckMessagesHealthCheck,
  createPM2RestartHealthCheck,
  createMessageLengthHealthCheck,
  createMemoryHealthCheck,
} from './health/resource-checks.js';

export default healthService;
