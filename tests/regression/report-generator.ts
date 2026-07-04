/**
 * Report Generator for Regression Testing System
 *
 * Generates markdown and JSON reports from regression test results.
 * Reports are saved to data/regression/ with timestamps.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import {
  REPORT_OUTPUT_PATH,
  REPORT_CONFIG,
  QUALITY_THRESHOLDS,
  PERFORMANCE_THRESHOLDS,
} from './config.js';
import type {
  RegressionReport,
  ScenarioResult,
  TurnResult,
  CategoryStats,
} from './types.js';

// ============================================================================
// ANSI Color Codes for Console Output
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// ============================================================================
// Report Generator Class
// ============================================================================

export class ReportGenerator {
  /**
   * Generate a markdown report from regression results
   */
  generateMarkdown(report: RegressionReport): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Regression Report - ${this.formatTimestamp(report.timestamp)}`);
    lines.push('');

    // Summary section
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total | ${report.summary.total} |`);
    lines.push(
      `| Passed | ${report.summary.passed} (${this.formatPercent(report.summary.passed, report.summary.total)}) |`
    );
    lines.push(`| Failed | ${report.summary.failed} |`);
    lines.push(`| Avg Quality | ${report.summary.avgQuality.toFixed(1)}/10 |`);
    lines.push(`| Avg Latency | ${this.formatLatency(report.summary.avgLatency)} |`);
    lines.push(`| P95 Latency | ${this.formatLatency(report.summary.p95Latency)} |`);
    lines.push(`| Duration | ${this.formatDuration(report.durationMs)} |`);
    lines.push('');

    // By Category section
    if (report.byCategory.length > 0) {
      lines.push('## By Category');
      lines.push('');
      lines.push('| Category | Total | Passed | Failed | Avg Quality | Avg Latency |');
      lines.push('|----------|-------|--------|--------|-------------|-------------|');
      for (const cat of report.byCategory) {
        const failed = cat.total - cat.passed;
        lines.push(
          `| ${cat.category} | ${cat.total} | ${cat.passed} | ${failed} | ${cat.avgQuality.toFixed(1)}/10 | ${this.formatLatency(cat.avgLatency)} |`
        );
      }
      lines.push('');
    }

    // Failed Scenarios section
    const failedScenarios = report.scenarios.filter((s) => !s.overallPassed);
    if (failedScenarios.length > 0) {
      lines.push('## Failed Scenarios');
      lines.push('');
      for (const result of failedScenarios) {
        lines.push(`### ${result.scenario.id} - ${result.scenario.name}`);
        lines.push('');
        lines.push(`- **Category:** ${result.scenario.category}`);
        lines.push(`- **Tags:** ${result.scenario.tags.join(', ') || 'none'}`);

        if (result.error) {
          lines.push(`- **Error:** ${result.error}`);
        } else {
          lines.push(`- **Avg Quality:** ${result.avgQualityScore.toFixed(1)}/10`);
          lines.push(`- **Latency:** ${this.formatLatency(result.totalLatencyMs)}`);
        }
        lines.push('');

        // Show failed turns
        const failedTurns = result.turns.filter((t) => !t.passed);
        for (const turn of failedTurns) {
          lines.push(`#### Turn: "${this.truncate(turn.turn.text, 80)}"`);
          lines.push('');
          lines.push(`- **Response:** "${this.truncate(turn.response, REPORT_CONFIG.MAX_RESPONSE_LENGTH)}"`);
          lines.push(`- **Quality Score:** ${turn.quality.score}/10 ${turn.quality.passed ? '✓' : '✗'}`);
          lines.push(`- **Judge Feedback:** ${turn.quality.feedback}`);
          if (turn.turn.expectedIntent && turn.detectedIntent !== turn.turn.expectedIntent) {
            lines.push(
              `- **Intent Mismatch:** expected ${turn.turn.expectedIntent}, got ${turn.detectedIntent || 'unknown'}`
            );
          }
          if (turn.turn.expectedRoute && turn.routedTo !== turn.turn.expectedRoute) {
            lines.push(
              `- **Route Mismatch:** expected ${turn.turn.expectedRoute}, got ${turn.routedTo}`
            );
          }
          if (turn.error) {
            lines.push(`- **Error:** ${turn.error}`);
          }
          lines.push('');
        }
      }
    }

    // Passed Scenarios section (compact)
    const passedScenarios = report.scenarios.filter((s) => s.overallPassed);
    if (passedScenarios.length > 0) {
      lines.push('## Passed Scenarios');
      lines.push('');
      lines.push('| Scenario | Category | Quality | Latency |');
      lines.push('|----------|----------|---------|---------|');
      for (const result of passedScenarios) {
        lines.push(
          `| ${result.scenario.name} | ${result.scenario.category} | ${result.avgQualityScore.toFixed(1)}/10 | ${this.formatLatency(result.totalLatencyMs)} |`
        );
      }
      lines.push('');
    }

    // Run options
    if (report.options.categories || report.options.tags) {
      lines.push('## Run Options');
      lines.push('');
      if (report.options.categories) {
        lines.push(`- **Categories:** ${report.options.categories.join(', ')}`);
      }
      if (report.options.tags) {
        lines.push(`- **Tags:** ${report.options.tags.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate a JSON report from regression results
   */
  generateJSON(report: RegressionReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Save reports to data/regression/ directory
   * Returns the paths of the saved files
   */
  async save(report: RegressionReport): Promise<{ markdown: string; json: string }> {
    // Ensure directory exists
    await mkdir(REPORT_OUTPUT_PATH, { recursive: true });

    // Generate filename from timestamp
    const timestamp = this.formatFilenameTimestamp(report.timestamp);
    const markdownPath = path.join(REPORT_OUTPUT_PATH, `report-${timestamp}.md`);
    const jsonPath = path.join(REPORT_OUTPUT_PATH, `report-${timestamp}.json`);

    // Generate and save reports
    const markdownContent = this.generateMarkdown(report);
    const jsonContent = this.generateJSON(report);

    await Promise.all([
      writeFile(markdownPath, markdownContent, 'utf-8'),
      writeFile(jsonPath, jsonContent, 'utf-8'),
    ]);

    return { markdown: markdownPath, json: jsonPath };
  }

  /**
   * Print a summary to the console with colors
   */
  printSummary(report: RegressionReport, savedPaths?: { markdown: string; json: string }): void {
    const { summary } = report;
    const passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;

    console.log('');
    console.log(`${colors.bold}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}                    REGRESSION REPORT                       ${colors.reset}`);
    console.log(`${colors.bold}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log('');

    // Overall result
    if (summary.failed === 0) {
      console.log(`  ${colors.green}${colors.bold}✓ ALL TESTS PASSED${colors.reset}`);
    } else {
      console.log(`  ${colors.red}${colors.bold}✗ SOME TESTS FAILED${colors.reset}`);
    }
    console.log('');

    // Stats
    console.log(`  ${colors.bold}Results:${colors.reset}`);
    console.log(`    ${colors.green}Passed:${colors.reset} ${summary.passed}/${summary.total} (${passRate.toFixed(1)}%)`);
    if (summary.failed > 0) {
      console.log(`    ${colors.red}Failed:${colors.reset} ${summary.failed}`);
    }
    console.log('');

    // Quality metrics
    console.log(`  ${colors.bold}Quality:${colors.reset}`);
    const qualityColor = this.getQualityColor(summary.avgQuality);
    console.log(`    Average: ${qualityColor}${summary.avgQuality.toFixed(1)}/10${colors.reset}`);
    console.log('');

    // Performance metrics
    console.log(`  ${colors.bold}Performance:${colors.reset}`);
    const latencyColor = this.getLatencyColor(summary.avgLatency);
    const p95Color = this.getLatencyColor(summary.p95Latency);
    console.log(`    Avg Latency: ${latencyColor}${this.formatLatency(summary.avgLatency)}${colors.reset}`);
    console.log(`    P95 Latency: ${p95Color}${this.formatLatency(summary.p95Latency)}${colors.reset}`);
    console.log(`    Duration:    ${this.formatDuration(report.durationMs)}`);
    console.log('');

    // Category breakdown
    if (report.byCategory.length > 0) {
      console.log(`  ${colors.bold}By Category:${colors.reset}`);
      for (const cat of report.byCategory) {
        const failed = cat.total - cat.passed;
        const status = failed === 0 ? colors.green : colors.red;
        const statusIcon = failed === 0 ? '✓' : '✗';
        console.log(
          `    ${status}${statusIcon}${colors.reset} ${cat.category}: ${cat.passed}/${cat.total} passed, ${cat.avgQuality.toFixed(1)}/10 quality`
        );
      }
      console.log('');
    }

    // Failed scenarios list
    const failedScenarios = report.scenarios.filter((s) => !s.overallPassed);
    if (failedScenarios.length > 0) {
      console.log(`  ${colors.bold}${colors.red}Failed Scenarios:${colors.reset}`);
      for (const result of failedScenarios) {
        const reason = result.error || `quality ${result.avgQualityScore.toFixed(1)}/10`;
        console.log(`    ${colors.red}✗${colors.reset} ${result.scenario.id}: ${reason}`);
      }
      console.log('');
    }

    // Report paths
    if (savedPaths) {
      console.log(`  ${colors.bold}Reports saved:${colors.reset}`);
      console.log(`    ${colors.dim}${savedPaths.markdown}${colors.reset}`);
      console.log(`    ${colors.dim}${savedPaths.json}${colors.reset}`);
      console.log('');
    }

    console.log(`${colors.bold}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log('');
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private formatTimestamp(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatFilenameTimestamp(isoString: string): string {
    const date = new Date(isoString);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  private formatPercent(value: number, total: number): string {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  }

  private formatLatency(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private getQualityColor(score: number): string {
    if (score >= QUALITY_THRESHOLDS.PASS) return colors.green;
    if (score >= QUALITY_THRESHOLDS.WARN) return colors.yellow;
    return colors.red;
  }

  private getLatencyColor(ms: number): string {
    if (ms <= PERFORMANCE_THRESHOLDS.LATENCY_WARN_MS) return colors.green;
    if (ms <= PERFORMANCE_THRESHOLDS.DEFAULT_MAX_LATENCY_MS) return colors.yellow;
    return colors.red;
  }
}
