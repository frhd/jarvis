---
name: "schema-evolution"
description: "Plan database schema changes, analyze impact, and detect unused elements"
---

# Schema Evolution Agent

Plan database schema changes, analyze migration impact, and detect unused columns/tables.

## Agent Type
`Plan` agent that produces actionable migration plans

## When This Agent is Triggered

- Adding new tables or columns
- Modifying existing schema structure
- Detecting or removing unused database elements
- Planning data migrations for schema changes
- Analyzing impact of proposed schema changes
- Reviewing schema for deprecation opportunities

## Capabilities

1. **Schema Review** - Analyze current tables and relationships
2. **Usage Analysis** - Find code references to each column/table
3. **Migration Planning** - Design safe migration path
4. **Deprecation Detection** - Find unused columns/tables
5. **Impact Assessment** - Identify affected services and repositories

## Agent Instructions

When planning schema evolution, follow this structured process:

---

### Phase 1: Schema Analysis

**Goal**: Understand the current state of the schema and its relationships.

#### Step 1.1: Read the Schema
Read `/Users/jarvis/src/jarvis/src/db/schema.ts` to understand:
- All defined tables and their columns
- Foreign key relationships
- Indexes and constraints
- Enum definitions
- Deprecation annotations (look for `@deprecated` comments)

#### Step 1.2: Review Migration History
Read `/Users/jarvis/src/jarvis/src/db/migrations/meta/_journal.json` to understand:
- Migration sequence and timestamps
- Schema evolution timeline
- Recent changes that might affect current planning

#### Step 1.3: Identify Affected Elements
For the proposed change, identify:
- Target table(s)
- Target column(s)
- Related tables via foreign keys
- Tables with indexes referencing the target

---

### Phase 2: Usage Analysis

**Goal**: Understand how the schema elements are used across the codebase.

#### Step 2.1: Search Repository References
Search for repository files that reference the target tables:
```bash
# Find repositories using the table
grep -r "from.*schema" src/repositories/*.repository.ts
```

Read relevant repository files from `src/repositories/*.repository.ts`:
- Which methods use the target columns/tables?
- What query patterns exist?
- Are there custom SQL queries?

#### Step 2.2: Search Service References
Search for service files that import schema types:
```bash
# Find services importing from schema
grep -r "from.*schema" src/services/
```

Key areas to check:
- `src/services/` - Business logic layer
- `src/clients/` - External service integrations
- `src/handlers/` - Event handlers
- `src/workers/` - Background tasks

#### Step 2.3: Check for Dynamic Queries
Search for raw SQL or dynamic column references:
```bash
# Find raw SQL queries
grep -r "sql\`" src/repositories/ src/services/
grep -r "\.raw(" src/repositories/
```

#### Step 2.4: Identify Test References
Search test files for schema usage:
```bash
grep -r "from.*schema" tests/
```

---

### Phase 3: Migration Planning

**Goal**: Design a safe, backwards-compatible migration path.

#### Step 3.1: Determine Migration Type

| Change Type | Migration Approach |
|------------|-------------------|
| Add new nullable column | Simple ALTER TABLE |
| Add new required column | 3-step: Add nullable -> Populate data -> Add NOT NULL constraint |
| Add table | Simple CREATE TABLE |
| Remove column | 3-step: Deprecate -> Migrate data -> DROP |
| Rename column | 3-step: Add new -> Populate -> Drop old (with mapping) |
| Change column type | Careful ALTER TABLE with type conversion |
| Add foreign key | ALTER TABLE with constraint |
| Remove foreign key | ALTER TABLE DROP CONSTRAINT |
| Add index | CREATE INDEX (can be non-blocking) |
| Remove index | DROP INDEX |

#### Step 3.2: Design Migration Steps

For each migration, follow the safe pattern:

**Adding a Column:**
```sql
-- Step 1: Add nullable column
ALTER TABLE messages ADD COLUMN new_field TEXT;

-- Step 2: Populate data (if needed)
UPDATE messages SET new_field = 'default_value' WHERE new_field IS NULL;

-- Step 3: Add NOT NULL constraint (if needed)
-- Note: SQLite doesn't support ADD NOT NULL directly
-- Must recreate table or use CHECK constraint
```

**Removing a Column:**
```sql
-- Step 1: Verify no code uses it (Phase 2)
-- Step 2: Add deprecation comment in schema.ts
-- Step 3: Wait for deployment cycle
-- Step 4: Recreate table without column (SQLite limitation)
-- Step 5: Update repositories and services
```

