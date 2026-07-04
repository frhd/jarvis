/**
 * impl.md Parser Tests
 *
 * Unit tests for the impl.md format parsing and serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  parseImplMd,
  serializeImplMd,
  countTasks,
  updateTaskStatus,
  addProgressEntry,
  createImplMdDocument,
} from './implMdParser.js';
import type { ImplMdDocument, ImplMdTask } from '../types/plan.types.js';

// Sample impl.md content for testing
const SAMPLE_IMPL_MD = `# Test Implementation Plan

**Status**: EXECUTING
**Created**: 2024-01-15
**Last Updated**: 2024-01-16
**Execution Started**: 2024-01-16

## Objective

Build a user authentication system with JWT tokens.

## Context

The application needs secure user authentication for protected endpoints.

## Implementation Tasks

- [x] Task 1: Setup database schema
  - [x] Create users table
  - [x] Add indexes
- [ ] Task 2: Implement registration
  - [ ] Create endpoint
  - [x] Add validation
- [ ] Task 3: Implement login
- [x] Task 4: Add JWT middleware

## Progress

### Iteration 1 (2024-01-15 10:30)
- Completed: Task 1
- Status: Working on Task 2
- Tokens: 45.2K in / 12.5K out
- Cost: $0.85

### Iteration 2 (2024-01-16 14:20)
- Completed: Task 4
- Status: Continuing Task 2
- Tokens: 30.1K in / 8.2K out
- Cost: $0.55

## Files Modified

- src/db/schema/users.ts
- src/services/auth.service.ts
- src/middleware/jwt.middleware.ts

## Notes

Using bcrypt for password hashing. JWT expiry set to 1 hour.
`;

describe('implMdParser', () => {
  // ===========================================================================
  // Parsing Tests
  // ===========================================================================

  describe('parseImplMd()', () => {
    it('should parse title correctly', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.title).toBe('Test Implementation Plan');
    });

    it('should parse status correctly', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.status).toBe('executing');
    });

    it('should parse dates correctly', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.createdDate).toBe('2024-01-15');
      expect(doc.lastUpdated).toBe('2024-01-16');
      expect(doc.executionStarted).toBe('2024-01-16');
    });

    it('should parse objective section', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.objective).toContain('authentication system');
    });

    it('should parse context section', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.context).toContain('secure user authentication');
    });

    it('should parse notes section', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.notes).toContain('bcrypt');
    });

    it('should parse tasks with checkboxes', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.tasks).toHaveLength(4);
      expect(doc.tasks[0].completed).toBe(true);
      expect(doc.tasks[1].completed).toBe(false);
      expect(doc.tasks[3].completed).toBe(true);
    });

    it('should parse subtasks correctly', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      const task1 = doc.tasks[0];
      expect(task1.subtasks).toHaveLength(2);
      expect(task1.subtasks?.[0].completed).toBe(true);
      expect(task1.subtasks?.[1].completed).toBe(true);

      const task2 = doc.tasks[1];
      expect(task2.subtasks).toHaveLength(2);
      expect(task2.subtasks?.[0].completed).toBe(false);
      expect(task2.subtasks?.[1].completed).toBe(true);
    });

    it('should parse progress entries', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.progress).toHaveLength(2);

      const progress1 = doc.progress[0];
      expect(progress1.iteration).toBe(1);
      expect(progress1.completedTasks).toContain('Task 1');
      expect(progress1.status).toContain('Working on Task 2');
      expect(progress1.tokensIn).toBe(45200);
      expect(progress1.tokensOut).toBe(12500);
      expect(progress1.cost).toBe(0.85);
    });

    it('should parse files modified list', () => {
      const doc = parseImplMd(SAMPLE_IMPL_MD);
      expect(doc.filesModified).toHaveLength(3);
      expect(doc.filesModified).toContain('src/db/schema/users.ts');
      expect(doc.filesModified).toContain('src/services/auth.service.ts');
    });

    it('should handle minimal document', () => {
      const minimal = `# Minimal Plan

**Status**: PROPOSED

## Objective

Do something

## Context

Some context

## Implementation Tasks

- [ ] Task 1

## Progress

## Files Modified

## Notes
`;
      const doc = parseImplMd(minimal);
      expect(doc.title).toBe('Minimal Plan');
      expect(doc.status).toBe('proposing');
      expect(doc.tasks).toHaveLength(1);
      expect(doc.progress).toHaveLength(0);
    });

    it('should handle document without execution started', () => {
      const noExec = `# Plan

**Status**: FEEDBACK
**Created**: 2024-01-15
**Last Updated**: 2024-01-15

## Objective
Test

## Context
Test

## Implementation Tasks
- [ ] Task

## Progress

## Files Modified

## Notes
`;
      const doc = parseImplMd(noExec);
      expect(doc.executionStarted).toBeUndefined();
    });
  });

  // ===========================================================================
  // Serialization Tests
  // ===========================================================================

  describe('serializeImplMd()', () => {
    it('should serialize a document correctly', () => {
      const doc: ImplMdDocument = {
        title: 'My Plan',
        status: 'approved',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-16',
        objective: 'Build something great',
        context: 'We need this feature',
        tasks: [
          { description: 'Task 1', completed: true },
          { description: 'Task 2', completed: false },
        ],
        progress: [],
        filesModified: ['src/index.ts'],
        notes: 'Important notes here',
      };

      const markdown = serializeImplMd(doc);

      expect(markdown).toContain('# My Plan');
      expect(markdown).toContain('**Status**: APPROVED');
      expect(markdown).toContain('**Created**: 2024-01-15');
      expect(markdown).toContain('## Objective');
      expect(markdown).toContain('Build something great');
      expect(markdown).toContain('- [x] Task 1');
      expect(markdown).toContain('- [ ] Task 2');
      expect(markdown).toContain('- src/index.ts');
      expect(markdown).toContain('Important notes here');
    });

    it('should serialize tasks with subtasks', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'proposing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-15',
        objective: 'Test',
        context: 'Test',
        tasks: [
          {
            description: 'Main task',
            completed: false,
            subtasks: [
              { description: 'Sub 1', completed: true },
              { description: 'Sub 2', completed: false },
            ],
          },
        ],
        progress: [],
        filesModified: [],
        notes: '',
      };

      const markdown = serializeImplMd(doc);

      expect(markdown).toContain('- [ ] Main task');
      expect(markdown).toContain('  - [x] Sub 1');
      expect(markdown).toContain('  - [ ] Sub 2');
    });

    it('should serialize progress entries', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'executing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-16',
        executionStarted: '2024-01-16',
        objective: 'Test',
        context: 'Test',
        tasks: [],
        progress: [
          {
            iteration: 1,
            timestamp: new Date('2024-01-16T10:30:00'),
            completedTasks: ['Task 1'],
            status: 'In progress',
            tokensIn: 45000,
            tokensOut: 12000,
            cost: 0.75,
          },
        ],
        filesModified: [],
        notes: '',
      };

      const markdown = serializeImplMd(doc);

      expect(markdown).toContain('### Iteration 1');
      expect(markdown).toContain('Completed: Task 1');
      expect(markdown).toContain('Status: In progress');
      expect(markdown).toContain('Tokens: 45.0K in / 12.0K out');
      expect(markdown).toContain('Cost: $0.75');
    });

    it('should include execution started when present', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'executing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-16',
        executionStarted: '2024-01-16',
        objective: 'Test',
        context: 'Test',
        tasks: [],
        progress: [],
        filesModified: [],
        notes: '',
      };

      const markdown = serializeImplMd(doc);

      expect(markdown).toContain('**Execution Started**: 2024-01-16');
    });

    it('should round-trip parse and serialize', () => {
      const original = parseImplMd(SAMPLE_IMPL_MD);
      const serialized = serializeImplMd(original);
      const reparsed = parseImplMd(serialized);

      expect(reparsed.title).toBe(original.title);
      expect(reparsed.status).toBe(original.status);
      expect(reparsed.tasks.length).toBe(original.tasks.length);
      expect(reparsed.filesModified.length).toBe(original.filesModified.length);
    });
  });

  // ===========================================================================
  // Utility Function Tests
  // ===========================================================================

  describe('countTasks()', () => {
    it('should count top-level tasks', () => {
      const tasks: ImplMdTask[] = [
        { description: 'Task 1', completed: true },
        { description: 'Task 2', completed: false },
        { description: 'Task 3', completed: true },
      ];

      const { completed, total } = countTasks(tasks);

      expect(total).toBe(3);
      expect(completed).toBe(2);
    });

    it('should count subtasks recursively', () => {
      const tasks: ImplMdTask[] = [
        {
          description: 'Task 1',
          completed: true,
          subtasks: [
            { description: 'Sub 1.1', completed: true },
            { description: 'Sub 1.2', completed: false },
          ],
        },
        { description: 'Task 2', completed: false },
      ];

      const { completed, total } = countTasks(tasks);

      expect(total).toBe(4);
      expect(completed).toBe(2);
    });

    it('should return zero for empty tasks', () => {
      const { completed, total } = countTasks([]);

      expect(total).toBe(0);
      expect(completed).toBe(0);
    });
  });

  describe('updateTaskStatus()', () => {
    it('should update task status by description', () => {
      const tasks: ImplMdTask[] = [
        { description: 'Task 1: Do something', completed: false },
        { description: 'Task 2: Do another thing', completed: false },
      ];

      const updated = updateTaskStatus(tasks, 'Do something', true);

      expect(updated).toBe(true);
      expect(tasks[0].completed).toBe(true);
      expect(tasks[1].completed).toBe(false);
    });

    it('should update subtask status', () => {
      const tasks: ImplMdTask[] = [
        {
          description: 'Main task',
          completed: false,
          subtasks: [
            { description: 'Subtask A', completed: false },
            { description: 'Subtask B', completed: false },
          ],
        },
      ];

      const updated = updateTaskStatus(tasks, 'Subtask A', true);

      expect(updated).toBe(true);
      expect(tasks[0].subtasks?.[0].completed).toBe(true);
      expect(tasks[0].subtasks?.[1].completed).toBe(false);
    });

    it('should return false for non-existent task', () => {
      const tasks: ImplMdTask[] = [
        { description: 'Task 1', completed: false },
      ];

      const updated = updateTaskStatus(tasks, 'Non-existent', true);

      expect(updated).toBe(false);
    });

    it('should match case-insensitively', () => {
      const tasks: ImplMdTask[] = [
        { description: 'Setup Database', completed: false },
      ];

      const updated = updateTaskStatus(tasks, 'setup database', true);

      expect(updated).toBe(true);
      expect(tasks[0].completed).toBe(true);
    });
  });

  describe('addProgressEntry()', () => {
    it('should add a progress entry with auto-incremented iteration', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'executing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-15',
        objective: 'Test',
        context: 'Test',
        tasks: [],
        progress: [],
        filesModified: [],
        notes: '',
      };

      const updated = addProgressEntry(doc, {
        completedTasks: ['Task 1'],
        status: 'Working on Task 2',
        tokensIn: 10000,
        tokensOut: 2000,
        cost: 0.25,
      });

      expect(updated.progress).toHaveLength(1);
      expect(updated.progress[0].iteration).toBe(1);
      expect(updated.progress[0].completedTasks).toContain('Task 1');
    });

    it('should auto-increment iteration number', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'executing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-15',
        objective: 'Test',
        context: 'Test',
        tasks: [],
        progress: [
          {
            iteration: 1,
            timestamp: new Date(),
            completedTasks: [],
            status: 'Started',
          },
        ],
        filesModified: [],
        notes: '',
      };

      const updated = addProgressEntry(doc, {
        completedTasks: ['Task 2'],
        status: 'Continuing',
      });

      expect(updated.progress).toHaveLength(2);
      expect(updated.progress[1].iteration).toBe(2);
    });

    it('should not mutate original document', () => {
      const doc: ImplMdDocument = {
        title: 'Plan',
        status: 'executing',
        createdDate: '2024-01-15',
        lastUpdated: '2024-01-15',
        objective: 'Test',
        context: 'Test',
        tasks: [],
        progress: [],
        filesModified: [],
        notes: '',
      };

      addProgressEntry(doc, {
        completedTasks: [],
        status: 'Started',
      });

      expect(doc.progress).toHaveLength(0);
    });
  });

  describe('createImplMdDocument()', () => {
    it('should create a new document with basic fields', () => {
      const doc = createImplMdDocument(
        'New Feature',
        'Build an API endpoint',
        'We need this for the frontend',
        [
          { description: 'Setup routes' },
          { description: 'Implement handler' },
        ]
      );

      expect(doc.title).toBe('New Feature');
      expect(doc.objective).toBe('Build an API endpoint');
      expect(doc.context).toBe('We need this for the frontend');
      expect(doc.status).toBe('proposing');
      expect(doc.tasks).toHaveLength(2);
      expect(doc.tasks[0].completed).toBe(false);
    });

    it('should create tasks with subtasks', () => {
      const doc = createImplMdDocument(
        'Feature',
        'Objective',
        'Context',
        [
          {
            description: 'Main task',
            subtasks: ['Sub 1', 'Sub 2'],
          },
        ]
      );

      expect(doc.tasks[0].subtasks).toHaveLength(2);
      expect(doc.tasks[0].subtasks?.[0].description).toBe('Sub 1');
      expect(doc.tasks[0].subtasks?.[0].completed).toBe(false);
    });

    it('should initialize with empty progress and files', () => {
      const doc = createImplMdDocument(
        'Feature',
        'Objective',
        'Context',
        []
      );

      expect(doc.progress).toHaveLength(0);
      expect(doc.filesModified).toHaveLength(0);
      expect(doc.notes).toBe('');
    });
  });
});
