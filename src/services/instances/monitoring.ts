/**
 * Monitoring service instances (lazy-loaded)
 *
 * Use these getters to avoid circular dependencies and eager instantiation.
 * Services are loaded on first access and cached for subsequent calls.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import type { MetricsService } from '../metrics.service';
import type { MetricsExporterService } from '../metrics-exporter.service';
import type { AlertingService } from '../alerting.service';
import type { AnalyticsService } from '../analytics.service';
import type { HealthService } from '../health.service';
import type { ExperimentService } from '../experiment.service';
import type { PM2RestartMonitorService } from '../pm2-restart-monitor.service';

let _metricsService: MetricsService | null = null;
let _metricsExporterService: MetricsExporterService | null = null;
let _alertingService: AlertingService | null = null;
let _analyticsService: AnalyticsService | null = null;
let _healthService: HealthService | null = null;
let _experimentService: ExperimentService | null = null;
let _pm2RestartMonitorService: PM2RestartMonitorService | null = null;

export function getMetricsService(): MetricsService {
  if (!_metricsService) {

    const { metricsService } = require('../factory/index');
    _metricsService = metricsService;
  }
  return _metricsService!;
}

export function getMetricsExporterService(): MetricsExporterService {
  if (!_metricsExporterService) {

    const { metricsExporterService } = require('../factory/index');
    _metricsExporterService = metricsExporterService;
  }
  return _metricsExporterService!;
}

export function getAlertingService(): AlertingService {
  if (!_alertingService) {

    const { alertingService } = require('../factory/index');
    _alertingService = alertingService;
  }
  return _alertingService!;
}

export function getAnalyticsService(): AnalyticsService {
  if (!_analyticsService) {

    const { analyticsService } = require('../factory/index');
    _analyticsService = analyticsService;
  }
  return _analyticsService!;
}

export function getHealthService(): HealthService {
  if (!_healthService) {

    const { healthService } = require('../health.service');
    _healthService = healthService;
  }
  return _healthService!;
}

export function getExperimentService(): ExperimentService {
  if (!_experimentService) {

    const { experimentService } = require('../factory/index');
    _experimentService = experimentService;
  }
  return _experimentService!;
}

export function getPM2RestartMonitorService(): PM2RestartMonitorService {
  if (!_pm2RestartMonitorService) {

    const { pm2RestartMonitorService } = require('../factory/index');
    _pm2RestartMonitorService = pm2RestartMonitorService;
  }
  return _pm2RestartMonitorService!;
}

/**
 * Reset all monitoring service instances (for testing)
 */
export function resetMonitoringServices(): void {
  _metricsService = null;
  _metricsExporterService = null;
  _alertingService = null;
  _analyticsService = null;
  _healthService = null;
  _experimentService = null;
  _pm2RestartMonitorService = null;
}
