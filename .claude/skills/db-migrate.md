# /db-migrate - Create Database Migration

Create a Drizzle ORM migration with proper SQL.

## When to Use

- Adding new tables
- Modifying existing tables
- Adding indexes
- Schema changes

## Migration Architecture

```
src/db/
├── client.ts              # Database client (better-sqlite3)
├── migrate.ts             # Migration runner
├── schema.ts              # Re-exports all schema
└── schema/
    ├── messages.ts        # Table definitions
    ├── queue.ts
    ├── memories.ts
    └── ...
└── migrations/
    ├── 0000_*.sql         # Initial schema
    ├── 0001_*.sql         # Intent classification
    ├── ...
    └── XXXX_<name>.sql    # Your new migration
```

## Migration Process

### Step 1: Modify Schema

Edit or create table definition in `src/db/schema/`:

```typescript
// src/db/schema/<table>.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const <tableName> = sqliteTable('<table_name>', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  value: integer('value').default(0),
  score: real('score'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Export type
export type <TableName> = typeof <tableName>.$inferSelect;
export type New<TableName> = typeof <tableName>.$inferInsert;
```

### Step 2: Export from Schema Index

Add to `src/db/schema/index.ts`:

```typescript
export * from './<table>.js';
```

### Step 3: Generate Migration

```bash
# Generate migration SQL
npx drizzle-kit generate:sqlite

# Or manually create migration file
```

### Step 4: Migration SQL Template

Create `src/db/migrations/XXXX_<name>.sql`:

```sql
-- Migration: <description>
-- Created: <date>

-- Create new table
CREATE TABLE IF NOT EXISTS <table_name> (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value INTEGER DEFAULT 0,
  score REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_<table>_<column>
ON <table_name>(<column>);

CREATE INDEX IF NOT EXISTS idx_<table>_<col1>_<col2>
ON <table_name>(<col1>, <col2>);
```

## Common Migration Patterns

### Add Column

```sql
-- Add column with default
ALTER TABLE <table> ADD COLUMN <column> TEXT DEFAULT '';

-- Add NOT NULL column (requires default or UPDATE)
ALTER TABLE <table> ADD COLUMN <column> INTEGER NOT NULL DEFAULT 0;
```

### Add Index

```sql
-- Single column index
CREATE INDEX IF NOT EXISTS idx_<table>_<column>
ON <table>(<column>);

-- Composite index
CREATE INDEX IF NOT EXISTS idx_<table>_<col1>_<col2>
ON <table>(<col1>, <col2>);

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_<table>_<column>_unique
ON <table>(<column>);
```

### Create Table with Foreign Key

```sql
CREATE TABLE IF NOT EXISTS <child_table> (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES <parent_table>(id)
);
```

### Vector Column (sqlite-vec)

```sql
-- Embedding column for vector search
ALTER TABLE <table> ADD COLUMN embedding BLOB;

-- Create virtual table for vector search
CREATE VIRTUAL TABLE IF NOT EXISTS <table>_vec USING vec0(
  embedding float[768]
);
```

### Add Timestamps

```sql
ALTER TABLE <table> ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE <table> ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP;
```

## Step 5: Run Migration

```bash
# Run migrations
npm run db:migrate

# Or directly
npx tsx src/db/migrate.ts
```

## Step 6: Verify Migration

```bash
# Open Drizzle Studio to inspect
npm run db:studio

# Or check via sqlite3
sqlite3 data/jarvis.db ".schema <table_name>"
```

## Migration Naming Convention

Format: `XXXX_<description>.sql`

- `XXXX` - Sequential number (0000, 0001, 0002, ...)
- `<description>` - Snake_case description

Examples:
- `0015_add_user_preferences.sql`
- `0016_create_webhooks_table.sql`
- `0017_add_message_indexes.sql`

## SQLite Limitations

SQLite has limited ALTER TABLE support:

| Operation | Supported |
|-----------|-----------|
| ADD COLUMN | Yes |
| DROP COLUMN | SQLite 3.35+ |
| RENAME COLUMN | SQLite 3.25+ |
| ALTER COLUMN TYPE | No (recreate table) |
| ADD CONSTRAINT | No (recreate table) |

### Recreating Table (for unsupported changes)

```sql
-- 1. Create new table with desired schema
CREATE TABLE <table>_new (
  -- new schema
);

-- 2. Copy data
INSERT INTO <table>_new SELECT * FROM <table>;

-- 3. Drop old table
DROP TABLE <table>;

-- 4. Rename new table
ALTER TABLE <table>_new RENAME TO <table>;

-- 5. Recreate indexes
CREATE INDEX ...;
```

## Checklist

- [ ] Create/modify schema file in `src/db/schema/`
- [ ] Export from `src/db/schema/index.ts`
- [ ] Generate or create migration SQL
- [ ] Add appropriate indexes
- [ ] Run migration: `npm run db:migrate`
- [ ] Verify with Drizzle Studio: `npm run db:studio`
- [ ] Create repository methods if needed
- [ ] Update types if needed

## Reference

- Drizzle config: `drizzle.config.ts`
- Migration runner: `src/db/migrate.ts`
- Schema files: `src/db/schema/`
- Existing migrations: `src/db/migrations/`
