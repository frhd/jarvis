/**
 * Command Handler Service
 *
 * Handles Telegram slash commands like /status, /health
 */

import { TelegramService } from './telegram.service';
import { healthService, type SystemHealth } from './health.service';
import { logger } from '../utils/logger';

export interface CommandHandlerConfig {
  enabled: boolean;
  ownerOnly?: boolean;
}

const DEFAULT_CONFIG: CommandHandlerConfig = {
  enabled: true,
  ownerOnly: false,
};

export class CommandHandlerService {
  private config: CommandHandlerConfig;
  private ownerTelegramId: string | undefined;

  constructor(
    private telegramService: TelegramService,
    config?: Partial<CommandHandlerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ownerTelegramId = process.env.OWNER_TELEGRAM_ID;
  }

  setOwnerTelegramId(ownerId: string): void {
    this.ownerTelegramId = ownerId;
    logger.info('[CommandHandler] Owner Telegram ID set', { ownerId });
  }

  updateConfig(updates: Partial<CommandHandlerConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[CommandHandler] Configuration updated', { config: this.config });
  }

  private isAuthorized(userId: string | number): boolean {
    if (!this.ownerTelegramId) {
      return true;
    }
    return String(userId) === this.ownerTelegramId;
  }

  /**
   * Handle incoming command messages
   * Returns true if command was handled, false otherwise
   */
  async handleCommand(
    chatId: string | number,
    senderId: string | number,
    command: string,
    args?: string
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const commandLower = command.toLowerCase().trim();

    logger.info('[CommandHandler] Received command', {
      chatId,
      senderId,
      command: commandLower,
      args,
    });

    try {
      switch (commandLower) {
        case '/status':
        case '/health':
          await this.handleHealthStatus(chatId, senderId);
          return true;

        default:
          return false;
      }
    } catch (error) {
      logger.error('[CommandHandler] Error handling command', {
        command: commandLower,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await this.telegramService.sendMessage(
        chatId,
        'Sorry, there was an error processing your command. Please try again.'
      );

      return true;
    }
  }

  /**
   * Handle /health command
   */
  private async handleHealthStatus(
    chatId: string | number,
    senderId: string | number
  ): Promise<void> {
    if (this.config.ownerOnly && !this.isAuthorized(senderId)) {
      await this.telegramService.sendMessage(
        chatId,
        'Sorry, this command is restricted to the owner only.'
      );
      return;
    }

    const health = await healthService.getSystemHealth();
    const response = this.formatHealthStatus(health);

    await this.telegramService.sendMessage(chatId, response);
    logger.info('[CommandHandler] Sent health status', {
      chatId,
      senderId,
      responseLength: response.length,
    });
  }

  private formatHealthStatus(health: SystemHealth): string {
    const lines: string[] = [];

    lines.push('🏥️ **System Health Status**');

    const statusEmoji = health.status === 'healthy' ? '✅' :
                      health.status === 'degraded' ? '⚠️' : '❌';
    lines.push(`\n${statusEmoji} Overall: ${health.status.toUpperCase()}`);

    lines.push('\n**Components:**');
    for (const component of health.components) {
      const emoji = component.status === 'healthy' ? '✅' :
                    component.status === 'degraded' ? '⚠️' : '❌';
      const name = component.name.charAt(0).toUpperCase() + component.name.slice(1);
      lines.push(`  ${emoji} ${name}: ${component.status.toUpperCase()}`);

      if (component.message) {
        lines.push(`     ${component.message}`);
      }
    }

    const timestamp = new Date(health.timestamp).toLocaleString();
    lines.push(`\n🕐 Last checked: ${timestamp}`);

    lines.push('\n---');
    lines.push('Commands:');
    lines.push('  /health - Show this health status');

    return lines.join('\n');
  }

  /**
   * Check if a message is a command
   * Returns the command and any arguments, or null if not a command
   */
  static parseCommand(text: string): { command: string; args?: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0];

    const args = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

    return { command, args };
  }
}
