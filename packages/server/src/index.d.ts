/**
 * @mctx-ai/mcp-server TypeScript Definitions
 *
 * Build MCP servers with an Express-like API - no protocol knowledge required.
 */

/// <reference types="node" />

// ============================================================================
// Core Server Types
// ============================================================================

/**
 * MCP Server instance with tool, resource, and prompt registration methods.
 * Compatible with Cloudflare Workers fetch handler.
 */
export interface Server {
  /**
   * Register a tool handler.
   * Tools can be synchronous or asynchronous functions, or generator functions for progress tracking.
   *
   * @param name - Tool name (must be unique)
   * @param handler - Tool handler function
   * @returns Server instance for chaining
   *
   * @example
   * ```typescript
   * server.tool('add', (args: { a: number; b: number }) => {
   *   return args.a + args.b;
   * });
   * ```
   *
   * @example
   * // Generator tool with progress tracking
   * ```typescript
   * server.tool('migrate', function* (args: { sourceDb: string; targetDb: string }) {
   *   const step = createProgress(5);
   *   yield step(); // Progress: 1/5
   *   // ... do work
   *   return "Migration complete";
   * });
   * ```
   */
  tool(name: string, handler: ToolHandler | GeneratorToolHandler): Server;

  /**
   * Register a resource handler.
   * Resources can be static URIs or URI templates with {param} placeholders.
   *
   * @param uri - Resource URI (may contain {param} templates)
   * @param handler - Resource handler function
   * @returns Server instance for chaining
   *
   * @example
   * ```typescript
   * // Static resource
   * server.resource('db://customers/schema', () => {
   *   return JSON.stringify({ ... });
   * });
   *
   * // Dynamic resource with template
   * server.resource('db://customers/{id}', (params) => {
   *   return getCustomer(params.id);
   * });
   * ```
   */
  resource(uri: string, handler: ResourceHandler): Server;

  /**
   * Register a prompt handler.
   * Prompts return messages for LLM conversation initialization.
   *
   * @param name - Prompt name (must be unique)
   * @param handler - Prompt handler function
   * @returns Server instance for chaining
   *
   * @example
   * ```typescript
   * server.prompt('code-review', (args: { code: string }) => {
   *   return conversation(({ user }) => [
   *     user.say("Review this code:"),
   *     user.say(args.code),
   *   ]);
   * });
   * ```
   */
  prompt(name: string, handler: PromptHandler): Server;

  /**
   * Cloudflare Worker fetch handler.
   * Processes JSON-RPC 2.0 requests over HTTP POST.
   *
   * @param request - HTTP request object
   * @param env - Environment variables (optional)
   * @param ctx - Execution context (optional)
   * @returns HTTP response
   *
   * @example
   * ```typescript
   * // Cloudflare Worker
   * export default {
   *   fetch: server.fetch,
   * };
   * ```
   */
  fetch(request: Request, env?: any, ctx?: any): Promise<Response>;
}

/**
 * Server configuration options.
 */
export interface ServerOptions {
  /**
   * Instructions for LLM clients using this server.
   * Helps guide the LLM on how to use the server's capabilities.
   *
   * @example
   * "This server provides tools for managing customer data. Use list_customers to browse, get_customer to fetch details."
   */
  instructions?: string;
}

/**
 * Creates an MCP server instance.
 *
 * @param options - Server configuration options
 * @returns Server instance with registration methods and fetch handler
 *
 * @example
 * ```typescript
 * import { createServer, T } from '@mctx-ai/mcp-server';
 *
 * const server = createServer({
 *   instructions: "You help developers debug CI pipelines..."
 * });
 *
 * server.tool('greet', (args: { name: string }) => {
 *   return `Hello, ${args.name}!`;
 * });
 *
 * export default { fetch: server.fetch };
 * ```
 */
export function createServer(options?: ServerOptions): Server;

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Tool handler function (non-generator).
 * Receives arguments and optional ask function for LLM sampling.
 *
 * @param args - Tool arguments (validated against handler.input schema)
 * @param ask - Optional LLM sampling function (null if not supported)
 * @returns Tool result (string, object, or Promise thereof)
 */
export type ToolHandler = {
  (args: Record<string, any>, ask?: AskFunction | null): any | Promise<any>;
  /** Tool description for documentation */
  description?: string;
  /** Input schema definition using T types */
  input?: Record<string, SchemaDefinition>;
  /** MIME type for binary results (optional) */
  mimeType?: string;
};

