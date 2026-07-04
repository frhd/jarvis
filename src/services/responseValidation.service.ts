/**
 * Response Validation Service
 *
 * Detects and handles hallucinated responses from LLMs, particularly:
 * - Fabricated bash/shell commands
 * - Fake conversations with other systems
 * - Made-up system status reports
 * - Claims of performing actions the LLM cannot do
 */

import { logger } from '../utils/logger.js';

export interface ValidationResult {
  isValid: boolean;
  issues: HallucinationIssue[];
  sanitizedContent?: string;
  shouldReject: boolean;
}

export interface HallucinationIssue {
  type: HallucinationType;
  description: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}

export type HallucinationType =
  | 'fake_bash_command'
  | 'fake_conversation'
  | 'fake_system_status'
  | 'fake_action_claim'
  | 'fake_file_operation'
  | 'fake_api_call'
  | 'too_short';

/**
 * Patterns that indicate hallucinated content
 */
const HALLUCINATION_PATTERNS = {
  // Fake bash command execution
  fake_bash_command: [
    /```bash\s*\n[^`]+```\s*\n+(?:(?:output|result|done|success|completed)[:\s])/i,
    /(?:ran|executed|running)\s*:\s*```/i,
    /(?:here's what i did|i ran|i executed)[:\s]*\n*```(?:bash|sh|shell)?/i,
    /\$\s*\w+.*\n.*(?:output|result):/i,
  ],

  // Fake conversations with other systems
  fake_conversation: [
    /claude\s+(?:responded|replied|said|answered)[:\s]/i,
    /(?:gpt|chatgpt|openai)\s+(?:responded|replied|said|answered)[:\s]/i,
    /(?:message|talking)\s+to\s+(?:claude|gpt|ai)[:\s]/i,
    /(?:asked|told|messaged)\s+(?:claude|gpt)\s+(?:to|about|and)/i,
    /"hey\s+(?:claude|gpt).*"\s*\n+.*(?:responded|replied)/is,
  ],

  // Fake system status reports with specific numbers
  fake_system_status: [
    /\*\*(?:memory|cpu|disk)\s*(?:usage|utilization)\*\*[:\s]*\d+%/i,
    /(?:current|peak)\s*(?:memory|cpu)[:\s]*\d+%/i,
    /memory[:\s]+\d+(?:\.\d+)?(?:gb|mb|%)/i,
    /(?:system|service)\s+(?:is\s+)?(?:now\s+)?(?:stable|running|working)/i,
  ],

  // Fake action claims
  fake_action_claim: [
    /(?:i've|i have)\s+(?:fixed|updated|modified|changed|cleared|deleted|created|committed|pushed)/i,
    /(?:successfully|done)[:\s]*(?:fixed|updated|modified|changed|cleared|deleted|created)/i,
    /the\s+(?:fix|update|change|modification)\s+(?:is|has been)\s+(?:applied|completed|done)/i,
    /(?:changes|updates)\s+(?:have been|were)\s+(?:made|applied|committed|pushed)/i,
  ],

  // Fake file operations
  fake_file_operation: [
    /(?:created|updated|modified|deleted)\s+(?:the\s+)?(?:file|config|database)[:\s]/i,
    /(?:wrote|saved)\s+(?:to|the)\s+(?:file|config)/i,
    /(?:file|config)\s+(?:has been|was)\s+(?:updated|modified|created|deleted)/i,
  ],

  // Fake API calls
  fake_api_call: [
    /(?:called|hit|fetched)\s+(?:the\s+)?(?:api|endpoint|url)/i,
    /(?:api|endpoint)\s+(?:returned|responded)[:\s]/i,
    /curl\s+.*\s*\n+.*(?:output|response|result)[:\s]/i,
  ],

  // Minimum response length issue (checked separately, not via regex)
  too_short: [],
};

/**
 * Severity levels for different hallucination types
 */
const SEVERITY_MAP: Record<HallucinationType, 'low' | 'medium' | 'high'> = {
  fake_bash_command: 'high',
  fake_conversation: 'high',
  fake_system_status: 'medium',
  fake_action_claim: 'high',
  fake_file_operation: 'high',
  fake_api_call: 'medium',
  too_short: 'medium',
};

/**
 * Minimum response length in characters for conversational responses
 * Exceptions: One-word confirmations (yes, no, ok, thanks, etc.)
 */
const MIN_RESPONSE_LENGTH = 15;

/**
 * Patterns that match acceptable one-word or short responses
 */
const ACCEPTABLE_SHORT_RESPONSES = [
  /^(yes|no|ok|okay|sure|alright|got it|gotcha|right|correct|wrong|thanks|thank you|welcome|bye|goodbye|see you|later|cool|awesome|great|perfect|nice|good|bad|maybe|perhaps|possibly|probably|likely|unlikely)\b$/i,
  /^(yep|yeah|yup|nope|nah|sure thing|sounds good|all good|no problem|no worries|not a problem|you're welcome|glad to help|happy to help|anytime)\b$/i,
  /^(ok\.|sure\.|yes\.)$/i,
  /^[✅❌👍👎🤝💪😊😄👋]+$/, // Emoji-only responses
];

export class ResponseValidationService {
  /**
   * Validate an LLM response for hallucinated content and quality issues
   */
  validate(response: string, context?: { model?: string; intent?: string }): ValidationResult {
    const issues: HallucinationIssue[] = [];

    // Check minimum response length for conversational responses
    if (this.isConversationalIntent(context?.intent)) {
      const lengthIssue = this.checkMinimumLength(response);
      if (lengthIssue) {
        issues.push(lengthIssue);
      }
    }

    // Check each hallucination pattern type
    for (const [type, patterns] of Object.entries(HALLUCINATION_PATTERNS)) {
      for (const pattern of patterns) {
        const match = response.match(pattern);
        if (match) {
          issues.push({
            type: type as HallucinationType,
            description: this.getDescription(type as HallucinationType),
            evidence: match[0].substring(0, 100),
            severity: SEVERITY_MAP[type as HallucinationType],
          });
          break; // Only report once per type
        }
      }
    }

    // Log issues if found
    if (issues.length > 0) {
      logger.warn('[ResponseValidation] Validation issues detected', {
        issueCount: issues.length,
        types: issues.map(i => i.type),
        model: context?.model,
        intent: context?.intent,
        responseLength: response.length,
      });
    }

    // Determine if we should reject the response
    const highSeverityCount = issues.filter(i => i.severity === 'high').length;
    const shouldReject = highSeverityCount >= 2 || issues.length >= 3;

    return {
      isValid: issues.length === 0,
      issues,
      shouldReject,
      sanitizedContent: shouldReject ? this.sanitizeResponse(response, issues) : undefined,
    };
  }

  /**
   * Check if intent is conversational (greeting, general chat, etc.)
   * These should meet minimum length requirements
   */
  private isConversationalIntent(intent?: string): boolean {
    if (!intent) return true; // Default to conversational for unknown intents

    const nonConversationalIntents = [
      'joke_request',
      'health_status',
      'web_search_question',
      'search_request',
      'plan',
      'task_request',
    ];

    return !nonConversationalIntents.includes(intent);
  }

  /**
   * Check if response meets minimum length requirements
   * Returns null if valid, or a HallucinationIssue if too short
   */
  private checkMinimumLength(response: string): HallucinationIssue | null {
    const trimmed = response.trim();

    // Check if it's an acceptable short response
    for (const pattern of ACCEPTABLE_SHORT_RESPONSES) {
      if (pattern.test(trimmed)) {
        return null; // Acceptable short response
      }
    }

    // Check length (excluding markdown code blocks and links)
    const codeBlockFree = trimmed.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
    const linkFree = codeBlockFree.replace(/https?:\/\/\S+/g, '');
    const contentLength = linkFree.trim().length;

    if (contentLength < MIN_RESPONSE_LENGTH) {
      logger.debug('[ResponseValidation] Response too short', {
        originalLength: trimmed.length,
        contentLength,
        threshold: MIN_RESPONSE_LENGTH,
      });
      return {
        type: 'too_short',
        description: `Response is too short (${contentLength} < ${MIN_RESPONSE_LENGTH} chars)`,
        evidence: trimmed.substring(0, 50),
        severity: 'medium',
      };
    }

    return null;
  }

  /**
   * Get human-readable description for hallucination type
   */
  private getDescription(type: HallucinationType): string {
    const descriptions: Record<HallucinationType, string> = {
      fake_bash_command: 'Claims to have executed a bash/shell command',
      fake_conversation: 'Claims to have had a conversation with another AI system',
      fake_system_status: 'Reports specific system status numbers that may be fabricated',
      fake_action_claim: 'Claims to have performed an action it cannot do',
      fake_file_operation: 'Claims to have created/modified/deleted files',
      fake_api_call: 'Claims to have made API calls',
      too_short: 'Response is too short and doesn\'t add value',
    };
    return descriptions[type];
  }

  /**
   * Sanitize a response by adding a disclaimer or modifying content
   */
  private sanitizeResponse(response: string, issues: HallucinationIssue[]): string {
    const issueTypes = issues.map(i => i.type).join(', ');

    // For too short responses, add an elaboration request instead of rejection
    if (issues.some(i => i.type === 'too_short') && issues.length === 1) {
      return response; // Let it through - the issue will be logged but not rejected
    }

    // Add a disclaimer prefix
    const disclaimer = `⚠️ Note: I cannot actually perform system operations. `;

    // For responses that claim actions, add context
    if (issues.some(i => i.type === 'fake_action_claim' || i.type === 'fake_bash_command')) {
      return `${disclaimer}I can only describe what *would* need to be done:\n\n${response}`;
    }

    // For fake conversations
    if (issues.some(i => i.type === 'fake_conversation')) {
      return `${disclaimer}I cannot communicate with other AI systems. Here's what I know:\n\n${this.removeFakeConversations(response)}`;
    }

    return `${disclaimer}\n\n${response}`;
  }

  /**
   * Remove fake conversation sections from response
   */
  private removeFakeConversations(response: string): string {
    // Remove quoted "conversations" with other AIs
    let cleaned = response
      .replace(/["']hey\s+(?:claude|gpt).*?["']\s*\n+.*?(?:responded|replied).*?["'].*?["']/gis, '')
      .replace(/claude\s+(?:responded|replied|said)[:\s].*?(?:\n\n|\n(?=[A-Z]))/gis, '')
      .replace(/(?:gpt|chatgpt)\s+(?:responded|replied|said)[:\s].*?(?:\n\n|\n(?=[A-Z]))/gis, '');

    return cleaned.trim();
  }

  /**
   * Quick check if response likely contains hallucinations
   * Faster than full validation, useful for screening
   */
  quickCheck(response: string): boolean {
    // Quick patterns that are strong indicators
    const quickPatterns = [
      /(?:i've|i have)\s+(?:fixed|updated|modified|cleared|deleted|created|committed)/i,
      /claude\s+(?:responded|replied|said)/i,
      /```bash\s*\n.*\n```\s*\n+(?:output|result|done)/i,
      /\*\*memory\s*usage\*\*[:\s]*\d+%/i,
    ];

    return quickPatterns.some(p => p.test(response));
  }
}
