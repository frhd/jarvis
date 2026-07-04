/**
 * Contact Management Service
 *
 * Handles contact information with intelligent parsing and normalization.
 * Extracts phone numbers from various formats and stores them consistently.
 * Uses database persistence and the centralized PhoneNormalizer utility.
 */

import { createLogger } from '../utils/logger';
import type { Message, Sender } from '../types';
import { contactRepository } from '../repositories';
import type { Contact, ContactCategoryType, NewContact } from '../types';
import { PhoneNormalizer } from '../utils/phone-normalizer';

const logger = createLogger('ContactManagementService');

export interface ContactMatch {
  contact: Contact | null;
  matchScore: number;
  suggestions?: string[];
}

export interface ContactParseResult {
  success: boolean;
  contact?: Partial<Contact>;
  normalizedPhone?: string;
  error?: string;
}

/**
 * ContactManagementService
 *
 * Manages contact information with intelligent parsing and normalization.
 * Uses database for persistence instead of in-memory Map.
 */
export class ContactManagementService {
  /**
   * Normalize phone number to E.164 format
   * Uses the centralized PhoneNormalizer utility for consistency
   * Returns normalized phone number and validation info
   */
  normalizePhoneNumber(phone: string): { normalized: string; isValid: boolean; error?: string } {
    const result = PhoneNormalizer.normalize(phone, 'de');

    if (!result.isValid) {
      return {
        normalized: result.normalized,
        isValid: false,
        error: result.normalized ? 'Invalid phone number format' : 'Phone number is empty or contains no digits',
      };
    }

    return {
      normalized: result.normalized,
      isValid: true,
    };
  }

  /**
   * Parse contact information from user message
   */
  async parseContactFromMessage(text: string, sender: Sender | null): Promise<ContactParseResult> {
    // Pattern for "save X: phone" or "save contact: X"
    const savePatterns = [
      /(?:speicher(e|en|:)|save|save\s+contact)\s*(?::)?\s*([A-Za-zÄÖÜäöüß\s]+)\s*(?::|:|statt|as)\s*([+0-9\s\-\/\(\)]+)/i,
      /(?:speicher(e|en|:)|save)\s*(?::)?\s*([+0-9\s\-\/\(\)]+)\s*(?::|:|as)\s*([A-Za-zÄÖÜäöüß\s]+)/i,
    ];

    for (const pattern of savePatterns) {
      const match = text.match(pattern);
      if (match) {
        const name = match[1].trim();
        const phone = match[2].trim();
        const normalizedResult = this.normalizePhoneNumber(phone);

        if (!normalizedResult.isValid) {
          logger.warn('[ContactManagement] Invalid phone number in save request', {
            name,
            originalPhone: phone,
            error: normalizedResult.error,
            messageText: text.substring(0, 50),
          });

          return {
            success: false,
            error: `Invalid phone number: ${normalizedResult.error}`,
          };
        }

        const normalizedPhone = normalizedResult.normalized;

        logger.info('[ContactManagement] Parsed contact from message', {
          name,
          originalPhone: phone,
          normalizedPhone,
          messageText: text.substring(0, 50),
        });

        return {
          success: true,
          contact: {
            name,
            phoneNumber: normalizedPhone,
            originalInput: text.trim(),
            preferredFormat: phone,
            category: 'friend' as ContactCategoryType, // Default category
            confidence: 90, // High confidence when explicitly stated
          },
          normalizedPhone,
        };
      }
    }

    // Pattern for phone number correction (e.g., "+49 176..." instead of "+49176...")
    const correctionPatterns = [
      /(?:richtig|correct|use|statt)\s*(?::|:|as)\s*([+0-9\s]+)/i,
    ];

    for (const pattern of correctionPatterns) {
      const match = text.match(pattern);
      if (match) {
        const phone = match[1].trim();
        const normalizedResult = this.normalizePhoneNumber(phone);

        if (!normalizedResult.isValid) {
          logger.warn('[ContactManagement] Invalid phone number in correction request', {
            originalPhone: phone,
            error: normalizedResult.error,
            messageText: text.substring(0, 50),
          });

          return {
            success: false,
            error: `Invalid phone number: ${normalizedResult.error}`,
          };
        }

        const normalizedPhone = normalizedResult.normalized;

        logger.info('[ContactManagement] Phone number correction detected', {
          originalPhone: phone,
          normalizedPhone,
          messageText: text.substring(0, 50),
        });

        return {
          success: true,
          contact: {
            phoneNumber: normalizedPhone,
            originalInput: text.trim(),
            preferredFormat: phone,
            confidence: 85, // High confidence but slightly lower than save
          },
          normalizedPhone,
        };
      }
    }

    return {
      success: false,
      error: 'No contact information found in message',
    };
  }

