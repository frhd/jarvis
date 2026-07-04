/**
 * Reliability Hardening Service Orchestrator
 * Thin orchestration layer combining failover, self-healing, and health monitoring.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import type { HealthStatus, ComponentHealth } from '../health.service';
import { FailoverService } from './failover.service';
import { SelfHealingService } from './self-healing.service';
import { HealthMonitoringService } from './health-monitoring.service';

export * from './failover.service';
export * from './self-healing.service';
export * from './health-monitoring.service';
export { FailoverService, SelfHealingService, HealthMonitoringService };

import type { FailoverConfig, FallbackConfig, BackupServiceConfig, FailoverEvent, DegradationMode, ServiceTier } from './failover.service';
import type { SelfHealingServiceConfig, SelfHealingConfig, IntegrityCheckConfig, IntegrityCheckResult, SelfHealingEvent, ErrorRecoveryContext, ErrorRecoveryResult } from './self-healing.service';
import type { HealthMonitoringConfig, EnhancedHealthCheck, ChaosInjectionConfig, HealthCheckSeverity } from './health-monitoring.service';

const logger = createLogger('ReliabilityHardeningService');

export interface ReliabilityHardeningConfig {
  enabled: boolean;
  failover: Partial<FailoverConfig>;
  selfHealing: Partial<SelfHealingServiceConfig>;
  healthMonitoring: Partial<HealthMonitoringConfig>;
}

export interface ReliabilityHardeningStats {
  totalFailovers: number;
  successfulFailovers: number;
  totalRecoveries: number;
  successfulRecoveries: number;
  totalSelfHeals: number;
  successfulSelfHeals: number;
  integrityChecksRun: number;
  integrityChecksPassed: number;
  chaosExperimentsRun: number;
  currentDegradationMode: string;
  servicesHealthy: number;
  servicesDegraded: number;
  servicesUnhealthy: number;
  lastHealthCheck: number | null;
  uptimeMs: number;
}

export interface ReliabilityReport {
  timestamp: number;
  stats: ReliabilityHardeningStats;
  healthSummary: Record<string, EnhancedHealthCheck>;
  recentFailovers: FailoverEvent[];
  recentSelfHeals: SelfHealingEvent[];
  recentIntegrityChecks: IntegrityCheckResult[];
  recommendations: string[];
}

export class ReliabilityHardeningService extends EventEmitter {
  private readonly failover: FailoverService;
  private readonly selfHealing: SelfHealingService;
  private readonly healthMonitoring: HealthMonitoringService;
  private readonly startTime: number;

  constructor(config?: Partial<ReliabilityHardeningConfig>) {
    super();
    this.startTime = Date.now();
    this.failover = new FailoverService(config?.failover);
    this.selfHealing = new SelfHealingService(config?.selfHealing);
    this.healthMonitoring = new HealthMonitoringService(config?.healthMonitoring);
    this.selfHealing.setFailoverService(this.failover);
    this.setupEventForwarding();
    this.setupHealthDegradationLink();
    if (config?.enabled !== false) logger.info('[Reliability] Service initialized');
  }

  // Failover delegation
  registerFallback(service: string, fallback: Omit<FallbackConfig, 'id' | 'service'>): string { return this.failover.registerFallback(service, fallback); }
  async executeWithFallback<T>(service: string, fn: () => Promise<T>, args?: unknown): Promise<T> {
    return this.failover.executeWithFallback(service, fn, args, (s) => this.healthMonitoring.recordHealthSuccess(s), (s, e) => this.healthMonitoring.recordHealthFailure(s, e));
  }
  setDegradationMode(mode: DegradationMode, reason: string): void { this.failover.setDegradationMode(mode, reason); }
  getDegradationMode(): DegradationMode { return this.failover.getDegradationMode(); }
  isServiceAvailable(service: string): boolean { return this.failover.isServiceAvailable(service); }
  setServiceTier(service: string, tier: ServiceTier): void { this.failover.setServiceTier(service, tier); }
  registerBackupService(config: Omit<BackupServiceConfig, 'id'>): string { return this.failover.registerBackupService(config); }
  getActiveService(primaryService: string): string { return this.failover.getActiveService(primaryService); }
  async switchToBackup(primaryService: string, reason: string): Promise<boolean> { return this.failover.switchToBackup(primaryService, reason); }
  async switchToPrimary(primaryService: string, healthStatus?: HealthStatus): Promise<boolean> { return this.failover.switchToPrimary(primaryService, healthStatus); }
  async executeFailover(fromService: string, reason: string, toService?: string): Promise<FailoverEvent> { return this.failover.executeFailover(fromService, reason, toService); }

  // Self-healing delegation
  registerSelfHealing(config: SelfHealingConfig): void { this.selfHealing.registerSelfHealing(config); }
  async attemptSelfHealing(service: string, reason: string, previousState?: HealthStatus): Promise<SelfHealingEvent | null> { return this.selfHealing.attemptSelfHealing(service, reason, previousState); }
  registerIntegrityCheck(config: Omit<IntegrityCheckConfig, 'id'>): string { return this.selfHealing.registerIntegrityCheck(config); }
  async runIntegrityCheck(checkId: string): Promise<IntegrityCheckResult> { return this.selfHealing.runIntegrityCheck(checkId); }
  async runAllIntegrityChecks(): Promise<IntegrityCheckResult[]> { return this.selfHealing.runAllIntegrityChecks(); }
  async executeErrorRecovery(context: ErrorRecoveryContext): Promise<ErrorRecoveryResult> { return this.selfHealing.executeErrorRecovery(context); }

  // Health monitoring delegation
  registerHealthCheck(component: string, checkFn: () => Promise<ComponentHealth>, severity?: HealthCheckSeverity): void { this.healthMonitoring.registerHealthCheck(component, checkFn, severity); }
  async runHealthChecks(): Promise<EnhancedHealthCheck[]> { return this.healthMonitoring.runHealthChecks(); }
  startHealthMonitoring(): void { this.healthMonitoring.startHealthMonitoring(); }
  stopHealthMonitoring(): void { this.healthMonitoring.stopHealthMonitoring(); }
  getHealthState(component: string): EnhancedHealthCheck | undefined { return this.healthMonitoring.getHealthState(component); }
  getAllHealthStates(): EnhancedHealthCheck[] { return this.healthMonitoring.getAllHealthStates(); }
  enableChaos(config?: Partial<ChaosInjectionConfig>): void { this.healthMonitoring.enableChaos(config); }
  disableChaos(): void { this.healthMonitoring.disableChaos(); }
  shouldInjectChaos(service: string): boolean { return this.healthMonitoring.shouldInjectChaos(service); }
  async injectChaosFault(service: string): Promise<{ type: string; injected: boolean }> { return this.healthMonitoring.injectChaosFault(service); }
  async withChaosInjection<T>(service: string, fn: () => Promise<T>): Promise<T> { return this.healthMonitoring.withChaosInjection(service, fn); }

  // Statistics and reporting
  getStats(): ReliabilityHardeningStats {
    const f = this.failover.getStats(), s = this.selfHealing.getStats(), h = this.healthMonitoring.getStats();
    return {
      totalFailovers: f.totalFailovers, successfulFailovers: f.successfulFailovers,
      totalRecoveries: s.totalRecoveries, successfulRecoveries: s.successfulRecoveries,
      totalSelfHeals: s.totalSelfHeals, successfulSelfHeals: s.successfulSelfHeals,
      integrityChecksRun: s.integrityChecksRun, integrityChecksPassed: s.integrityChecksPassed,
      chaosExperimentsRun: h.chaosExperimentsRun, currentDegradationMode: f.currentDegradationMode,
      servicesHealthy: h.servicesHealthy, servicesDegraded: h.servicesDegraded, servicesUnhealthy: h.servicesUnhealthy,
      lastHealthCheck: h.lastHealthCheck, uptimeMs: Date.now() - this.startTime,
    };
  }

  generateReport(): ReliabilityReport {
    const healthSummary: Record<string, EnhancedHealthCheck> = {};
    for (const h of this.healthMonitoring.getAllHealthStates()) healthSummary[h.component] = h;
    return {
      timestamp: Date.now(), stats: this.getStats(), healthSummary,
      recentFailovers: this.failover.getFailoverHistory(10),
      recentSelfHeals: this.selfHealing.getSelfHealingHistory(10),
      recentIntegrityChecks: this.selfHealing.getIntegrityResults(10),
      recommendations: this.generateRecommendations(),
    };
  }

  private generateRecommendations(): string[] {
    const r: string[] = [], s = this.getStats();
    if (s.totalFailovers > 0 && s.successfulFailovers / s.totalFailovers < 0.9) r.push('Failover success rate is below 90%. Review backup service configurations.');
    if (s.totalSelfHeals > 0 && s.successfulSelfHeals / s.totalSelfHeals < 0.8) r.push('Self-healing success rate is below 80%. Consider adding more healing strategies.');
    if (s.integrityChecksRun > 0 && s.integrityChecksPassed / s.integrityChecksRun < 0.95) r.push('Data integrity check pass rate is below 95%. Investigate data consistency issues.');
    if (s.currentDegradationMode !== 'normal') r.push(`System is in ${s.currentDegradationMode} degradation mode. Monitor closely.`);
    if (s.servicesUnhealthy > 0) r.push(`${s.servicesUnhealthy} service(s) are unhealthy. Review health check failures.`);
    return r;
  }

  private setupEventForwarding(): void {
    const events = ['degradation-change', 'failover', 'healing-action', 'integrity-check', 'integrity-repair', 'integrity-failure', 'retry', 'shed-load', 'escalate', 'chaos-enabled', 'chaos-disabled', 'health-critical'];
    for (const e of events) {
      this.failover.on(e, (...args) => this.emit(e, ...args));
      this.selfHealing.on(e, (...args) => this.emit(e, ...args));
      this.healthMonitoring.on(e, (...args) => this.emit(e, ...args));
    }
  }

  private setupHealthDegradationLink(): void {
    this.healthMonitoring.on('health-critical', async ({ component, status }) => {
      await this.selfHealing.attemptSelfHealing(component, 'Consecutive health check failures', status);
      this.failover.updateDegradationFromHealthRatio(this.healthMonitoring.getHealthyRatio());
    });
  }

  async shutdown(): Promise<void> {
    logger.info('[Reliability] Shutting down...');
    await Promise.all([this.failover.shutdown(), this.selfHealing.shutdown(), this.healthMonitoring.shutdown()]);
    this.removeAllListeners();
    logger.info('[Reliability] Shutdown complete');
  }
}

export const reliabilityHardeningService = new ReliabilityHardeningService();
export default ReliabilityHardeningService;