/**
 * Generator tool handler function (for progress tracking).
 * Yields progress notifications and returns final result.
 *
 * @param args - Tool arguments
 * @param ask - Optional LLM sampling function
 * @yields Progress notifications or intermediate values
 * @returns Final tool result
 *
 * @example
 * ```typescript
 * function* migrate(args: { tables: string[] }): Generator<ProgressNotification, string> {
 *   const step = createProgress(args.tables.length);
 *   for (const table of args.tables) {
 *     yield step();
 *     // ... process table
 *   }
 *   return "Migration complete";
 * }
 * ```
 */
export type GeneratorToolHandler = {
  (
    args: Record<string, any>,
    ask?: AskFunction | null,
  ): Generator<any, any, any> | AsyncGenerator<any, any, any>;
  description?: string;
  input?: Record<string, SchemaDefinition>;
  mimeType?: string;
};

/**
 * Resource handler function.
 * Returns resource content (string, binary data, or object).
 *
 * @param params - Extracted URI template parameters (e.g., { id: '123' })
 * @param ask - Optional LLM sampling function
 * @returns Resource content
 */
export type ResourceHandler = {
  (
    params: Record<string, string>,
    ask?: AskFunction | null,
  ): any | Promise<any>;
  /** Resource name for display */
  name?: string;
  /** Resource description */
  description?: string;
  /** MIME type (default: 'text/plain') */
  mimeType?: string;
};

/**
 * Prompt handler function.
 * Returns messages for LLM conversation or a conversation result.
 *
 * @param args - Prompt arguments
 * @param ask - Optional LLM sampling function
 * @returns Prompt messages (string, conversation result, or message array)
 */
export type PromptHandler = {
  (
    args: Record<string, any>,
    ask?: AskFunction | null,
  ):
    | string
    | ConversationResult
    | Message[]
    | Promise<string | ConversationResult | Message[]>;
  /** Prompt description */
  description?: string;
  /** Input schema definition using T types */
  input?: Record<string, SchemaDefinition>;
};

/**
 * LLM sampling function.
 * Allows tools to request AI completions from the client.
 * Overloaded to accept either a simple string prompt or advanced options.
 *
 * @param prompt - Simple text prompt
 * @returns LLM response content
 *
 * @example
 * ```typescript
 * // Simple usage
 * const summary = await ask("Summarize this document: " + doc);
 * ```
 *
 * @example
 * // Advanced usage
 * ```typescript
 * const result = await ask({
 *   messages: [
 *     { role: "user", content: { type: "text", text: "What is the capital of France?" } }
 *   ],
 *   modelPreferences: {
 *     hints: [{ name: "claude-3-5-sonnet" }]
 *   },
 *   maxTokens: 1000,
 * });
 * ```
 */
export type AskFunction = {
  (prompt: string): Promise<string | Record<string, unknown>>;
  (options: SamplingOptions): Promise<string | Record<string, unknown>>;
};

/**
 * Options for LLM sampling requests.
 */
export interface SamplingOptions {
  /** Array of conversation messages */
  messages: Message[];
  /** Model preferences (optional) */
  modelPreferences?: {
    hints?: Array<{ name: string }>;
  };
  /** System prompt (optional) */
  systemPrompt?: string;
  /** Maximum tokens to generate (optional) */
  maxTokens?: number;
  /** Temperature for sampling (optional, 0.0-1.0) */
  temperature?: number;
  /** Top-p sampling parameter (optional, 0.0-1.0) */
  topP?: number;
  /** Stop sequences (optional) */
  stopSequences?: string[];
}

// ============================================================================
// JSON Schema Type System (T)
// ============================================================================

/**
 * Schema definition created by T type builders.
 * Represents a JSON Schema property with optional metadata.
 */
export interface SchemaDefinition {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: any[];
  default?: any;
  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  // Number constraints
  minimum?: number;
  maximum?: number;
  // Array constraints
  items?: SchemaDefinition;
  // Object constraints
  properties?: Record<string, SchemaDefinition>;
  required?: string[];
  additionalProperties?: boolean | SchemaDefinition;
  // Internal metadata (removed by buildInputSchema)
  _required?: boolean;
}

/**
 * Options for string type schemas.
 */
export interface StringOptions {
  /** Mark field as required (metadata for buildInputSchema) */
  required?: boolean;
  /** Field description */
  description?: string;
  /** Allowed values (enum) */
  enum?: string[];
  /** Default value */
  default?: string;
  /** Minimum string length */
  minLength?: number;
  /** Maximum string length */
  maxLength?: number;
  /** Regex pattern */
  pattern?: string;
  /** Format hint (e.g., 'email', 'uri', 'date-time') */
  format?: string;
}

