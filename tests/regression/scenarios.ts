/**
 * Regression Test Scenarios
 *
 * 20 curated test scenarios covering critical paths:
 * - 4 greeting scenarios
 * - 5 question scenarios
 * - 4 command scenarios
 * - 4 multi-turn scenarios
 * - 3 edge case scenarios
 */

import type { RegressionScenario, ScenarioCategory } from './types.js';

// ============================================================================
// Greeting Scenarios (4)
// ============================================================================

const greetingScenarios: RegressionScenario[] = [
  {
    id: 'greeting-simple',
    category: 'greetings',
    name: 'Simple Greeting',
    description: 'Basic greeting with hi/hello',
    turns: [
      {
        role: 'user',
        text: 'hi',
        expectedIntent: 'simple_greeting',
        // Note: No expectedRoute - cacheable intents may return from cache or ollama
      },
    ],
    tags: ['critical', 'fast', 'cacheable'],
  },
  {
    id: 'greeting-time-based',
    category: 'greetings',
    name: 'Time-Based Greeting',
    description: 'Greeting with time of day reference',
    turns: [
      {
        role: 'user',
        text: 'good morning',
        expectedIntent: 'time_greeting',
        // Note: No expectedRoute - cacheable intents may return from cache or ollama
      },
    ],
    tags: ['critical', 'fast', 'cacheable'],
  },
  {
    id: 'greeting-farewell',
    category: 'greetings',
    name: 'Farewell',
    description: 'Goodbye/farewell message',
    turns: [
      {
        role: 'user',
        text: 'bye, talk to you later!',
        expectedIntent: 'farewell',
        // Note: No expectedRoute - cacheable intents may return from cache or ollama
      },
    ],
    tags: ['critical', 'fast', 'cacheable'],
  },
  {
    id: 'greeting-gratitude',
    category: 'greetings',
    name: 'Gratitude',
    description: 'Thank you message',
    turns: [
      {
        role: 'user',
        text: 'thanks so much!',
        expectedIntent: 'gratitude',
        // Note: No expectedRoute - cacheable intents may return from cache or ollama
      },
    ],
    tags: ['critical', 'fast', 'cacheable'],
  },
];

// ============================================================================
// Question Scenarios (5)
// ============================================================================

const questionScenarios: RegressionScenario[] = [
  {
    id: 'question-factual',
    category: 'questions',
    name: 'Factual Question',
    description: 'Simple factual question about world knowledge',
    turns: [
      {
        role: 'user',
        text: 'What is the capital of France?',
        expectedIntent: 'factual_question',
        // Note: No expectedRoute - may be cached or LLM
      },
    ],
    tags: ['critical', 'knowledge'],
  },
  {
    id: 'question-how-to',
    category: 'questions',
    name: 'How-To Question',
    description: 'Question about how to do something',
    turns: [
      {
        role: 'user',
        text: 'How do I install Node.js on my Mac?',
        expectedIntent: 'how_to_question',
        // Note: No expectedRoute - routing depends on complexity scoring
      },
    ],
    tags: ['critical', 'knowledge'],
  },
  {
    id: 'question-opinion',
    category: 'questions',
    name: 'Opinion Question',
    description: 'Question asking for opinion or recommendation',
    turns: [
      {
        role: 'user',
        text: 'Should I learn React or Vue first?',
        expectedIntent: 'opinion_question',
        // Note: No expectedRoute - routing depends on complexity scoring
      },
    ],
    tags: ['opinion', 'knowledge'],
  },
  {
    id: 'question-web-search',
    category: 'questions',
    name: 'Web Search Question',
    description: 'Question that requires current/real-time information',
    turns: [
      {
        role: 'user',
        text: "What's the weather like in Berlin today?",
        expectedIntent: 'web_search_question',
      },
    ],
    tags: ['web-search', 'realtime'],
  },
  {
    id: 'question-personal',
    category: 'questions',
    name: 'Personal Question',
    description: 'Question about the assistant itself',
    turns: [
      {
        role: 'user',
        text: "What's your name?",
        expectedIntent: 'personal_question',
        // Note: No expectedRoute - cacheable intents may return from cache or ollama
      },
    ],
    tags: ['personal', 'cacheable'],
  },
];

// ============================================================================
// Command Scenarios (4)
// ============================================================================

const commandScenarios: RegressionScenario[] = [
  {
    id: 'command-task-request',
    category: 'commands',
    name: 'Task Request',
    description: 'Request to perform a coding task',
    turns: [
      {
        role: 'user',
        text: 'Write a JavaScript function to sort an array of numbers',
        expectedIntent: 'task_request',
      },
    ],
    maxLatencyMs: 15000,
    tags: ['critical', 'coding', 'slow'],
  },
  {
    id: 'command-translation',
    category: 'commands',
    name: 'Translation',
    description: 'Request to translate text',
    turns: [
      {
        role: 'user',
        text: 'Translate "hello, how are you?" to Spanish',
        expectedIntent: 'translation',
        // Note: No expectedRoute - routing depends on complexity scoring
      },
    ],
    tags: ['translation'],
  },
  {
    id: 'command-summarization',
    category: 'commands',
    name: 'Summarization',
    description: 'Request to summarize text',
    turns: [
      {
        role: 'user',
        text: 'tldr: The quick brown fox jumps over the lazy dog. This sentence is a famous pangram that contains every letter of the English alphabet at least once. Pangrams are often used for testing typewriters, computer keyboards, and fonts. The phrase has been used since at least the late 19th century.',
        expectedIntent: 'summarization',
        // Note: No expectedRoute - routing depends on complexity scoring
      },
    ],
    tags: ['summarization'],
  },
  {
    id: 'command-calculation',
    category: 'commands',
    name: 'Calculation',
    description: 'Request to perform a calculation',
    turns: [
      {
        role: 'user',
        text: 'what is 5 + 5?',
        // Note: No strict intent/route expectations - simple math may be cached or classified differently
      },
    ],
    tags: ['calculation', 'fast'],
  },
];

