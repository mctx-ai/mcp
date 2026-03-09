/**
 * Sampling Support Module
 *
 * Enables MCP servers to request LLM completions from clients.
 * Provides the `ask` function for tools that need AI assistance.
 *
 * @module sampling
 */

/**
 * Default timeout for sampling requests (30 seconds)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Creates an ask function for a given request context
 *
 * The ask function allows tools to request LLM completions from the client.
 * Returns null if the client doesn't support sampling.
 *
 * @param {Function} sendRequest - Callback to send MCP requests (async)
 * @param {Object} clientCapabilities - Client capabilities from initialization
 * @returns {Function|null} Ask function, or null if sampling not supported
 *
 * @example
 * // In a tool handler
 * async function summarize({ document }, ask) {
 *   if (!ask) {
 *     return "Client doesn't support sampling";
 *   }
 *
 *   const summary = await ask("Summarize this document: " + document);
 *   return summary;
 * }
 *
 * @example
 * // Advanced usage with options
 * const result = await ask({
 *   messages: [
 *     { role: "user", content: { type: "text", text: "What is the capital of France?" } }
 *   ],
 *   modelPreferences: {
 *     hints: [{ name: "claude-3-5-sonnet" }]
 *   },
 *   systemPrompt: "You are a helpful geography assistant",
 *   maxTokens: 1000,
 * });
 */
export function createAsk(sendRequest, clientCapabilities) {
  // Validate inputs
  if (typeof sendRequest !== "function") {
    throw new Error("createAsk() requires sendRequest to be a function");
  }

  if (!clientCapabilities || typeof clientCapabilities !== "object") {
    throw new Error("createAsk() requires clientCapabilities object");
  }

  // Check if client supports sampling
  if (!clientCapabilities.sampling) {
    return null;
  }

  /**
   * Ask function - request LLM completion from client
   *
   * @param {string|Object} promptOrOptions - Simple prompt string, or options object
   * @param {number} [timeout=30000] - Request timeout in milliseconds
   * @returns {Promise<string>} The LLM response content
   * @throws {Error} If request fails or times out
   */
  return async function ask(promptOrOptions, timeout = DEFAULT_TIMEOUT) {
    let requestParams;

    // Simple string prompt - wrap as messages array
    if (typeof promptOrOptions === "string") {
      requestParams = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: promptOrOptions,
            },
          },
        ],
      };
    } else if (promptOrOptions && typeof promptOrOptions === "object") {
      // Advanced options object
      requestParams = { ...promptOrOptions };

      // Validate required fields
      if (!requestParams.messages || !Array.isArray(requestParams.messages)) {
        throw new Error("ask() options must include messages array");
      }
    } else {
      throw new Error("ask() requires a string prompt or options object");
    }

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Sampling request timed out after ${timeout}ms`));
      }, timeout);
    });

    // Send sampling request with timeout
    try {
      const responsePromise = sendRequest("sampling/createMessage", requestParams);
      const response = await Promise.race([responsePromise, timeoutPromise]);

      // Extract content from response
      if (!response || !response.content) {
        throw new Error("Invalid sampling response: missing content");
      }

      return response.content;
    } catch (error) {
      // Re-throw with better context
      if (error.message.includes("timed out")) {
        throw error;
      }

      throw new Error(`Sampling request failed: ${error.message}`);
    }
  };
}
