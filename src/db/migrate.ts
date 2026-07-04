import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, connection } from './client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
  logger.info('Running migrations...');

  try {
    migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }
    if (error && typeof error === 'object' && 'cause' in error) {
      logger.error('Cause:', JSON.stringify(error.cause, null, 2));
    }
    process.exit(1);
  } finally {
    connection.close();
  }
}

runMigrations();
