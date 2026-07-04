# /add-tool - Create New Tool

Create a new tool for the tool executor system (for LLM tool calling).

## When to Use

- Adding new capabilities for the LLM to use
- Integrating external APIs
- Creating calculation/utility tools

## Tool System Architecture

```
src/services/tools/
├── tool-executor.service.ts   # Registry and execution
├── tool-result-validator.ts   # Result validation
├── web-search.tool.ts         # Example: DuckDuckGo search
└── <new-tool>.tool.ts         # Your new tool
```

## Tool Interface

```typescript
export interface ToolHandler {
  name: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  toolName: string;
  result: string;       // Formatted for LLM
  rawResult?: unknown;  // Raw data
  error?: string;
  durationMs: number;
}
```

## Tool Template

```typescript
// src/services/tools/<name>.tool.ts

import { logger } from '../../utils/logger.js';

/**
 * Tool result interface
 */
export interface <Name>ToolResult {
  success: boolean;
  data?: <ResultType>;
  error?: string;
  durationMs: number;
}

/**
 * Tool configuration
 */
export interface <Name>ToolConfig {
  timeoutMs?: number;
  // Add tool-specific config
}

const DEFAULT_CONFIG: Required<<Name>ToolConfig> = {
  timeoutMs: 30000,
};

/**
 * <Name> Tool
 *
 * <Description of what this tool does>
 */
export class <Name>Tool {
  private config: Required<<Name>ToolConfig>;

  constructor(config?: <Name>ToolConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute the tool
   */
  async execute(input: string): Promise<<Name>ToolResult> {
    const startTime = Date.now();

    try {
      logger.info('[<Name>Tool] Executing', { input });

      // Tool implementation here
      const result = await this.doWork(input);

      return {
        success: true,
        data: result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[<Name>Tool] Execution failed', { input, error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async doWork(input: string): Promise<<ResultType>> {
    // Actual implementation
    throw new Error('Not implemented');
  }

  /**
   * Format result for LLM consumption
   */
  formatForLLM(result: <Name>ToolResult): string {
    if (!result.success) {
      return `Error: ${result.error}`;
    }
    // Format the result as a string the LLM can understand
    return JSON.stringify(result.data, null, 2);
  }

  /**
   * Get tool definition for LLM tool calling
   */
  static getToolDefinition() {
    return {
      type: 'function' as const,
      function: {
        name: '<tool_name>',
        description: '<Description for LLM>',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: '<Parameter description>',
            },
            // Add more parameters as needed
          },
          required: ['input'],
        },
      },
    };
  }
}
```

## Registering the Tool

Add to `tool-executor.service.ts` in `registerDefaultHandlers()`:

```typescript
private registerDefaultHandlers(): void {
  // Existing handlers...

  // Register new tool
  const <name>Tool = new <Name>Tool();
  this.registerHandler({
    name: '<tool_name>',
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const startTime = Date.now();
      const input = args.input as string;

      if (!input || typeof input !== 'string') {
        return {
          success: false,
          toolName: '<tool_name>',
          result: 'Invalid input: input must be a non-empty string',
          error: 'Invalid input parameter',
          durationMs: Date.now() - startTime,
        };
      }

      const toolResult = await <name>Tool.execute(input);

      return {
        success: toolResult.success,
        toolName: '<tool_name>',
        result: <name>Tool.formatForLLM(toolResult),
        rawResult: toolResult,
        error: toolResult.error,
        durationMs: toolResult.durationMs,
      };
    },
  });
}
```

## Add Tool Definition

In `getToolDefinitions()`:

```typescript
getToolDefinitions() {
  return [
    WebSearchTool.getToolDefinition(),
    <Name>Tool.getToolDefinition(),  // Add new tool
  ];
}
```

## Example: Calculator Tool

```typescript
// src/services/tools/calculator.tool.ts
import { logger } from '../../utils/logger.js';

export interface CalculatorResult {
  success: boolean;
  result?: number;
  expression?: string;
  error?: string;
  durationMs: number;
}

export class CalculatorTool {
  async execute(expression: string): Promise<CalculatorResult> {
    const startTime = Date.now();

    try {
      // Safe evaluation (no eval!)
      const result = this.safeEvaluate(expression);

      return {
        success: true,
        result,
        expression,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Calculation failed',
        durationMs: Date.now() - startTime,
      };
    }
  }

  private safeEvaluate(expr: string): number {
    // Implement safe math evaluation
    // Use a library like mathjs for safety
    throw new Error('Not implemented - use mathjs');
  }

  formatForLLM(result: CalculatorResult): string {
    if (!result.success) {
      return `Calculation error: ${result.error}`;
    }
    return `${result.expression} = ${result.result}`;
  }

  static getToolDefinition() {
    return {
      type: 'function' as const,
      function: {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")',
            },
          },
          required: ['expression'],
        },
      },
    };
  }
}
```

## Checklist

- [ ] Create tool file: `src/services/tools/<name>.tool.ts`
- [ ] Define result interface
- [ ] Implement `execute()` method
- [ ] Implement `formatForLLM()` method
- [ ] Create static `getToolDefinition()`
- [ ] Register in `tool-executor.service.ts`
- [ ] Add to `getToolDefinitions()` array
- [ ] Test the tool

## Troubleshooting

### Tool Not Being Called
- Verify tool is registered in `registerDefaultHandlers()`
- Check tool definition is in `getToolDefinitions()` array
- Ensure tool name matches exactly in registration and definition

### Tool Returns Error
- Check input validation in the handler
- Verify external API credentials and connectivity
- Review timeout settings for long-running operations

### LLM Not Using the Tool
- Improve tool description to be more specific
- Check if tool parameters match expected LLM format
- Verify `supportsToolCalling()` returns true for the provider

## Reference

- Tool executor: `src/services/tools/tool-executor.service.ts`
- Example tool: `src/services/tools/web-search.tool.ts`
- Tool types: `src/clients/llm.client.ts` (ToolCall interface)
