#!/usr/bin/env node
/**
 * Regression Testing CLI Entry Point
 *
 * Usage:
 *   npm run regression
 *   npm run regression -- --verbose
 *   npm run regression -- --category=greetings
 *   npm run regression -- --tag=critical
 *   npm run regression -- --keep
 */

// Handle unhandled rejections gracefully to prevent crashes during test execution
// This is critical because LLM calls may timeout and produce unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  // Log but don't crash - let the runner's error handling deal with it
  console.error('[Regression] Unhandled rejection (suppressed):', reason);
});

import { RegressionRunner, buildReport } from './runner.js';
import { ReportGenerator } from './report-generator.js';
import {
  getAllScenarios,
  getScenariosByCategory,
  getScenariosByTag,
} from './scenarios.js';
import type { RegressionScenario, ScenarioCategory, RunnerOptions } from './types.js';

// ============================================================================
// ANSI Colors for Console Output
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
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIArgs {
  categories?: ScenarioCategory[];
  tags?: string[];
  verbose: boolean;
  keep: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    verbose: false,
    keep: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--keep' || arg === '-k') {
      result.keep = true;
    } else if (arg.startsWith('--category=')) {
      const value = arg.slice('--category='.length);
      result.categories = value.split(',').map((c) => c.trim() as ScenarioCategory);
    } else if (arg.startsWith('--tag=')) {
      const value = arg.slice('--tag='.length);
      result.tags = value.split(',').map((t) => t.trim());
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
${colors.bold}Regression Testing System${colors.reset}

${colors.cyan}Usage:${colors.reset}
  npm run regression [options]

${colors.cyan}Options:${colors.reset}
  --help, -h          Show this help message
  --verbose, -v       Show detailed progress for each scenario
  --keep, -k          Keep test data after run (don't cleanup)
  --category=X,Y      Filter by categories (greetings, questions, commands, multi_turn, edge_cases)
  --tag=X             Filter by tag (critical, fast, slow, context, memory, etc.)

${colors.cyan}Examples:${colors.reset}
  npm run regression                       Run all 20 scenarios
  npm run regression -- --verbose          Run with detailed output
  npm run regression -- --category=greetings   Run only greeting scenarios
  npm run regression -- --tag=critical     Run only critical scenarios
  npm run regression -- --keep --verbose   Run with verbose output, keep test data

${colors.cyan}Categories:${colors.reset}
  greetings    - Greeting, farewell, gratitude scenarios (4)
  questions    - Factual, how-to, opinion, web search, personal (5)
  commands     - Task request, translation, summarization, calculation (4)
  multi_turn   - Context continuity, name recall, follow-up (4)
  edge_cases   - Empty input, ambiguous, unclear (3)

${colors.cyan}Tags:${colors.reset}
  critical, fast, slow, cacheable, knowledge, context, memory, edge-case, robustness
`);
}

// ============================================================================
// Scenario Filtering
// ============================================================================

function filterScenarios(
  categories?: ScenarioCategory[],
  tags?: string[]
): RegressionScenario[] {
  let scenarios = getAllScenarios();

  // Filter by categories if specified
  if (categories && categories.length > 0) {
    scenarios = scenarios.filter((s) => categories.includes(s.category));
  }

  // Filter by tags if specified (must have at least one)
  if (tags && tags.length > 0) {
    scenarios = scenarios.filter((s) => tags.some((tag) => s.tags.includes(tag)));
  }

  return scenarios;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle --help
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Build runner options
  const options: RunnerOptions = {
    categories: args.categories,
    tags: args.tags,
    verbose: args.verbose,
    keep: args.keep,
  };

  // Filter scenarios
  const scenarios = filterScenarios(args.categories, args.tags);

  if (scenarios.length === 0) {
    console.error(`${colors.red}No scenarios match the specified filters.${colors.reset}`);
    process.exit(1);
  }

  // Print header
  console.log('');
  console.log(`${colors.bold}${colors.cyan}Regression Testing System${colors.reset}`);
  console.log(`${colors.dim}─────────────────────────────────${colors.reset}`);
  console.log('');

  // Show what we're running
  console.log(`${colors.bold}Running ${scenarios.length} scenario(s)...${colors.reset}`);
  if (args.categories) {
    console.log(`  Categories: ${args.categories.join(', ')}`);
  }
  if (args.tags) {
    console.log(`  Tags: ${args.tags.join(', ')}`);
  }
  console.log('');

  let runner: RegressionRunner | null = null;

  try {
    // Initialize runner
    console.log(`${colors.dim}Initializing test pipeline...${colors.reset}`);
    runner = await RegressionRunner.create(options);
    console.log(`${colors.green}Pipeline ready (run ID: ${runner.getRunId()})${colors.reset}`);
    console.log('');

    // Execute scenarios
    const results = await runner.run(scenarios);

    // Build report
    const report = buildReport(results, options);

    // Generate and save reports
    const generator = new ReportGenerator();
    const savedPaths = await generator.save(report);

    // Print summary
    generator.printSummary(report, savedPaths);

    // Cleanup unless --keep
    if (!args.keep) {
      console.log(`${colors.dim}Cleaning up test data...${colors.reset}`);
      await runner.cleanup();
      console.log(`${colors.green}Cleanup complete.${colors.reset}`);
    } else {
      console.log(`${colors.yellow}Test data kept (run ID: ${runner.getRunId()})${colors.reset}`);
    }

    // Exit with appropriate code
    const exitCode = results.summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('');
    console.error(`${colors.red}${colors.bold}Error during regression run:${colors.reset}`);
    console.error(error instanceof Error ? error.message : String(error));

    // Attempt cleanup on error
    if (runner && !args.keep) {
      try {
        console.log(`${colors.dim}Attempting cleanup after error...${colors.reset}`);
        await runner.cleanup();
        console.log(`${colors.green}Cleanup complete.${colors.reset}`);
      } catch (cleanupError) {
        console.error(
          `${colors.red}Cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}${colors.reset}`
        );
      }
    }

    process.exit(1);
  }
}

// Run main
main();
