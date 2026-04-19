/**
 * Core MCP Server Implementation
 *
 * Provides createServer() factory that returns a Cloudflare Worker-compatible
 * app with tool/resource/prompt registration and JSON-RPC 2.0 routing.
 */

import { createRequire } from "module";
import { buildInputSchema } from "./types.js";
import { matchUri, isTemplate } from "./uri.js";
import { generateCompletions } from "./completion.js";
import { setLogLevel } from "./log.js";
import {
  sanitizeError as securitySanitizeError,
  validateRequestSize,
  validateResponseSize,
  validateUriScheme,
  canonicalizePath,
  sanitizeInput,
} from "./security.js";
import { createAsk } from "./sampling.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

/**
 * HTTP Security Headers
 *
 * Defense in depth: Multiple security headers protect against common web attacks
 * - X-Content-Type-Options: Prevents MIME type sniffing
 * - Content-Security-Policy: Restricts resource loading (none for JSON API)
 * - X-Frame-Options: Prevents clickjacking
 */
const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
  "X-Frame-Options": "DENY",
};

/**
 * Safe JSON serialization handling circular refs, BigInt, Date
 * @param {*} value - Value to serialize
 * @returns {string} JSON string
 */
function safeSerialize(value) {
  const seen = new WeakSet();

  return JSON.stringify(value, (key, val) => {
    // Handle null/undefined
    if (val === undefined) return null;
    if (val === null) return null;

    // Handle primitives
    if (typeof val !== "object") {
      if (typeof val === "bigint") return val.toString();
      return val;
    }

    // Handle Date
    if (val instanceof Date) {
      return val.toISOString();
    }

    // Handle circular references
    if (seen.has(val)) {
      return "[Circular]";
    }
    seen.add(val);

    return val;
  });
}

/**
 * Sanitize error messages for production
 * Removes stack traces and redacts sensitive patterns
 * @param {Error} error - Error object
 * @returns {string} Sanitized message
 */
function sanitizeError(error) {
  // Determine if we're in production mode
  // Check NODE_ENV or default to production (fail secure)
  const isProduction = !process.env.NODE_ENV || process.env.NODE_ENV === "production";

  return securitySanitizeError(error, isProduction);
}

/**
 * Parse pagination cursor
 * @param {string|undefined} cursor - Base64 encoded offset
 * @returns {number} Offset number
 */
function parseCursor(cursor) {
  if (!cursor) return 0;

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const offset = parseInt(decoded, 10);
    return isNaN(offset) || offset < 0 ? 0 : offset;
  } catch {
    return 0;
  }
}

/**
 * Create pagination cursor
 * @param {number} offset - Offset number
 * @returns {string} Base64 encoded cursor
 */
function createCursor(offset) {
  return Buffer.from(String(offset), "utf-8").toString("base64");
}

/**
 * Paginate items array
 * @param {Array} items - Items to paginate
 * @param {string|undefined} cursor - Pagination cursor
 * @param {number} pageSize - Items per page (default 50)
 * @returns {{items: Array, nextCursor?: string}} Paginated result
 */
function paginate(items, cursor, pageSize = 50) {
  const offset = parseCursor(cursor);
  const paginatedItems = items.slice(offset, offset + pageSize);

  const result = { items: paginatedItems };

  // Add nextCursor if more items exist
  if (offset + pageSize < items.length) {
    result.nextCursor = createCursor(offset + pageSize);
  }

  return result;
}

/**
 * Create MCP server instance
 * @param {Object} [options] - Server configuration options
 * @param {string} [options.instructions] - Server instructions for LLM clients
 * @returns {Object} Server app with registration methods and fetch handler
 */
