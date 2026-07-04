/**
 * Plan-specific prompts for the plan-execute workflow system.
 *
 * These prompts guide Claude in generating plan content, processing feedback,
 * and formatting status reports.
 */

/**
 * System prompt for plan proposal generation
 */
export const PLAN_PROPOSAL_SYSTEM_PROMPT = `You are Jarvis, a helpful assistant that creates structured implementation plans.

When creating a plan:
1. Break down the request into clear, actionable tasks
2. Use checkbox format (- [ ]) for trackable items
3. Group related tasks into logical sections
4. Consider dependencies between tasks
5. Be specific about what needs to be done

Format the plan in markdown with the following structure:

## Objective
[Clear description of what this plan achieves]

## Context
[Background information, constraints, or relevant details]

## Implementation Tasks
- [ ] Task 1: Description
  - Subtask details if needed
- [ ] Task 2: Description
- [ ] Task 3: Description

## Notes
[Any additional considerations, assumptions, or potential blockers]

Keep the plan focused and achievable. Don't over-engineer or add unnecessary complexity.`;

/**
 * System prompt for processing plan feedback
 */
export const PLAN_FEEDBACK_SYSTEM_PROMPT = `You are Jarvis, helping to refine an implementation plan based on user feedback.

When processing feedback:
1. Carefully understand the user's requested changes
2. Incorporate additions, removals, or modifications as specified
3. Maintain the existing structure and format
4. Keep all unaffected tasks unchanged
5. Ensure the updated plan remains coherent and actionable

Respond with the updated plan in the same markdown format:

## Objective
[Updated objective if needed]

## Context
[Updated context if needed]

## Implementation Tasks
[Updated task list with changes incorporated]

## Notes
[Updated notes if relevant]

Only modify what the user requested. Keep everything else intact.`;

/**
 * Prompt templates for plan operations
 */
export const PLAN_PROMPTS = {
  /**
   * Generate a new plan from a user request
   */
  propose: (request: string) => `
Create an implementation plan for the following request:

${request}

Generate a clear, structured plan that can be tracked and executed step by step.`,

  /**
   * Incorporate feedback into an existing plan
   */
  feedback: (currentPlan: string, feedback: string) => `
Current plan:
${currentPlan}

User feedback:
${feedback}

Update the plan to incorporate this feedback while maintaining the overall structure.`,

  /**
   * Format plan content for display
   */
  formatPlanDisplay: (title: string, content: string, state: string, version: number) => `
📋 **${title}** (v${version})
**Status**: ${formatPlanState(state)}

${content}`,

  /**
   * Format execution progress for display
   */
  formatProgressDisplay: (progress: {
    tasksCompleted: number;
    totalTasks: number;
    currentIteration: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    lastActivity?: string;
  }) => {
    const completionPercent = progress.totalTasks > 0
      ? Math.round((progress.tasksCompleted / progress.totalTasks) * 100)
      : 0;

    return `
📊 **Execution Progress**

• Tasks: ${progress.tasksCompleted}/${progress.totalTasks} (${completionPercent}%)
• Iteration: ${progress.currentIteration}
• Tokens: ${formatNumber(progress.tokensIn)} in / ${formatNumber(progress.tokensOut)} out
• Cost: $${progress.cost.toFixed(2)}
${progress.lastActivity ? `• Last activity: ${progress.lastActivity}` : ''}`;
  },

  /**
   * Format final completion report
   */
  formatCompletionReport: (plan: { title: string }, progress: {
    tasksCompleted: number;
    totalTasks: number;
    currentIteration: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    filesModified: string[];
  }) => `
✅ **Execution Complete**

Plan "${plan.title}" has finished executing.

**Summary:**
• Tasks completed: ${progress.tasksCompleted}/${progress.totalTasks}
• Total iterations: ${progress.currentIteration}
• Tokens used: ${formatNumber(progress.tokensIn)} in / ${formatNumber(progress.tokensOut)} out
• Total cost: $${progress.cost.toFixed(2)}
${progress.filesModified.length > 0 ? `\n**Files modified:**\n${progress.filesModified.map(f => `• ${f}`).join('\n')}` : ''}`,
};

/**
 * Response templates for plan operations
 */
export const PLAN_RESPONSES = {
  /**
   * No active plan found
   */
  noActivePlan: "You don't have an active plan. Create one by saying 'create a plan to...'",

  /**
   * Active plan already exists
   */
  activePlanExists: (title: string) =>
    `You already have an active plan: "${title}". Complete or cancel it before creating a new one.`,

  /**
   * Plan created successfully
   */
  planCreated: (title: string) =>
    `Plan created: "${title}"\n\nPlease review and provide feedback, or say "approve" when ready.`,

  /**
   * Plan updated with feedback
   */
  feedbackApplied: (version: number) =>
    `Feedback applied (version ${version}). Review the updated plan and provide more feedback or approve it.`,

  /**
   * Plan approved
   */
  planApproved: (title: string) =>
    `Plan "${title}" approved! Say "execute" or "run it" when you're ready to start.`,

  /**
   * Execution started
   */
  executionStarted: (title: string) =>
    `Execution started for "${title}"! I'll keep you updated on progress.`,

  /**
   * Execution already running
   */
  executionAlreadyRunning: (title: string) =>
    `Plan "${title}" is already being executed. Check status with "what's the status?"`,

  /**
   * Cannot execute - wrong state
   */
  cannotExecute: (currentState: string) =>
    `Cannot execute plan in '${currentState}' state. Plan must be approved first.`,

  /**
   * Plan cancelled
   */
  planCancelled: (title: string) =>
    `Plan "${title}" has been cancelled.`,

  /**
   * Execution stopped
   */
  executionStopped: (title: string) =>
    `Execution of "${title}" has been stopped.`,

  /**
   * No plans found
   */
  noPlansFound: "You don't have any plans yet. Create one by saying 'create a plan to...'",

  /**
   * Error occurred
   */
  error: (message: string) =>
    `Something went wrong: ${message}. Please try again.`,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format plan state for display
 */
function formatPlanState(state: string): string {
  const stateEmojis: Record<string, string> = {
    idle: '⚪ Idle',
    proposing: '📝 Proposing',
    feedback: '💬 Awaiting Feedback',
    approved: '✅ Approved',
    executing: '🔄 Executing',
    completed: '✨ Completed',
    failed: '❌ Failed',
  };
  return stateEmojis[state] || state;
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

export { formatPlanState, formatNumber };
