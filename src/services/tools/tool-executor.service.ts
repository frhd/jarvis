import { logger } from '../../utils/logger.js';
import { WebSearchTool, WebSearchToolResult } from './web-search.tool.js';
import type { ToolCall } from '../../clients/llm.client.js';

/**
 * Tool Result Interface
 *
 * Represents the result of executing a tool, including success status,
 * the formatted result for LLM consumption, and raw data.
 */
export interface ToolResult {
  success: boolean;
  toolName: string;
  result: string; // Formatted result for LLM consumption
  rawResult?: unknown; // Raw result data for programmatic access
  error?: string;
  durationMs: number;
}

/**
 * Tool Handler Interface
 *
 * Any tool that can be executed must implement this interface.
 */
export interface ToolHandler {
  name: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Tool Executor Configuration
 */
export interface ToolExecutorConfig {
  maxConcurrentTools?: number;
  defaultTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ToolExecutorConfig> = {
  maxConcurrentTools: 5,
  defaultTimeoutMs: 60000, // 60 seconds to match LLM timeout and allow time for web search with rate limiting
};

/**
 * Tool Executor Service
 *
 * Registry-based tool execution service that manages tool handlers
 * and executes tool calls from LLM responses.
 *
 * Key responsibilities:
 * - Register and manage tool handlers
 * - Execute tool calls with timeout handling
 * - Format results for LLM consumption
 * - Provide concurrent tool execution
 */
export class ToolExecutorService {
  private config: Required<ToolExecutorConfig>;
  private handlers: Map<string, ToolHandler> = new Map();

  constructor(config?: ToolExecutorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultHandlers();
  }

  /**
   * Register default tool handlers (web search, etc.)
   */
  private registerDefaultHandlers(): void {
    // Register web search tool
    const webSearchTool = new WebSearchTool();
    this.registerHandler({
      name: 'web_search',
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const startTime = Date.now();
        const query = args.query as string;

        if (!query || typeof query !== 'string') {
          return {
            success: false,
            toolName: 'web_search',
            result: 'Invalid query: query must be a non-empty string',
            error: 'Invalid query parameter',
            durationMs: Date.now() - startTime,
          };
        }

        const searchResult = await webSearchTool.execute(query);

        return {
          success: searchResult.success,
          toolName: 'web_search',
          result: webSearchTool.formatForLLM(searchResult),
          rawResult: searchResult,
          error: searchResult.error,
          durationMs: searchResult.durationMs,
        };
      },
    });

    logger.debug('[ToolExecutor] Default handlers registered', {
      handlers: Array.from(this.handlers.keys()),
    });
  }

  /**
   * Register a tool handler
   *
   * @param handler - The tool handler to register
   */
  registerHandler(handler: ToolHandler): void {
    if (this.handlers.has(handler.name)) {
      logger.warn('[ToolExecutor] Overwriting existing handler', {
        toolName: handler.name,
      });
    }
    this.handlers.set(handler.name, handler);
    logger.debug('[ToolExecutor] Handler registered', { toolName: handler.name });
  }

  /**
   * Unregister a tool handler
   *
   * @param name - The name of the handler to remove
   */
  unregisterHandler(name: string): boolean {
    return this.handlers.delete(name);
  }

  /**
   * Get list of registered tool names
   */
  getRegisteredTools(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a tool is registered
   *
   * @param name - The tool name to check
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Execute a single tool call
   *
   * @param toolCall - The tool call to execute (from LLM response)
   * @returns ToolResult with execution status and formatted result
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    const toolName = toolCall.function.name;
    const args = toolCall.function.arguments;

    logger.info('[ToolExecutor] Executing tool', {
      toolName,
      argsKeys: Object.keys(args),
    });

    const handler = this.handlers.get(toolName);

    if (!handler) {
      logger.warn('[ToolExecutor] Unknown tool requested', { toolName });
      return {
        success: false,
        toolName,
        result: `Unknown tool: ${toolName}. Available tools: ${this.getRegisteredTools().join(', ')}`,
        error: `Tool not found: ${toolName}`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        handler.execute(args),
        this.config.defaultTimeoutMs,
        toolName
      );

      logger.info('[ToolExecutor] Tool execution completed', {
        toolName,
        success: result.success,
        durationMs: result.durationMs,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;

      logger.error('[ToolExecutor] Tool execution failed', {
        toolName,
        error: errorMessage,
        durationMs,
      });

      return {
        success: false,
        toolName,
        result: `Tool execution failed: ${errorMessage}`,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Execute multiple tool calls (sequentially or in parallel based on config)
   *
   * @param toolCalls - Array of tool calls to execute
   * @param parallel - Whether to execute in parallel (default: true)
   * @returns Array of ToolResults in the same order as input
   */
  async executeMany(toolCalls: ToolCall[], parallel: boolean = true): Promise<ToolResult[]> {
    if (toolCalls.length === 0) {
      return [];
    }

    logger.info('[ToolExecutor] Executing multiple tools', {
      count: toolCalls.length,
      parallel,
      tools: toolCalls.map((tc) => tc.function.name),
    });

    if (parallel) {
      // Execute in parallel with concurrency limit
      const results: ToolResult[] = [];
      for (let i = 0; i < toolCalls.length; i += this.config.maxConcurrentTools) {
        const batch = toolCalls.slice(i, i + this.config.maxConcurrentTools);
        const batchResults = await Promise.all(batch.map((tc) => this.execute(tc)));
        results.push(...batchResults);
      }
      return results;
    } else {
      // Execute sequentially
      const results: ToolResult[] = [];
      for (const toolCall of toolCalls) {
        results.push(await this.execute(toolCall));
      }
      return results;
    }
  }

  /**
   * Format tool results for LLM continuation
   *
   * @param results - Array of tool results to format
   * @returns Formatted string for LLM context
   */
  formatResultsForLLM(results: ToolResult[]): string {
    if (results.length === 0) {
      return '';
    }

    return results
      .map((result) => {
        if (result.success) {
          return `[${result.toolName}]\n${result.result}`;
        } else {
          return `[${result.toolName}] Error: ${result.error || 'Unknown error'}`;
        }
      })
      .join('\n\n---\n\n');
  }

  /**
   * Execute a promise with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    toolName: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Get tool definitions for LLM tool calling
   */
  getToolDefinitions() {
    return [WebSearchTool.getToolDefinition()];
  }
}

// Export singleton instance
export const toolExecutor = new ToolExecutorService();