export function createServer(options = {}) {
  const { instructions } = options;

  // Internal registries
  const tools = new Map();
  const resources = new Map();
  const prompts = new Map();

  // Client capabilities stored during initialization.
  // Used to determine whether to provide an ask() function to handlers.
  let clientCapabilities = {};

  /**
   * Register a tool
   * @param {string} name - Tool name
   * @param {Function} handler - Tool handler function. Called as handler(mctx, req, res) where
   *   mctx is the request context with optional userId, req is the validated input args,
   *   and res is the response output port { send, progress, ask }.
   * @returns {Object} App instance (for chaining)
   */
  function tool(name, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Tool handler for "${name}" must be a function`);
    }

    tools.set(name, handler);
    return app;
  }

  /**
   * Register a resource
   * @param {string} uri - Resource URI (may contain {param} templates)
   * @param {Function} handler - Resource handler function. Called as handler(mctx, req, res) where
   *   mctx is the request context with optional userId, req contains URI template variables,
   *   and res is the response output port { send, progress, ask }.
   * @returns {Object} App instance (for chaining)
   */
  function resource(uri, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Resource handler for "${uri}" must be a function`);
    }

    resources.set(uri, handler);
    return app;
  }

  /**
   * Register a prompt
   * @param {string} name - Prompt name
   * @param {Function} handler - Prompt handler function. Called as handler(mctx, req, res) where
   *   mctx is the request context with optional userId, req is the validated input args,
   *   and res is the response output port { send, progress, ask }.
   * @returns {Object} App instance (for chaining)
   */
  function prompt(name, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Prompt handler for "${name}" must be a function`);
    }

    prompts.set(name, handler);
    return app;
  }

  /**
   * Handle tools/list request
   * @param {Object} params - Request params
   * @returns {Object} List of tools with pagination
   */
  function handleToolsList(params = {}) {
    const toolsList = Array.from(tools.entries()).map(([name, handler]) => {
      const tool = {
        name,
        description: handler.description || "",
        inputSchema: buildInputSchema(handler.input),
      };

      if (handler.annotations) {
        tool.annotations = handler.annotations;
      }

      return tool;
    });

    const { items, nextCursor } = paginate(toolsList, params.cursor);

    const result = { tools: items };
    if (nextCursor) result.nextCursor = nextCursor;

    return result;
  }

  /**
   * Handle tools/call request
   * @param {Object} params - Request params
   * @param {Object} [_meta] - Request metadata (_meta field, unused)
   * @param {string|null} [sessionId] - MCP session ID from request header
   * @param {Object} [mctx] - Request context (e.g. { userId })
   * @returns {Promise<Object>} Tool result
   */
  async function handleToolsCall(params, _meta = {}, sessionId = null, mctx = {}) {
    const { name, arguments: args } = params;

    if (!name) {
      throw new Error("Tool name is required");
    }

    const handler = tools.get(name);
    if (!handler) {
      throw new Error(`Tool "${name}" not found`);
    }

    // Sanitize arguments to prevent prototype pollution; fall back to empty object
    // when args is null/undefined
    const req = sanitizeInput(args || {});

    try {
      let capturedResult;

      // Construct the response output port
      const res = {
        send(result) {
          capturedResult = result;
        },
        progress(current, total) {
          // Send MCP progress notification via sendProgressNotification
          sendProgressNotification(sessionId, current, total);
        },
        ask: createAsk(buildSendRequest(sessionId), clientCapabilities),
      };

      // Call handler with new signature: handler(mctx, req, res)
      await handler(mctx, req, res);

      // Use result captured via res.send()
      const result = capturedResult;

      // Wrap result based on type
      if (typeof result === "string") {
        return {
          content: [{ type: "text", text: result }],
        };
      }

      // For objects/arrays, serialize safely
      const serialized = safeSerialize(result);
      return {
        content: [{ type: "text", text: serialized }],
      };
    } catch (error) {
      // Return error as content with isError flag
      const sanitized = sanitizeError(error);
      return {
        content: [{ type: "text", text: sanitized }],
        isError: true,
      };
    }
  }

  /**
   * Send an MCP progress notification to the client.
   * This is a fire-and-forget best-effort notification.
   * @private
   * @param {string|null} sessionId - MCP session ID
   * @param {number} current - Current progress value
   * @param {number} [total] - Total progress value (optional)
   */
  function sendProgressNotification(sessionId, current, total) {
    // Progress notifications are best-effort; errors are silently swallowed
    try {
      const sendRequest = buildSendRequest(sessionId);
      const params = { progress: current };
      if (total !== undefined) params.total = total;
      // Fire-and-forget — do not await
      sendRequest("notifications/progress", params).catch(() => {});
    } catch {
      // Silently ignore — progress is advisory
    }
  }

  /**
   * Handle resources/list request
   * @param {Object} params - Request params
   * @returns {Object} List of static resources with pagination
   */
  function handleResourcesList(params = {}) {
    // Only return static resources (not templates)
    const resourcesList = Array.from(resources.entries())
      .filter(([uri]) => !isTemplate(uri))
      .map(([uri, handler]) => ({
        uri,
        name: handler.name || uri,
        description: handler.description || "",
        mimeType: handler.mimeType || "text/plain",
      }));

    const { items, nextCursor } = paginate(resourcesList, params.cursor);

    const result = { resources: items };
    if (nextCursor) result.nextCursor = nextCursor;

    return result;
  }

  /**
   * Handle resources/templates/list request
   * @param {Object} params - Request params
   * @returns {Object} List of resource templates with pagination
   */
  function handleResourceTemplatesList(params = {}) {
    // Only return template resources (containing {param})
    const templatesList = Array.from(resources.entries())
      .filter(([uri]) => isTemplate(uri))
      .map(([uriTemplate, handler]) => ({
        uriTemplate,
        name: handler.name || uriTemplate,
        description: handler.description || "",
        mimeType: handler.mimeType || "text/plain",
      }));

    const { items, nextCursor } = paginate(templatesList, params.cursor);

    const result = { resourceTemplates: items };
    if (nextCursor) result.nextCursor = nextCursor;

    return result;
  }

  /**
   * Handle resources/read request
   * @param {Object} params - Request params
   * @param {string|null} [sessionId] - MCP session ID from request header
   * @param {Object} [mctx] - Request context (e.g. { userId })
   * @returns {Promise<Object>} Resource content
   */
  async function handleResourcesRead(params, sessionId = null, mctx = {}) {
    const { uri } = params;

    if (!uri) {
      throw new Error("Resource URI is required");
    }

    // Validate URI scheme (prevent dangerous schemes like file://, javascript:, data:)
    if (!validateUriScheme(uri)) {
      throw new Error(
        `Disallowed URI scheme: dangerous schemes like file://, javascript:, data: are not allowed`,
      );
    }

    // Apply canonicalizePath to ALL URIs for consistent security validation
    // This catches: null bytes, Unicode variants, multi-layer encoding, mixed encoding
    // Path normalization (slash deduplication, backslash conversion) is safe for all schemes
    const normalizedUri = canonicalizePath(uri);

    // Find matching resource (try exact match first, then templates)
    let handler = null;
    let extractedParams = {};

    // Try exact match first (use normalized URI for matching)
    if (resources.has(normalizedUri)) {
      handler = resources.get(normalizedUri);
    } else {
      // Try template matching using uri.js module
      for (const [registeredUri, h] of resources.entries()) {
        // Normalize registered URI for consistent matching (slash deduplication only)
        // Don't apply security validation to developer-provided templates
        const normalizedRegisteredUri = registeredUri
          .replace(/\\/g, "/") // Convert backslashes to forward slashes
          .replace(/\/+/g, "/"); // Remove duplicate slashes
        const match = matchUri(normalizedRegisteredUri, normalizedUri);
        if (match) {
          handler = h;
          extractedParams = match.params || {};
          break;
        }
      }
    }

    if (!handler) {
      throw new Error(`Resource "${uri}" not found`);
    }

    try {
      // Sanitize extracted params to prevent prototype pollution
      const req = sanitizeInput(extractedParams);

      let capturedResult;

      // Construct the response output port
      const res = {
        send(result) {
          capturedResult = result;
        },
        progress(current, total) {
          sendProgressNotification(sessionId, current, total);
        },
        ask: createAsk(buildSendRequest(sessionId), clientCapabilities),
      };

      // Execute handler with new signature: handler(mctx, req, res)
      await handler(mctx, req, res);

      const result = capturedResult;

      // Wrap result as resource content
      const mimeType = handler.mimeType || "text/plain";

      if (typeof result === "string") {
        return {
          contents: [
            {
              uri,
              mimeType,
              text: result,
            },
          ],
        };
      }

      // For binary data (Buffer, Uint8Array)
      if (result instanceof Buffer || result instanceof Uint8Array) {
        const base64 = Buffer.from(result).toString("base64");
        return {
          contents: [
            {
              uri,
              mimeType,
              blob: base64,
            },
          ],
        };
      }

      // For objects, serialize as JSON
      const serialized = safeSerialize(result);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: serialized,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to read resource "${uri}": ${sanitizeError(error)}`);
    }
  }

  /**
   * Handle prompts/list request
   * @param {Object} params - Request params
   * @returns {Object} List of prompts with pagination
   */
  function handlePromptsList(params = {}) {
    const promptsList = Array.from(prompts.entries()).map(([name, handler]) => {
      // Build arguments schema from handler.input
      const argumentsList = handler.input
        ? Object.entries(handler.input).map(([argName, schema]) => ({
            name: argName,
            description: schema.description || "",
            required: schema._required === true,
          }))
        : [];

      return {
        name,
        description: handler.description || "",
        arguments: argumentsList,
      };
    });

    const { items, nextCursor } = paginate(promptsList, params.cursor);

    const result = { prompts: items };
    if (nextCursor) result.nextCursor = nextCursor;

    return result;
  }

  /**
   * Handle prompts/get request
   * @param {Object} params - Request params
   * @param {string|null} [sessionId] - MCP session ID from request header
   * @param {Object} [mctx] - Request context (e.g. { userId })
   * @returns {Promise<Object>} Prompt messages
   */
  async function handlePromptsGet(params, sessionId = null, mctx = {}) {
    const { name, arguments: args } = params;

    if (!name) {
      throw new Error("Prompt name is required");
    }

    const handler = prompts.get(name);
    if (!handler) {
      throw new Error(`Prompt "${name}" not found`);
    }

    try {
      // Sanitize arguments to prevent prototype pollution
      const req = sanitizeInput(args || {});

      let capturedResult;

      // Construct the response output port
      const res = {
        send(result) {
          capturedResult = result;
        },
        progress(current, total) {
          sendProgressNotification(sessionId, current, total);
        },
        ask: createAsk(buildSendRequest(sessionId), clientCapabilities),
      };

      // Execute handler with new signature: handler(mctx, req, res)
      await handler(mctx, req, res);

      const result = capturedResult;

      // If handler returns a string, wrap as user message
      if (typeof result === "string") {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: result,
              },
            },
          ],
        };
      }

      // If handler returns messages array, wrap it
      if (Array.isArray(result)) {
        return { messages: result };
      }

      // If handler returns object with messages (from conversation()), pass through
      if (result && result.messages) {
        return result;
      }

      // Otherwise serialize and wrap as user message
      const serialized = safeSerialize(result);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: serialized,
            },
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get prompt "${name}": ${sanitizeError(error)}`);
    }
  }

  /**
   * Handle completion/complete request
   * @param {Object} params - Request params
   * @returns {Object} Completion suggestions
   */
  function handleCompletionComplete(params) {
    const { ref, argument } = params;

    if (!ref || !ref.type) {
      return {
        completion: {
          values: [],
          hasMore: false,
        },
      };
    }

    // Determine which registry to use based on ref type
    let registeredItems;
    if (ref.type === "ref/prompt-argument") {
      // Convert prompts Map to object for generateCompletions
      registeredItems = Object.fromEntries(prompts);
    } else if (ref.type === "ref/resource") {
      // Convert resources Map to object for generateCompletions
      registeredItems = Object.fromEntries(resources);
    } else {
      return {
        completion: {
          values: [],
          hasMore: false,
        },
      };
    }

    return generateCompletions(registeredItems, ref, argument?.value);
  }

  /**
   * Handle logging/setLevel request
   * @param {Object} params - Request params
   * @returns {Object} Empty success result
   */
  function handleLoggingSetLevel(params) {
    const { level } = params;

    if (!level) {
      throw new Error("Log level is required");
    }

    setLogLevel(level);

    return {}; // Success
  }

  /**
   * Handle initialize request
   * Auto-detects capabilities from registered tools/resources/prompts
   * @param {Object} params - Initialize params (clientInfo, capabilities, etc.)
   * @param {Object} [env] - Environment bindings (Cloudflare Workers env)
   * @returns {Object} Server capabilities and info
   */
  function handleInitialize(params, _env) {
    // Store client capabilities for use during handler dispatch
    clientCapabilities = (params && params.capabilities) || {};

    // Build capabilities object by detecting what's registered
    const capabilities = {};

    // Add tools capability if any tools are registered
    if (tools.size > 0) {
      capabilities.tools = {};
    }

    // Add resources capability if any resources are registered
    if (resources.size > 0) {
      capabilities.resources = {
        subscribe: false, // Resource subscriptions not supported yet
        listChanged: false, // Resource change notifications not supported yet
      };
    }

    // Add prompts capability if any prompts are registered
    if (prompts.size > 0) {
      capabilities.prompts = {};
    }

    // Always include logging capability
    capabilities.logging = {};

    // Advertise sampling capability — the server supports LLM-in-the-loop
    // via res.ask() if the client also supports sampling
    capabilities.sampling = {};

    // Build response
    const response = {
      protocolVersion: "2025-11-25",
      capabilities,
      serverInfo: {
        name: "@mctx-ai/mcp",
        version,
      },
    };

    // Include instructions if provided
    if (instructions) {
      response.instructions = instructions;
    }

    return response;
  }

  /**
   * Build a sendRequest callback for LLM sampling.
   * Posts a JSON-RPC 2.0 request to /_mctx/sampling and returns the result.
   *
   * @param {string|null} sessionId - MCP session ID to include in the request header
   * @returns {Function} async (method, params) => result
   */
  function buildSendRequest(sessionId) {
    let requestCounter = 0;

    return async function sendRequest(method, params) {
      const id = ++requestCounter;

      const headers = { "Content-Type": "application/json" };
      if (sessionId) {
        headers["Mcp-Session-Id"] = sessionId;
      }

      const response = await globalThis.fetch("/_mctx/sampling", {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });

      const data = await response.json();

      if (data.error) {
        const err = new Error(data.error.message || "Sampling request failed");
        err.code = data.error.code;
        throw err;
      }

      return data.result;
    };
  }

  /**
   * Route JSON-RPC request to appropriate handler
   * @param {Object} request - JSON-RPC request
   * @param {string|null} sessionId - MCP session ID from request header
   * @param {Object} mctx - Request context (userId) built in fetch()
   * @param {Object} [env] - Environment bindings (Cloudflare Workers env)
   * @returns {Promise<Object>} Response result
   */
  async function route(request, sessionId, mctx, env) {
    const { method, params } = request;

    switch (method) {
      case "initialize":
        return handleInitialize(params, env);

      case "initialized":
        // Notification - no response needed
        return null;

      case "ping":
        // Respond to ping with empty result
        return {};

      case "tools/list":
        return handleToolsList(params);

      case "tools/call":
        return await handleToolsCall(params, {}, sessionId, mctx);

      case "resources/list":
        return handleResourcesList(params);

      case "resources/read":
        return await handleResourcesRead(params, sessionId, mctx);

      case "resources/templates/list":
        return handleResourceTemplatesList(params);

      case "prompts/list":
        return handlePromptsList(params);

      case "prompts/get":
        return await handlePromptsGet(params, sessionId, mctx);

      case "notifications/cancelled":
        // Silent acknowledgment - no response for notifications
        return null;

      case "completion/complete":
        return handleCompletionComplete(params);

      case "logging/setLevel":
        return handleLoggingSetLevel(params);

      default: {
        const error = { code: -32601, message: `Method not found: ${method}` };
        throw error;
      }
    }
  }

  /**
   * Cloudflare Worker fetch handler
   * @param {Request} request - HTTP request
   * @param {Object} env - Environment variables (Cloudflare Workers env bindings)
   * @param {Object} executionCtx - Execution context (Cloudflare Workers ctx)
   * @returns {Promise<Response>} HTTP response
   */
  async function fetch(request, env, _executionCtx) {
    // Only accept POST requests
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request - Only POST method is supported",
          },
          id: null,
        }),
        {
          status: 405,
          headers: SECURITY_HEADERS,
        },
      );
    }

    // Extract session ID from request header for sampling back-channel
    const sessionId = request.headers.get("Mcp-Session-Id") || null;

    // Extract user ID from request header injected by mctx dispatch worker
    const userId = request.headers.get("x-mctx-user-id") || undefined;

    // Build context object passed as first arg to all handlers
    const mctx = { userId };

    let rpcRequest;
    let rawBody;

    try {
      // Get raw body text for size validation
      rawBody = await request.text();

      // Validate request size before parsing (prevent DoS)
      validateRequestSize(rawBody);

      // Parse JSON body
      rpcRequest = JSON.parse(rawBody);
    } catch {
      // Parse error
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error - Invalid JSON",
          },
          id: null,
        }),
        {
          status: 400,
          headers: SECURITY_HEADERS,
        },
      );
    }

    // Validate JSON-RPC structure
    if (!rpcRequest.method || typeof rpcRequest.method !== "string") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request - Missing or invalid method",
          },
          id: rpcRequest.id || null,
        }),
        {
          status: 400,
          headers: SECURITY_HEADERS,
        },
      );
    }

    try {
      // Route request
      const result = await route(rpcRequest, sessionId, mctx, env);

      // NOTE: Log buffer is intentionally NOT cleared here.
      // Consumers (e.g. dev server) are responsible for reading and clearing the
      // buffer after each request via getLogBuffer() / clearLogBuffer().
      // In a streaming transport (WebSocket/SSE), buffered logs would be sent as
      // notifications/message events during handler execution instead.

      // For notifications (no id), return 204 No Content
      if (!("id" in rpcRequest)) {
        return new Response(null, { status: 204, headers: new Headers(SECURITY_HEADERS) });
      }

      // Build response object
      const responseBody = {
        jsonrpc: "2.0",
        id: rpcRequest.id,
        result,
      };

      // Validate response size before sending (prevent DoS)
      validateResponseSize(responseBody);

      // Return JSON-RPC success response
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: new Headers(SECURITY_HEADERS),
      });
    } catch (error) {
      // Check if error is JSON-RPC error (has code and message)
      const isJsonRpcError = error && typeof error === "object" && "code" in error;

      const rpcError = isJsonRpcError
        ? error
        : {
            code: -32603,
            message: sanitizeError(error instanceof Error ? error : new Error(String(error))),
          };

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpcRequest.id || null,
          error: rpcError,
        }),
        {
          status: 200, // JSON-RPC errors use 200 status with error object
          headers: new Headers(SECURITY_HEADERS),
        },
      );
    }
  }

  // Create app object
  const app = {
    tool,
    resource,
    prompt,
    fetch,
  };

  return app;
}
