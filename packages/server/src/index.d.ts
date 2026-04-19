/**
 * @mctx-ai/mcp TypeScript Definitions
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
   *
   * @param name - Tool name (must be unique)
   * @param handler - Tool handler function
   * @returns Server instance for chaining
   *
   * @example
   * ```typescript
   * server.tool('add', (mctx, req: { a: number; b: number }, res) => {
   *   res.send(req.a + req.b);
   * });
   * ```
   */
  tool(name: string, handler: ToolHandler): Server;

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
   * server.resource('db://customers/schema', (mctx, req, res) => {
   *   res.send(JSON.stringify({ ... }));
   * });
   *
   * // Dynamic resource with template
   * server.resource('db://customers/{id}', (mctx, req, res) => {
   *   res.send(getCustomer(req.id));
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
   * server.prompt('code-review', (mctx, req: { code: string }, res) => {
   *   res.send(conversation(({ user }) => [
   *     user.say("Review this code:"),
   *     user.say(req.code),
   *   ]));
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
 * import { createServer, T } from '@mctx-ai/mcp';
 *
 * const server = createServer({
 *   instructions: "You help developers debug CI pipelines..."
 * });
 *
 * server.tool('greet', (mctx, req: { name: string }, res) => {
 *   res.send(`Hello, ${req.name}!`);
 * });
 *
 * export default { fetch: server.fetch };
 * ```
 */
export function createServer(options?: ServerOptions): Server;

// ============================================================================
// Context Types
// ============================================================================

/**
 * Request context passed as the first argument to all handler functions.
 * Populated from HTTP headers injected by the mctx dispatch worker.
 */
export interface ModelContext {
  /**
   * Authenticated user ID, extracted from the X-Mctx-User-Id request header.
   * Undefined when no user ID header is present.
   */
  userId?: string;
}

// ============================================================================
// Response Output Port
// ============================================================================

/**
 * Response output port passed as the third argument to all handler functions.
 * Provides methods for sending results, reporting progress, and requesting
 * LLM completions.
 */
export interface Response {
  /**
   * Send the handler result.
   * Captures the result to be returned in the JSON-RPC response.
   *
   * @param result - The handler result (string, object, binary, etc.)
   *
   * @example
   * ```typescript
   * function myTool(mctx, req, res) {
   *   res.send("done");
   * }
   * ```
   */
  send(result: any): void;

  /**
   * Report progress for long-running operations.
   * Sends an MCP progress notification to the client.
   *
   * @param current - Current progress value
   * @param total - Total progress value (optional, for determinate progress)
   *
   * @example
   * ```typescript
   * async function myTool(mctx, req, res) {
   *   for (let i = 0; i < 10; i++) {
   *     await doWork();
   *     res.progress(i + 1, 10);
   *   }
   *   res.send("done");
   * }
   * ```
   */
  progress(current: number, total?: number): void;

  /**
   * Request an LLM completion from the client.
   * Allows handlers to use LLM-in-the-loop patterns.
   * Returns null if the client does not support sampling.
   *
   * @param prompt - Simple text prompt or advanced sampling options
   * @returns LLM response content, or null if sampling unsupported
   *
   * @example
   * ```typescript
   * async function myTool(mctx, req, res) {
   *   const summary = await res.ask("Summarize: " + req.text);
   *   res.send(summary);
   * }
   * ```
   */
  ask: AskFunction | null;
}

// ============================================================================
// Handler Types
// ============================================================================

/**
 * MCP tool annotation hints.
 * Provides behavioral hints to clients for appropriate UI and permission prompts.
 * Per the MCP spec 2025-11-25.
 */
export interface ToolAnnotations {
  /**
   * Hint that the tool only reads data and does not modify state.
   * Clients may use this to show a less prominent permission prompt.
   */
  readOnlyHint?: boolean;
  /**
   * Hint that the tool may perform destructive or irreversible actions.
   * Clients may use this to show a more prominent warning prompt.
   */
  destructiveHint?: boolean;
  /**
   * Hint that the tool may interact with external systems or the open world
   * (e.g., make network requests, read from the filesystem).
   */
  openWorldHint?: boolean;
  /**
   * Hint that the tool can be called repeatedly with the same arguments without
   * causing additional side effects beyond the first call.
   * Clients may use this to safely retry or re-run the tool.
   */
  idempotentHint?: boolean;
}

/**
 * Tool handler function.
 * Receives context, request args, and response output port.
 *
 * @param mctx - ModelContext with optional userId
 * @param req - Tool arguments (validated against handler.input schema)
 * @param res - Response output port: { send, progress, ask }
 *
 * @example
 * ```typescript
 * function myTool(mctx: ModelContext, req: { name: string }, res: Response) {
 *   res.send(`Hello, ${req.name}!`);
 * }
 * myTool.description = "Greet someone";
 * myTool.input = { name: T.string({ required: true }) };
 * ```
 */
export type ToolHandler = {
  (mctx: ModelContext, req: Record<string, any>, res: Response): void | Promise<void>;
  /** Tool description for documentation */
  description?: string;
  /** Input schema definition using T types */
  input?: Record<string, SchemaDefinition>;
  /** MIME type for binary results (optional) */
  mimeType?: string;
  /** Behavioral hint annotations for MCP clients */
  annotations?: ToolAnnotations;
};

/**
 * Resource handler function.
 * Returns resource content via res.send().
 *
 * @param mctx - ModelContext with optional userId
 * @param req - Extracted URI template parameters (e.g., { id: '123' })
 * @param res - Response output port: { send, progress, ask }
 *
 * @example
 * ```typescript
 * function myResource(mctx: ModelContext, req: { id: string }, res: Response) {
 *   res.send(getItem(req.id));
 * }
 * ```
 */
export type ResourceHandler = {
  (mctx: ModelContext, req: Record<string, string>, res: Response): void | Promise<void>;
  /** Resource name for display */
  name?: string;
  /** Resource description */
  description?: string;
  /** MIME type (default: 'text/plain') */
  mimeType?: string;
};

/**
 * Prompt handler function.
 * Returns messages for LLM conversation via res.send().
 *
 * @param mctx - ModelContext with optional userId
 * @param req - Prompt arguments
 * @param res - Response output port: { send, progress, ask }
 *
 * @example
 * ```typescript
 * function myPrompt(mctx: ModelContext, req: { topic: string }, res: Response) {
 *   res.send(conversation(({ user }) => [
 *     user.say(`Tell me about: ${req.topic}`),
 *   ]));
 * }
 * ```
 */
export type PromptHandler = {
  (
    mctx: ModelContext,
    req: Record<string, any>,
    res: Response,
  ): void | Promise<void>;
  /** Prompt description */
  description?: string;
  /** Input schema definition using T types */
  input?: Record<string, SchemaDefinition>;
};

/**
 * LLM sampling function.
 * Allows handlers to request AI completions from the client via res.ask().
 * Overloaded to accept either a simple string prompt or advanced options.
 *
 * @param prompt - Simple text prompt
 * @returns LLM response content
 *
 * @example
 * ```typescript
 * // Simple usage
 * const summary = await res.ask("Summarize this document: " + doc);
 * ```
 *
 * @example
 * // Advanced usage
 * ```typescript
 * const result = await res.ask({
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
  /** Maps to JSON Schema 'minimum' */
  min?: number;
  /** Maps to JSON Schema 'maximum' */
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
 * import { T } from '@mctx-ai/mcp';
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
 * A buffered log notification object.
 * Produced by the log methods and stored until the server flushes them.
 */
export interface LogNotification {
  /** Always "log" */
  type: "log";
  /** RFC 5424 severity level */
  level: LogLevel;
  /** Log data (any JSON-serializable value) */
  data: any;
}

/**
 * Returns a copy of the current log buffer.
 * The server uses this to retrieve buffered log notifications before sending
 * them to MCP clients.
 *
 * @returns Array of log notification objects
 *
 * @example
 * ```typescript
 * import { getLogBuffer } from '@mctx-ai/mcp';
 *
 * const entries = getLogBuffer();
 * // => [{ type: 'log', level: 'info', data: 'Server started' }, ...]
 * ```
 */
export function getLogBuffer(): LogNotification[];

/**
 * Clears the log buffer.
 * The server calls this after flushing buffered notifications to clients.
 *
 * @example
 * ```typescript
 * import { clearLogBuffer } from '@mctx-ai/mcp';
 *
 * clearLogBuffer(); // Buffer is now empty
 * ```
 */
export function clearLogBuffer(): void;

/**
 * Log object with methods for each severity level.
 * Creates log notifications that are buffered and sent by the server.
 *
 * @example
 * ```typescript
 * import { log } from '@mctx-ai/mcp';
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