  /**
   * Save or update a contact
   * Returns saved contact and a confirmation message
   */
  async saveContact(contact: Partial<Contact>, senderId: string): Promise<{ contact: Contact; message: string }> {
    if (!senderId) {
      throw new Error('senderId is required to save a contact');
    }

    const normalizedPhone = contact.phoneNumber!;

    // Prepare contact data for database - ensure required fields are present
    const contactData: Omit<NewContact, 'id'> = {
      senderId,
      name: contact.name || 'Unknown',
      phoneNumber: normalizedPhone,
      originalInput: contact.originalInput || '',
      preferredFormat: contact.preferredFormat || normalizedPhone,
      category: (contact.category as ContactCategoryType) || 'friend',
      confidence: contact.confidence || 50,
    };

    // Use repository to upsert (insert or update)
    const savedContact = await contactRepository.upsert(contactData);
    const isNew = !contact.id; // If no ID was provided, it's a new contact

    if (isNew) {
      logger.info('[ContactManagement] Saved new contact to database', {
        id: savedContact.id,
        name: contact.name,
        phoneNumber: normalizedPhone,
        senderId,
      });

      return {
        contact: savedContact,
        message: `Stored: ${savedContact.name} → ${normalizedPhone} (normalized from ${contact.preferredFormat || normalizedPhone})`,
      };
    }

    logger.info('[ContactManagement] Updated existing contact in database', {
      id: savedContact.id,
      name: contact.name,
      phoneNumber: normalizedPhone,
      senderId,
    });

    return {
      contact: savedContact,
      message: `Updated ${savedContact.name}: ${normalizedPhone} (from ${contact.preferredFormat || normalizedPhone})`,
    };
  }

  /**
   * Find contact by name (fuzzy search)
   * Returns match with helpful message
   * If senderId is not provided, searches globally across all contacts
   */
  async findContact(nameOrPhone: string, senderId?: string): Promise<ContactMatch & { message?: string }> {
    // First try to find by phone number (exact match) - requires senderId
    const phoneResult = this.normalizePhoneNumber(nameOrPhone);
    if (senderId && phoneResult.isValid) {
      const byPhone = await contactRepository.findByPhoneNumber(nameOrPhone, senderId);

      if (byPhone) {
        return {
          contact: byPhone,
          matchScore: 100,
          message: `Found exact match: ${byPhone.name} (${byPhone.preferredFormat})`,
        };
      }
    }

    // Try to find by name (fuzzy search)
    // Use global search if senderId is not provided, otherwise use sender-scoped search
    const result = await contactRepository.findByFuzzyNameGlobal(nameOrPhone, senderId);

    if (result.contact && result.matchScore >= 80) {
      const suggestions = result.suggestions?.map(c => `${c.name}: ${c.preferredFormat}`);
      return {
        contact: result.contact,
        matchScore: result.matchScore,
        suggestions,
        message: `Found close match (${result.matchScore}%): ${result.contact.name} (${result.contact.preferredFormat})`,
      };
    }

    const suggestions = result.suggestions?.map(c => `${c.name}: ${c.preferredFormat}`);
    return {
      contact: result.contact,
      matchScore: result.matchScore,
      suggestions,
    };
  }

  /**
   * Get all contacts for a sender
   */
  async getContactsBySender(senderId: string): Promise<Contact[]> {
    if (!senderId) {
      return [];
    }

    return contactRepository.getBySender(senderId);
  }

  /**
   * Delete a contact
   */
  async deleteContact(phoneNumber: string, senderId: string): Promise<boolean> {
    if (!senderId) {
      return false;
    }

    const deleted = await contactRepository.deleteByPhoneNumber(phoneNumber, senderId);
    if (deleted) {
      logger.info('[ContactManagement] Deleted contact from database', {
        phoneNumber,
        senderId,
      });
    }
    return deleted;
  }

  /**
   * Format phone number for display
   * Uses the PhoneNormalizer utility for consistent formatting
   */
  formatPhoneNumber(phoneNumber: string, senderId: string): string {
    if (!senderId) {
      const normalizedResult = this.normalizePhoneNumber(phoneNumber);
      return normalizedResult.normalized;
    }

    // Try to get from database
    contactRepository.findByPhoneNumber(phoneNumber, senderId).then(contact => {
      if (contact) {
        return contact.preferredFormat;
      }
    });

    // Default formatting (same as repository's normalization)
    const normalizedResult = this.normalizePhoneNumber(phoneNumber);
    const normalized = normalizedResult.normalized;
    const display = PhoneNormalizer.formatForDisplay(normalized.replace('+', ''));
    return display || normalized;
  }

  /**
   * Generate helpful message for missing contacts
   */
  generateNotFoundMessage(name: string, suggestions?: string[]): string {
    if (suggestions && suggestions.length > 0) {
      return `I couldn't find a contact for "${name}". Did you mean one of these?\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    return `I couldn't find a contact for "${name}". Would you like to save a new contact?`;
  }
}

// Export singleton instance
export const contactManagementService = new ContactManagementService();
