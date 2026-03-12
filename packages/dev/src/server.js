/**
 * @mctx-ai/mcp-dev Server
 *
 * HTTP server that wraps the app's fetch handler with developer-friendly features:
 * - Initialize handshake handling
 * - Request/response logging with timing
 * - Rich error messages with stack traces
 * - Hot reload support
 */

import { createServer } from "http";
import { getLogBuffer, clearLogBuffer } from "@mctx-ai/mcp-server";
import { watch } from "./watcher.js";

// ANSI color codes for logging
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

/**
 * Format timestamp for logs
 */
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

/**
 * Log with timestamp and color (Fix #8: separated framework vs request logs)
 */
function log(message, color = colors.reset) {
  console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${color}${message}${colors.reset}`);
}

/**
 * Log framework events (startup, reload, errors)
 */
function logFramework(message, color = colors.reset) {
  console.log(
    `${colors.gray}[${timestamp()}]${colors.reset} ${colors.bright}[mctx-dev]${colors.reset} ${color}${message}${colors.reset}`,
  );
}

/**
 * Extract method name and arguments for logging
 */
function formatMethod(rpcRequest) {
  const { method, params } = rpcRequest;

  // For tools/call, show tool name
  if (method === "tools/call" && params?.name) {
    return `${method} (${params.name})`;
  }

  // For resources/read, show URI
  if (method === "resources/read" && params?.uri) {
    return `${method} (${params.uri})`;
  }

  // For prompts/get, show prompt name
  if (method === "prompts/get" && params?.name) {
    return `${method} (${params.name})`;
  }

  // For completion/complete, show ref type and argument name
  if (method === "completion/complete") {
    const refType = params?.ref?.type;
    const argName = params?.argument?.name;
    if (refType && argName) {
      return `${method} (${refType}, ${argName})`;
    }
    if (refType) {
      return `${method} (${refType})`;
    }
  }

  // For logging/setLevel, show the requested level
  if (method === "logging/setLevel" && params?.level) {
    return `${method} (${params.level})`;
  }

  return method;
}

/**
 * Format error for display with helpful hints
 */
function formatError(error, rpcRequest) {
  let formatted = `${colors.red}${colors.bright}Error:${colors.reset} ${error.message}\n`;

  // Add stack trace if available
  if (error.stack) {
    const stack = error.stack
      .split("\n")
      .slice(1) // Skip first line (error message)
      .map((line) => `  ${colors.dim}${line.trim()}${colors.reset}`)
      .join("\n");
    formatted += `${stack}\n`;
  }

  // Add helpful hints for common errors
  if (error.message.includes("not found")) {
    formatted += `\n${colors.yellow}Hint:${colors.reset} Check if the ${rpcRequest.method.split("/")[0]} is registered in your server.\n`;
  } else if (error.message.includes("required")) {
    formatted += `\n${colors.yellow}Hint:${colors.reset} Check your request parameters. Some fields might be missing.\n`;
  } else if (error.message.includes("undefined")) {
    formatted += `\n${colors.yellow}Hint:${colors.reset} Did you forget to return a value from your handler?\n`;
  }

  return formatted;
}

/**
 * Create a Web API Request for the app's fetch handler.
 *
 * The app's fetch handler (packages/server/src/server.js) uses the standard
 * Web API Request interface: request.headers.get() and request.text(). A plain
 * object does not satisfy that contract, so we construct a real Request using
 * globalThis.Request, which is guaranteed in Node >=18 (project requires >=22).
 *
 * Incoming headers from the Node.js IncomingMessage are forwarded so that
 * headers like X-Mctx-User-Id reach the core server's fetch handler. The
 * Content-Type header is always set to application/json for JSON-RPC, overriding
 * any incoming value to ensure the body is parsed correctly.
 *
 * Hop-by-hop headers are filtered out before forwarding to prevent header
 * forwarding edge cases in the dev server.
 *
 * @param {string} rawBody - The raw JSON string already read from the Node IncomingMessage
 * @param {import("http").IncomingHttpHeaders} incomingHeaders - Headers from the Node IncomingMessage
 */
function createRequest(rawBody, incomingHeaders = {}) {
  // Hop-by-hop headers that should not be forwarded
  const hopByHopHeaders = new Set([
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
  ]);

  // Filter out hop-by-hop headers before spreading
  const filteredHeaders = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      filteredHeaders[key] = value;
    }
  }

  // Content-Type is set explicitly as an override
  const headers = { ...filteredHeaders, "Content-Type": "application/json" };
  return new globalThis.Request("http://localhost/", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

/**
 * Start the development server
 */
export async function startDevServer(entryUrl, port) {
  let app = null;
  let appModule = null;

  // Check if verbose logging is enabled
  const isVerbose = process.env.MCTX_VERBOSE === "true";

  // Load the user's app
  async function loadApp() {
    try {
      // Clear module from cache for hot reload
      if (entryUrl.startsWith("file://")) {
        const modulePath = entryUrl;
        // Add cache-busting query parameter for ES modules
        const cacheBustedUrl = `${modulePath}?t=${Date.now()}`;
        appModule = await import(cacheBustedUrl);
      } else {
        appModule = await import(entryUrl);
      }

      app = appModule.default;

      if (!app) {
        throw new Error("Entry file must have a default export (the app instance)");
      }

      if (typeof app.fetch !== "function") {
        throw new Error("App must have a fetch method (created via createServer())");
      }

      return true;
    } catch (error) {
      throw error;
    }
  }

  // Initial load (Fix #2: handle syntax errors gracefully)
  try {
    await loadApp();
  } catch (error) {
    // Show error and continue - watcher will retry on file changes
    logFramework(`Failed to load ${entryUrl.split("/").pop()}`, colors.red);

    if (error instanceof SyntaxError) {
      console.error(`${colors.red}${colors.bright}SyntaxError:${colors.reset} ${error.message}`);
      if (error.stack) {
        const stackLines = error.stack.split("\n").slice(1, 4);
        console.error(colors.dim + stackLines.join("\n") + colors.reset);
      }
      logFramework("Watching for changes... fix the error and save to retry.", colors.yellow);
    } else {
      console.error(formatError(error, { method: "initial-load" }));
    }
  }

  // Start file watcher for hot reload
  const entryPath = new URL(entryUrl).pathname;
  const watcherInfo = watch(entryPath, async () => {
    try {
      await loadApp();
      logFramework("Reload successful", colors.green);
    } catch (error) {
      logFramework("Reload failed", colors.red);

      if (error instanceof SyntaxError) {
        console.error(`${colors.red}${colors.bright}SyntaxError:${colors.reset} ${error.message}`);
        if (error.stack) {
          const stackLines = error.stack.split("\n").slice(1, 4);
          console.error(colors.dim + stackLines.join("\n") + colors.reset);
        }
      } else {
        console.error(formatError(error, { method: "reload" }));
      }
    }
  });

  // Create HTTP server
  const server = createServer(async (req, res) => {
    // Handle /_mctx/sampling back-channel: sampling is not supported in dev mode.
    // Return a JSON-RPC error response so ask() fails with a clear message rather
    // than a network error.
    if (req.url === "/_mctx/sampling") {
      let samplingBody = "";
      req.on("data", (chunk) => {
        samplingBody += chunk.toString();
      });
      req.on("end", () => {
        let samplingId = null;
        try {
          const parsed = JSON.parse(samplingBody);
          samplingId = parsed.id || null;
        } catch {
          // ignore parse errors — we still send a valid error response
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32601,
              message: "Sampling is not supported in dev mode — ask() will return null",
            },
            id: samplingId,
          }),
        );
        logFramework(
          "Sampling request received — sampling is not supported in dev mode",
          colors.yellow,
        );
      });
      return;
    }

    // Return 404 for OAuth discovery paths so MCP clients (e.g. Claude Code) do not
    // trigger an auth flow. Without this, non-POST requests fall through to the
    // method check below and return 405, which some clients interpret as "auth
    // endpoint exists but wrong method".
    if (req.method === "GET" && req.url && req.url.startsWith("/.well-known/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not Found",
          message: "OAuth discovery is not supported by this server",
        }),
      );
      return;
    }

    // Fix #2: If app failed to load initially, return error
    if (!app) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Server initialization failed - fix syntax errors and save to retry",
          },
          id: null,
        }),
      );
      return;
    }

    // Only accept POST requests
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request - Only POST method is supported",
          },
          id: null,
        }),
      );
      return;
    }

    // Read request body (Fix #6: add timeout protection)
    let body = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      req.destroy();
      res.writeHead(408, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Request timeout - body not received within 30s",
          },
          id: null,
        }),
      );
      logFramework("Request timeout", colors.red);
    }, 30000);

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      clearTimeout(timeout);

      if (timedOut) {
        return;
      }

      let rpcRequest;
      const startTime = Date.now();

      try {
        // Parse JSON body
        rpcRequest = JSON.parse(body);
      } catch (error) {
        // Fix #9: include body snippet in parse error
        const bodySnippet = body.length > 100 ? body.substring(0, 100) + "..." : body;

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: `Parse error - Invalid JSON: ${error.message}`,
              data: { bodySnippet },
            },
            id: null,
          }),
        );

        log(`${colors.red}✗${colors.reset} Parse error`, colors.red);
        console.error(`${colors.dim}Body snippet: ${bodySnippet}${colors.reset}`);
        return;
      }

      // Validate JSON-RPC method field before dispatching
      if (!rpcRequest.method || typeof rpcRequest.method !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Invalid Request - Missing or invalid method",
            },
            id: rpcRequest.id || null,
          }),
        );
        log(`${colors.red}✗${colors.reset} Invalid Request - missing method`, colors.red);
        return;
      }

      // Log incoming request
      const methodDisplay = formatMethod(rpcRequest);
      log(`${colors.cyan}→${colors.reset} ${methodDisplay}`, colors.dim);

      // Verbose logging: log full request body (skip initialize/initialized)
      if (isVerbose && rpcRequest.method !== "initialize" && rpcRequest.method !== "initialized") {
        console.log(`${colors.dim}[verbose] Request:${colors.reset}`);
        console.log(JSON.stringify(rpcRequest, null, 2));
      }

      try {
        // Delegate all requests to app's fetch handler (including initialize)
        // The core SDK now handles initialize, initialized, and ping
        const request = createRequest(body, req.headers);
        const response = await app.fetch(request, {}, {});

        const elapsed = Date.now() - startTime;

        // Read response
        const responseText = await response.text();
        const statusCode = response.status;

        // Send response
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(responseText);

        // Log response
        const statusColor = statusCode >= 200 && statusCode < 300 ? colors.green : colors.red;
        log(`${statusColor}←${colors.reset} ${statusCode} (${elapsed}ms)`, colors.dim);

        // Surface buffered log entries from handler code to dev console
        const bufferedLogs = getLogBuffer();
        clearLogBuffer();
        if (bufferedLogs.length > 0) {
          for (const entry of bufferedLogs) {
            const levelColor =
              entry.level === "error" ||
              entry.level === "critical" ||
              entry.level === "alert" ||
              entry.level === "emergency"
                ? colors.red
                : entry.level === "warning"
                  ? colors.yellow
                  : colors.dim;
            const dataStr =
              typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
            console.log(
              `${colors.gray}[${timestamp()}]${colors.reset} ${levelColor}[log:${entry.level}]${colors.reset} ${dataStr}`,
            );
          }
        }

        // Verbose logging: log full response body (skip initialize/initialized)
        if (
          isVerbose &&
          rpcRequest.method !== "initialize" &&
          rpcRequest.method !== "initialized"
        ) {
          console.log(`${colors.dim}[verbose] Response:${colors.reset}`);
          try {
            const responseJson = JSON.parse(responseText);
            console.log(JSON.stringify(responseJson, null, 2));
          } catch {
            console.log(responseText);
          }
        }

        // Slow tool warning: if tools/call took >1000ms
        if (rpcRequest.method === "tools/call" && elapsed > 1000) {
          const toolName = rpcRequest.params?.name || "unknown";
          log(
            `${colors.yellow}⚠️  Slow tool: ${toolName} took ${elapsed}ms${colors.reset}`,
            colors.yellow,
          );
        }

        // If error, show details
        if (statusCode >= 400) {
          try {
            const errorResponse = JSON.parse(responseText);
            if (errorResponse.error) {
              console.error(
                formatError(new Error(errorResponse.error.message || "Unknown error"), rpcRequest),
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      } catch (error) {
        const elapsed = Date.now() - startTime;

        // Return error response
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: error.message || "Internal error",
            },
            id: rpcRequest.id || null,
          }),
        );

        log(`${colors.red}←${colors.reset} error (${elapsed}ms)`, colors.red);
        console.error(formatError(error, rpcRequest));
      }
    });
  });

  // Fix #1: Handle EADDRINUSE port conflicts
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      // Propagate to CLI for proper error handling
      throw error;
    } else {
      logFramework(`Server error: ${error.message}`, colors.red);
      throw error;
    }
  });

  // Start listening
  server.listen(port, () => {
    logFramework(`Server running at http://localhost:${port}`, colors.cyan);

    // Format watched directories for display
    const watchedDirsDisplay = watcherInfo.watchedDirs
      .map(
        ({ path, recursive }) =>
          `  ${colors.dim}${path}${recursive ? " (recursive)" : ""}${colors.reset}`,
      )
      .join("\n");

    console.log(`
${colors.bright}${colors.cyan}🔧 mctx dev server running at http://localhost:${port}${colors.reset}

${colors.bright}Test with curl:${colors.reset}
  ${colors.dim}curl -X POST http://localhost:${port} \\
    -H "Content-Type: application/json" \\
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'${colors.reset}

${colors.bright}Claude Desktop config${colors.reset} ${colors.dim}(~/.config/claude/claude_desktop_config.json):${colors.reset}
  ${colors.dim}{
    "mcpServers": {
      "my-server": {
        "command": "npx",
        "args": ["mctx-dev", "${entryPath}"]
      }
    }
  }${colors.reset}

${colors.bright}Watching for changes:${colors.reset}
${watchedDirsDisplay}
`);
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log(`\n${colors.dim}Shutting down...${colors.reset}`);
    server.close(() => {
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
