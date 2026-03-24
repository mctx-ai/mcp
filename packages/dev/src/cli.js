#!/usr/bin/env node

/**
 * @mctx-ai/dev CLI Entry Point
 *
 * Usage: npx mctx-dev <entry-file>
 * Example: npx mctx-dev index.js
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { startDevServer } from "./server.js";

// Parse command line arguments
const args = process.argv.slice(2);

// Check for --help flag
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
mctx-dev - Local development server for MCP servers

Usage:
  npx mctx-dev <entry-file> [options]

Options:
  --port <number>    Port to listen on (default: 3000)
  -h, --help         Show this help message

Examples:
  npx mctx-dev index.js
  npx mctx-dev index.js --port 8080

Environment Variables:
  PORT              Port to listen on (overridden by --port flag)
`);
  process.exit(0);
}

// Parse entry file
const entryFile = args.find((arg) => !arg.startsWith("--"));

if (!entryFile) {
  console.error("Error: Entry file is required");
  console.error("Usage: npx mctx-dev <entry-file>");
  console.error('Run "npx mctx-dev --help" for more information');
  process.exit(1);
}

// Parse port from flags or environment
const portFlagIndex = args.indexOf("--port");
const port =
  portFlagIndex !== -1 && args[portFlagIndex + 1]
    ? parseInt(args[portFlagIndex + 1], 10)
    : parseInt(process.env.PORT || "3000", 10);

if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`Error: Invalid port "${args[portFlagIndex + 1] || process.env.PORT}"`);
  process.exit(1);
}

// Resolve entry file to absolute path
const entryPath = resolve(process.cwd(), entryFile);

// Check if file exists (Fix #4)
if (!existsSync(entryPath)) {
  console.error(`Error: File not found: ${entryFile}`);
  console.error(`Resolved path: ${entryPath}`);
  process.exit(1);
}

// Convert to file URL for dynamic import
const entryUrl = pathToFileURL(entryPath).href;

// Start dev server
try {
  await startDevServer(entryUrl, port);
} catch (error) {
  // Handle EADDRINUSE port conflicts (Fix #1)
  if (error.code === "EADDRINUSE") {
    console.error(`\nError: Port ${port} is already in use.`);
    console.error(`Try a different port: npx mctx-dev ${entryFile} --port ${port + 1}`);
    process.exit(1);
  }

  console.error("Failed to start dev server:", error.message);

  if (error.code === "ERR_MODULE_NOT_FOUND") {
    console.error(`\nCould not find module: ${entryFile}`);
    console.error("Make sure the file exists and the path is correct.");
  } else if (error.message.includes("default export")) {
    console.error("\nMake sure your entry file has a default export.");
    console.error("Example: export default app;");
  } else {
    console.error("\nStack trace:");
    console.error(error.stack);
  }

  process.exit(1);
}
