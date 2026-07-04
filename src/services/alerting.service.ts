import { MetricsRepository } from '../repositories/metrics.repository';
import { MetricsExporterService } from './metrics-exporter.service';
import { AlertSeverity, MetricAlert, AlertEvent } from '../types/metrics.types';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import {
  FIVE_MINUTES_MS,
  TEN_MINUTES_MS,
  FIFTEEN_MINUTES_MS,
  TWENTY_MINUTES_MS,
  THIRTY_MINUTES_MS,
  MS_PER_HOUR,
  TEN_SECONDS_MS,
  THIRTY_SECONDS_MS,
  EIGHT_SECONDS_MS,
  THREE_SECONDS_MS,
} from '../config/constants';

// =============================================================================
// Alert Thresholds (in milliseconds)
// =============================================================================

/** High LLM response time threshold - 10 seconds */
export const HIGH_LLM_RESPONSE_TIME_THRESHOLD_MS = TEN_SECONDS_MS;

/** Critical LLM response time threshold - 30 seconds */
export const CRITICAL_LLM_RESPONSE_TIME_THRESHOLD_MS = THIRTY_SECONDS_MS;

/** Low cache hit rate threshold - 20% */
export const LOW_CACHE_HIT_RATE_THRESHOLD = 20;

/** High queue depth threshold */
export const HIGH_QUEUE_DEPTH_THRESHOLD = 100;

/** Critical queue depth threshold */
export const CRITICAL_QUEUE_DEPTH_THRESHOLD = 500;

/** Low intent confidence threshold - 30% */
export const LOW_INTENT_CONFIDENCE_THRESHOLD = 0.3;

/** High escalation rate threshold */
export const HIGH_ESCALATION_RATE_THRESHOLD = 10;

/** Stuck messages warning threshold */
export const STUCK_MESSAGES_WARNING_THRESHOLD = 5;

/** Stuck messages critical threshold */
export const STUCK_MESSAGES_CRITICAL_THRESHOLD = 10;

/** Stuck message age critical threshold - 2 hours */
export const STUCK_MESSAGE_CRITICAL_AGE_MINUTES = 120;

/** Stuck messages growing threshold */
export const STUCK_MESSAGES_GROWING_THRESHOLD = 3;

/** High message summarization rate threshold */
export const HIGH_SUMMARIZATION_RATE_THRESHOLD = 10;

/** Any truncation threshold */
export const TRUNCATION_THRESHOLD = 1;

/** High message truncation rate threshold */
export const HIGH_TRUNCATION_RATE_THRESHOLD = 5;

/** High LLM response time threshold (deprecated, use HIGH_LLM_RESPONSE_TIME_THRESHOLD_MS) */
export const HIGH_LLM_RESPONSE_THRESHOLD_MS = 10_000;

/** Slow summarization threshold - 8 seconds */
export const SLOW_SUMMARIZATION_THRESHOLD_MS = EIGHT_SECONDS_MS;

/** Slow intent classification threshold - 3 seconds */
export const SLOW_INTENT_CLASSIFICATION_THRESHOLD_MS = THREE_SECONDS_MS;

/** Telegram reconnection storm threshold */
export const TELEGRAM_RECONNECTION_STORM_THRESHOLD = 5;

/** Error rate threshold */
export const HIGH_ERROR_RATE_THRESHOLD = 5;

/**
 * Alert rule configuration
 */
export interface AlertRule {
  id: string;
  name: string;
  metricName: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  severity: AlertSeverity;
  enabled: boolean;
  windowMs?: number; // Time window for aggregation (default: 5 minutes)
  cooldownMs?: number; // Minimum time between alerts (default: 15 minutes)
  tags?: Record<string, string>;
}

/**
 * Alert callback function type
 */
export type AlertCallback = (event: AlertEvent) => void | Promise<void>;

/**
 * Default alert rules for common scenarios
 */
