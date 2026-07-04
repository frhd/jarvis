import { users } from '../db/schema.js';
import type { User, NewUser } from '../types/index.js';
import { BaseRepository } from './base.repository.js';
import type { IUserRepository } from '../interfaces/repositories.js';

export class UserRepository
  extends BaseRepository<User, NewUser, typeof users>
  implements IUserRepository
{
  protected table = users;

  async findAll(limit = 100, offset = 0): Promise<User[]> {
    return this.findMany({ limit, offset });
  }
}
