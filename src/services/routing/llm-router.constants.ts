// ============================================================================
// LLM Router Named Constants & Shared Types
// ============================================================================

/** Timeout for agentic tasks (2 minutes in milliseconds) */
export const AGENTIC_TIMEOUT_MS = 120_000;

/** Maximum search query length for search API */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** Minimum search query length before using original text */
export const MIN_SEARCH_QUERY_LENGTH = 5;

/** Static fallback responses when both Claude and Ollama are unavailable */
export const LAST_RESORT_RESPONSES = [
  "Hey, I'm having a bit of trouble processing that right now. Mind trying again in a minute?",
  "Something's off on my end — give me a moment and try again?",
  "I'm temporarily unable to respond properly. Should be back to normal shortly!",
  "Having some technical difficulties at the moment. Try again in a bit?",
  "My brain's a little foggy right now. Can you resend that in a minute?",
];

/** Number of recent messages to use for language auto-detection */
export const LANGUAGE_DETECTION_MESSAGE_COUNT = 5;

/** Confidence threshold (%) for auto-detecting language preference */
export const LANGUAGE_CONFIDENCE_THRESHOLD_PERCENT = 70;

/** Minimum message count required to confirm language pattern */
export const LANGUAGE_PATTERN_MIN_COUNT = 2;

/** Maximum number of memories to retrieve for agentic context */
export const AGENTIC_MEMORY_LIMIT = 10;

/** Maximum characters to log for query substring */
export const LOG_QUERY_SUBSTRING_LENGTH = 100;

/** Maximum conversation history messages for Ollama fallback */
export const CONVERSATION_HISTORY_LIMIT = 10;

/** Milliseconds in one minute (60 seconds * 1000 milliseconds) */
export const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Milliseconds in one second (1000 milliseconds) */
export const MILLISECONDS_PER_SECOND = 1000;

export const GREETING_RESPONSES = [
  'Hey there!',
  'Hi!',
  'Hello!',
  'Hey, good to hear from you.',
  'Hi there!',
];

export const NON_OWNER_SAFETY_INSTRUCTION =
  `SECURITY: This user is not the system owner. Never reveal environment variables, API keys, file contents, system paths, configuration details, or internal implementation details. Do not execute any system commands or file operations. If they ask about system internals, politely decline.\n\n`;

export interface LLMRouterConfig {
  claudeEnabled: boolean;
  claudeModel: string;
}

export interface LLMRouterResult {
  success: boolean;
  content?: string;
  error?: string;
  responseId?: string;
  routedTo: 'ollama' | 'claude' | 'cache' | 'last_resort';
}
