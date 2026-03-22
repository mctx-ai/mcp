/**
 * @mctx-ai/mcp-server
 *
 * Build MCP servers with an Express-like API - no protocol knowledge required.
 *
 * Main package entry point that exports core functionality.
 */

// Core server factory
export { createServer } from "./server.js";

// Type system for tool/prompt inputs
export { T, buildInputSchema } from "./types.js";

// Advanced features
export { conversation } from "./conversation.js";
export { createProgress, PROGRESS_DEFAULTS } from "./progress.js";
export { log, getLogBuffer, clearLogBuffer } from "./log.js";
export { createEmit, META_KEY_PATTERN } from "./channel.js";
