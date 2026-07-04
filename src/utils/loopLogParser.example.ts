/**
 * Loop Log Parser Usage Examples
 *
 * This file demonstrates how to use the loop log parser utility
 * to extract metrics and progress information from loop.log files.
 */

import { parseLoopLog, parseLoopLogIncremental, extractSubagentStats } from './loopLogParser.js';
import { readFile } from 'fs/promises';

/**
 * Example 1: Parse a complete loop.log file
 */
async function example1_parseCompleteLog() {
  console.log('=== Example 1: Parse Complete Log ===\n');

  const logPath = './loop/loop.log';
  const content = await readFile(logPath, 'utf-8');
  const metrics = parseLoopLog(content);

  console.log(`Total Iterations: ${metrics.totalIterations}`);
  console.log(`Total Input Tokens: ${metrics.totalTokensIn.toLocaleString()}`);
  console.log(`Total Output Tokens: ${metrics.totalTokensOut.toLocaleString()}`);
  console.log(`Total Cache Read: ${metrics.totalCacheRead.toLocaleString()}`);
  console.log(`Total Cache Write: ${metrics.totalCacheWrite.toLocaleString()}`);
  console.log(`Total Cost: $${metrics.totalCost.toFixed(2)}`);

  if (metrics.averageDuration) {
    const avgSeconds = (metrics.averageDuration / 1000).toFixed(1);
    console.log(`Average Duration: ${avgSeconds}s per iteration`);
  }

  console.log('\nPer-Iteration Breakdown:');
  metrics.entries.forEach((entry) => {
    console.log(
      `  Iteration ${entry.iteration}: ` +
        `${entry.tokensIn} in, ${entry.tokensOut} out, ` +
        `cache: ${entry.cacheRead || 0} read / ${entry.cacheWrite || 0} write, ` +
        `cost: $${entry.cost.toFixed(2)}`
    );
  });
}

/**
 * Example 2: Parse incrementally for real-time progress tracking
 */
async function example2_parseIncremental() {
  console.log('\n=== Example 2: Incremental Parsing ===\n');

  const logPath = './loop/loop.log';
  let lastLine = 0;

  // Simulate reading in chunks
  for (let i = 0; i < 3; i++) {
    const { metrics, lastLine: newLastLine } = await parseLoopLogIncremental(logPath, lastLine);
    lastLine = newLastLine;

    console.log(`Read up to line ${lastLine}:`);
    console.log(`  Iterations: ${metrics.totalIterations}`);
    console.log(`  Total Cost: $${metrics.totalCost.toFixed(2)}`);
    console.log(`  Latest Iteration: ${metrics.entries[metrics.entries.length - 1]?.iteration || 'N/A'}\n`);

    // In a real scenario, you'd wait between reads
    // await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

/**
 * Example 3: Extract subagent statistics
 */
async function example3_extractSubagents() {
  console.log('\n=== Example 3: Subagent Statistics ===\n');

  const logPath = './loop/loop.log';
  const content = await readFile(logPath, 'utf-8');
  const stats = extractSubagentStats(content);

  if (stats.length === 0) {
    console.log('No subagents found in log');
    return;
  }

  console.log(`Total Subagents: ${stats.length}\n`);

  stats.forEach((agent, i) => {
    console.log(`Subagent ${i + 1}:`);
    console.log(`  Agent ID: ${agent.agentId}`);
    console.log(`  Model: ${agent.model}`);
    console.log(`  Tokens: ${agent.tokens.toLocaleString()}`);
    console.log(`  Duration: ${(agent.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Tools Used: ${agent.toolCount}\n`);
  });

  // Calculate totals
  const totalTokens = stats.reduce((sum, s) => sum + s.tokens, 0);
  const totalDuration = stats.reduce((sum, s) => sum + s.durationMs, 0);
  const totalTools = stats.reduce((sum, s) => sum + s.toolCount, 0);

  console.log('Subagent Totals:');
  console.log(`  Total Tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Total Tools: ${totalTools}`);
}

/**
 * Example 4: Calculate efficiency metrics
 */
async function example4_calculateEfficiency() {
  console.log('\n=== Example 4: Efficiency Metrics ===\n');

  const logPath = './loop/loop.log';
  const content = await readFile(logPath, 'utf-8');
  const metrics = parseLoopLog(content);

  if (metrics.totalIterations === 0) {
    console.log('No iterations found');
    return;
  }

  const totalTokens = metrics.totalTokensIn + metrics.totalTokensOut;
  const cacheHitRate =
    metrics.totalTokensIn + metrics.totalCacheRead > 0
      ? (metrics.totalCacheRead / (metrics.totalTokensIn + metrics.totalCacheRead)) * 100
      : 0;

  const avgCostPerIteration = metrics.totalCost / metrics.totalIterations;
  const avgTokensPerIteration = totalTokens / metrics.totalIterations;

  console.log(`Total Tokens: ${totalTokens.toLocaleString()}`);
  console.log(`Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
  console.log(`Average Cost per Iteration: $${avgCostPerIteration.toFixed(2)}`);
  console.log(`Average Tokens per Iteration: ${avgTokensPerIteration.toLocaleString()}`);

  // Cost breakdown
  const inputCost = (metrics.totalTokensIn / 1_000_000) * 15;
  const outputCost = (metrics.totalTokensOut / 1_000_000) * 75;
  const cacheReadCost = (metrics.totalCacheRead / 1_000_000) * 1.5;
  const cacheWriteCost = (metrics.totalCacheWrite / 1_000_000) * 18.75;

  console.log('\nCost Breakdown:');
  console.log(`  Input: $${inputCost.toFixed(2)} (${((inputCost / metrics.totalCost) * 100).toFixed(1)}%)`);
  console.log(`  Output: $${outputCost.toFixed(2)} (${((outputCost / metrics.totalCost) * 100).toFixed(1)}%)`);
  console.log(`  Cache Read: $${cacheReadCost.toFixed(2)} (${((cacheReadCost / metrics.totalCost) * 100).toFixed(1)}%)`);
  console.log(
    `  Cache Write: $${cacheWriteCost.toFixed(2)} (${((cacheWriteCost / metrics.totalCost) * 100).toFixed(1)}%)`
  );

  // Savings from cache
  const cacheSavings = (metrics.totalCacheRead / 1_000_000) * (15 - 1.5);
  console.log(`\nCache Savings: $${cacheSavings.toFixed(2)} (saved by using cached tokens)`);
}

/**
 * Run all examples
 */
async function main() {
  try {
    await example1_parseCompleteLog();
    await example2_parseIncremental();
    await example3_extractSubagents();
    await example4_calculateEfficiency();
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Uncomment to run examples:
// main();
