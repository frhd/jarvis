import type { HealthStatus, ComponentHealth } from '../../utils/index.js';

// ============================================================================
// Types (Re-export from utils for backward compatibility)
// ============================================================================

export type { HealthStatus, ComponentHealth } from '../../utils/index.js';

export interface SystemHealth {
  status: HealthStatus;
  components: ComponentHealth[];
  timestamp: Date;
}

export interface HealthCheckOptions {
  /** Interval in ms for periodic health checks */
  interval?: number;
  /** Timeout in ms for health check execution */
  timeout?: number;
  /** If true, this component being unhealthy makes system unhealthy */
  critical?: boolean;
}

export type HealthCheckFn = () => Promise<ComponentHealth>;

export interface RegisteredCheck {
  name: string;
  checkFn: HealthCheckFn;
  options: Required<HealthCheckOptions>;
}
