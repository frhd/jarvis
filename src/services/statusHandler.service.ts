/**
 * Status Handler Service
 *
 * Handles system health status requests.
 * Provides formatted responses for /health and /status commands.
 */

import { HealthService } from './health.service.js';
import { logger } from '../utils/logger.js';

export interface StatusHandlerConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: StatusHandlerConfig = {
  enabled: true,
};

export interface SystemHealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentStatus[];
  queueStats: QueueStats | null;
  lastMessageProcessed: Date | null;
}

export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastChecked: Date;
  latencyMs?: number;
  error?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export class StatusHandlerService {
  private config: StatusHandlerConfig;

  constructor(
    private healthService: HealthService,
    config?: Partial<StatusHandlerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Handle system health status request
   * Returns a formatted response showing system health
   */
  async handleSystemHealth(): Promise<string> {
    const health = await this.getSystemHealth();
    return this.formatSystemHealth(health);
  }

  /**
   * Get current system health
   */
  private async getSystemHealth(): Promise<SystemHealthStatus> {
    const systemHealth = await this.healthService.getSystemHealth();

    return {
      overall: systemHealth.status,
      components: systemHealth.components.map(c => ({
        name: c.name,
        status: c.status,
        lastChecked: c.lastChecked,
        latencyMs: c.latencyMs,
        error: c.error,
      })),
      queueStats: this.extractQueueStats(systemHealth.components),
      lastMessageProcessed: null,
    };
  }

  private extractQueueStats(components: { name: string; metadata?: Record<string, unknown> }[]): QueueStats | null {
    const queueComponent = components.find(c => c.name === 'queue');
    if (!queueComponent?.metadata) {
      return null;
    }

    const meta = queueComponent.metadata as {
      pending?: number;
      processing?: number;
      completed?: number;
      failed?: number;
    };

    return {
      pending: meta.pending ?? 0,
      processing: meta.processing ?? 0,
      completed: meta.completed ?? 0,
      failed: meta.failed ?? 0,
    };
  }

  private formatSystemHealth(health: SystemHealthStatus): string {
    const lines: string[] = [];

    lines.push('🏥 *System Health Status*');
    lines.push('');

    const statusEmoji = health.overall === 'healthy' ? '✅' : health.overall === 'degraded' ? '⚠️' : '❌';
    lines.push(`${statusEmoji} Overall: ${health.overall.toUpperCase()}`);
    lines.push('');

    lines.push('*Components:*');

    const healthy = health.components.filter(c => c.status === 'healthy');
    const degraded = health.components.filter(c => c.status === 'degraded');
    const unhealthy = health.components.filter(c => c.status === 'unhealthy');

    if (healthy.length > 0) {
      lines.push('');
      lines.push('✅ Healthy:');
      healthy.forEach(c => {
        const latency = c.latencyMs !== undefined ? ` (${c.latencyMs}ms)` : '';
        lines.push(`  • ${c.name}${latency}`);
      });
    }

    if (degraded.length > 0) {
      lines.push('');
      lines.push('⚠️  Degraded:');
      degraded.forEach(c => {
        const details = c.error ? ` - ${c.error}` : '';
        lines.push(`  • ${c.name}${details}`);
      });
    }

    if (unhealthy.length > 0) {
      lines.push('');
      lines.push('❌ Unhealthy:');
      unhealthy.forEach(c => {
        const details = c.error ? ` - ${c.error}` : '';
        lines.push(`  • ${c.name}${details}`);
      });
    }

    if (health.queueStats) {
      lines.push('');
      lines.push('*Queue Statistics:*');
      const { pending, processing, completed, failed } = health.queueStats;
      lines.push(`  • Pending: ${pending}`);
      lines.push(`  • Processing: ${processing}`);
      lines.push(`  • Completed: ${completed}`);
      lines.push(`  • Failed: ${failed}`);

      const backlog = pending + processing;
      if (backlog > 0) {
        lines.push('');
        lines.push(`  Total backlog: ${backlog}`);
      }
    }

    return lines.join('\n');
  }

  updateConfig(updates: Partial<StatusHandlerConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Status handler configuration updated', { config: this.config });
  }
}
