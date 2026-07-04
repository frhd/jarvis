/**
 * PII Service Demo
 *
 * Demonstrates the capabilities of the PII detection and redaction service.
 * Run with: tsx examples/pii-service-demo.ts
 */

import { PIIService, PIIType, PIIRedactionConfig } from '../src/services/pii.service.js';

// Example text with various PII types
const sampleText = `
Hi, my name is John Smith. You can reach me at:
- Email: john.smith@example.com
- Phone: +1-555-123-4567 or (555) 987-6543
- Telegram: @johnsmith123

My SSN is 123-45-6789 and my credit card is 4111-1111-1111-1111.
My server IP is 192.168.1.100 and IPv6 is 2001:0db8:85a3::8a2e:0370:7334.

Please contact Mary Johnson at mary@company.co.uk for more information.
`;

console.log('='.repeat(80));
console.log('PII SERVICE DEMO');
console.log('='.repeat(80));
console.log();

// 1. Basic Detection
console.log('1. BASIC DETECTION');
console.log('-'.repeat(80));

const config: PIIRedactionConfig = {
  types: Object.values(PIIType),
  preserveFormat: true,
  redactionChar: '*',
  minConfidence: 0.7,
};

const service = new PIIService(config);
const detections = service.detect(sampleText);

console.log(`Found ${detections.length} PII instances:\n`);
detections.forEach((detection, index) => {
  console.log(`${index + 1}. ${detection.type}`);
  console.log(`   Value: "${detection.value}"`);
  console.log(`   Position: ${detection.startIndex}-${detection.endIndex}`);
  console.log(`   Confidence: ${(detection.confidence * 100).toFixed(0)}%`);
  console.log(`   Redacted: "${detection.redactedValue}"`);
  console.log();
});

// 2. Full Redaction
console.log('2. FULL REDACTION (Format Preserving)');
console.log('-'.repeat(80));

const redactedText = service.redact(sampleText);
console.log(redactedText);
console.log();

// 3. Redaction without Format Preservation
console.log('3. REDACTION (No Format Preservation)');
console.log('-'.repeat(80));

const noFormatService = new PIIService({
  ...config,
  preserveFormat: false,
});

const fullyRedacted = noFormatService.redact(sampleText);
console.log(fullyRedacted);
console.log();

// 4. Selective Type Redaction
console.log('4. SELECTIVE REDACTION (Emails and Phone Numbers Only)');
console.log('-'.repeat(80));

const selectiveRedacted = service.redactTypes(sampleText, [
  PIIType.EMAIL,
  PIIType.PHONE_NUMBER,
]);
console.log(selectiveRedacted);
console.log();

// 5. PII Check
console.log('5. PII DETECTION CHECK');
console.log('-'.repeat(80));

const testCases = [
  'Contact me at admin@example.com',
  'The meeting is on Monday',
  'My credit card is 4532-1234-5678-9010',
  'Hello world!',
];

testCases.forEach((text) => {
  const hasPII = service.containsPII(text);
  console.log(`"${text}"`);
  console.log(`  → Has PII: ${hasPII}`);
  console.log();
});

// 6. Detect and Redact in One Pass
console.log('6. COMBINED DETECT + REDACT');
console.log('-'.repeat(80));

const combinedResult = service.detectAndRedact(
  'Email john@example.com or call 555-1234'
);

console.log('Original:', 'Email john@example.com or call 555-1234');
console.log('Redacted:', combinedResult.redactedText);
console.log('Found:', combinedResult.detections.length, 'PII instances');
console.log();

// 7. Different Confidence Thresholds
console.log('7. CONFIDENCE THRESHOLD COMPARISON');
console.log('-'.repeat(80));

const testText = 'Contact John Smith at john@example.com';

const lowConfidence = new PIIService({ ...config, minConfidence: 0.5 });
const highConfidence = new PIIService({ ...config, minConfidence: 0.9 });

console.log('Test text:', testText);
console.log();
console.log('Min Confidence 0.5:', lowConfidence.detect(testText).length, 'detections');
console.log('Min Confidence 0.9:', highConfidence.detect(testText).length, 'detections');
console.log();

// 8. Edge Cases
console.log('8. EDGE CASES AND OVERLAPS');
console.log('-'.repeat(80));

const edgeCases = [
  'Invalid SSN: 000-12-3456 (should be filtered)',
  'Multiple emails: user1@test.com user2@test.com user3@test.com',
  'Overlapping: Call @username or email username@example.com',
];

edgeCases.forEach((text) => {
  console.log('Text:', text);
  const result = service.detectAndRedact(text);
  console.log('Redacted:', result.redactedText);
  console.log('Detections:', result.detections.length);
  console.log();
});

console.log('='.repeat(80));
console.log('Demo completed successfully!');
console.log('='.repeat(80));