// ============================================================================
// Multi-Turn Scenarios (4)
// ============================================================================

const multiTurnScenarios: RegressionScenario[] = [
  {
    id: 'multi-turn-name-recall',
    category: 'multi_turn',
    name: 'Name Recall',
    description: 'User provides name, then asks bot to recall it',
    turns: [
      {
        role: 'user',
        text: 'Hi! My name is Alex.',
        // First turn: greeting with name
      },
      {
        role: 'user',
        text: "What's my name?",
        // Note: Focus on quality of response (does it recall the name?) rather than intent classification
        minQualityScore: 7,
      },
    ],
    tags: ['critical', 'context', 'memory'],
  },
  {
    id: 'multi-turn-context-continuity',
    category: 'multi_turn',
    name: 'Context Continuity',
    description: 'Ask about a topic, then request more details',
    turns: [
      {
        role: 'user',
        text: 'What is TypeScript?',
        expectedIntent: 'factual_question',
      },
      {
        role: 'user',
        text: 'Tell me more about its type system',
        // Note: Intent classification varies - focus on quality of contextual response
        minQualityScore: 7,
      },
    ],
    tags: ['critical', 'context'],
  },
  {
    id: 'multi-turn-follow-up',
    category: 'multi_turn',
    name: 'Follow-Up Question',
    description: 'Get an answer then ask why',
    turns: [
      {
        role: 'user',
        text: 'Is Python good for beginners?',
        // Note: Intent classification varies
      },
      {
        role: 'user',
        text: 'Why do you think so?',
        // Note: Focus on quality of follow-up response
        minQualityScore: 7,
      },
    ],
    tags: ['context'],
  },
  {
    id: 'multi-turn-topic-reference',
    category: 'multi_turn',
    name: 'Topic Reference',
    description: 'Reference something from earlier in conversation',
    turns: [
      {
        role: 'user',
        text: 'I really enjoy hiking in the mountains',
        expectedIntent: 'personal_sharing',
      },
      {
        role: 'user',
        text: "That's a great point. Going back to what I said earlier about my hobby, what gear would you recommend?",
        // Note: Focus on quality of contextual response
        minQualityScore: 6,
      },
    ],
    tags: ['context', 'memory'],
  },
];

// ============================================================================
// Edge Case Scenarios (3)
// ============================================================================

const edgeCaseScenarios: RegressionScenario[] = [
  {
    id: 'edge-empty-input',
    category: 'edge_cases',
    name: 'Empty/Minimal Input',
    description: 'Handle empty or minimal input gracefully (system should not crash)',
    turns: [
      {
        role: 'user',
        text: '',
        // Note: Low threshold - testing robustness, not quality
        minQualityScore: 2,
      },
    ],
    tags: ['edge-case', 'robustness'],
  },
  {
    id: 'edge-ambiguous-input',
    category: 'edge_cases',
    name: 'Ambiguous Input',
    description: 'Handle ambiguous acknowledgment/thanks (system should not crash)',
    turns: [
      {
        role: 'user',
        text: 'ok thanks',
        // Note: Low threshold - testing robustness, not quality
        minQualityScore: 2,
      },
    ],
    tags: ['edge-case', 'ambiguous'],
  },
  {
    id: 'edge-unclear-input',
    category: 'edge_cases',
    name: 'Unclear Input',
    description: 'Handle unclear/confused input (system should not crash)',
    turns: [
      {
        role: 'user',
        text: '???',
        // Note: Low threshold - testing robustness, not quality
        minQualityScore: 2,
      },
    ],
    tags: ['edge-case', 'robustness'],
  },
];

// ============================================================================
// All Scenarios Combined
// ============================================================================

const allScenarios: RegressionScenario[] = [
  ...greetingScenarios,
  ...questionScenarios,
  ...commandScenarios,
  ...multiTurnScenarios,
  ...edgeCaseScenarios,
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all regression test scenarios
 */
export function getAllScenarios(): RegressionScenario[] {
  return allScenarios;
}

/**
 * Get scenarios filtered by category
 */
export function getScenariosByCategory(
  category: ScenarioCategory
): RegressionScenario[] {
  return allScenarios.filter((s) => s.category === category);
}

/**
 * Get scenarios filtered by tag
 */
export function getScenariosByTag(tag: string): RegressionScenario[] {
  return allScenarios.filter((s) => s.tags.includes(tag));
}

/**
 * Get scenarios filtered by multiple tags (must have all)
 */
export function getScenariosByTags(tags: string[]): RegressionScenario[] {
  return allScenarios.filter((s) => tags.every((tag) => s.tags.includes(tag)));
}

/**
 * Get a single scenario by ID
 */
export function getScenarioById(id: string): RegressionScenario | undefined {
  return allScenarios.find((s) => s.id === id);
}

// Export individual arrays for direct access if needed
export {
  greetingScenarios,
  questionScenarios,
  commandScenarios,
  multiTurnScenarios,
  edgeCaseScenarios,
};
