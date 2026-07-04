import { and, eq } from 'drizzle-orm';
import { platformIdentities } from '../db/schema.js';
import type { PlatformIdentity, NewPlatformIdentity } from '../types/index.js';
import { BaseRepository } from './base.repository.js';
import type { IPlatformIdentityRepository } from '../interfaces/repositories.js';

export class PlatformIdentityRepository
  extends BaseRepository<PlatformIdentity, NewPlatformIdentity, typeof platformIdentities>
  implements IPlatformIdentityRepository
{
  protected table = platformIdentities;

  async findByPlatformUser(platform: string, platformUserId: string): Promise<PlatformIdentity | null> {
    return this.findOneWhere(
      and(
        eq(this.table.platform, platform),
        eq(this.table.platformUserId, platformUserId),
      )!,
    );
  }

  async findByUserId(userId: string): Promise<PlatformIdentity[]> {
    return this.findManyWhere(eq(this.table.userId, userId));
  }
}
