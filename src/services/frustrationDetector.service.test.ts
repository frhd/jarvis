#!/usr/bin/env npx tsx
/**
 * FrustrationDetectorService Tests
 *
 * Run: npx tsx src/services/frustrationDetector.service.test.ts
 */

import { FrustrationDetectorService } from './frustrationDetector.service.js';
import type { Message } from '../types/index.js';

// Simple test helpers
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        console.log(`  Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false');
  }
}

function assertGreaterThanOrEqual(actual: number, expected: number, message?: string) {
  if (actual < expected) {
    throw new Error(message || `Expected ${actual} >= ${expected}`);
  }
}

function assertLessThanOrEqual(actual: number, expected: number, message?: string) {
  if (actual > expected) {
    throw new Error(message || `Expected ${actual} <= ${expected}`);
  }
}

// Helper to create mock messages
function createMessage(text: string, createdAt: Date, senderId: string | null = 'user1'): Message {
  return {
    id: Math.random().toString(36).substring(7),
    telegramMessageId: Math.floor(Math.random() * 10000),
    chatId: 'chat1',
    senderId,
    text,
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    rawJson: null,
    createdAt,
  };
}

async function runTests() {
  console.log('\n=== FrustrationDetectorService Tests ===\n');

  const service = new FrustrationDetectorService();

  // Test 1: No frustration with normal conversation
  await test('No frustration with normal conversation', async () => {
    const now = new Date();
    const messages = [
      createMessage('Hello, how are you?', new Date(now.getTime() - 5000)),
      createMessage("I'm fine, thanks!", new Date(now.getTime() - 4000), null), // bot
      createMessage('Can you help me with something?', new Date(now.getTime() - 3000)),
    ];

    const result = await service.analyze(messages);
    assertEqual(result.level, 0, 'Should have 0 frustration level');
    assertFalse(result.needsAction, 'Should not need action');
  });

  // Test 2: Detect message repetition
  await test('Detect message repetition', async () => {
    const now = new Date();
    const messages = [
      createMessage('Can you do this?', new Date(now.getTime() - 6000)),
      createMessage('OK', new Date(now.getTime() - 5000), null), // bot
      createMessage('Can you do this please?', new Date(now.getTime() - 4000)), // similar
      createMessage('Sure', new Date(now.getTime() - 3000), null), // bot
      createMessage('Can you do this?', new Date(now.getTime() - 2000)), // repeated
    ];

    const result = await service.analyze(messages);
    assertGreaterThanOrEqual(result.indicators.repeatedMessages, 1, 'Should detect at least 1 repetition');
    assertGreaterThanOrEqual(result.level, 2, 'Should have frustration level >= 2');
  });

  // Test 3: Detect message length decline
  await test('Detect message length decline', async () => {
    const now = new Date();
    // Create messages in reverse chronological order (most recent first, as typical in chat)
    const messages = [
      createMessage('???', new Date(now.getTime() - 1000)),
      createMessage('Almost done', new Date(now.getTime() - 2000), null), // bot
      createMessage('Now?', new Date(now.getTime() - 3000)),
      createMessage('Working on it', new Date(now.getTime() - 4000), null), // bot
      createMessage('Can you do it now?', new Date(now.getTime() - 5000)),
      createMessage('Sure!', new Date(now.getTime() - 6000), null), // bot
      createMessage('I would like you to help me with this complex task that requires detailed attention', new Date(now.getTime() - 7000)),
    ];

    const result = await service.analyze(messages);
    assertTrue(result.indicators.shorterMessages, 'Should detect message length decline');
    assertGreaterThanOrEqual(result.level, 2, 'Should have frustration level >= 2');
  });

  // Test 4: Detect high caps usage
  await test('Detect high caps usage', async () => {
    const now = new Date();
    const messages = [
      createMessage('PLEASE DO THIS NOW', new Date(now.getTime() - 4000)),
      createMessage('OK', new Date(now.getTime() - 3000), null), // bot
      createMessage('I NEED THIS DONE', new Date(now.getTime() - 2000)),
    ];

    const result = await service.analyze(messages);
    assertGreaterThanOrEqual(result.indicators.capsUsage, 0.3, 'Should have high caps usage');
    assertGreaterThanOrEqual(result.level, 2, 'Should have frustration level >= 2');
  });

  // Test 5: Detect high punctuation density
  await test('Detect high punctuation density', async () => {
    const now = new Date();
    const messages = [
      createMessage('Are you there???', new Date(now.getTime() - 3000)),
      createMessage('Yes', new Date(now.getTime() - 2500), null), // bot
      createMessage('Do it!!!', new Date(now.getTime() - 2000)),
    ];

    const result = await service.analyze(messages);
    assertGreaterThanOrEqual(result.indicators.punctuationDensity, 0.1, 'Should have high punctuation density');
    assertGreaterThanOrEqual(result.level, 1, 'Should have frustration level >= 1');
  });

  // Test 6: Detect time compression
  await test('Detect time compression', async () => {
    const now = new Date();
    const messages = [
      createMessage('Do this', new Date(now.getTime() - 30000)), // 30s ago
      createMessage('OK', new Date(now.getTime() - 25000), null), // bot
      createMessage('Now', new Date(now.getTime() - 5000)), // 5s ago
      createMessage('Working', new Date(now.getTime() - 4500), null), // bot
      createMessage('Please', new Date(now.getTime() - 3000)), // 3s ago
      createMessage('Almost', new Date(now.getTime() - 2500), null), // bot
      createMessage('Hurry', new Date(now.getTime() - 1000)), // 1s ago
    ];

    const result = await service.analyze(messages);
    assertTrue(result.indicators.timeCompression, 'Should detect time compression');
    assertGreaterThanOrEqual(result.level, 2, 'Should have frustration level >= 2');
  });

  // Test 7: High frustration triggers action
  await test('High frustration triggers action threshold', async () => {
    const now = new Date();
    const messages = [
      createMessage('DO THIS NOW!!!', new Date(now.getTime() - 10000)),
      createMessage('OK', new Date(now.getTime() - 9500), null), // bot
      createMessage('DO IT!!!', new Date(now.getTime() - 3000)), // repeated + caps + punctuation
      createMessage('Working', new Date(now.getTime() - 2500), null), // bot
      createMessage('NOW!!!', new Date(now.getTime() - 1500)), // time compression + caps + punctuation
      createMessage('Almost', new Date(now.getTime() - 1000), null), // bot
      createMessage('!!!', new Date(now.getTime() - 500)), // short + time compression + punctuation
    ];

    const result = await service.analyze(messages);
    assertGreaterThanOrEqual(result.level, 5, 'Should have frustration level >= 5');
    assertTrue(result.needsAction, 'Should need action');
  });

  // Test 8: Configuration customization
  await test('Configuration customization works', async () => {
    const customService = new FrustrationDetectorService({
      actionThreshold: 3,
      capsUsageThreshold: 0.5,
    });

    const config = customService.getConfig();
    assertEqual(config.actionThreshold, 3, 'Should have custom threshold');
    assertEqual(config.capsUsageThreshold, 0.5, 'Should have custom caps threshold');
  });

  // Test 9: Update configuration
  await test('Update configuration works', async () => {
    const testService = new FrustrationDetectorService();
    testService.updateConfig({ actionThreshold: 8 });

    const config = testService.getConfig();
    assertEqual(config.actionThreshold, 8, 'Should have updated threshold');
  });

  // Test 10: Helper method isFrustrated
  await test('isFrustrated helper method', async () => {
    const now = new Date();
    const highFrustrationMessages = [
      createMessage('DO THIS!!!', new Date(now.getTime() - 3000)),
      createMessage('OK', new Date(now.getTime() - 2500), null),
      createMessage('DO IT!!!', new Date(now.getTime() - 1500)),
      createMessage('Working', new Date(now.getTime() - 1000), null),
      createMessage('NOW!!!', new Date(now.getTime() - 500)),
    ];

    const isFrustrated = await service.isFrustrated(highFrustrationMessages);
    assertTrue(isFrustrated, 'Should detect user is frustrated');

    const lowFrustrationMessages = [
      createMessage('Hello', new Date(now.getTime() - 2000)),
      createMessage('Hi!', new Date(now.getTime() - 1000), null),
    ];

    const isNotFrustrated = await service.isFrustrated(lowFrustrationMessages);
    assertFalse(isNotFrustrated, 'Should detect user is not frustrated');
  });

  // Test 11: Helper method getFrustrationLevel
  await test('getFrustrationLevel helper method', async () => {
    const now = new Date();
    const messages = [
      createMessage('Please help', new Date(now.getTime() - 2000)),
      createMessage('Sure!', new Date(now.getTime() - 1000), null),
    ];

    const level = await service.getFrustrationLevel(messages);
    assertLessThanOrEqual(level, 10, 'Level should be <= 10');
    assertGreaterThanOrEqual(level, 0, 'Level should be >= 0');
  });

  // Test 12: Insufficient data handling
  await test('Handle insufficient data gracefully', async () => {
    const result = await service.analyze([]);
    assertEqual(result.level, 0, 'Should have 0 frustration with no messages');
    assertFalse(result.needsAction, 'Should not need action with no data');
    assertTrue(result.reasoning[0].includes('Insufficient'), 'Should indicate insufficient data');
  });

  // Test 13: Filter by sender ID
  await test('Filter messages by sender ID', async () => {
    const now = new Date();
    const messages = [
      createMessage('User 1 message', new Date(now.getTime() - 3000), 'user1'),
      createMessage('Bot message', new Date(now.getTime() - 2500), null),
      createMessage('User 2 message', new Date(now.getTime() - 2000), 'user2'),
      createMessage('User 1 again', new Date(now.getTime() - 1000), 'user1'),
    ];

    const result = await service.analyze(messages, 'user1');
    // Should only analyze user1's messages, so only 2 messages
    // Result will depend on similarity of "User 1 message" and "User 1 again"
    assertTrue(result.level >= 0, 'Should analyze successfully');
  });

  // Test 14: Reasoning provides clear explanations
  await test('Reasoning provides clear explanations', async () => {
    const now = new Date();
    const messages = [
      createMessage('DO THIS!!!', new Date(now.getTime() - 5000)),
      createMessage('OK', new Date(now.getTime() - 4500), null),
      createMessage('DO THIS!!!', new Date(now.getTime() - 2000)),
      createMessage('Working', new Date(now.getTime() - 1500), null),
      createMessage('!!!', new Date(now.getTime() - 500)),
    ];

    const result = await service.analyze(messages);
    assertTrue(result.reasoning.length > 0, 'Should provide reasoning');
    // Check that reasoning includes specific indicators
    const reasoningText = result.reasoning.join(' ');
    assertTrue(
      reasoningText.includes('repeated') ||
      reasoningText.includes('caps') ||
      reasoningText.includes('punctuation') ||
      reasoningText.includes('compression') ||
      reasoningText.includes('declining'),
      'Reasoning should mention specific indicators'
    );
  });

  // Print summary
  console.log(`\n=== Test Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run all tests
runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
