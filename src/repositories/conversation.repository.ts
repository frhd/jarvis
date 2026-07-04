import { and, eq } from 'drizzle-orm';
import { conversations } from '../db/schema.js';
import type { Conversation, NewConversation } from '../types/index.js';
import { BaseRepository } from './base.repository.js';
import type { IConversationRepository } from '../interfaces/repositories.js';

export class ConversationRepository
  extends BaseRepository<Conversation, NewConversation, typeof conversations>
  implements IConversationRepository
{
  protected table = conversations;

  async findByPlatformConversation(platform: string, platformConversationId: string): Promise<Conversation | null> {
    return this.findOneWhere(
      and(
        eq(this.table.platform, platform),
        eq(this.table.platformConversationId, platformConversationId),
      )!,
    );
  }

  async findByType(type: string): Promise<Conversation[]> {
    return this.findManyWhere(eq(this.table.type, type));
  }

  async findByPlatform(platform: string): Promise<Conversation[]> {
    return this.findManyWhere(eq(this.table.platform, platform));
  }
}
