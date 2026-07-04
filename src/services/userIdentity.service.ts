/**
 * User Identity Service
 *
 * Handles user-provided identity information (name, preferences)
 * to ensure continuity across conversations and sessions.
 *
 * Extracts identity cues from messages like:
 * - "I am [name]"
 * - "My name is [name]"
 * - "Call me [name]"
 * - "I'm [name]"
 */

import { SenderRepository } from '../repositories/sender.repository';
import { logger } from '../utils/logger';

export interface IdentityExtractionResult {
  extractedName: string | null;
  confidence: number;
}

export class UserIdentityService {
  constructor(private senderRepo: SenderRepository) {}

  /**
   * Extract user-provided name from message text
   * Uses patterns to detect when user introduces themselves
   */
  extractIdentity(message: string): IdentityExtractionResult {
    if (!message || message.trim().length === 0) {
      return { extractedName: null, confidence: 0 };
    }

    const lowerMessage = message.toLowerCase().trim();

    // Patterns for self-identification (ordered by specificity)
    const patterns = [
      // "my name is [name]" - high confidence
      {
        regex: /(?:my name is|i am|i'm|i'm called|call me)\s+([a-zA-Z\u00C0-\u00FF\s\-']{2,30})/i,
        confidence: 0.9,
        groupIndex: 1,
      },
      // "[name] speaking" or similar - medium confidence
      {
        regex: /(?:this is|it's|its)\s+([a-zA-Z\u00C0-\u00FF\s\-']{2,30})(?:\s+speaking)?/i,
        confidence: 0.7,
        groupIndex: 1,
      },
      // Simple name introduction patterns
      {
        regex: /^(?:i'm|i am|i\s+just\s+)?([a-zA-Z\u00C0-\u00FF]{2,20})\s+(?:here|speaking|reporting|checking in)/i,
        confidence: 0.6,
        groupIndex: 1,
      },
    ];

    for (const pattern of patterns) {
      const match = lowerMessage.match(pattern.regex);
      if (match && match[pattern.groupIndex]) {
        const name = match[pattern.groupIndex].trim();
        // Validate name doesn't look like common words
        if (this.isValidName(name)) {
          logger.info('[UserIdentity] Extracted name from message', {
            name,
            confidence: pattern.confidence,
            pattern: pattern.regex.source,
          });
          return {
            extractedName: name,
            confidence: pattern.confidence,
          };
        }
      }
    }

    return { extractedName: null, confidence: 0 };
  }

  /**
   * Validate that extracted text looks like a real name
   * Filters out common words, greetings, etc.
   */
  private isValidName(name: string): boolean {
    const lowerName = name.toLowerCase();

    // Words that are definitely not names
    const invalidPatterns = [
      /^(?:hi|hello|hey|greetings|ok|yes|no|thanks|please|sorry|oops|oops|error|test|test|message|user|admin|owner)$/i,
      /^(?:the|a|an|this|that|these|those)$/i,
      /^(?:good|bad|great|awesome|cool|nice|fine)$/i,
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(lowerName)) {
        return false;
      }
    }

    // Should have at least one vowel (basic check for non-random text)
    if (!/[aeiou]/i.test(name) && name.length > 2) {
      return false;
    }

    return true;
  }

  /**
   * Update user identity with extracted name
   * Only updates if confidence is high enough and name is different
   */
  async updateIdentityFromMessage(
    senderId: string,
    message: string
  ): Promise<{ updated: boolean; name?: string }> {
    const result = this.extractIdentity(message);

    if (!result.extractedName || result.confidence < 0.7) {
      return { updated: false };
    }

    const sender = await this.senderRepo.findById(senderId);
    if (!sender) {
      return { updated: false };
    }

    // Check if name is different from current displayName
    if (sender.displayName && sender.displayName.toLowerCase() === result.extractedName.toLowerCase()) {
      logger.debug('[UserIdentity] Name unchanged, skipping update', {
        senderId,
        name: result.extractedName,
      });
      return { updated: false };
    }

    // Update displayName
    const updated = await this.senderRepo.updateDisplayName(
      senderId,
      result.extractedName
    );

    if (updated) {
      logger.info('[UserIdentity] Updated user identity', {
        senderId,
        oldName: sender.displayName || '(none)',
        newName: result.extractedName,
        confidence: result.confidence,
      });
      return { updated: true, name: result.extractedName };
    }

    return { updated: false };
  }

  /**
   * Get user's display name (prioritizes displayName, then firstName)
   */
  getDisplayAddressing(sender: { displayName?: string | null; firstName?: string | null; lastName?: string | null }): string {
    if (sender.displayName) {
      return sender.displayName;
    }
    if (sender.firstName) {
      return sender.lastName ? `${sender.firstName} ${sender.lastName}`.trim() : sender.firstName;
    }
    return 'friend';
  }

  /**
   * Build identity context for LLM system prompt
   * Includes user name and any relevant identity information
   */
  async buildIdentityContext(senderId: string): Promise<string> {
    const sender = await this.senderRepo.findById(senderId);
    if (!sender) {
      return '';
    }

    const parts: string[] = [];

    if (sender.displayName) {
      parts.push(`User identifies as: ${sender.displayName}`);
    } else if (sender.firstName) {
      const fullName = sender.lastName ? `${sender.firstName} ${sender.lastName}` : sender.firstName;
      parts.push(`User's name from Telegram: ${fullName}`);
    }

    if (sender.username) {
      parts.push(`Telegram username: @${sender.username}`);
    }

    return parts.length > 0 ? `## User Identity\n${parts.join('\n')}\n` : '';
  }
}

// Singleton instance
export const userIdentityService = new UserIdentityService(
  // Will be set via setter during initialization
  null as unknown as SenderRepository
);