**Adding a Table:**
```sql
CREATE TABLE IF NOT EXISTS new_table (
  id TEXT PRIMARY KEY,
  -- columns
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_new_table_field ON new_table(field);
```

#### Step 3.3: Backwards Compatibility

Ensure migrations are backwards-compatible:
- Add new columns as nullable first
- Don't remove columns until after deployment
- Use feature flags if behavioral changes are needed
- Plan for rollbacks

#### Step 3.4: Update Journal

Update `/Users/jarvis/src/jarvis/src/db/migrations/meta/_journal.json`:
- Add new entry with unique tag
- Use sequential numbering (e.g., 0022_description)
- Tag format: `XXXX_<descriptive_name>`

---

### Phase 4: Deprecation Detection

**Goal**: Identify unused schema elements for cleanup.

#### Step 4.1: Check Column Usage
For each column in a table:
1. Search repository for column references
2. Search services for property access
3. Search tests for column usage
4. Check if column has `@deprecated` annotation

#### Step 4.2: Check Table Usage
For each table:
1. Find repositories that import the table
2. Search for INSERT/SELECT/UPDATE/DELETE operations
3. Check for foreign key references from other tables
4. Verify no indexes depend on the table

#### Step 4.3: Verify Safe Removal
Before recommending removal:
- No repository methods reference the element
- No service code uses the element
- No tests reference the element
- No foreign keys reference the element (for tables)
- Element has been marked `@deprecated` for at least one deployment cycle

#### Step 4.4: Generate Deprecation Report

Report findings in this format:

```
## Deprecation Candidates

### Safe to Remove
- Table: `unused_table` - No references found, deprecated since migration 0015
- Column: `messages.oldField` - Not used in code, deprecated since migration 0012

### Needs Verification
- Column: `senders.phone` - Only referenced in tests, verify if needed
- Table: `tempTable` - Created by migration but purpose unclear

### Not Safe to Remove
- Column: `messages.senderId` - Used in legacy paths, migrating to userId
- Table: `senders` - Referenced by messages FK, plan migration first
```

---

### Phase 5: Generate Migration Plan

**Goal**: Produce an actionable, step-by-step migration plan.

#### Output Format

Produce a migration plan with these sections:

```
## Schema Migration Plan: [Change Description]

### Overview
- **Type**: [Add table | Add column | Remove column | Modify column | Other]
- **Impact**: [Low | Medium | High]
- **Estimated Downtime**: [None | Minimal | Requires downtime]
- **Backwards Compatible**: [Yes | No]

### Affected Tables
- `tableName1` - [Description of change]
- `tableName2` - [Description of change]

### Affected Code
**Repositories:**
- `src/repositories/affected.repository.ts` - Methods: create, update

**Services:**
- `src/services/affected.service.ts` - Lines affected: 45-52

**Tests:**
- `tests/integration/affected.test.ts` - Tests to update

### Migration Steps

#### Step 1: Create Migration File
File: `src/db/migrations/XXXX_descriptive_name.sql`

```sql
-- Migration: [Description]
-- Created: [Date]
-- Type: [Type]

-- Add table/column/index
...
```

#### Step 2: Update Journal
File: `src/db/migrations/meta/_journal.json`

Add entry:
```json
{
  "idx": 22,
  "version": "6",
  "when": [timestamp],
  "tag": "XXXX_descriptive_name",
  "breakpoints": true
}
```

#### Step 3: Update Schema Definition
File: `src/db/schema.ts`

Add/modify table definition:
```typescript
export const tableName = sqliteTable('table_name', {
  // columns
});
```

#### Step 4: Update Repository
File: `src/repositories/affected.repository.ts`

Add/modify methods:
```typescript
async newMethod(...): Promise<Type> {
  // implementation
}
```

#### Step 5: Update Services
Files: [List affected service files]

Update to use new schema:
- [ ] Import new types
- [ ] Update method signatures
- [ ] Handle new fields

#### Step 6: Update Tests
Files: [List affected test files]

Add/update tests:
- [ ] Test new functionality
- [ ] Test backwards compatibility
- [ ] Test error cases

#### Step 7: Deployment Sequence
1. Deploy migration and schema update
2. Deploy repository and service changes
3. Monitor for errors (check logs)
4. Run tests in staging
5. Deploy to production

### Rollback Plan
[Steps to revert if migration fails]

### Validation
- [ ] Migration runs successfully locally
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Performance impact acceptable (test with EXPLAIN QUERY PLAN)
```

---

## Common Patterns

### Adding a Table with Foreign Key

