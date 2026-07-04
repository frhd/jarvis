/**
 * Comprehensive Intent Classification Test Dataset
 * Phase 2.4: Testing & Validation
 *
 * This dataset contains 100+ test cases covering all 25 child intents
 * with edge cases, ambiguous messages, and real-world examples.
 */

import { ParentIntent, ChildIntent } from '../../src/types/intent.types';

export interface IntentTestCase {
  input: string;
  expectedParentIntent: ParentIntent;
  expectedChildIntent: ChildIntent;
  notes?: string;
}

export const intentTestDataset: IntentTestCase[] = [
  // ============================================================================
  // GREETING INTENTS (4 child intents)
  // simple_greeting, time_greeting, farewell, gratitude
  // ============================================================================

  // simple_greeting (13 cases)
  {
    input: 'hi',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'hello',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'hey',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'yo',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'sup',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'howdy',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'hola',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'greetings',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: "what's up",
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'whats up?',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
  },
  {
    input: 'Hi!',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
    notes: 'Capitalization variation',
  },
  {
    input: 'HELLO!!!',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
    notes: 'All caps with multiple punctuation',
  },
  {
    input: 'hey there',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'simple_greeting',
    notes: 'Greeting with additional words - may need LLM',
  },

  // time_greeting (4 cases)
  {
    input: 'good morning',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'time_greeting',
  },
  {
    input: 'good afternoon',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'time_greeting',
  },
  {
    input: 'good evening',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'time_greeting',
  },
  {
    input: 'good night',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'time_greeting',
  },

  // farewell (8 cases)
  {
    input: 'bye',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'goodbye',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'see ya',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'later',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'cya',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'peace',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'take care',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },
  {
    input: 'talk to you later',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'farewell',
  },

  // gratitude (5 cases)
  {
    input: 'thanks',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
  },
  {
    input: 'thank you',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
  },
  {
    input: 'thx',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
  },
  {
    input: 'ty',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
  },
  {
    input: 'appreciate it',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
  },

  // ============================================================================
  // QUESTION INTENTS (6 child intents)
  // factual_question, how_to_question, opinion_question, clarification,
  // web_search_question, personal_question
  // ============================================================================

  // factual_question (8 cases)
  {
    input: 'What is the capital of France?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'Who invented the light bulb?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'When did World War II end?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'What is photosynthesis?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'Where is Mount Everest located?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'How many planets are in the solar system?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'What does HTTP stand for?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },
  {
    input: 'What is the speed of light?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
  },

  // how_to_question (7 cases)
  {
    input: 'How do I install Node.js?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How can I learn Python?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How do I deploy a web application?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How can I improve my productivity?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How do I fix a memory leak in my code?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How to bake a chocolate cake?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },
  {
    input: 'How can I become a better programmer?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'how_to_question',
  },

  // opinion_question (6 cases)
  {
    input: 'What do you think about artificial intelligence?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },
  {
    input: 'Should I learn React or Vue?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },
  {
    input: 'Is it worth investing in cryptocurrency?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },
  {
    input: 'What is your opinion on remote work?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },
  {
    input: 'Do you prefer TypeScript or JavaScript?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },
  {
    input: 'Which framework is better for backend development?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'opinion_question',
  },

  // clarification (5 cases)
  {
    input: 'what do you mean?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Requires conversation context',
  },
  {
    input: 'can you explain?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Requires conversation context',
  },
  {
    input: "i don't understand",
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Requires conversation context',
  },
  {
    input: 'huh?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Requires conversation context',
  },
  {
    input: 'what???',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Multiple question marks indicate confusion',
  },

  // web_search_question (8 cases)
  {
    input: 'What is the weather in Tokyo?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: 'What is the current Bitcoin price?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: 'Who won the latest NBA game?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: 'What time is it in New York?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: "What's the latest news about SpaceX?",
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: 'What is the temperature forecast for tomorrow?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: 'What are the recent stock prices for Tesla?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },
  {
    input: "What's the current weather forecast for London?",
    expectedParentIntent: 'question',
    expectedChildIntent: 'web_search_question',
  },

  // personal_question (4 cases)
  {
    input: "What's your name?",
    expectedParentIntent: 'question',
    expectedChildIntent: 'personal_question',
  },
  {
    input: 'Who are you?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'personal_question',
  },
  {
    input: 'What can you do?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'personal_question',
  },
  {
    input: 'Are you a robot?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'personal_question',
  },

  // ============================================================================
  // COMMAND INTENTS (7 child intents)
  // task_request, search_request, reminder_request, calculation, translation,
  // summarization, correction
  // ============================================================================

  // task_request (7 cases)
  {
    input: 'Write a function to sort an array',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Create a REST API for user authentication',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Build a responsive navbar component',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Generate a Python script to parse CSV files',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Implement a binary search algorithm',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Design a database schema for an e-commerce site',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },
  {
    input: 'Refactor this code to use async/await',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
  },

  // search_request (5 cases)
  {
    input: 'search for best restaurants in Tokyo',
    expectedParentIntent: 'command',
    expectedChildIntent: 'search_request',
  },
  {
    input: 'google Python tutorials for beginners',
    expectedParentIntent: 'command',
    expectedChildIntent: 'search_request',
  },
  {
    input: 'look up TypeScript documentation',
    expectedParentIntent: 'command',
    expectedChildIntent: 'search_request',
  },
  {
    input: 'find me articles about machine learning',
    expectedParentIntent: 'command',
    expectedChildIntent: 'search_request',
  },
  {
    input: 'Search for affordable hotels in Paris',
    expectedParentIntent: 'command',
    expectedChildIntent: 'search_request',
  },

  // reminder_request (4 cases)
  {
    input: 'Remind me to call mom tomorrow',
    expectedParentIntent: 'command',
    expectedChildIntent: 'reminder_request',
  },
  {
    input: 'Set a reminder for my dentist appointment',
    expectedParentIntent: 'command',
    expectedChildIntent: 'reminder_request',
  },
  {
    input: 'remind me to buy groceries at 5pm',
    expectedParentIntent: 'command',
    expectedChildIntent: 'reminder_request',
  },
  {
    input: 'Set an alarm for 7am',
    expectedParentIntent: 'command',
    expectedChildIntent: 'reminder_request',
  },

  // calculation (6 cases)
  {
    input: 'what is 5 + 5',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },
  {
    input: 'calculate 125 * 8',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },
  {
    input: '15 - 7',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },
  {
    input: 'what is 100 / 4',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },
  {
    input: 'compute 2^8',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },
  {
    input: 'what is (15 + 25) * 2',
    expectedParentIntent: 'command',
    expectedChildIntent: 'calculation',
  },

  // translation (5 cases)
  {
    input: 'translate hello to Spanish',
    expectedParentIntent: 'command',
    expectedChildIntent: 'translation',
  },
  {
    input: 'Translate "good morning" to French',
    expectedParentIntent: 'command',
    expectedChildIntent: 'translation',
  },
  {
    input: "How do you say 'thank you' in Japanese",
    expectedParentIntent: 'command',
    expectedChildIntent: 'translation',
  },
  {
    input: "what's 'water' in German",
    expectedParentIntent: 'command',
    expectedChildIntent: 'translation',
  },
  {
    input: 'Translate this sentence into Italian',
    expectedParentIntent: 'command',
    expectedChildIntent: 'translation',
  },

  // summarization (5 cases)
  {
    input: 'summarize this article',
    expectedParentIntent: 'command',
    expectedChildIntent: 'summarization',
  },
  {
    input: 'tldr',
    expectedParentIntent: 'command',
    expectedChildIntent: 'summarization',
  },
  {
    input: 'give me a summary of the meeting notes',
    expectedParentIntent: 'command',
    expectedChildIntent: 'summarization',
  },
  {
    input: 'sum up the key points',
    expectedParentIntent: 'command',
    expectedChildIntent: 'summarization',
  },
  {
    input: 'tl;dr',
    expectedParentIntent: 'command',
    expectedChildIntent: 'summarization',
  },

  // correction (4 cases)
  {
    input: 'no, I meant the other one',
    expectedParentIntent: 'command',
    expectedChildIntent: 'correction',
  },
  {
    input: 'fix that typo',
    expectedParentIntent: 'command',
    expectedChildIntent: 'correction',
  },
  {
    input: 'actually, change it to blue',
    expectedParentIntent: 'command',
    expectedChildIntent: 'correction',
  },
  {
    input: 'wait, not that - I want the other option',
    expectedParentIntent: 'command',
    expectedChildIntent: 'correction',
  },

  // ============================================================================
  // FEEDBACK INTENTS (4 child intents)
  // positive_feedback, negative_feedback, acknowledgment, opinion_statement
  // ============================================================================

  // positive_feedback (7 cases)
  {
    input: 'great!',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: 'perfect',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: 'awesome',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: 'excellent work',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: 'nice job',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: "that's exactly what I needed",
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },
  {
    input: "that's right!",
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'positive_feedback',
  },

  // negative_feedback (6 cases)
  {
    input: 'no',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },
  {
    input: 'wrong',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },
  {
    input: 'incorrect',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },
  {
    input: "that's not right",
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },
  {
    input: 'not what I wanted',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },
  {
    input: "that's not it",
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
  },

  // acknowledgment (9 cases)
  {
    input: 'ok',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'okay',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'k',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'got it',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'understood',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'alright',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'sure',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'yeah',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },
  {
    input: 'sounds good',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'acknowledgment',
  },

  // opinion_statement (4 cases)
  {
    input: 'I think TypeScript is better than JavaScript',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'opinion_statement',
  },
  {
    input: 'In my opinion, remote work is the future',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'opinion_statement',
  },
  {
    input: 'I believe AI will change everything',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'opinion_statement',
  },
  {
    input: 'Python is my favorite programming language',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'opinion_statement',
  },

  // ============================================================================
  // CONTINUATION INTENTS (4 child intents)
  // follow_up, elaboration_request, topic_change, reference_previous
  // ============================================================================

  // follow_up (5 cases)
  {
    input: 'and what about performance?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Continuation marker "and"',
  },
  {
    input: 'also, how does caching work?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Continuation marker "also"',
  },
  {
    input: 'so what happens next?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Follow-up marker "so"',
  },
  {
    input: 'but what if it fails?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Follow-up marker "but"',
  },
  {
    input: 'then how do we proceed?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Follow-up marker "then"',
  },

  // elaboration_request (5 cases)
  {
    input: 'tell me more',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'elaboration_request',
  },
  {
    input: 'go on',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'elaboration_request',
  },
  {
    input: 'continue',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'elaboration_request',
  },
  {
    input: 'more details please',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'elaboration_request',
  },
  {
    input: 'what else?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'elaboration_request',
  },

  // topic_change (3 cases)
  {
    input: "anyway, let's talk about something else",
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'topic_change',
  },
  {
    input: 'by the way, I wanted to ask about React',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'topic_change',
  },
  {
    input: 'speaking of which, how is the weather today?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'topic_change',
  },

  // reference_previous (4 cases)
  {
    input: 'about what you said earlier',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'reference_previous',
    notes: 'Explicit reference to previous conversation',
  },
  {
    input: 'going back to the previous topic',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'reference_previous',
  },
  {
    input: 'as you mentioned before',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'reference_previous',
  },
  {
    input: 'regarding your last message',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'reference_previous',
  },

  // ============================================================================
  // EDGE CASES & AMBIGUOUS MESSAGES
  // ============================================================================

  {
    input: '',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
    notes: 'Empty message - fallback behavior',
  },
  {
    input: '???',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Only punctuation - confusion signal',
  },
  {
    input: 'ok thanks',
    expectedParentIntent: 'greeting',
    expectedChildIntent: 'gratitude',
    notes: 'Ambiguous: could be acknowledgment or gratitude',
  },
  {
    input: 'no thanks',
    expectedParentIntent: 'feedback',
    expectedChildIntent: 'negative_feedback',
    notes: 'Polite decline',
  },
  {
    input: 'help me',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
    notes: 'Generic request for assistance',
  },
  {
    input: 'I need help with my code',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
    notes: 'Specific help request',
  },
  {
    input: 'why?',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'clarification',
    notes: 'Single word question seeking explanation',
  },
  {
    input: 'because',
    expectedParentIntent: 'continuation',
    expectedChildIntent: 'follow_up',
    notes: 'Incomplete response, continuation of conversation',
  },
  {
    input: 'What is AI and how does it work?',
    expectedParentIntent: 'question',
    expectedChildIntent: 'factual_question',
    notes: 'Compound question - factual definition',
  },
  {
    input: 'Can you help me with Python?',
    expectedParentIntent: 'command',
    expectedChildIntent: 'task_request',
    notes: 'Polite request for help',
  },
];

// Group test cases by parent intent for analysis
export const testCasesByParentIntent = {
  greeting: intentTestDataset.filter((tc) => tc.expectedParentIntent === 'greeting'),
  question: intentTestDataset.filter((tc) => tc.expectedParentIntent === 'question'),
  command: intentTestDataset.filter((tc) => tc.expectedParentIntent === 'command'),
  feedback: intentTestDataset.filter((tc) => tc.expectedParentIntent === 'feedback'),
  continuation: intentTestDataset.filter((tc) => tc.expectedParentIntent === 'continuation'),
};

// Group test cases by child intent for detailed analysis
export const testCasesByChildIntent = intentTestDataset.reduce(
  (acc, tc) => {
    if (!acc[tc.expectedChildIntent]) {
      acc[tc.expectedChildIntent] = [];
    }
    acc[tc.expectedChildIntent].push(tc);
    return acc;
  },
  {} as Record<ChildIntent, IntentTestCase[]>
);

// Statistics
export const datasetStats = {
  total: intentTestDataset.length,
  byParentIntent: {
    greeting: testCasesByParentIntent.greeting.length,
    question: testCasesByParentIntent.question.length,
    command: testCasesByParentIntent.command.length,
    feedback: testCasesByParentIntent.feedback.length,
    continuation: testCasesByParentIntent.continuation.length,
  },
  byChildIntent: Object.fromEntries(
    Object.entries(testCasesByChildIntent).map(([intent, cases]) => [intent, cases.length])
  ),
};
