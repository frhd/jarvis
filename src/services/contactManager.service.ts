/**
 * Contact Manager Service
 *
 * Orchestrates contact operations including creation, updates,
 * lookup, and confirmation messages.
 */

import type { Message, Sender, Chat } from '../types/index.js';
import type { Contact, NewContact, ContactCategoryType } from '../types/index.js';
import { contactRepository, ContactMatchResult } from '../repositories/contact.repository.js';
import { phoneNormalizer } from '../utils/phone-normalizer.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

/**
 * Contact lookup result
 */
export interface ContactLookupResult {
  found: boolean;
  contact?: Contact;
  message: string;
  suggestions?: Contact[];
}

/**
 * Contact operation result
 */
export interface ContactOperationResult {
  success: boolean;
  message: string;
  contact?: Contact;
}

/**
 * Contact patterns for detecting contact-related requests
 */
const CONTACT_PATTERNS = {
  // Save/store patterns
  save: [
    /(?:save|store|speicher)(?:e|en)?\s+(?:a\s+)?(?:contact\s+)?"?([^"]+?)"?/i,
    /(?:contact\s+)?([^"]+?)\s+(?:is|has)\s+(?:number|phone|tel)/i,
    /(?:number|phone|tel)(?:\s+of\s+)?([^"]+?)(?:\s+is)/i,
  ],
  // Find/lookup patterns
  find: [
    /(?:find|lookup|search)(?:e|en)?\s+(?:contact\s+)?"?([^"]+?)"?/i,
    /(?:what'?s?|who\s+is\s+(?:the\s+)?)?([^"]+?)\s*'?s?\s*(?:number|phone|tel)/i,
    /(?:call|message|text)(?:ing)?\s+(?:to\s+)?([^?!.]+)/i,
  ],
  // Update patterns
  update: [
    /(?:update|change|correct|correct)(?:e|en)?\s+(?:contact\s+)?"?([^"]+?)"?/i,
    /(?:save|store)(?:e|en)?\s+(?:[^"]+?)\s+(?:again|new|neu)\s*(?::|with|mit)\s*/i,
  ],
} as const;

/**
 * Extract contact information from user message
 */
interface ExtractedContactInfo {
  action: 'save' | 'find' | 'update' | 'unknown';
  name?: string;
  phoneNumber?: string;
  category?: ContactCategoryType;
}

export class ContactManagerService {
  /**
   * Parse message for contact-related requests
   */
  parseContactRequest(messageText: string): ExtractedContactInfo {
    const text = messageText.trim();
    const lowerText = text.toLowerCase();

    // Check for save patterns
    for (const pattern of CONTACT_PATTERNS.save) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        // Try to extract phone number from the message
        const phoneNumber = this.extractPhoneNumber(text);
        return {
          action: 'save',
          name: match[1].trim(),
          phoneNumber,
        };
      }
    }

    // Check for find patterns
    for (const pattern of CONTACT_PATTERNS.find) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        return {
          action: 'find',
          name: match[1].trim(),
        };
      }
    }

    // Check for update patterns
    for (const pattern of CONTACT_PATTERNS.update) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        // Try to extract phone number from the message
        const phoneNumber = this.extractPhoneNumber(text);
        return {
          action: 'update',
          name: match[1].trim(),
          phoneNumber,
        };
      }
    }

    return { action: 'unknown' };
  }

  /**
   * Extract phone number from text
   */
  private extractPhoneNumber(text: string): string | undefined {
    const phoneNumbers = phoneNormalizer.extractFromText(text);
    return phoneNumbers.length > 0 ? phoneNumbers[0] : undefined;
  }

  /**
   * Save or update a contact
   */
  async saveContact(
    senderId: string,
    name: string,
    phoneNumber: string,
    category: ContactCategoryType = 'friend'
  ): Promise<ContactOperationResult> {
    try {
      logger.info('[ContactManager] Saving contact', {
        senderId,
        name,
        phoneNumber,
        category,
      });

      // Normalize phone number
      const normalizedPhone = phoneNormalizer.normalize(phoneNumber);

      if (!normalizedPhone.isValid) {
        return {
          success: false,
          message: `Invalid phone number format: ${phoneNumber}`,
        };
      }

      // Check if contact already exists
      const existing = await contactRepository.findByPhoneNumber(
        normalizedPhone.normalized,
        senderId
      );

      const contactData: Omit<NewContact, 'id'> = {
        senderId,
        name: name.trim(),
        phoneNumber: normalizedPhone.normalized,
        originalInput: phoneNumber,
        preferredFormat: normalizedPhone.display,
        category,
        confidence: 100,
      };

      let contact: Contact;

      if (existing) {
        // Update existing contact
        contact = await contactRepository.upsert({
          ...contactData,
          lastContactedAt: existing.lastContactedAt,
        });

        logger.info('[ContactManager] Updated existing contact', {
          contactId: contact.id,
          name: contact.name,
        });

        return {
          success: true,
          message: this.formatUpdateConfirmation(contact),
          contact,
        };
      } else {
        // Create new contact
        contact = await contactRepository.upsert(contactData);

        logger.info('[ContactManager] Created new contact', {
          contactId: contact.id,
          name: contact.name,
        });

        return {
          success: true,
          message: this.formatSaveConfirmation(contact),
          contact,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ContactManager] Failed to save contact', {
        senderId,
        name,
        phoneNumber,
        error: errorMessage,
      });

      return {
        success: false,
        message: `Failed to save contact: ${errorMessage}`,
      };
    }
  }

  /**
   * Find a contact by name or phone number
   */
  async findContact(
    senderId: string,
    query: string
  ): Promise<ContactLookupResult> {
    try {
      logger.debug('[ContactManager] Finding contact', {
        senderId,
        query,
      });

      // First, check if query is a phone number
      const normalizedPhone = phoneNormalizer.normalize(query);
      if (normalizedPhone.isValid) {
        const contact = await contactRepository.findByPhoneNumber(
          normalizedPhone.normalized,
          senderId
        );

        if (contact) {
          return {
            found: true,
            contact,
            message: `Found contact: ${contact.name} - ${contact.preferredFormat}`,
          };
        }

        return {
          found: false,
          message: `No contact found for phone number: ${query}`,
        };
      }

      // Try fuzzy name search
      const result = await contactRepository.findByFuzzyName(query, senderId);

      if (result.contact) {
        const confidenceMessage = result.matchScore >= 90
          ? ''
          : ` (Match confidence: ${result.matchScore}%)`;

        logger.info('[ContactManager] Found contact via fuzzy search', {
          senderId,
          query,
          contactName: result.contact.name,
          matchScore: result.matchScore,
        });

        return {
          found: true,
          contact: result.contact,
          message: `Found contact: ${result.contact.name} - ${result.contact.preferredFormat}${confidenceMessage}`,
          suggestions: result.suggestions,
        };
      }

      // No match found
      logger.debug('[ContactManager] No contact found', {
        senderId,
        query,
        bestScore: result.matchScore,
      });

      const suggestionsMessage = result.suggestions && result.suggestions.length > 0
        ? `\n\nDid you mean: ${result.suggestions.map(c => c.name).join(', ')}?`
        : '';

      return {
        found: false,
        message: `I couldn't find a contact matching "${query}".${suggestionsMessage}`,
        suggestions: result.suggestions,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ContactManager] Failed to find contact', {
        senderId,
        query,
        error: errorMessage,
      });

      return {
        found: false,
        message: `Failed to search contacts: ${errorMessage}`,
      };
    }
  }

  /**
   * Get all contacts for a sender
   */
  async getAllContacts(senderId: string): Promise<Contact[]> {
    try {
      return await contactRepository.getBySender(senderId);
    } catch (error) {
      logger.error('[ContactManager] Failed to get contacts', {
        senderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Delete a contact
   */
  async deleteContact(
    senderId: string,
    contactId: string
  ): Promise<ContactOperationResult> {
    try {
      const deleted = await contactRepository.deleteById(contactId);

      if (!deleted) {
        return {
          success: false,
          message: 'Contact not found',
        };
      }

      logger.info('[ContactManager] Deleted contact', { senderId, contactId });

      return {
        success: true,
        message: 'Contact deleted successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ContactManager] Failed to delete contact', {
        senderId,
        contactId,
        error: errorMessage,
      });

      return {
        success: false,
        message: `Failed to delete contact: ${errorMessage}`,
      };
    }
  }

  /**
   * Format save confirmation message
   */
  private formatSaveConfirmation(contact: Contact): string {
    return `Saved contact: ${contact.name} - ${contact.preferredFormat}`;
  }

  /**
   * Format update confirmation message
   */
  private formatUpdateConfirmation(contact: Contact): string {
    return `Updated ${contact.name}'s number to ${contact.preferredFormat}`;
  }
}

// Export singleton instance
export const contactManagerService = new ContactManagerService();