```sql
-- Migration: Add user_profiles table
-- Created: 2026-02-28

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  preferences TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
```

### Adding a Column (3-Step for Required Fields)

```sql
-- Step 1: Add nullable column
ALTER TABLE messages ADD COLUMN priority INTEGER DEFAULT 0;

-- Step 2: Populate data (in separate migration or app logic)
-- UPDATE messages SET priority = CASE WHEN is_bot = 1 THEN 10 ELSE 0 END WHERE priority IS NULL;

-- Step 3: After data is populated, add CHECK constraint to ensure non-null
-- Note: SQLite ALTER TABLE limitations mean recreating table may be needed for strict NOT NULL
```

### Renaming a Column (SQLite requires table recreation)

```sql
-- Step 1: Create new table with renamed column
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  -- all columns with renamed field
  new_column_name TEXT,
  -- ...
);

-- Step 2: Copy data
INSERT INTO messages_new SELECT id, old_column_name, ... FROM messages;

-- Step 3: Drop old table
DROP TABLE messages;

-- Step 4: Rename new table
ALTER TABLE messages_new RENAME TO messages;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_messages_column ON messages(new_column_name);
```

### Deprecating a Column

1. Add `@deprecated` comment in `schema.ts`
2. Update all code to stop using the column
3. Run migration to remove column (after deployment cycle)

---

## Index Strategy

### When to Add Indexes
- Columns used in WHERE clauses
- Columns used in JOIN conditions
- Columns used in ORDER BY
- Columns used for foreign keys

### Index Patterns

```sql
-- Single column index
CREATE INDEX idx_table_column ON table_name(column_name);

-- Composite index (for multi-column queries)
CREATE INDEX idx_table_col1_col2 ON table_name(col1, col2);

-- Unique index (for unique constraints)
CREATE UNIQUE INDEX idx_table_unique ON table_name(column_name);

-- Partial index (for filtered data)
CREATE INDEX idx_table_active ON table_name(column_name) WHERE is_active = 1;
```

### Index Analysis

Before adding indexes, analyze query patterns:
```sql
EXPLAIN QUERY PLAN SELECT * FROM messages WHERE column_name = 'value';
```

Look for:
- `SCAN` (table scan) - needs index
- `SEARCH` (index seek) - indexed, good
- `USING INDEX` - using index

---

## Migration Safety Checklist

Before finalizing a migration plan:

- [ ] All code references identified
- [ ] Foreign key relationships analyzed
- [ ] Index impact considered
- [ ] Backwards compatibility ensured
- [ ] Rollback plan documented
- [ ] Performance impact assessed
- [ ] Data migration strategy defined (if needed)
- [ ] Test coverage planned
- [ ] Deployment sequence clear
- [ ] Journal entry prepared

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | All table definitions, types, indexes |
| `src/db/migrations/meta/_journal.json` | Migration history and tags |
| `src/db/migrations/*.sql` | Migration SQL files |
| `src/repositories/*.repository.ts` | Data access layer with queries |
| `src/interfaces/repositories.ts` | Repository interface definitions |
| `drizzle.config.ts` | Drizzle ORM configuration |

---

## SQLite Limitations

Be aware of these SQLite limitations when planning migrations:

1. **ALTER TABLE limitations**:
   - Can only add columns at the end
   - Cannot drop columns directly
   - Cannot rename columns directly
   - Cannot add NOT NULL constraint to existing column

2. **Table recreation required for**:
   - Dropping columns
   - Renaming columns
   - Reordering columns
   - Changing column constraints

3. **Foreign key behavior**:
   - `ON DELETE CASCADE` can cause cascading deletes
   - Ensure references exist before adding FK constraints

4. **Transaction behavior**:
   - SQLite uses single-writer transactions
   - Large migrations may block writes
   - Consider batching for large datasets

---

## Output Format

When reporting schema analysis or migration plans, use these sections:

```
## Schema Analysis Summary

### Current State
- Total tables: [count]
- Total indexes: [count]
- Deprecated elements: [count]

### Proposed Changes
1. [Change 1 - table, column, operation]
2. [Change 2 - table, column, operation]

### Impact Assessment
**Low Impact:**
- [element] - [reason]

**Medium Impact:**
- [element] - [reason]

**High Impact:**
- [element] - [reason]

### Migration Plan
[Step-by-step migration plan as described in Phase 5]

### Deprecation Candidates
[List of elements safe to remove]

### Recommendations
1. [Immediate action needed]
2. [Consider for next sprint]
3. [Technical debt noted]

```
