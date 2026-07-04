import { eq, desc } from 'drizzle-orm';
import { llmResponses } from '../db/schema';
import { LLMResponseRecord, NewLLMResponseRecord } from '../types';
import { BaseRepository } from './base.repository';

export class LLMResponseRepository extends BaseRepository<
  LLMResponseRecord,
  NewLLMResponseRecord,
  typeof llmResponses
> {
  protected table = llmResponses;

  async findByMessageId(messageId: string): Promise<LLMResponseRecord[]> {
    return this.findManyWhere(
      eq(this.table.messageId, messageId)
    );
  }

  async findLatestByMessageId(
    messageId: string,
    promptType?: string
  ): Promise<LLMResponseRecord | null> {
    return this.findOneWhere(eq(this.table.messageId, messageId));
  }
}