/**
 * Options for number type schemas.
 */
export interface NumberOptions {
  /** Mark field as required */
  required?: boolean;
  /** Field description */
  description?: string;
  /** Allowed values (enum) */
  enum?: number[];
  /** Default value */
  default?: number;
  /** Minimum value (maps to 'minimum') */
  min?: number;
  /** Maximum value (maps to 'maximum') */
  max?: number;
}

/**
 * Options for boolean type schemas.
 */
export interface BooleanOptions {
  /** Mark field as required */
  required?: boolean;
  /** Field description */
  description?: string;
  /** Default value */
  default?: boolean;
}

/**
 * Options for array type schemas.
 */
export interface ArrayOptions {
  /** Mark field as required */
  required?: boolean;
  /** Field description */
  description?: string;
  /** Schema for array items */
  items?: SchemaDefinition;
  /** Default value */
  default?: any[];
}

/**
 * Options for object type schemas.
 */
export interface ObjectOptions {
  /** Mark field as required */
  required?: boolean;
  /** Field description */
  description?: string;
  /** Nested property schemas */
  properties?: Record<string, SchemaDefinition>;
  /** Allow additional properties (boolean or schema) */
  additionalProperties?: boolean | SchemaDefinition;
  /** Default value */
  default?: Record<string, any>;
}

/**
 * T - JSON Schema type system for tool and prompt inputs.
 * Provides factory methods to build JSON Schema objects with a clean API.
 *
 * @example
 * ```typescript
 * import { T } from '@mctx-ai/mcp-server';
 *
 * const handler = {
 *   input: {
 *     name: T.string({ required: true, description: "User name" }),
 *     age: T.number({ min: 0, max: 150 }),
 *     role: T.string({ enum: ['admin', 'user', 'guest'] }),
 *     tags: T.array({ items: T.string() }),
 *     metadata: T.object({
 *       properties: {
 *         createdAt: T.string({ format: 'date-time' }),
 *       },
 *     }),
 *   },
 * };
 * ```
 */
export const T: {
  /**
   * Creates a string type schema.
   *
   * @param options - Schema options
   * @returns JSON Schema object
   */
  string(options?: StringOptions): SchemaDefinition;

  /**
   * Creates a number type schema.
   *
   * @param options - Schema options
   * @returns JSON Schema object
   */
  number(options?: NumberOptions): SchemaDefinition;

  /**
   * Creates a boolean type schema.
   *
   * @param options - Schema options
   * @returns JSON Schema object
   */
  boolean(options?: BooleanOptions): SchemaDefinition;

  /**
   * Creates an array type schema.
   *
   * @param options - Schema options
   * @returns JSON Schema object
   */
  array(options?: ArrayOptions): SchemaDefinition;

  /**
   * Creates an object type schema.
   *
   * @param options - Schema options
   * @returns JSON Schema object
   */
  object(options?: ObjectOptions): SchemaDefinition;
};

/**
 * Builds a complete MCP input schema from handler input definition.
 * Extracts required fields and removes internal metadata.
 *
 * @param input - Handler input definition using T types
 * @returns Valid JSON Schema for MCP inputSchema
 *
 * @example
 * ```typescript
 * const inputSchema = buildInputSchema({
 *   name: T.string({ required: true }),
 *   age: T.number(),
 * });
 * // => { type: 'object', properties: { name: {...}, age: {...} }, required: ['name'] }
 * ```
 */
export function buildInputSchema(input?: Record<string, SchemaDefinition>): {
  type: "object";
  properties: Record<string, SchemaDefinition>;
  required?: string[];
};

// ============================================================================
// Conversation Builder
// ============================================================================

/**
 * Message object in MCP format.
 */
export interface Message {
  /** Message role */
  role: "user" | "assistant";
  /** Message content */
  content: TextContent | ImageContent | ResourceContent;
}

/**
 * Text content type.
 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * Image content type (base64-encoded).
 */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * Resource content type (embedded resource).
 */
export interface ResourceContent {
  type: "resource";
  resource: {
    uri: string;
    text: string;
  };
}

/**
 * Result returned by conversation() builder.
 */
export interface ConversationResult {
  messages: Message[];
}

/**
 * Role helper object provided to conversation builder.
 */
export interface RoleHelper {
  /**
   * Add a text message.
   *
   * @param text - The text content
   * @returns MCP message object
   */
  say(text: string): Message;

