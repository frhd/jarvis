/**
 * Contact Service Tests
 *
 * Tests for contact persistence, lookup, and context integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactService } from './contact.service';
import type { Contact, ContactCategoryType } from '../types/index.js';

describe('ContactService', () => {
  let contactService: ContactService;
  let mockContactRepo: any;

  beforeEach(() => {
    mockContactRepo = {
      findByPhoneNumber: vi.fn(),
      findByFuzzyName: vi.fn(),
      findByFuzzy: vi.fn(),
      upsert: vi.fn(),
      updateLastContacted: vi.fn(),
      deleteByPhoneNumber: vi.fn(),
      getBySender: vi.fn(),
    };

    contactService = new ContactService(mockContactRepo);
  });

  describe('findContact', () => {
    it('should find contact by phone number when exact match exists', async () => {
      const mockContact: Contact = {
        id: 'test-id',
        senderId: 'sender-1',
        name: 'Test Contact',
        phoneNumber: '+491761234567',
        category: 'friend' as ContactCategoryType,
        confidence: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockContactRepo.findByPhoneNumber.mockResolvedValue(mockContact);

      const result = await contactService.findContact('+491761234567', 'sender-1');

      expect(result.found).toBe(true);
      expect(result.contact).toEqual(mockContact);
      expect(result.matchScore).toBe(100);
      expect(mockContactRepo.findByPhoneNumber).toHaveBeenCalledWith('+491761234567', 'sender-1');
    });

    it('should find contact by name with fuzzy match', async () => {
      const mockContact: Contact = {
        id: 'test-id',
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '+491761234567',
        category: 'friend' as ContactCategoryType,
        confidence: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockResult = {
        contact: mockContact,
        matchScore: 80,
        suggestions: [],
      };

      mockContactRepo.findByFuzzyName.mockResolvedValue(mockResult);

      const result = await contactService.findContact('Lenn', 'sender-1');

      expect(result.found).toBe(true);
      expect(result.contact).toEqual(mockContact);
      expect(result.matchScore).toBe(80);
    });

    it('should return not found when no match exists', async () => {
      const mockResult = {
        contact: null,
        matchScore: 0,
        suggestions: [],
      };

      mockContactRepo.findByPhoneNumber.mockResolvedValue(null);
      mockContactRepo.findByFuzzyName.mockResolvedValue(mockResult);

      const result = await contactService.findContact('Unknown', 'sender-1');

      expect(result.found).toBe(false);
      expect(result.contact).toBeUndefined();
    });

    it('should return suggestions for partial name match', async () => {
      const contact1: Contact = {
        id: 'test-id-1',
        senderId: 'sender-1',
        name: 'Lennart',
        phoneNumber: '+491761234567',
        category: 'friend' as ContactCategoryType,
        confidence: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const contact2: Contact = {
        id: 'test-id-2',
        senderId: 'sender-1',
        name: 'Lenna',
        phoneNumber: '+491761234567',
        category: 'friend' as ContactCategoryType,
        confidence: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockResult = {
        contact: contact1,
        matchScore: 80,
        suggestions: [contact2],
      };

      mockContactRepo.findByFuzzyName.mockResolvedValue(mockResult);

      const result = await contactService.findContact('Lenn', 'sender-1');

      expect(result.found).toBe(true);
      expect(result.contact).toEqual(contact1);
      expect(result.suggestions).toEqual([contact2]);
    });

    it('should return error for empty query', async () => {
      const result = await contactService.findContact('', 'sender-1');

      expect(result.found).toBe(false);
      expect(result.errorMessage).toBe('Contact query cannot be empty');
    });
  });

  describe('saveContact', () => {
    it('should save new contact successfully', async () => {
      const mockContact: Contact = {
        id: 'test-id',
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '+491761234567',
        category: 'friend' as ContactCategoryType,
        confidence: 50,
        originalInput: '+49 176 123456 78',
        preferredFormat: '+49 176 123456 78',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockContactRepo.upsert.mockResolvedValue(mockContact);

      const result = await contactService.saveContact({
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '+49 176 123456 78',
        category: 'friend',
        originalInput: '+49 176 123456 78',
        preferredFormat: '+49 176 123456 78',
      });

      expect(result.success).toBe(true);
      expect(result.contact).toEqual(mockContact);
      expect(mockContactRepo.upsert).toHaveBeenCalledWith({
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '+49 176 123456 78',
        category: 'friend',
        originalInput: '+49 176 123456 78',
        preferredFormat: '+49 176 123456 78',
        confidence: 50,
      });
    });

    it('should return error for missing name', async () => {
      const result = await contactService.saveContact({
        senderId: 'sender-1',
        name: '',
        phoneNumber: '+491761234567',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Contact name and phone number are required');
    });

    it('should return error for missing phone number', async () => {
      const result = await contactService.saveContact({
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Contact name and phone number are required');
    });
  });

  describe('buildContextString', () => {
    it('should return empty string for no contacts', async () => {
      mockContactRepo.getBySender.mockResolvedValue([]);

      const result = await contactService.buildContextString('sender-1');

      expect(result).toBe('');
    });

    it('should build context string with contacts', async () => {
      const contacts = [
        {
          id: 'test-id-1',
          senderId: 'sender-1',
          name: 'Lenn',
          phoneNumber: '+49 176 123456 78',
          category: 'friend' as ContactCategoryType,
          confidence: 80,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'test-id-2',
          senderId: 'sender-1',
          name: 'Anna',
          phoneNumber: '+49 151 23456789',
          category: 'family' as ContactCategoryType,
          confidence: 80,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockContactRepo.getBySender.mockResolvedValue(contacts);

      const result = await contactService.buildContextString('sender-1');

      expect(result).toContain('Saved Contacts');
      expect(result).toContain('Lenn (+49 176 123456 78) - Category: friend');
      expect(result).toContain('Anna (+49 151 23456789) - Category: family');
    });
  });

  describe('listContacts', () => {
    it('should return all contacts for sender', async () => {
      const contacts = [
        {
          id: 'test-id-1',
          senderId: 'sender-1',
          name: 'Lenn',
          phoneNumber: '+49 176 123456 78',
          category: 'friend' as ContactCategoryType,
          confidence: 80,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockContactRepo.getBySender.mockResolvedValue(contacts);

      const result = await contactService.listContacts('sender-1');

      expect(result).toEqual(contacts);
    });

    it('should return empty array on error', async () => {
      mockContactRepo.getBySender.mockRejectedValue(new Error('Database error'));

      const result = await contactService.listContacts('sender-1');

      expect(result).toEqual([]);
    });
  });

  describe('deleteContact', () => {
    it('should delete contact successfully', async () => {
      mockContactRepo.deleteByPhoneNumber.mockResolvedValue(true);

      const result = await contactService.deleteContact('+491761234567', 'sender-1');

      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockContactRepo.deleteByPhoneNumber.mockRejectedValue(new Error('Database error'));

      const result = await contactService.deleteContact('+491761234567', 'sender-1');

      expect(result).toBe(false);
    });
  });

  describe('formatLookupResult', () => {
    it('should format found contact', () => {
      const mockContact: Contact = {
        id: 'test-id',
        senderId: 'sender-1',
        name: 'Lenn',
        phoneNumber: '+49 176 123456 78',
        category: 'friend' as ContactCategoryType,
        confidence: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result: any = { found: true, contact: mockContact };

      const formatted = contactService.formatLookupResult(result, 'Lenn');

      expect(formatted).toBe('Found contact: Lenn (+49 176 123456 78)');
    });

    it('should format no contact with suggestions', () => {
      const result: any = {
        found: false,
        suggestions: [
          {
            id: 'test-id-1',
            senderId: 'sender-1',
            name: 'Lennart',
            phoneNumber: '+49 176 123456 78',
            preferredFormat: '+49 176 123456 78',
            category: 'friend' as ContactCategoryType,
            confidence: 80,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      const formatted = contactService.formatLookupResult(result, 'Lenn');

      expect(formatted).toContain('No exact match for "Lenn"');
      expect(formatted).toContain('Similar contacts:');
    });
  });
});
