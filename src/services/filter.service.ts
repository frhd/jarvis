import { ChatFilterRepository } from '../repositories/chatFilter.repository';
import { FilterCheckResult, FilterType } from '../types';

export class FilterService {
  constructor(private chatFilterRepo: ChatFilterRepository) {}

  async checkMessage(telegramChatId: string): Promise<FilterCheckResult> {
    return await this.chatFilterRepo.isAllowed(telegramChatId);
  }

  async addToAllowlist(telegramChatId: string, priority: number = 0): Promise<void> {
    await this.chatFilterRepo.addFilter(telegramChatId, 'allow', priority);
  }

  async addToBlocklist(telegramChatId: string): Promise<void> {
    await this.chatFilterRepo.addFilter(telegramChatId, 'block', 0);
  }

  async removeFromList(telegramChatId: string): Promise<void> {
    await this.chatFilterRepo.removeFilter(telegramChatId);
  }
}
