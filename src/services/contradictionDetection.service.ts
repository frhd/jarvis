/**
 * Contradiction Detection Service
 *
 * Detects and resolves contradictions in LLM responses.
 * Checks responses against known capabilities and identifies inconsistencies.
 *
 * This helps build trust by preventing the bot from making false claims
 * about its own capabilities or facts.
 */

import { createLogger } from '../utils/logger';
import { capabilityManifest, CapabilityCategory } from '../config/capabilities';

const logger = createLogger('ContradictionDetectionService');

export interface Contradiction {
  type: 'capability_claim' | 'self_knowledge' | 'factual_error';
  severity: 'low' | 'medium' | 'high';
  claim: string;
  expectedValue: string;
  detectedValue: string;
  suggestion?: string;
}

export interface ContradictionCheckResult {
  hasContradictions: boolean;
  contradictions: Contradiction[];
  sanitization?: {
    original: string;
    sanitized: string;
  };
  shouldReject: boolean;
}

/**
 * Known patterns of contradictions that Jarvis should avoid
 * Using double-quoted regex patterns to avoid escaping issues
 */
const CONTRADICTION_PATTERNS = {
  // Claims about inability to do things Jarvis can do
  cannotSendTelegram: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:send|message|telegram)(?:\s+(?:a\s+)?(?:telegram)?\s*message)?/i,
  cannotSendMessages: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:send|message)(?:\s+(?:any\s+)?messages?)/i,
  cannotUseFileOps: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:read|write|edit|create|save|file|shell|execute|run|command)(?:\s+(?:any\s+)?(?:files|commands)?)?\b/i,
  cannotSearchWeb: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:search|google|find|look\s+up)(?:\s+(?:for|current|the)?\s*(?:info|information|news|data)?)/i,
  cannotTranscribeVoice: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:transcribe|hear|understand)(?:\s+(?:voice|audio|speech)?)/i,
  cannotRemember: /\b(?:can'?t|can't|cannot|unable|not able)\s*(to\s*)?(?:remember|recall|store|save)(?:\s+(?:any|new)?\s*(?:information|details|facts|memories|preferences)?)/i,

  // Conflicting capability claims
  hasCapabilityThenClaimsNot: /\b(?:yes|i\s*do|of\s*course)\s*,?\s*i\s*can\b.*\b(?:but|however|yet|then)\s*(?:says|claims|states?)(?:\s*that)?\s*i\s*can'?t\b/i,
  saysCanThenSaysCannot: /\b(?:i\s*can\b.*\b(?:but|however|then)\s*(?:says|claims?)(?:\s*that)?\s*i\s*can'?t\b)/i,

  // Self-knowledge contradictions
  doesNotKnowWhatItCan: /\b(?:don'?t|do\s+not)\s*(?:know|remember|have|aware)\s*(?:about|of|what\s+(?:i\s*can|do)?)/i,
  doesNotKnowCapability: /\b(?:don'?t|do\s+not)\s*(?:know|remember|have)\s*(?:about|of\s+(?:if\s+)?(?:i\s*can|have))\s*to\s+do\b/i,
} as const;

/**
 * Capability mappings for correction suggestions
 */
const CAPABILITY_CORRECTIONS = {
  cannotSendTelegram: 'You CAN send Telegram messages to contacts.',
  cannotSendMessages: 'You CAN send Telegram messages.',
  cannotUseFileOps: 'You CAN read/write files and execute shell commands.',
  cannotSearchWeb: 'You CAN search the web for current information.',
  cannotTranscribeVoice: 'You CAN transcribe voice messages.',
  cannotRemember: 'You CAN remember information and access memories.',
} satisfies Record<string, string>;

/**
 * ContradictionDetectionService
 *
 * Detects contradictions in LLM responses and provides resolutions.
 */
export class ContradictionDetectionService {
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /**
   * Enable or disable contradiction detection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check a response for contradictions
   *
   * @param response - The LLM response to check
   * @returns Contradiction check result with detected issues and suggestions
   */
  checkResponse(response: string): ContradictionCheckResult {
    if (!this.enabled) {
      return {
        hasContradictions: false,
        contradictions: [],
        shouldReject: false,
      };
    }

    const contradictions: Contradiction[] = [];

    // Check for known negative capability claims
    this.checkNegativeCapabilityClaims(response, contradictions);

    // Check for self-knowledge contradictions
    this.checkSelfKnowledgeContradictions(response, contradictions);

    return {
      hasContradictions: contradictions.length > 0,
      contradictions,
      shouldReject: contradictions.some(c => c.severity === 'high'),
    };
  }

  /**
   * Check for negative claims about capabilities
   */
  private checkNegativeCapabilityClaims(response: string, contradictions: Contradiction[]): void {
    // Check each pattern
    for (const [patternName, pattern] of Object.entries(CONTRADICTION_PATTERNS)) {
      if (pattern.test(response)) {
        const correction = CAPABILITY_CORRECTIONS[patternName as keyof typeof CAPABILITY_CORRECTIONS];
        if (correction) {
          contradictions.push({
            type: 'capability_claim',
            severity: 'high',
            claim: 'Claims inability to do something Jarvis can do',
            expectedValue: 'Jarvis CAN do this',
            detectedValue: 'Jarvis CANNOT do this',
            suggestion: correction,
          });
        }
      }
    }
  }

  /**
   * Check for self-knowledge contradictions
   */
  private checkSelfKnowledgeContradictions(response: string, contradictions: Contradiction[]): void {
    // Check for "I don't know what I can do" patterns
    if (CONTRADICTION_PATTERNS.doesNotKnowWhatItCan.test(response)) {
      const capabilities = capabilityManifest.getEnabledCapabilities()
        .filter(c => c.category === CapabilityCategory.MESSAGING || c.category === CapabilityCategory.FILE_OPS)
        .map(c => c.description)
        .join(', ');

      if (capabilities.length > 0) {
        contradictions.push({
          type: 'self_knowledge',
          severity: 'medium',
          claim: 'Does not know own capabilities',
          expectedValue: 'Knows capabilities',
          detectedValue: 'Claims ignorance of capabilities',
          suggestion: `You have these capabilities: ${capabilities.substring(0, 100)}...`,
        });
      }
    }

    // Check for "I don't know if I can do X" patterns
    if (CONTRADICTION_PATTERNS.doesNotKnowCapability.test(response)) {
      contradictions.push({
        type: 'self_knowledge',
        severity: 'medium',
        claim: 'Uncertain about capability',
        expectedValue: 'Knows capability status',
        detectedValue: 'Claims uncertainty',
        suggestion: 'You should check your capabilities before stating whether you can do something.',
      });
    }
  }

  /**
   * Sanitize response by removing or correcting contradictions
   *
   * @param response - Original response
   * @param contradictions - Detected contradictions
   * @returns Sanitized response
   */
  sanitizeResponse(response: string, contradictions: Contradiction[]): string {
    let sanitized = response;

    for (const contradiction of contradictions) {
      if (contradiction.severity === 'high' && contradiction.suggestion) {
        // Apply correction (simple replacement)
        if (CONTRADICTION_PATTERNS.cannotSendTelegram instanceof RegExp) {
          sanitized = sanitized.replace(CONTRADICTION_PATTERNS.cannotSendTelegram, contradiction.suggestion);
        }
        if (CONTRADICTION_PATTERNS.cannotSendMessages instanceof RegExp) {
          sanitized = sanitized.replace(CONTRADICTION_PATTERNS.cannotSendMessages, contradiction.suggestion);
        }
        if (CONTRADICTION_PATTERNS.cannotUseFileOps instanceof RegExp) {
          sanitized = sanitized.replace(CONTRADICTION_PATTERNS.cannotUseFileOps, contradiction.suggestion);
        }
      }
    }

    return sanitized;
  }

  /**
   * Get capabilities summary for inclusion in context
   *
   * @returns Summary of enabled capabilities
   */
  getCapabilitiesSummary(): string {
    const capabilities = capabilityManifest.getEnabledCapabilities();

    if (capabilities.length === 0) {
      return 'No capabilities enabled.';
    }

    const grouped = new Map<CapabilityCategory, string[]>();
    for (const cap of capabilities) {
      if (!grouped.has(cap.category)) {
        grouped.set(cap.category, []);
      }
      grouped.get(cap.category)!.push(cap.description);
    }

    // Build summary
    const parts: string[] = [];
    for (const [category, descriptions] of grouped.entries()) {
      if (descriptions.length > 0) {
        parts.push(`\n${category.toUpperCase()}:\n- ${descriptions.join('\n- ')}`);
      }
    }

    return parts.join('');
  }

  /**
   * Check if response contradicts a previous statement
   *
   * @param currentResponse - Current response
   * @param previousResponses - Previous responses for comparison
   * @returns Contradiction if found
   */
  checkAgainstHistory(
    currentResponse: string,
    previousResponses: string[]
  ): Contradiction | null {
    const lowerCurrent = currentResponse.toLowerCase();
    for (const prev of previousResponses.slice(-5)) { // Check last 5 responses
      const lowerPrev = prev.toLowerCase();

      // Check for direct contradictions
      if (lowerCurrent.includes("can't") && lowerPrev.includes("can ")) {
        // Current says "can't", previous said "can"
        const subject = this.extractSubject(lowerPrev);
        if (subject) {
          return {
            type: 'self_knowledge',
            severity: 'medium',
            claim: `Previously said "can ${subject}"`,
            expectedValue: 'Consistent with previous claim',
            detectedValue: `Now says "can't ${subject}"`,
          };
        }
      }

      if (lowerPrev.includes("can't") && lowerCurrent.includes("can ")) {
        // Previous said "can't", current says "can"
        const subject = this.extractSubject(lowerCurrent);
        if (subject) {
          return {
            type: 'self_knowledge',
            severity: 'medium',
            claim: `Previously said "can't ${subject}"`,
            expectedValue: 'Consistent with previous claim',
            detectedValue: `Now says "can ${subject}"`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract the subject/object from a "can/can't" statement
   */
  private extractSubject(text: string): string | null {
    // Pattern: "can send messages" -> "send messages"
    const canPattern = /\bcan\s+(?:to\s+)?([a-z\s]+(?:\s+(?:to|for|with)\s+[a-z\s]+)*)?\b/i;
    const canMatch = text.match(canPattern);
    if (canMatch && canMatch[1]) {
      return canMatch[1].trim();
    }

    const cannotPattern = /\bcan'?t\s+(?:to\s+)?([a-z\s]+(?:\s+(?:to|for|with)\s+[a-z\s]+)*)?\b/i;
    const cannotMatch = text.match(cannotPattern);
    if (cannotMatch && cannotMatch[1]) {
      return cannotMatch[1].trim();
    }

    return null;
  }

  /**
   * Check if response mentions SMS (which Jarvis cannot do)
   */
  checkForSmsMention(response: string): boolean {
    const smsPatterns = [
      /\bsms\b/i,
      /\btext\s+message\b/i,
      /\bsend\s+an?\s*sms\b/i,
      /\bsend\s+text\s+to\b/i,
    ];

    for (const pattern of smsPatterns) {
      if (pattern.test(response) && !response.includes("cannot") && !response.includes("can't")) {
        // Response mentions SMS without saying it cannot do it
        logger.warn('[ContradictionDetection] Potential SMS claim without denial', {
          response: response.substring(0, 100),
        });
        return true;
      }
    }

    return false;
  }
}

// Export singleton instance
export const contradictionDetectionService = new ContradictionDetectionService();