  /**
   * Attach an image (base64 data).
   *
   * @param data - Base64-encoded image data
   * @param mimeType - MIME type (e.g., "image/png", "image/jpeg")
   * @returns MCP message object
   */
  attach(data: string, mimeType: string): Message;

  /**
   * Embed a resource by URI.
   *
   * @param uri - The resource URI to embed
   * @returns MCP message object
   */
  embed(uri: string): Message;
}

/**
 * Conversation builder helpers.
 */
export interface ConversationHelpers {
  /** User role helper */
  user: RoleHelper;
  /** Assistant role helper */
  ai: RoleHelper;
}

/**
 * Creates a conversation using a builder function.
 * Provides clean API for constructing MCP prompt messages.
 *
 * @param builderFn - Function that receives { user, ai } helpers
 * @returns MCP prompt result: { messages: [...] }
 *
 * @example
 * ```typescript
 * const result = conversation(({ user, ai }) => [
 *   user.say("What's in this image?"),
 *   user.attach(imageData, "image/png"),
 *   ai.say("I see a customer schema..."),
 * ]);
 * ```
 */
export function conversation(
  builderFn: (helpers: ConversationHelpers) => Message[],
): ConversationResult;

// ============================================================================
// Progress Tracking
// ============================================================================

/**
 * Progress notification object.
 * Yielded by generator tools to report progress.
 */
export interface ProgressNotification {
  type: "progress";
  /** Current step number (1-indexed) */
  progress: number;
  /** Total steps (optional, for determinate progress) */
  total?: number;
}

/**
 * Progress step function.
 * Call to generate next progress notification.
 */
export type StepFunction = () => ProgressNotification;

/**
 * Creates a progress step function for generator-based tools.
 * Each call auto-increments the progress counter.
 *
 * @param total - Total number of steps (optional, for determinate progress)
 * @returns Step function that returns progress notification objects
 *
 * @example
 * ```typescript
 * // Determinate progress (with known total)
 * function* migrate(args: { tables: string[] }) {
 *   const step = createProgress(args.tables.length);
 *   for (const table of args.tables) {
 *     yield step();  // { type: "progress", progress: 1, total: 5 }
 *     await copyTable(table);
 *   }
 *   return "Migration complete";
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Indeterminate progress (no total)
 * function* processQueue() {
 *   const step = createProgress();
 *   while (hasMessages()) {
 *     yield step();  // { type: "progress", progress: 1 }
 *     await processMessage();
 *   }
 *   return "Queue processed";
 * }
 * ```
 */
export function createProgress(total?: number): StepFunction;

/**
 * Default configuration for generator guardrails.
 * Server uses these to prevent runaway generators.
 */
export const PROGRESS_DEFAULTS: {
  /** Maximum execution time in milliseconds (60 seconds) */
  maxExecutionTime: number;
  /** Maximum number of yields (10,000) */
  maxYields: number;
};

// ============================================================================
// Logging
// ============================================================================

/**
 * Log severity level (RFC 5424).
 */
export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/**
 * Log object with methods for each severity level.
 * Creates log notifications that are buffered and sent by the server.
 *
 * @example
 * ```typescript
 * import { log } from '@mctx-ai/mcp-server';
 *
 * log.debug('Variable value:', { x: 42 });
 * log.info('Server started on port 3000');
 * log.warning('Rate limit approaching');
 * log.error('Database connection failed', error);
 * log.critical('System out of memory');
 * ```
 */
export const log: {
  /**
   * Debug-level message (lowest severity).
   * Used for detailed debugging information.
   *
   * @param data - Log data (any JSON-serializable value)
   */
  debug(data: any): void;

  /**
   * Informational message.
   * Used for general informational messages.
   *
   * @param data - Log data
   */
  info(data: any): void;

  /**
   * Notice - normal but significant condition.
   * Used for important events that are not errors.
   *
   * @param data - Log data
   */
  notice(data: any): void;

  /**
   * Warning condition.
   * Used for warnings that don't prevent operation.
   *
   * @param data - Log data
   */
  warning(data: any): void;

  /**
   * Error condition.
   * Used for errors that affect functionality.
   *
   * @param data - Log data
   */
  error(data: any): void;

  /**
   * Critical condition.
   * Used for critical conditions requiring immediate attention.
   *
   * @param data - Log data
   */
  critical(data: any): void;

  /**
   * Alert - action must be taken immediately.
   * Used for conditions requiring immediate operator intervention.
   *
   * @param data - Log data
   */
  alert(data: any): void;

  /**
   * Emergency - system is unusable.
   * Used for system-wide failures.
   *
   * @param data - Log data
   */
  emergency(data: any): void;
};
