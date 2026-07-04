#!/usr/bin/env npx tsx
/**
 * Circular Dependency Detection Script
 *
 * Detects circular dependencies in the codebase using madge.
 * Run with: npm run check:circular or npx tsx scripts/check-circular-deps.ts
 *
 * @see https://github.com/pahen/madge
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

const rootDir = resolve(import.meta.dirname, '..');
const srcDir = resolve(rootDir, 'src');

interface CircularDep {
  cycle: string[];
}

function checkCircularDependencies(): void {
  console.log('Checking for circular dependencies in src/...\n');

  try {
    // Run madge to detect circular dependencies
    const result = execSync(
      `npx madge --circular --extensions ts --json "${srcDir}"`,
      {
        encoding: 'utf-8',
        cwd: rootDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large codebases
      }
    );

    const circularDeps: string[][] = JSON.parse(result);

    if (circularDeps.length === 0) {
      console.log('✅ No circular dependencies found!\n');
      process.exit(0);
    }

    console.log(`⚠️  Found ${circularDeps.length} circular dependencies:\n`);

    // Categorize by severity (services are higher priority)
    const serviceCircular = circularDeps.filter((cycle) =>
      cycle.some((path) => path.includes('services/'))
    );
    const otherCircular = circularDeps.filter(
      (cycle) => !cycle.some((path) => path.includes('services/'))
    );

    if (serviceCircular.length > 0) {
      console.log('🔴 Service layer circular dependencies (high priority):');
      for (const cycle of serviceCircular) {
        console.log(`   ${cycle.join(' → ')} → ${cycle[0]}`);
      }
      console.log('');
    }

    if (otherCircular.length > 0) {
      console.log('🟡 Other circular dependencies:');
      for (const cycle of otherCircular) {
        console.log(`   ${cycle.join(' → ')} → ${cycle[0]}`);
      }
      console.log('');
    }

    // Suggestions
    console.log('💡 Suggestions to fix circular dependencies:');
    console.log('   1. Extract shared types to src/services/types/');
    console.log('   2. Use lazy getters from src/services/instances/');
    console.log('   3. Consider dependency injection patterns');
    console.log('   4. Move shared utilities to a separate module\n');

    // Exit with error code if there are service circular deps (high priority)
    if (serviceCircular.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    // madge returns non-zero exit code when circular deps found
    if (error instanceof Error && 'stdout' in error) {
      const output = (error as { stdout: string }).stdout;
      try {
        const circularDeps: string[][] = JSON.parse(output);
        if (circularDeps.length > 0) {
          console.log(`⚠️  Found ${circularDeps.length} circular dependencies:\n`);
          for (const cycle of circularDeps) {
            console.log(`   ${cycle.join(' → ')} → ${cycle[0]}`);
          }
          process.exit(1);
        }
      } catch {
        // Not JSON, print raw output
        console.error('Circular dependencies detected:');
        console.error(output);
        process.exit(1);
      }
    }

    // Unexpected error
    console.error('Error running madge:', error);
    process.exit(1);
  }
}

// Generate dependency graph visualization (optional)
function generateGraph(): void {
  const outputPath = resolve(rootDir, 'data', 'dependency-graph.svg');

  console.log(`Generating dependency graph to ${outputPath}...\n`);

  try {
    execSync(
      `npx madge --image "${outputPath}" --extensions ts "${srcDir}/services/index.ts"`,
      {
        encoding: 'utf-8',
        cwd: rootDir,
      }
    );
    console.log(`✅ Dependency graph saved to: ${outputPath}\n`);
  } catch (error) {
    console.error('Failed to generate graph:', error);
  }
}

// Main
const args = process.argv.slice(2);
if (args.includes('--graph')) {
  generateGraph();
} else {
  checkCircularDependencies();
}
