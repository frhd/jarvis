/**
 * Response Validation Service Tests
 *
 * Tests for hallucination detection and minimum response length validation.
 */

import { describe, it, expect } from 'vitest';
import { ResponseValidationService } from './responseValidation.service';

describe('ResponseValidationService', () => {
  let service: ResponseValidationService;

  beforeEach(() => {
    service = new ResponseValidationService();
  });

  describe('minimum response length', () => {
    it('should accept valid conversational responses', () => {
      const result = service.validate('Hello! How can I help you today?', { intent: 'general_chat' });
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject too short responses', () => {
      const result = service.validate('Hi', { intent: 'general_chat' });
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('too_short');
      expect(result.issues[0].severity).toBe('medium');
    });

    it('should accept acceptable one-word confirmations', () => {
      const confirmations = ['yes', 'no', 'ok', 'sure', 'thanks', 'welcome', 'bye', 'cool'];
      for (const confirmation of confirmations) {
        const result = service.validate(confirmation, { intent: 'general_chat' });
        expect(result.isValid).toBe(true);
        expect(result.issues.filter(i => i.type === 'too_short')).toHaveLength(0);
      }
    });

    it('should not check length for non-conversational intents', () => {
      const nonConversationalIntents = [
        'joke_request',
        'health_status',
        'plan',
        'task_request',
      ];

      for (const intent of nonConversationalIntents) {
        const result = service.validate('ok', { intent });
        expect(result.isValid).toBe(true);
        expect(result.issues.filter(i => i.type === 'too_short')).toHaveLength(0);
      }
    });

    it('should accept emoji-only responses', () => {
      const result = service.validate('👍', { intent: 'general_chat' });
      expect(result.isValid).toBe(true);
      expect(result.issues.filter(i => i.type === 'too_short')).toHaveLength(0);
    });

    it('should count content length excluding code blocks and links', () => {
      const result = service.validate('http://example.com', { intent: 'general_chat' });
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('too_short');
    });
  });

  describe('hallucination detection', () => {
    it('should detect fake bash commands', () => {
      const result = service.validate('```bash\necho "test"\n```\nOutput: test');
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.type === 'fake_bash_command')).toBe(true);
    });

    it('should detect fake conversations', () => {
      const result = service.validate('Claude responded with "Hello there!"');
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.type === 'fake_conversation')).toBe(true);
    });

    it('should detect fake system status', () => {
      const result = service.validate('**Memory usage** 85%');
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.type === 'fake_system_status')).toBe(true);
    });

    it('should detect fake action claims', () => {
      const result = service.validate('I have successfully fixed the issue');
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.type === 'fake_action_claim')).toBe(true);
    });
  });

  describe('combined validation', () => {
    it('should flag both hallucination and short response', () => {
      const result = service.validate('I fixed it', { intent: 'general_chat' });
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});
