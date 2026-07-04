/**
 * Deduplication Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeduplicationService } from './deduplication.service';

describe('DeduplicationService', () => {
  let service: DeduplicationService;

  beforeEach(() => {
    service = new DeduplicationService({
      windowMs: 1000, // Short window for testing
      enabled: true,
      notifyOnDuplicate: false,
    });
  });

  describe('isDuplicate', () => {
    it('should return false for new messages', () => {
      const result = service.isDuplicate({
        text: 'Hello world',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.notify).toBeUndefined();
    });

    it('should return true for duplicate messages within window', async () => {
      const params = {
        text: 'Hello world',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      // First check - should not be duplicate
      const result1 = service.isDuplicate(params);
      expect(result1.isDuplicate).toBe(false);

      // Immediate second check - should be duplicate
      const result2 = service.isDuplicate(params);
      expect(result2.isDuplicate).toBe(true);
    });

    it('should return false for same message outside window', async () => {
      const params = {
        text: 'Hello world',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      const result1 = service.isDuplicate(params);
      expect(result1.isDuplicate).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result2 = service.isDuplicate(params);
      expect(result2.isDuplicate).toBe(false);
    });

    it('should return false for messages in different chats', () => {
      const text = 'Hello world';

      const result1 = service.isDuplicate({
        text,
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      });

      const result2 = service.isDuplicate({
        text,
        senderId: 'sender1',
        chatId: 'chat2',
        mediaType: null,
      });

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });

    it('should return false for messages from different senders', () => {
      const text = 'Hello world';

      const result1 = service.isDuplicate({
        text,
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      });

      const result2 = service.isDuplicate({
        text,
        senderId: 'sender2',
        chatId: 'chat1',
        mediaType: null,
      });

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });

    it('should skip deduplication for voice messages', () => {
      const params = {
        text: 'Voice message content',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: 'voice',
      };

      const result1 = service.isDuplicate(params);
      const result2 = service.isDuplicate(params);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });

    it('should normalize text for comparison', () => {
      const params = {
        text: '  HELLO  world!  ',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      const result1 = service.isDuplicate(params);

      const params2 = {
        text: 'hello world',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      const result2 = service.isDuplicate(params2);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(true);
    });

    it('should return notify message when duplicate detected', () => {
      const notifyMsg = 'I heard you the first time!';
      const serviceWithNotify = new DeduplicationService({
        windowMs: 1000,
        enabled: true,
        notifyOnDuplicate: true,
        notifyMessage: notifyMsg,
      });

      const params = {
        text: 'Hello',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      serviceWithNotify.isDuplicate(params);
      const result = serviceWithNotify.isDuplicate(params);

      expect(result.isDuplicate).toBe(true);
      expect(result.notify).toBe(notifyMsg);
    });

    it('should return false for empty text', () => {
      const result = service.isDuplicate({
        text: null,
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      });

      expect(result.isDuplicate).toBe(false);
    });

    it('should return false when service is disabled', () => {
      const disabledService = new DeduplicationService({
        windowMs: 1000,
        enabled: false,
        notifyOnDuplicate: false,
      });

      const params = {
        text: 'Hello',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      const result1 = disabledService.isDuplicate(params);
      const result2 = disabledService.isDuplicate(params);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should track total messages processed', () => {
      service.isDuplicate({
        text: 'Test 1',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      });

      const stats = service.getStats();
      expect(stats.total).toBe(1);
    });

    it('should track duplicates detected', () => {
      const params = {
        text: 'Test',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      service.isDuplicate(params);
      service.isDuplicate(params);

      const stats = service.getStats();
      expect(stats.duplicates).toBe(1);
    });

    it('should calculate duplicate rate correctly', () => {
      const params = {
        text: 'Test',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      service.isDuplicate(params);
      service.isDuplicate(params);

      const stats = service.getStats();
      expect(stats.total).toBe(2);
      expect(stats.duplicates).toBe(1);
      expect(stats.duplicateRate).toBe(50);
    });
  });

  describe('clear', () => {
    it('should clear all cached entries', () => {
      const params = {
        text: 'Test',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      service.isDuplicate(params);
      const stats1 = service.getStats();
      expect(stats1.cacheSize).toBeGreaterThan(0);

      service.clear();
      const stats2 = service.getStats();
      expect(stats2.cacheSize).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const newNotifyMsg = 'Updated message';

      service.updateConfig({
        notifyOnDuplicate: true,
        notifyMessage: newNotifyMsg,
      });

      const params = {
        text: 'Test',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      service.isDuplicate(params);
      const result = service.isDuplicate(params);

      expect(result.notify).toBe(newNotifyMsg);
    });

    it('should enable/disable service via config', () => {
      service.updateConfig({ enabled: false });

      const params = {
        text: 'Test',
        senderId: 'sender1',
        chatId: 'chat1',
        mediaType: null,
      };

      const result1 = service.isDuplicate(params);
      const result2 = service.isDuplicate(params);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });
  });
});
