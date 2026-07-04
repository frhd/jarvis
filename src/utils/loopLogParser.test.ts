/**
 * Loop Log Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseLoopLogLine,
  parseLoopLog,
  extractSubagentStats,
} from './loopLogParser.js';

describe('loopLogParser', () => {
  describe('parseLoopLogLine', () => {
    it('should parse loop_start_marker event', () => {
      const line =
        '{"type":"loop_start_marker", "message":"==================== New Claude Run 1 - Sun Jan 18 21:45:55 CET 2026 ===================="}';
      const result = parseLoopLogLine(line);
      expect(result).toEqual({
        type: 'loop_start_marker',
        message:
          '==================== New Claude Run 1 - Sun Jan 18 21:45:55 CET 2026 ====================',
      });
    });

    it('should parse message_start event', () => {
      const line =
        '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-4-5-20251101","id":"msg_123","type":"message","role":"assistant","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":16657,"cache_read_input_tokens":13854,"output_tokens":1}}}}';
      const result = parseLoopLogLine(line);
      expect(result).toBeDefined();
      expect(result?.type).toBe('stream_event');
    });

    it('should parse message_delta event with usage', () => {
      const line =
        '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":2,"cache_creation_input_tokens":16657,"cache_read_input_tokens":13854,"output_tokens":308}}}';
      const result = parseLoopLogLine(line);
      expect(result).toBeDefined();
      expect(result?.type).toBe('stream_event');
      if (result && result.type === 'stream_event' && 'event' in result) {
        const event = result.event as { type: string; usage?: { input_tokens: number } };
        expect(event.type).toBe('message_delta');
        expect(event.usage?.input_tokens).toBe(2);
      }
    });

    it('should return null for malformed JSON', () => {
      const line = '{invalid json}';
      const result = parseLoopLogLine(line);
      expect(result).toBeNull();
    });

    it('should return null for empty lines', () => {
      const result = parseLoopLogLine('');
      expect(result).toBeNull();
    });
  });

  describe('parseLoopLog', () => {
    it('should parse complete log with multiple iterations', () => {
      const logContent = `
{"type":"loop_start_marker", "message":"==================== New Claude Run 1 ===================="}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":100,"cache_creation_input_tokens":1000,"cache_read_input_tokens":5000,"output_tokens":200}}}
{"type":"loop_start_marker", "message":"==================== New Claude Run 2 ===================="}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":50,"cache_creation_input_tokens":500,"cache_read_input_tokens":2500,"output_tokens":100}}}
`.trim();

      const metrics = parseLoopLog(logContent);

      expect(metrics.totalIterations).toBe(2);
      expect(metrics.totalTokensIn).toBe(150); // 100 + 50
      expect(metrics.totalTokensOut).toBe(300); // 200 + 100
      expect(metrics.totalCacheRead).toBe(7500); // 5000 + 2500
      expect(metrics.totalCacheWrite).toBe(1500); // 1000 + 500
      expect(metrics.totalCost).toBeGreaterThan(0);
      expect(metrics.entries).toHaveLength(2);
    });

    it('should handle log with no iterations', () => {
      const logContent = `
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
`.trim();

      const metrics = parseLoopLog(logContent);

      expect(metrics.totalIterations).toBe(0);
      expect(metrics.totalTokensIn).toBe(0);
      expect(metrics.totalTokensOut).toBe(0);
      expect(metrics.entries).toHaveLength(0);
    });

    it('should calculate cost correctly', () => {
      const logContent = `
{"type":"loop_start_marker", "message":"==================== New Claude Run 1 ===================="}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":1000000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1000000}}}
`.trim();

      const metrics = parseLoopLog(logContent);

      // Cost: (1M * $15 + 1M * $75) / 1M = $90
      expect(metrics.totalCost).toBeCloseTo(90, 2);
    });

    it('should handle cache read pricing correctly', () => {
      const logContent = `
{"type":"loop_start_marker", "message":"==================== New Claude Run 1 ===================="}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":1000000,"output_tokens":0}}}
`.trim();

      const metrics = parseLoopLog(logContent);

      // Cost: 1M * $1.50 / 1M = $1.50
      expect(metrics.totalCost).toBeCloseTo(1.5, 2);
    });
  });

  describe('extractSubagentStats', () => {
    it('should extract subagent statistics', () => {
      const logContent = `
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task","id":"tool_123","input":{"model":"sonnet"}}]}}
{"type":"user","tool_use_result":{"agentId":"abc123","totalTokens":5000,"totalDurationMs":3000,"totalToolUseCount":3},"message":{"content":[{"tool_use_id":"tool_123"}]}}
`.trim();

      const stats = extractSubagentStats(logContent);

      expect(stats).toHaveLength(1);
      expect(stats[0]).toEqual({
        agentId: 'abc123',
        model: 'sonnet',
        tokens: 5000,
        durationMs: 3000,
        toolCount: 3,
      });
    });

    it('should default to opus model when not specified', () => {
      const logContent = `
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task","id":"tool_456","input":{}}]}}
{"type":"user","tool_use_result":{"agentId":"def456","totalTokens":2000,"totalDurationMs":1500,"totalToolUseCount":1},"message":{"content":[{"tool_use_id":"tool_456"}]}}
`.trim();

      const stats = extractSubagentStats(logContent);

      expect(stats).toHaveLength(1);
      expect(stats[0].model).toBe('opus');
    });

    it('should handle empty log', () => {
      const stats = extractSubagentStats('');
      expect(stats).toHaveLength(0);
    });
  });
});