export const DEFAULT_ALERT_RULES: Omit<AlertRule, 'id'>[] = [
  // Response time alerts
  {
    name: 'High LLM Response Time',
    metricName: 'llm_response_time_ms',
    threshold: HIGH_LLM_RESPONSE_TIME_THRESHOLD_MS,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
    windowMs: FIVE_MINUTES_MS,
  },
  {
    name: 'Critical LLM Response Time',
    metricName: 'llm_response_time_ms',
    threshold: CRITICAL_LLM_RESPONSE_TIME_THRESHOLD_MS,
    operator: 'gt',
    severity: 'critical',
    enabled: true,
    windowMs: FIVE_MINUTES_MS,
  },
  // Error rate alerts
  {
    name: 'High Error Rate',
    metricName: 'llm_request_error',
    threshold: HIGH_ERROR_RATE_THRESHOLD,
    operator: 'gt',
    severity: 'error',
    enabled: true,
    windowMs: FIVE_MINUTES_MS,
  },
  // Cache performance alerts
  {
    name: 'Low Cache Hit Rate',
    metricName: 'cache_hit_rate',
    threshold: LOW_CACHE_HIT_RATE_THRESHOLD,
    operator: 'lt',
    severity: 'warning',
    enabled: true,
    windowMs: FIFTEEN_MINUTES_MS,
  },
  // Queue depth alerts
  {
    name: 'High Queue Depth',
    metricName: 'queue_depth',
    threshold: HIGH_QUEUE_DEPTH_THRESHOLD,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
  },
  {
    name: 'Critical Queue Depth',
    metricName: 'queue_depth',
    threshold: CRITICAL_QUEUE_DEPTH_THRESHOLD,
    operator: 'gt',
    severity: 'critical',
    enabled: true,
  },
  // Intent classification alerts
  {
    name: 'Low Intent Confidence',
    metricName: 'intent_confidence',
    threshold: LOW_INTENT_CONFIDENCE_THRESHOLD,
    operator: 'lt',
    severity: 'info',
    enabled: true,
    windowMs: TEN_MINUTES_MS,
  },
  {
    name: 'High Escalation Rate',
    metricName: 'intent_escalation',
    threshold: HIGH_ESCALATION_RATE_THRESHOLD,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
    windowMs: FIFTEEN_MINUTES_MS,
  },
  // Stuck message alerts
  {
    name: 'Stuck Messages Warning',
    metricName: 'queue_stuck_messages',
    threshold: STUCK_MESSAGES_WARNING_THRESHOLD,
    operator: 'gte',
    severity: 'warning',
    enabled: true,
    windowMs: TEN_MINUTES_MS,
    cooldownMs: FIFTEEN_MINUTES_MS,
  },
  {
    name: 'Stuck Messages Critical',
    metricName: 'queue_stuck_messages',
    threshold: STUCK_MESSAGES_CRITICAL_THRESHOLD,
    operator: 'gte',
    severity: 'critical',
    enabled: true,
    windowMs: TEN_MINUTES_MS,
    cooldownMs: TEN_MINUTES_MS,
  },
  {
    name: 'Stuck Message Age Critical',
    metricName: 'queue_stuck_oldest_age_minutes',
    threshold: STUCK_MESSAGE_CRITICAL_AGE_MINUTES,
    operator: 'gte',
    severity: 'critical',
    enabled: true,
    windowMs: FIVE_MINUTES_MS,
    cooldownMs: THIRTY_MINUTES_MS,
  },
  {
    name: 'Stuck Messages Growing',
    metricName: 'queue_stuck_messages',
    threshold: STUCK_MESSAGES_GROWING_THRESHOLD,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
    windowMs: THIRTY_MINUTES_MS,
    cooldownMs: MS_PER_HOUR,
  },
  // Message length alerts
  {
    name: 'High Message Summarization Rate',
    metricName: 'message_summarization_count',
    threshold: HIGH_SUMMARIZATION_RATE_THRESHOLD,
    operator: 'gte',
    severity: 'warning',
    enabled: true,
    windowMs: MS_PER_HOUR,
    cooldownMs: THIRTY_MINUTES_MS,
  },
  {
    name: 'Message Truncation Occurring',
    metricName: 'message_truncation_count',
    threshold: TRUNCATION_THRESHOLD,
    operator: 'gte',
    severity: 'warning',
    enabled: true,
    windowMs: MS_PER_HOUR,
    cooldownMs: MS_PER_HOUR,
  },
  {
    name: 'High Message Truncation Rate',
    metricName: 'message_truncation_count',
    threshold: HIGH_TRUNCATION_RATE_THRESHOLD,
    operator: 'gte',
    severity: 'error',
    enabled: true,
    windowMs: MS_PER_HOUR,
    cooldownMs: THIRTY_MINUTES_MS,
  },
  {
    name: 'Slow Message Summarization',
    metricName: 'message_summarization_duration_ms',
    threshold: SLOW_SUMMARIZATION_THRESHOLD_MS,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
    windowMs: FIFTEEN_MINUTES_MS,
    cooldownMs: THIRTY_MINUTES_MS,
  },
  // Stability alerts (Phase 4)
  {
    name: 'Ollama Model Cold Start',
    metricName: 'ollama_model_load_count',
    threshold: 1, // Any model load after warmup indicates cold start
    operator: 'gte',
    severity: 'warning',
    enabled: true,
    windowMs: THIRTY_MINUTES_MS,
    cooldownMs: THIRTY_MINUTES_MS,
  },
  {
    name: 'Intent Classification Slow',
    metricName: 'intent_classification_time_ms',
    threshold: SLOW_INTENT_CLASSIFICATION_THRESHOLD_MS,
    operator: 'gt',
    severity: 'warning',
    enabled: true,
    windowMs: TEN_MINUTES_MS,
    cooldownMs: TWENTY_MINUTES_MS,
  },
  {
    name: 'Telegram Reconnect Storm',
    metricName: 'telegram_reconnection_count',
    threshold: TELEGRAM_RECONNECTION_STORM_THRESHOLD,
    operator: 'gt',
    severity: 'error',
    enabled: true,
    windowMs: MS_PER_HOUR,
    cooldownMs: MS_PER_HOUR,
  },
];

