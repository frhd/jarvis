/**
 * impl.md Format Parser and Serializer
 *
 * Handles parsing and generation of the impl.md document format
 * used for plan tracking and execution progress.
 */

import type { PlanState } from '../db/schema.js';
import type { ImplMdDocument, ImplMdTask, ImplMdProgress } from '../types/plan.types.js';

// ============================================================================
// Format Constants
// ============================================================================

const DATE_FORMAT = 'YYYY-MM-DD';
const DATETIME_FORMAT = 'YYYY-MM-DD HH:MM';

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(date: Date): string {
  const dateStr = formatDate(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${dateStr} ${hours}:${minutes}`;
}

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function parseDateTime(dateTimeStr: string): Date {
  const [dateStr, timeStr] = dateTimeStr.split(' ');
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = (timeStr ?? '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function mapStateToDisplay(state: PlanState): string {
  const stateMap: Record<PlanState, string> = {
    idle: 'IDLE',
    proposing: 'PROPOSED',
    feedback: 'FEEDBACK',
    approved: 'APPROVED',
    executing: 'EXECUTING',
    completed: 'COMPLETED',
    failed: 'FAILED',
  };
  return stateMap[state] ?? state.toUpperCase();
}

function mapDisplayToState(display: string): PlanState {
  const displayMap: Record<string, PlanState> = {
    'IDLE': 'idle',
    'PROPOSED': 'proposing',
    'PROPOSING': 'proposing',
    'FEEDBACK': 'feedback',
    'APPROVED': 'approved',
    'EXECUTING': 'executing',
    'COMPLETED': 'completed',
    'FAILED': 'failed',
  };
  return displayMap[display.toUpperCase()] ?? 'idle';
}

// ============================================================================
// Task Parsing
// ============================================================================

/**
 * Parse a single task line
 * Supports: - [ ] Task, - [x] Task, * [ ] Task, * [x] Task
 */
function parseTaskLine(line: string): { task: ImplMdTask; indent: number } | null {
  const match = line.match(/^(\s*)[-*]\s*\[([xX ])\]\s*(.+)$/);
  if (!match) return null;

  const [, indentStr, checkMark, description] = match;
  const indent = indentStr.length;
  const completed = checkMark.toLowerCase() === 'x';

  return {
    task: { description: description.trim(), completed, subtasks: [] },
    indent,
  };
}

/**
 * Parse tasks from markdown content
 */
function parseTasks(content: string): ImplMdTask[] {
  const lines = content.split('\n');
  const tasks: ImplMdTask[] = [];
  const stack: { task: ImplMdTask; indent: number }[] = [];

  for (const line of lines) {
    const parsed = parseTaskLine(line);
    if (!parsed) continue;

    const { task, indent } = parsed;

    // Find the parent task based on indentation
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level task
      tasks.push(task);
    } else {
      // Subtask of the last item in stack
      const parent = stack[stack.length - 1].task;
      if (!parent.subtasks) parent.subtasks = [];
      parent.subtasks.push(task);
    }

    stack.push({ task, indent });
  }

  return tasks;
}

/**
 * Serialize tasks to markdown
 */
function serializeTasks(tasks: ImplMdTask[], indent: number = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const task of tasks) {
    const checkbox = task.completed ? '[x]' : '[ ]';
    lines.push(`${prefix}- ${checkbox} ${task.description}`);

    if (task.subtasks && task.subtasks.length > 0) {
      lines.push(serializeTasks(task.subtasks, indent + 1));
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Progress Parsing
// ============================================================================

/**
 * Parse progress entries from markdown content
 */
function parseProgress(content: string): ImplMdProgress[] {
  const progressSection = extractSection(content, 'Progress');
  if (!progressSection) return [];

  const progress: ImplMdProgress[] = [];
  const iterationRegex = /### Iteration (\d+) \(([^)]+)\)/g;
  let match;

  while ((match = iterationRegex.exec(progressSection)) !== null) {
    const iteration = parseInt(match[1], 10);
    const timestamp = parseDateTime(match[2]);

    // Extract content until next iteration or end of section
    const startIdx = match.index + match[0].length;
    const nextMatch = iterationRegex.exec(progressSection);
    const endIdx = nextMatch ? nextMatch.index : progressSection.length;
    iterationRegex.lastIndex = match.index + match[0].length; // Reset to continue properly

    const iterationContent = progressSection.slice(startIdx, endIdx);

    // Parse progress details
    const completedMatch = iterationContent.match(/- Completed: (.+)/);
    const statusMatch = iterationContent.match(/- Status: (.+)/);
    const tokensMatch = iterationContent.match(/- Tokens: ([\d.]+)K in \/ ([\d.]+)K out/);
    const costMatch = iterationContent.match(/- Cost: \$([\d.]+)/);

    progress.push({
      iteration,
      timestamp,
      completedTasks: completedMatch ? completedMatch[1].split(', ').map(s => s.trim()) : [],
      status: statusMatch ? statusMatch[1] : '',
      tokensIn: tokensMatch ? Math.round(parseFloat(tokensMatch[1]) * 1000) : undefined,
      tokensOut: tokensMatch ? Math.round(parseFloat(tokensMatch[2]) * 1000) : undefined,
      cost: costMatch ? parseFloat(costMatch[1]) : undefined,
    });
  }

  return progress;
}

/**
 * Serialize progress entries to markdown
 */
function serializeProgress(progress: ImplMdProgress[]): string {
  if (progress.length === 0) return '';

  const lines: string[] = [];

  for (const entry of progress) {
    lines.push(`### Iteration ${entry.iteration} (${formatDateTime(entry.timestamp)})`);

    if (entry.completedTasks.length > 0) {
      lines.push(`- Completed: ${entry.completedTasks.join(', ')}`);
    }

    if (entry.status) {
      lines.push(`- Status: ${entry.status}`);
    }

    if (entry.tokensIn !== undefined && entry.tokensOut !== undefined) {
      const tokensIn = (entry.tokensIn / 1000).toFixed(1);
      const tokensOut = (entry.tokensOut / 1000).toFixed(1);
      lines.push(`- Tokens: ${tokensIn}K in / ${tokensOut}K out`);
    }

    if (entry.cost !== undefined) {
      lines.push(`- Cost: $${entry.cost.toFixed(2)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Section Extraction
// ============================================================================

/**
 * Extract a section from markdown content by heading
 */
function extractSection(content: string, sectionName: string): string | null {
  const regex = new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract metadata field value
 */
function extractMetadataField(content: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract files modified list
 */
function extractFilesModified(content: string): string[] {
  const section = extractSection(content, 'Files Modified');
  if (!section) return [];

  const files: string[] = [];
  const lines = section.split('\n');
  for (const line of lines) {
    const match = line.match(/^-\s*(.+)$/);
    if (match) {
      files.push(match[1].trim());
    }
  }
  return files;
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse an impl.md document into structured data
 */
export function parseImplMd(content: string): ImplMdDocument {
  // Extract title (first H1)
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Plan';

  // Extract metadata fields
  const statusStr = extractMetadataField(content, 'Status');
  const status = statusStr ? mapDisplayToState(statusStr) : 'idle';
  const createdDate = extractMetadataField(content, 'Created') ?? formatDate(new Date());
  const lastUpdated = extractMetadataField(content, 'Last Updated') ?? formatDate(new Date());
  const executionStarted = extractMetadataField(content, 'Execution Started') ?? undefined;

  // Extract sections
  const objective = extractSection(content, 'Objective') ?? '';
  const context = extractSection(content, 'Context') ?? '';
  const notes = extractSection(content, 'Notes') ?? '';

  // Parse tasks
  const tasksSection = extractSection(content, 'Implementation Tasks');
  const tasks = tasksSection ? parseTasks(tasksSection) : [];

  // Parse progress
  const progress = parseProgress(content);

  // Extract files modified
  const filesModified = extractFilesModified(content);

  return {
    title,
    status,
    createdDate,
    lastUpdated,
    executionStarted,
    objective,
    context,
    tasks,
    progress,
    filesModified,
    notes,
  };
}

// ============================================================================
// Main Serializer
// ============================================================================

/**
 * Serialize a plan document to impl.md format
 */
export function serializeImplMd(doc: ImplMdDocument): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${doc.title}`);
  lines.push('');

  // Metadata
  lines.push(`**Status**: ${mapStateToDisplay(doc.status)}`);
  lines.push(`**Created**: ${doc.createdDate}`);
  lines.push(`**Last Updated**: ${doc.lastUpdated}`);
  if (doc.executionStarted) {
    lines.push(`**Execution Started**: ${doc.executionStarted}`);
  }
  lines.push('');

  // Objective
  lines.push('## Objective');
  lines.push('');
  lines.push(doc.objective || '[Clear description of what this plan achieves]');
  lines.push('');

  // Context
  lines.push('## Context');
  lines.push('');
  lines.push(doc.context || '[Background information, user requirements, constraints]');
  lines.push('');

  // Implementation Tasks
  lines.push('## Implementation Tasks');
  lines.push('');
  if (doc.tasks.length > 0) {
    lines.push(serializeTasks(doc.tasks));
  } else {
    lines.push('- [ ] Task 1: Description');
  }
  lines.push('');

  // Progress
  lines.push('## Progress');
  lines.push('');
  if (doc.progress.length > 0) {
    lines.push(serializeProgress(doc.progress));
  } else {
    lines.push('_No progress recorded yet._');
    lines.push('');
  }

  // Files Modified
  lines.push('## Files Modified');
  lines.push('');
  if (doc.filesModified.length > 0) {
    for (const file of doc.filesModified) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push('_No files modified yet._');
  }
  lines.push('');

  // Notes
  lines.push('## Notes');
  lines.push('');
  lines.push(doc.notes || '[Any additional context, decisions, or blockers]');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Count completed and total tasks (including subtasks)
 */
export function countTasks(tasks: ImplMdTask[]): { completed: number; total: number } {
  let completed = 0;
  let total = 0;

  function countRecursive(taskList: ImplMdTask[]) {
    for (const task of taskList) {
      total++;
      if (task.completed) completed++;
      if (task.subtasks && task.subtasks.length > 0) {
        countRecursive(task.subtasks);
      }
    }
  }

  countRecursive(tasks);
  return { completed, total };
}

/**
 * Update task completion status by description
 */
export function updateTaskStatus(
  tasks: ImplMdTask[],
  description: string,
  completed: boolean
): boolean {
  for (const task of tasks) {
    if (task.description.toLowerCase().includes(description.toLowerCase())) {
      task.completed = completed;
      return true;
    }
    if (task.subtasks && task.subtasks.length > 0) {
      if (updateTaskStatus(task.subtasks, description, completed)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Add a progress entry
 */
export function addProgressEntry(
  doc: ImplMdDocument,
  entry: Omit<ImplMdProgress, 'iteration' | 'timestamp'>
): ImplMdDocument {
  const nextIteration = doc.progress.length + 1;
  const newEntry: ImplMdProgress = {
    ...entry,
    iteration: nextIteration,
    timestamp: new Date(),
  };

  return {
    ...doc,
    progress: [...doc.progress, newEntry],
    lastUpdated: formatDate(new Date()),
  };
}

/**
 * Create a new impl.md document from plan data
 */
export function createImplMdDocument(
  title: string,
  objective: string,
  context: string,
  tasks: Array<{ description: string; subtasks?: string[] }>
): ImplMdDocument {
  const now = new Date();
  const dateStr = formatDate(now);

  const implTasks: ImplMdTask[] = tasks.map((t) => ({
    description: t.description,
    completed: false,
    subtasks: t.subtasks?.map((st) => ({
      description: st,
      completed: false,
    })),
  }));

  return {
    title,
    status: 'proposing',
    createdDate: dateStr,
    lastUpdated: dateStr,
    objective,
    context,
    tasks: implTasks,
    progress: [],
    filesModified: [],
    notes: '',
  };
}
