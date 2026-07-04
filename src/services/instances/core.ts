/**
 * Core service instances (lazy-loaded)
 *
 * Use these getters to avoid circular dependencies and eager instantiation.
 * Services are loaded on first access and cached for subsequent calls.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import type { FilterService } from '../filter.service';
import type { MediaService } from '../media.service';
import type { TelegramService } from '../telegram.service';
import type { LLMService } from '../llm.service';
import type { MessageLengthService } from '../messageLength.service';
import type { ContactService } from '../contact.service';
import type { IdentityService } from '../identity.service';

let _filterService: FilterService | null = null;
let _mediaService: MediaService | null = null;
let _telegramService: TelegramService | null = null;
let _llmService: LLMService | null = null;
let _messageLengthService: MessageLengthService | null = null;
let _contactService: ContactService | null = null;
let _identityService: IdentityService | null = null;

export function getFilterService(): FilterService {
  if (!_filterService) {
    // Dynamic import to break circular dependencies
    const { filterService } = require('../factory/index');
    _filterService = filterService;
  }
  return _filterService!;
}

export function getMediaService(): MediaService {
  if (!_mediaService) {

    const { mediaService } = require('../factory/index');
    _mediaService = mediaService;
  }
  return _mediaService!;
}

export function getTelegramService(): TelegramService {
  if (!_telegramService) {

    const { telegramService } = require('../factory/index');
    _telegramService = telegramService;
  }
  return _telegramService!;
}

export function getLLMService(): LLMService {
  if (!_llmService) {

    const { llmService } = require('../factory/index');
    _llmService = llmService;
  }
  return _llmService!;
}

export function getMessageLengthService(): MessageLengthService {
  if (!_messageLengthService) {

    const { messageLengthService } = require('../factory/index');
    _messageLengthService = messageLengthService;
  }
  return _messageLengthService!;
}

export function getContactService(): ContactService {
  if (!_contactService) {

    const { contactService } = require('../factory/index');
    _contactService = contactService;
  }
  return _contactService!;
}

export function getIdentityService(): IdentityService {
  if (!_identityService) {

    const { identityService } = require('../factory/index');
    _identityService = identityService;
  }
  return _identityService!;
}

/**
 * Reset all core service instances (for testing)
 */
export function resetCoreServices(): void {
  _filterService = null;
  _mediaService = null;
  _telegramService = null;
  _llmService = null;
  _messageLengthService = null;
  _contactService = null;
  _identityService = null;
}
