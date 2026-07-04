/**
 * Script to clear stale/low-quality cached responses
 *
 * Usage: npx tsx scripts/clear-stale-cache.ts
 */

import { semanticCacheRepository } from '../src/repositories/semanticCache.repository.js';

// Patterns that indicate pushy/low-quality responses
const PROBLEMATIC_PATTERNS = [
  "What's up?",
  "What's going on?",
  "How can I help?",
  "How can I assist?",
  "What can I do for you?",
  "What do you need?",
  "dude!",  // Too informal
  "What's good?",
];

async function main() {
  console.log('🧹 Clearing stale cache entries...\n');

  let totalDeleted = 0;

  for (const pattern of PROBLEMATIC_PATTERNS) {
    const deleted = await semanticCacheRepository.deleteByResponsePattern(pattern);
    if (deleted > 0) {
      console.log(`  Deleted ${deleted} entries matching: "${pattern}"`);
      totalDeleted += deleted;
    }
  }

  if (totalDeleted === 0) {
    console.log('  No problematic entries found.');
  } else {
    console.log(`\n✅ Total deleted: ${totalDeleted} entries`);
  }

  // Also clear any gratitude entries that might have pushy follow-ups
  const gratitudeCleared = await semanticCacheRepository.invalidateByIntent('gratitude');
  if (gratitudeCleared > 0) {
    console.log(`\n🔄 Cleared ${gratitudeCleared} gratitude intent entries for fresh generation`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
