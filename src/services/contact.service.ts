/**
 * Contact Service
 *
 * Manages user contacts with persistence, lookup, and LLM context integration.
 * Ensures contacts are available for message generation and response handling.
 */

import { ContactRepository, ContactMatchResult } from '../repositories/contact.repository.js';
import type { Contact, NewContact, ContactCategoryType } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ContactError, ValidationError } from '../errors/index.js';

export interface ContactLookupResult {
  found: boolean;
  contact?: Contact;
  matchScore?: number;
  suggestions?: Contact[];
  errorMessage?: string;
}

export interface ContactSaveResult {
  success: boolean;
  contact?: Contact;
  error?: string;
}

export class ContactService {
  constructor(private contactRepo: ContactRepository) {}

  /**
   * Find a contact by name or phone number
   * Tries phone number first (exact match), then name search (fuzzy)
   */
  async findContact(
    query: string,
    senderId: string
  ): Promise<ContactLookupResult> {
    try {
      if (!query?.trim()) {
        throw new ValidationError('Contact query cannot be empty');
      }

      // First try phone number match (exact)
      const phoneContact = await this.contactRepo.findByPhoneNumber(query, senderId);
      if (phoneContact) {
        logger.info('[ContactService] Contact found by phone number', {
          name: phoneContact.name,
          phone: phoneContact.phoneNumber,
        });
        return {
          found: true,
          contact: phoneContact,
          matchScore: 100,
        };
      }

      // Then try name search (fuzzy)
      const nameResult = await this.contactRepo.findByFuzzyName(query, senderId);
      if (nameResult.contact) {
        logger.info('[ContactService] Contact found by name', {
          name: nameResult.contact.name,
          matchScore: nameResult.matchScore,
        });
        return {
          found: true,
          contact: nameResult.contact,
          matchScore: nameResult.matchScore,
          suggestions: nameResult.suggestions,
        };
      }

      logger.info('[ContactService] No contact found', { query, senderId });
      return {
        found: false,
        suggestions: nameResult.suggestions,
      };
    } catch (error) {
      // Re-throw ContactError and ValidationError as-is
      if (error instanceof ContactError || error instanceof ValidationError) {
        logger.warn('[ContactService] Contact lookup failed', {
          code: error.code,
          message: error.message,
          query,
          senderId,
        });
        return {
          found: false,
          errorMessage: error.message,
        };
      }

      // Wrap other errors in ContactError
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Contact lookup failed', { error: errorDetails, query, senderId });
      return {
        found: false,
        errorMessage: `Contact lookup failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Save or update a contact
   * Uses upsert semantics: updates if phone number exists, creates otherwise
   */
  async saveContact(data: {
    senderId: string;
    name: string;
    phoneNumber: string;
    category?: ContactCategoryType;
    originalInput?: string;
    preferredFormat?: string;
    confidence?: number;
  }): Promise<ContactSaveResult> {
    try {
      if (!data.name?.trim() || !data.phoneNumber?.trim()) {
        throw new ValidationError('Contact name and phone number are required');
      }

      // Validate phone number format (basic validation)
      const phoneRegex = /^[\d\s\-\+\(\)]{7,20}$/;
      if (!phoneRegex.test(data.phoneNumber.trim())) {
        throw ContactError.phoneInvalid(data.phoneNumber, 'Phone number must be 7-20 digits with optional spaces, hyphens, plus, or parentheses');
      }

      // Validate name (not empty and reasonable length)
      const trimmedName = data.name.trim();
      if (trimmedName.length < 2 || trimmedName.length > 100) {
        throw ContactError.invalidName(trimmedName, 'Name must be between 2 and 100 characters');
      }

      const newContact: Omit<NewContact, 'id'> = {
        senderId: data.senderId,
        name: trimmedName,
        phoneNumber: data.phoneNumber.trim(),
        originalInput: data.originalInput,
        preferredFormat: data.preferredFormat,
        category: data.category || 'friend',
        confidence: data.confidence ?? 50,
      };

      const saved = await this.contactRepo.upsert(newContact);

      logger.info('[ContactService] Contact saved', {
        id: saved.id,
        name: saved.name,
        phone: saved.phoneNumber,
        category: saved.category,
      });

      return {
        success: true,
        contact: saved,
      };
    } catch (error) {
      // Re-throw ContactError and ValidationError as-is
      if (error instanceof ContactError || error instanceof ValidationError) {
        logger.warn('[ContactService] Contact save failed', {
          code: error.code,
          message: error.message,
          data: { senderId: data.senderId, name: data.name },
        });
        return {
          success: false,
          error: error.message,
        };
      }

      // Wrap other errors in ContactError
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Failed to save contact', { error: errorDetails, data: { senderId: data.senderId, name: data.name } });
      return {
        success: false,
        error: `Failed to save contact: ${errorMessage}`,
      };
    }
  }

  /**
   * List all contacts for a sender
   */
  async listContacts(senderId: string): Promise<Contact[]> {
    try {
      const contacts = await this.contactRepo.getBySender(senderId);
      logger.debug('[ContactService] Listed contacts', {
        senderId,
        count: contacts.length,
      });
      return contacts;
    } catch (error) {
      // Wrap database errors in ContactError for consistent error handling
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Failed to list contacts', { error: errorDetails, senderId });
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Delete a contact by phone number
   */
  async deleteContact(phoneNumber: string, senderId: string): Promise<boolean> {
    try {
      const deleted = await this.contactRepo.deleteByPhoneNumber(phoneNumber, senderId);
      if (deleted) {
        logger.info('[ContactService] Contact deleted', { phoneNumber, senderId });
      } else {
        // Contact not found - this is expected, not an error
        logger.info('[ContactService] Contact not found for deletion', { phoneNumber, senderId });
      }
      return deleted;
    } catch (error) {
      // Re-throw ContactError as-is
      if (error instanceof ContactError) {
        logger.warn('[ContactService] Contact delete failed', {
          code: error.code,
          message: error.message,
          phoneNumber,
          senderId,
        });
        return false;
      }

      // Wrap other errors in ContactError
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Failed to delete contact', { error: errorDetails, phoneNumber, senderId });
      return false;
    }
  }

  /**
   * Update the last contacted timestamp for a contact
   */
  async updateLastContacted(contactId: string): Promise<void> {
    try {
      await this.contactRepo.updateLastContacted(contactId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Failed to update last contacted', {
        error: errorDetails,
        contactId,
      });
    }
  }

  /**
   * Build context string for LLM with all contacts
   * Format: "Contact: Name (+49 123456789) - Category: friend"
   */
  async buildContextString(senderId: string): Promise<string> {
    try {
      const contacts = await this.listContacts(senderId);

      if (contacts.length === 0) {
        return '';
      }

      const contactStrings = contacts.map(c => {
        const category = c.category || 'other';
        const phone = c.preferredFormat || c.phoneNumber;
        return `Contact: ${c.name} (${phone}) - Category: ${category}`;
      });

      return `## Saved Contacts\n${contactStrings.join('\n')}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = error instanceof Error && 'code' in error
        ? { code: (error as { code?: string }).code, sqlMessage: (error as any).sqlMessage }
        : { message: errorMessage };
      logger.error('[ContactService] Failed to build contact context', {
        error: errorDetails,
        senderId,
      });
      return '';
    }
  }

  /**
   * Format a contact query result for user-friendly display
   */
  formatLookupResult(result: ContactLookupResult, query: string): string {
    if (result.found && result.contact) {
      const phone = result.contact.preferredFormat || result.contact.phoneNumber;
      return `Found contact: ${result.contact.name} (${phone})`;
    }

    if (result.suggestions && result.suggestions.length > 0) {
      const suggestionList = result.suggestions
        .map(s => `  • ${s.name} (${s.preferredFormat || s.phoneNumber})`)
        .join('\n');
      return `No exact match for "${query}". Similar contacts:\n${suggestionList}`;
    }

    return `No contact found for "${query}". Would you like to save them?`;
  }

  /**
   * Resolve a phone number to a Telegram chat identifier
   * This is used when the LLM generates a response like "send to +49 123456789"
   * Telegram doesn't support sending to phone numbers directly, so we need to:
   * 1. Look up the phone number in contacts
   * 2. If found, inform the user that we need to Telegram username
   * 3. If not found, suggest saving the contact first
   *
   * @param phoneNumber - The phone number to resolve
   * @param senderId - The user's ID for contact lookup
   * @returns An object with resolved info and guidance message
   */
  async resolvePhoneNumberToTelegram(
    phoneNumber: string,
    senderId: string
  ): Promise<{
      resolved: boolean;
      contact?: Contact;
      guidanceMessage?: string;
    }> {
    try {
      // Normalize phone number for lookup
      const normalizedPhone = phoneNumber.replace(/[\s-()]/g, '');

      // Look up the contact by phone number
      const lookupResult = await this.findContact(normalizedPhone, senderId);

      if (lookupResult.found && lookupResult.contact) {
        return {
          resolved: true,
          contact: lookupResult.contact,
          guidanceMessage: undefined,
        };
      }

      // Contact not found
      const formattedPhone = this.formatPhoneNumber(normalizedPhone);
      return {
        resolved: false,
        guidanceMessage: `I don't have ${formattedPhone} saved as a contact. Please save the contact with their Telegram username or user ID first, then I can help you send messages.`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ContactService] Failed to resolve phone number', {
        phoneNumber,
        senderId,
        error: errorMessage,
      });

      return {
        resolved: false,
        guidanceMessage: `I had trouble looking up that phone number. Please try again or provide their Telegram username directly.`,
      };
    }
  }

  /**
   * Format phone number for display (E.164 format with spaces)
   */
  private formatPhoneNumber(phone: string): string {
    // Simple formatting for display
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('49') && cleaned.length >= 12) {
      // German format: +49 176 123456789
      return `+49 ${cleaned.slice(2, 5)} ${cleaned.slice(5, 12)}`;
    }
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }
}
