import { MetricsService } from '../metrics.service.js';
import { MetricsExporterService } from '../metrics-exporter.service.js';
import { AlertingService } from '../alerting.service.js';
import { ExperimentService } from '../experiment.service.js';
import { AnalyticsService } from '../analytics.service.js';
import { UserBehaviorService } from '../userBehavior.service.js';
import { PM2RestartMonitorService } from '../pm2-restart-monitor.service.js';
import { pm2RestartMonitorService as pm2RestartMonitorServiceInstance } from '../pm2-restart-monitor.service.js';
import { SystemService } from '../system.service.js';
import { systemService } from '../system.service.js';
import {
  metricsRepository,
  experimentRepository,
  analyticsRepository,
  userBehaviorRepository,
  llmResponseRepository,
  intentLogRepository,
  semanticCacheRepository,
  queueRepository,
  type DeadLetterQueueRepository,
  type CircuitBreakerRepository,
} from '../../repositories/index.js';
import { appConfig } from '../../config/index.js';

// Metrics service for performance monitoring
export const metricsService = new MetricsService(metricsRepository, {
  enabled: appConfig.metrics.enabled,
  flushIntervalMs: appConfig.metrics.flushIntervalMs,
  retentionDays: appConfig.metrics.retentionDays,
});

// Metrics exporter service for Prometheus/JSON/CSV exports
export const metricsExporterService = new MetricsExporterService(
  llmResponseRepository,
  intentLogRepository,
  semanticCacheRepository,
  queueRepository
);

// Alerting service for anomaly detection
export const alertingService = new AlertingService(
  metricsRepository,
  metricsExporterService,
  {
    enabled: appConfig.alerting.enabled,
    defaultWindowMs: appConfig.alerting.defaultWindowMs,
    defaultCooldownMs: appConfig.alerting.defaultCooldownMs,
  }
);

// Experiment service for A/B testing
export const experimentService = new ExperimentService(experimentRepository);

// Analytics service for conversation flow analysis
export const analyticsService = new AnalyticsService(analyticsRepository);

// User behavior service for user engagement analytics
export const userBehaviorService = new UserBehaviorService(userBehaviorRepository);

// PM2 restart monitor for process stability
export { pm2RestartMonitorServiceInstance as pm2RestartMonitorService };

// System service for system information
export { systemService };

/**
 * Initializes monitoring services with their required dependencies and starts background jobs
 * @param deadLetterQueueRepository - Repository for dead letter queue metrics
 * @param circuitBreakerRepository - Repository for circuit breaker state metrics
 */
export function initializeMonitoringServices(
  deadLetterQueueRepository: DeadLetterQueueRepository,
  circuitBreakerRepository: CircuitBreakerRepository
): void {
  // Wire up optional repositories for queue health metrics
  metricsExporterService.setDLQRepository(deadLetterQueueRepository);
  metricsExporterService.setCircuitBreakerRepository(circuitBreakerRepository);

  // Start metrics aggregation job if enabled
  if (appConfig.metrics.enabled) {
    metricsService.startAggregationJob(appConfig.metrics.aggregationIntervalMs);
  }

  // Start alerting checks if enabled
  if (appConfig.alerting.enabled) {
    alertingService.startChecking(appConfig.alerting.checkIntervalMs);
  }

  // PM2 restart monitoring is started in src/index.ts via startPm2RestartMonitor()
  // This ensures proper configuration and prevents duplicate initialization
}
