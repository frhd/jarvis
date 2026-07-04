import { Router } from 'express';
import { telegramService } from '../services/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/health/telegram
 *
 * Returns Telegram connection health metrics for monitoring and debugging.
 * Requires API authentication if enabled.
 */
router.get('/telegram', (req, res) => {
  try {
    const metrics = telegramService.getConnectionMetrics();

    // Calculate time since last reconnect
    const timeSinceLastReconnect = metrics.lastReconnectTime
      ? Date.now() - metrics.lastReconnectTime.getTime()
      : null;

    // Calculate uptime (approximate based on time since last reconnect)
    const uptimeMs = timeSinceLastReconnect && timeSinceLastReconnect > 0
      ? timeSinceLastReconnect
      : null;

    // Format reconnect reasons for readability
    const reconnectReasonBreakdown = Object.entries(metrics.reconnectReasons || {})
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: metrics.reconnectCount > 0
          ? Math.round((count / metrics.reconnectCount) * 100)
          : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const response = {
      status: telegramService.isConnected() ? 'connected' : 'disconnected',
      metrics: {
        reconnectCount: metrics.reconnectCount,
        failedReconnectCount: metrics.failedReconnectCount,
        lastReconnectTime: metrics.lastReconnectTime?.toISOString() || null,
        lastReconnectDuration: metrics.lastReconnectDuration,
        timeSinceLastReconnectMs: timeSinceLastReconnect,
        uptimeMs,
        avgTimeBetweenReconnectsMs: metrics.avgTimeBetweenReconnectsMs,
        primaryReconnectReason: metrics.primaryReconnectReason,
        reconnectReasonBreakdown,
      },
      latency: {
        avgHealthCheckLatencyMs: metrics.avgHealthCheckLatencyMs,
        avgKeepalivePingLatencyMs: metrics.avgKeepalivePingLatencyMs,
        avgUpdateLagMs: metrics.avgUpdateLagMs,
      },
      queue: {
        outboundQueueSize: metrics.queueSize,
        queuedMessageCount: metrics.queuedMessageCount,
        flushedMessageCount: metrics.flushedMessageCount,
      },
      keepalive: {
        pingCount: metrics.keepalivePingCount,
        pingFailures: metrics.keepalivePingFailures,
        consecutiveFailures: metrics.consecutiveKeepaliveFailures,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('[HealthRoutes] Error fetching Telegram health metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to fetch Telegram health metrics',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
