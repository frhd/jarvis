/**
 * Contact Repository
 *
 * Manages contact information with phone number normalization,
 * name search, and CRUD operations.
 */

import { eq, and, like, or, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type { Contact, NewContact, ContactCategoryType } from '../types/index.js';
import { calculateCombinedSimilarity, normalizeName } from '../utils/fuzzy-matcher.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ContactRepository');

export interface ContactMatchResult {
  contact: Contact | null;
  matchScore: number;
  suggestions?: Contact[];
}

export class ContactRepository extends BaseRepository<
  Contact,
  NewContact,
  typeof contacts
> {
  protected table = contacts;

  /**
   * Find a contact by phone number (exact match)
   */
  async findByPhoneNumber(phoneNumber: string, senderId: string): Promise<Contact | null> {
    // Normalize phone number to E.164 format
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const result = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          eq(this.table.phoneNumber, normalized)
        )
      )
      .limit(1);

    return (result[0] as Contact) ?? null;
  }

  /**
   * Find contacts by name (case-insensitive partial match)
   */
  async findByName(name: string, senderId: string): Promise<Contact[]> {
    const normalizedName = name.toLowerCase().trim();

    const results = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          like(this.table.name, `%${normalizedName}%`)
        )
      )
      .orderBy(desc(this.table.updatedAt))
      .limit(10);

    return results as Contact[];
  }

  /**
   * Find a contact by name (fuzzy search)
   * Uses improved Levenshtein distance matching
   */
  async findByFuzzyName(name: string, senderId: string): Promise<ContactMatchResult> {
    const normalizedName = normalizeName(name);

    logger.debug('[ContactRepository] Starting fuzzy name search', {
      name,
      normalizedName,
      senderId,
    });

    // Try exact match first (case-insensitive)
    const exactMatches = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          like(this.table.name, `${normalizedName}`)
        )
      )
      .orderBy(desc(this.table.updatedAt))
      .limit(1);

    const exactResult = exactMatches[0] as Contact | undefined;
    if (exactResult) {
      logger.debug('[ContactRepository] Found exact match', {
        contactName: exactResult.name,
        phoneNumber: exactResult.preferredFormat,
      });
      return {
        contact: exactResult,
        matchScore: 100,
      };
    }

    // Get all contacts for this sender to perform in-memory fuzzy matching
    const allContacts = await this.getBySender(senderId);

    if (allContacts.length === 0) {
      logger.debug('[ContactRepository] No contacts found for sender', { senderId });
      return {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };
    }

    // Calculate similarity scores for all contacts
    const scoredContacts = allContacts.map(contact => {
      const score = calculateCombinedSimilarity(normalizedName, contact.name, {
        weights: {
          levenshtein: 0.5,
          phonetic: 0.3,
          prefix: 0.2,
        },
      });
      return {
        contact,
        score,
        normalized: normalizeName(contact.name),
      };
    });

    // Sort by score (descending)
    scoredContacts.sort((a, b) => b.score - a.score);

    // Filter by minimum score (60% or higher)
    const minScore = 60;
    const goodMatches = scoredContacts.filter(sc => sc.score >= minScore);

    if (goodMatches.length === 0) {
      logger.debug('[ContactRepository] No good matches found', {
        name,
        bestScore: scoredContacts[0]?.score,
        minScore,
        totalContacts: allContacts.length,
      });
      return {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };
    }

    const bestMatch = goodMatches[0];
    logger.info('[ContactRepository] Found fuzzy match', {
      originalName: bestMatch.contact.name,
      normalizedQuery: normalizedName,
      score: bestMatch.score,
      phoneNumber: bestMatch.contact.preferredFormat,
      matchScore: minScore,
    });

    // Return best match with suggestions (up to 3)
    const suggestions = goodMatches.slice(1, 4).map(sc => sc.contact);

    return {
      contact: bestMatch.contact,
      matchScore: bestMatch.score,
      suggestions,
    };
  }

  /**
   * Get all contacts for a sender
   */
  async getBySender(senderId: string): Promise<Contact[]> {
    const results = await db
      .select()
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .orderBy(desc(this.table.updatedAt));

    return results as Contact[];
  }

  /**
   * Get contacts by category for a sender
   */
  async getByCategory(senderId: string, category: ContactCategoryType): Promise<Contact[]> {
    const results = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          eq(this.table.category, category)
        )
      )
      .orderBy(desc(this.table.updatedAt));

    return results as Contact[];
  }

  /**
   * Update or upsert a contact
   * If a contact with the same phone number exists, it's updated
   * Otherwise, a new contact is created
   */
  async upsert(data: Omit<NewContact, 'id'>): Promise<Contact> {
    const normalizedPhone = this.normalizePhoneNumber(data.phoneNumber);
    const now = new Date();

    // Check if contact exists
    const existing = await this.findByPhoneNumber(normalizedPhone, data.senderId);

    if (existing) {
      // Update existing contact
      const updated = await db
        .update(this.table)
        .set({
          name: data.name,
          phoneNumber: normalizedPhone,
          originalInput: data.originalInput,
          preferredFormat: data.preferredFormat,
          category: data.category,
          confidence: data.confidence,
          updatedAt: now,
          lastContactedAt: data.lastContactedAt ?? existing.lastContactedAt,
        })
        .where(eq(this.table.id, existing.id))
        .returning();

      return updated[0] as Contact;
    }

    // Create new contact
    const id = this.generateId();
    const inserted = await db
      .insert(this.table)
      .values({
        id,
        senderId: data.senderId,
        name: data.name,
        phoneNumber: normalizedPhone,
        originalInput: data.originalInput,
        preferredFormat: data.preferredFormat,
        category: data.category,
        confidence: data.confidence,
        lastContactedAt: data.lastContactedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return inserted[0] as Contact;
  }

  /**
   * Update the last contacted timestamp for a contact
   */
  async updateLastContacted(contactId: string): Promise<void> {
    await db
      .update(this.table)
      .set({ lastContactedAt: new Date() })
      .where(eq(this.table.id, contactId));
  }

  /**
   * Delete a contact by ID
   */
  async deleteById(contactId: string): Promise<boolean> {
    const result = await db
      .delete(this.table)
      .where(eq(this.table.id, contactId));

    return result.changes > 0;
  }

  /**
   * Delete a contact by phone number for a sender
   */
  async deleteByPhoneNumber(phoneNumber: string, senderId: string): Promise<boolean> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const result = await db
      .delete(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          eq(this.table.phoneNumber, normalized)
        )
      );

    return result.changes > 0;
  }

  /**
   * Find contacts globally by name (fuzzy search across all senders)
   * Used for cross-user contact lookup
   */
  async findByNameGlobal(name: string): Promise<ContactMatchResult> {
    const normalizedName = name.toLowerCase().trim();

    // Try exact match first
    const exactMatches = await db
      .select()
      .from(this.table)
      .where(like(this.table.name, `%${normalizedName}%`))
      .orderBy(desc(this.table.updatedAt))
      .limit(10);

    const matches = exactMatches as Contact[];

    if (matches.length === 0) {
      return {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };
    }

    // Return best match (most recently updated)
    return {
      contact: matches[0],
      matchScore: 80,
      suggestions: matches.slice(1, 4), // Up to 3 suggestions
    };
  }

  /**
   * Find a contact by name (global fuzzy search)
   * Searches across all senders when senderId is not provided
   * Uses improved Levenshtein distance matching
   */
  async findByFuzzyNameGlobal(name: string, senderId?: string): Promise<ContactMatchResult> {
    const normalizedName = normalizeName(name);

    logger.debug('[ContactRepository] Starting global fuzzy name search', {
      name,
      normalizedName,
      senderId: senderId || 'global',
    });

    // If senderId is provided, use sender-scoped search
    if (senderId) {
      return this.findByFuzzyName(name, senderId);
    }

    // Get all contacts for global search
    const allContacts = await db
      .select()
      .from(this.table)
      .orderBy(desc(this.table.updatedAt))
      .limit(100); // Limit to 100 for performance

    const contacts = allContacts as Contact[];

    if (contacts.length === 0) {
      return {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };
    }

    // Calculate similarity scores for all contacts
    const scoredContacts = contacts.map(contact => {
      const score = calculateCombinedSimilarity(normalizedName, contact.name, {
        weights: {
          levenshtein: 0.5,
          phonetic: 0.3,
          prefix: 0.2,
        },
      });
      return {
        contact,
        score,
        normalized: normalizeName(contact.name),
      };
    });

    // Sort by score (descending)
    scoredContacts.sort((a, b) => b.score - a.score);

    // Filter by minimum score (60% or higher)
    const minScore = 60;
    const goodMatches = scoredContacts.filter(sc => sc.score >= minScore);

    if (goodMatches.length === 0) {
      logger.debug('[ContactRepository] No good global matches found', {
        name,
        bestScore: scoredContacts[0]?.score,
        minScore,
      });
      return {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };
    }

    const bestMatch = goodMatches[0];
    logger.debug('[ContactRepository] Found global fuzzy match', {
      originalName: bestMatch.contact.name,
      normalizedQuery: normalizedName,
      score: bestMatch.score,
      phoneNumber: bestMatch.contact.preferredFormat,
    });

    // Return best match with suggestions (up to 3)
    const suggestions = goodMatches.slice(1, 4).map(sc => sc.contact);

    return {
      contact: bestMatch.contact,
      matchScore: bestMatch.score,
      suggestions,
    };
  }

  /**
   * Normalize phone number to E.164 format
   * Removes spaces, dashes, parentheses, etc.
   * Handles various formats: +49 176 12345678, 017612345678, 4917612345678
   */
  private normalizePhoneNumber(phone: string): string {
    // Step 1: Remove all formatting characters (spaces, dashes, parentheses)
    let normalized = phone.replace(/[\s-()]/g, '');

    // Step 2: Handle leading '+' - remove it temporarily for processing
    const hasLeadingPlus = normalized.startsWith('+');
    if (hasLeadingPlus) {
      normalized = normalized.substring(1);
    }

    // Step 3: Handle German local numbers (starting with 0)
    if (normalized.startsWith('0') && !normalized.startsWith('00')) {
      // Remove leading 0 and add 49 (Germany country code)
      normalized = '49' + normalized.substring(1);
    }
    // Step 4: Handle international format without + (e.g., 4917612345678)
    else if (normalized.startsWith('49') && !hasLeadingPlus) {
      // Already in E.164 format (just missing +)
      // Keep as is
    }
    // Step 5: Handle 00 prefix (international format)
    else if (normalized.startsWith('00')) {
      normalized = normalized.substring(2);
    }

    // Step 6: Add back the + prefix
    return '+' + normalized;
  }
}

// Singleton instance
export const contactRepository = new ContactRepository();
