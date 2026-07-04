/**
 * Command Handler Service Factory
 *
 * Creates and exports the CommandHandlerService singleton.
 */

import { CommandHandlerService } from '../commandHandler.service';
import { telegramService } from './core-services.js';
import { appConfig } from '../../config/index.js';

// Create command handler service with dependencies
export const commandHandlerService = new CommandHandlerService(
  telegramService,
  {
    enabled: true,
    ownerOnly: false, // Set to true to restrict to owner only
  }
);

// Set owner Telegram ID for access control
if (appConfig.security.ownerTelegramId) {
  commandHandlerService.setOwnerTelegramId(appConfig.security.ownerTelegramId);
}
