#!/usr/bin/env tsx
/**
 * Load Alerting Rules
 *
 * This utility script loads alerting rules from the JSON configuration file
 * and validates them. It can be used to test rule configurations before
 * deploying them to production.
 *
 * Usage:
 *   tsx scripts/monitoring/load-alerting-rules.ts [options]
 *
 * Options:
 *   --config <path>       Path to alerting rules JSON (default: config/alerting-rules.json)
 *   --validate            Only validate rules, don't display them
 *   --export              Export rules in AlertingService format
 *   --help                Show help message
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Alert rule interface (matching AlertingService)
interface AlertRule {
  name: string;
  metricName: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  severity: 'info' | 'warning' | 'error' | 'critical';
  enabled: boolean;
  windowMs?: number;
  cooldownMs?: number;
  tags?: Record<string, string>;
  description?: string;
}

interface AlertingRulesConfig {
  rules: AlertRule[];
  globalSettings?: {
    defaultWindowMs?: number;
    defaultCooldownMs?: number;
    enabledByDefault?: boolean;
  };
}

// Parse command line arguments
interface Args {
  config: string;
  validate: boolean;
  export: boolean;
  help: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    config: 'config/alerting-rules.json',
    validate: false,
    export: false,
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    switch (arg) {
      case '--config':
        args.config = process.argv[++i];
        break;
      case '--validate':
        args.validate = true;
        break;
      case '--export':
        args.export = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return args;
}

function showHelp(): void {
  const help = `
Load Alerting Rules

This utility loads and validates alerting rules from a JSON configuration file.

Usage:
  tsx scripts/monitoring/load-alerting-rules.ts [options]

Options:
  --config <path>       Path to alerting rules JSON (default: config/alerting-rules.json)
  --validate            Only validate rules, don't display them
  --export              Export rules in AlertingService format
  --help, -h            Show this help message

Examples:
  # Load and display rules
  tsx scripts/monitoring/load-alerting-rules.ts

  # Validate custom config
  tsx scripts/monitoring/load-alerting-rules.ts --config custom-rules.json --validate

  # Export rules for programmatic use
  tsx scripts/monitoring/load-alerting-rules.ts --export > rules.json
`;
  console.log(help);
}

function validateRule(rule: AlertRule, index: number): string[] {
  const errors: string[] = [];

  // Required fields
  if (!rule.name) {
    errors.push(`Rule ${index}: Missing 'name' field`);
  }
  if (!rule.metricName) {
    errors.push(`Rule ${index}: Missing 'metricName' field`);
  }
  if (rule.threshold === undefined || rule.threshold === null) {
    errors.push(`Rule ${index}: Missing 'threshold' field`);
  }

  // Operator validation
  const validOperators = ['gt', 'lt', 'eq', 'gte', 'lte'];
  if (!rule.operator || !validOperators.includes(rule.operator)) {
    errors.push(`Rule ${index}: Invalid 'operator' (must be one of: ${validOperators.join(', ')})`);
  }

  // Severity validation
  const validSeverities = ['info', 'warning', 'error', 'critical'];
  if (!rule.severity || !validSeverities.includes(rule.severity)) {
    errors.push(`Rule ${index}: Invalid 'severity' (must be one of: ${validSeverities.join(', ')})`);
  }

  // Enabled field
  if (typeof rule.enabled !== 'boolean') {
    errors.push(`Rule ${index}: 'enabled' must be a boolean`);
  }

  // Optional numeric fields
  if (rule.windowMs !== undefined && (typeof rule.windowMs !== 'number' || rule.windowMs <= 0)) {
    errors.push(`Rule ${index}: 'windowMs' must be a positive number`);
  }
  if (rule.cooldownMs !== undefined && (typeof rule.cooldownMs !== 'number' || rule.cooldownMs <= 0)) {
    errors.push(`Rule ${index}: 'cooldownMs' must be a positive number`);
  }

  // Tags validation
  if (rule.tags !== undefined && typeof rule.tags !== 'object') {
    errors.push(`Rule ${index}: 'tags' must be an object`);
  }

  return errors;
}

function loadRules(configPath: string): AlertingRulesConfig {
  try {
    const fullPath = resolve(process.cwd(), configPath);
    const content = readFileSync(fullPath, 'utf-8');
    const config = JSON.parse(content) as AlertingRulesConfig;

    if (!config.rules || !Array.isArray(config.rules)) {
      throw new Error('Config must contain a "rules" array');
    }

    return config;
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`);
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function validateConfig(config: AlertingRulesConfig): boolean {
  let hasErrors = false;
  const allErrors: string[] = [];

  config.rules.forEach((rule, index) => {
    const errors = validateRule(rule, index + 1);
    if (errors.length > 0) {
      allErrors.push(...errors);
      hasErrors = true;
    }
  });

  if (hasErrors) {
    console.error('Validation failed:\n');
    allErrors.forEach(error => console.error(`  - ${error}`));
    return false;
  }

  return true;
}

function displayRules(config: AlertingRulesConfig): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      Alerting Rules Configuration      ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Global settings
  if (config.globalSettings) {
    console.log('Global Settings:');
    console.log(`  Default Window:    ${config.globalSettings.defaultWindowMs || 'N/A'} ms`);
    console.log(`  Default Cooldown:  ${config.globalSettings.defaultCooldownMs || 'N/A'} ms`);
    console.log(`  Enabled by Default: ${config.globalSettings.enabledByDefault || false}`);
    console.log('');
  }

  // Rules summary
  const enabledCount = config.rules.filter(r => r.enabled).length;
  const disabledCount = config.rules.length - enabledCount;

  console.log(`Total Rules: ${config.rules.length}`);
  console.log(`  Enabled:  ${enabledCount}`);
  console.log(`  Disabled: ${disabledCount}`);
  console.log('');

  // Group rules by severity
  const bySeverity = config.rules.reduce((acc, rule) => {
    acc[rule.severity] = (acc[rule.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('Rules by Severity:');
  Object.entries(bySeverity)
    .sort(([a], [b]) => {
      const order = ['critical', 'error', 'warning', 'info'];
      return order.indexOf(a) - order.indexOf(b);
    })
    .forEach(([severity, count]) => {
      console.log(`  ${severity.padEnd(10)}: ${count}`);
    });
  console.log('');

  // List all rules
  console.log('Rules:\n');

  config.rules.forEach((rule, index) => {
    const status = rule.enabled ? '✓' : '✗';
    const statusColor = rule.enabled ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const resetColor = '\x1b[0m';

    console.log(`${statusColor}${status}${resetColor} ${index + 1}. ${rule.name}`);
    console.log(`   Metric:      ${rule.metricName}`);
    console.log(`   Threshold:   ${rule.operator} ${rule.threshold}`);
    console.log(`   Severity:    ${rule.severity}`);
    console.log(`   Window:      ${rule.windowMs || 'default'} ms`);
    console.log(`   Cooldown:    ${rule.cooldownMs || 'default'} ms`);

    if (rule.tags && Object.keys(rule.tags).length > 0) {
      console.log(`   Tags:        ${JSON.stringify(rule.tags)}`);
    }

    if (rule.description) {
      console.log(`   Description: ${rule.description}`);
    }

    console.log('');
  });
}

function exportRules(config: AlertingRulesConfig): void {
  // Export in format compatible with AlertingService constructor
  const exportData = {
    rules: config.rules.map(rule => ({
      name: rule.name,
      metricName: rule.metricName,
      threshold: rule.threshold,
      operator: rule.operator,
      severity: rule.severity,
      enabled: rule.enabled,
      windowMs: rule.windowMs,
      cooldownMs: rule.cooldownMs,
      tags: rule.tags || {},
    })),
    config: config.globalSettings,
  };

  console.log(JSON.stringify(exportData, null, 2));
}

function main(): void {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Load configuration
  const config = loadRules(args.config);

  // Validate rules
  const isValid = validateConfig(config);

  if (!isValid) {
    process.exit(1);
  }

  if (args.validate) {
    console.log(`✓ Configuration is valid (${config.rules.length} rules)`);
    process.exit(0);
  }

  if (args.export) {
    exportRules(config);
    process.exit(0);
  }

  // Display rules
  displayRules(config);
}

// Run the script
main();
