import { TelegramClient, Api } from 'telegram';
import { logger } from '../../utils/logger';

/**
 * Presence and read-receipt helpers. These operate directly on the Telegram
 * client and are all non-fatal: a failure is logged and swallowed so callers
 * can continue without the indicator.
 */

export async function setTyping(client: TelegramClient, chatId: string | number): Promise<void> {
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: chatId,
        action: new Api.SendMessageTypingAction(),
      })
    );
  } catch (error) {
    logger.warn('[Telegram] Failed to set typing indicator', { chatId });
    // Non-fatal, continue without typing indicator
  }
}

/**
 * Mark messages as read in a chat (shows ✓✓ to sender)
 * Use this to acknowledge receipt before processing
 */
export async function markAsRead(
  client: TelegramClient,
  chatId: string | number,
  maxId: number
): Promise<void> {
  try {
    await client.invoke(
      new Api.messages.ReadHistory({
        peer: chatId,
        maxId: maxId,
      })
    );
    logger.debug('[Telegram] Marked messages as read', { chatId, maxId });
  } catch (error) {
    logger.warn('[Telegram] Failed to mark as read', { chatId });
    // Non-fatal, continue without read receipt
  }
}

/**
 * Explicitly set online/offline status
 * Note: This is user-wide, not per-chat
 */
export async function setOnlineStatus(client: TelegramClient, online: boolean = true): Promise<void> {
  try {
    await client.invoke(
      new Api.account.UpdateStatus({
        offline: !online,
      })
    );
    logger.debug('[Telegram] Updated online status', { online });
  } catch (error) {
    logger.warn('[Telegram] Failed to update online status');
    // Non-fatal, continue without status update
  }
}