/**
 * AlertingService - Monitor metrics and trigger alerts for anomalies
 *
 * Features:
 * - Configurable alert rules with thresholds
 * - Multiple severity levels (info, warning, error, critical)
 * - Cooldown periods to prevent alert storms
 * - Callback-based alert notifications
 * - Integration with metrics repository
 */
export class AlertingService {
  private rules: Map<string, AlertRule> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();
  private activeAlerts: Map<string, AlertEvent> = new Map();
  private callbacks: AlertCallback[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly defaultWindowMs: number;
  private readonly defaultCooldownMs: number;
  private readonly enabled: boolean;

  constructor(
    private metricsRepo: MetricsRepository,
    private metricsExporter: MetricsExporterService,
    config?: {
      enabled?: boolean;
      defaultWindowMs?: number;
      defaultCooldownMs?: number;
      rules?: Omit<AlertRule, 'id'>[];
    }
  ) {
    this.enabled = config?.enabled ?? true;
    this.defaultWindowMs = config?.defaultWindowMs ?? FIVE_MINUTES_MS;
    this.defaultCooldownMs = config?.defaultCooldownMs ?? FIFTEEN_MINUTES_MS;

    // Register default rules
    const rules = config?.rules ?? DEFAULT_ALERT_RULES;
    for (const rule of rules) {
      this.addRule(rule);
    }

    if (this.enabled) {
      logger.info('[Alerting] Service initialized', {
        rulesCount: this.rules.size,
        defaultWindowMs: this.defaultWindowMs,
        defaultCooldownMs: this.defaultCooldownMs,
      });
    } else {
      logger.info('[Alerting] Service disabled via configuration');
    }
  }

  /**
   * Add an alert rule
   */
  addRule(rule: Omit<AlertRule, 'id'>): string {
    const id = nanoid();
    const fullRule: AlertRule = {
      ...rule,
      id,
      windowMs: rule.windowMs ?? this.defaultWindowMs,
      cooldownMs: rule.cooldownMs ?? this.defaultCooldownMs,
    };

    this.rules.set(id, fullRule);
    logger.debug('[Alerting] Rule added', { id, name: rule.name });

    return id;
  }

  /**
   * Remove an alert rule
   */
  removeRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) {
      this.lastAlertTimes.delete(id);
      this.activeAlerts.delete(id);
      logger.debug('[Alerting] Rule removed', { id });
    }
    return deleted;
  }

  /**
   * Enable or disable a rule
   */
  setRuleEnabled(id: string, enabled: boolean): boolean {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = enabled;
      logger.debug('[Alerting] Rule updated', { id, enabled });
      return true;
    }
    return false;
  }

  /**
   * Get all registered rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): AlertEvent[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Register an alert callback
   */
  onAlert(callback: AlertCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start periodic alert checks
   */
  startChecking(intervalMs: number = MS_PER_HOUR): void {
    if (!this.enabled) return;

    if (this.checkInterval) {
      logger.warn('[Alerting] Check interval already running');
      return;
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAllRules();
      } catch (error) {
        logger.error('[Alerting] Failed to check rules', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, intervalMs);

    logger.info('[Alerting] Started periodic checks', { intervalMs });
  }

  /**
   * Stop periodic alert checks
   */
  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('[Alerting] Stopped periodic checks');
    }
  }

  /**
   * Manually trigger a check of all rules
   */
  async checkAllRules(): Promise<AlertEvent[]> {
    if (!this.enabled) return [];

    const triggeredAlerts: AlertEvent[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      try {
        const alert = await this.checkRule(rule, now);
        if (alert) {
          triggeredAlerts.push(alert);
        }
      } catch (error) {
        logger.error('[Alerting] Failed to check rule', {
          ruleId: rule.id,
          ruleName: rule.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return triggeredAlerts;
  }

  /**
   * Check a single rule against current metrics
   */
  private async checkRule(rule: AlertRule, now: number): Promise<AlertEvent | null> {
    // Check cooldown
    const lastAlertTime = this.lastAlertTimes.get(rule.id);
    if (lastAlertTime && now - lastAlertTime < (rule.cooldownMs ?? this.defaultCooldownMs)) {
      return null; // Still in cooldown
    }

    // Get metric value
    const windowMs = rule.windowMs ?? this.defaultWindowMs;
    const from = now - windowMs;
    const stats = await this.metricsRepo.getStats(rule.metricName, from, now);

    if (!stats) {
      return null; // No data for this metric
    }

    // Use avg for comparison (could be configurable)
    const currentValue = stats.avg;

    // Check threshold
    const triggered = this.compareValue(currentValue, rule.operator, rule.threshold);

    if (!triggered) {
      // Check if we can resolve an active alert
      if (this.activeAlerts.has(rule.id)) {
        const activeAlert = this.activeAlerts.get(rule.id)!;
        activeAlert.resolvedAt = Math.floor(now / 1000);
        this.activeAlerts.delete(rule.id);
        logger.info('[Alerting] Alert resolved', {
          alertId: activeAlert.id,
          ruleName: rule.name,
          currentValue,
          threshold: rule.threshold,
        });
      }
      return null;
    }

    // Create alert event
    const alert: AlertEvent = {
      id: nanoid(),
      alertId: rule.id,
      metricName: rule.metricName,
      currentValue,
      threshold: rule.threshold,
      severity: rule.severity,
      message: this.buildAlertMessage(rule, currentValue),
      triggeredAt: Math.floor(now / 1000),
    };

    // Track alert
    this.lastAlertTimes.set(rule.id, now);
    this.activeAlerts.set(rule.id, alert);

    // Log alert
    const logMethod = this.getSeverityLogMethod(rule.severity);
    logMethod('[Alerting] Alert triggered', {
      alertId: alert.id,
      ruleName: rule.name,
      metricName: rule.metricName,
      currentValue,
      threshold: rule.threshold,
      severity: rule.severity,
    });

    // Notify callbacks
    await this.notifyCallbacks(alert);

    return alert;
  }

  /**
   * Compare a value against a threshold using the specified operator
   */
  private compareValue(value: number, operator: AlertRule['operator'], threshold: number): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  /**
   * Build a human-readable alert message
   */
  private buildAlertMessage(rule: AlertRule, currentValue: number): string {
    const operatorText: Record<AlertRule['operator'], string> = {
      gt: 'exceeds',
      lt: 'is below',
      eq: 'equals',
      gte: 'exceeds or equals',
      lte: 'is at or below',
    };

    return `[${rule.severity.toUpperCase()}] ${rule.name}: ${rule.metricName} ${operatorText[rule.operator]} threshold (${currentValue.toFixed(2)} ${rule.operator} ${rule.threshold})`;
  }

  /**
   * Get the appropriate logger method for a severity level
   */
  private getSeverityLogMethod(severity: AlertSeverity): typeof logger.info {
    switch (severity) {
      case 'critical':
      case 'error':
        return logger.error.bind(logger);
      case 'warning':
        return logger.warn.bind(logger);
      default:
        return logger.info.bind(logger);
    }
  }

  /**
   * Notify all registered callbacks of an alert
   */
  private async notifyCallbacks(alert: AlertEvent): Promise<void> {
    for (const callback of this.callbacks) {
      try {
        await callback(alert);
      } catch (error) {
        logger.error('[Alerting] Callback failed', {
          alertId: alert.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Shutdown the alerting service
   */
  async shutdown(): Promise<void> {
    logger.info('[Alerting] Shutting down...');
    this.stopChecking();
    this.rules.clear();
    this.activeAlerts.clear();
    this.lastAlertTimes.clear();
    this.callbacks = [];
    logger.info('[Alerting] Shutdown complete');
  }
}
