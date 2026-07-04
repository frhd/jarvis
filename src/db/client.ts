import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { appConfig } from '../config/index.js';
import * as schema from './schema.js';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Ensure database directory exists
const dbDir = dirname(appConfig.database.path);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Initialize better-sqlite3 connection
const sqlite = new Database(appConfig.database.path);

// Load sqlite-vec extension for vector operations
sqliteVec.load(sqlite);

// Enable WAL mode for better concurrency
sqlite.pragma('journal_mode = WAL');

// Set busy timeout to 5 seconds to handle lock contention
// This prevents SQLITE_BUSY errors when multiple operations compete for write access
sqlite.pragma('busy_timeout = 5000');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export the db type for transaction support
export type DbClient = typeof db;

// Export the connection for cleanup
export const connection: Database.Database = sqlite;
