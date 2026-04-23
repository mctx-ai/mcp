<div align="center">
  <img src="https://mctx.ai/brand/logo-black.png" width="120" alt="mctx" />
</div>

# @mctx-ai/dev

Dev server with hot reload for [@mctx-ai/mcp](https://www.npmjs.com/package/@mctx-ai/mcp).

[![npm version](https://img.shields.io/npm/v/@mctx-ai/dev)](https://www.npmjs.com/package/@mctx-ai/dev)

---

## Quick Start

```bash
npm install -D @mctx-ai/dev
npx mctx-dev index.js
```

Your server restarts automatically on file changes.

---

## What It Does

- **Hot reload** — watches `.js`, `.mjs`, `.cjs`, and `.json` files and restarts on save
- **Request logging** — logs every MCP request and response to the console
- **Handler log surfacing** — prints any `log.*()` calls made inside your handlers to the dev console after each request
- **Sampling stub** — when a tool calls `ask()`, the `/_mctx/sampling` endpoint returns a clear error explaining that sampling is not supported in dev mode
- **Local testing** — serves your server over HTTP for use with any MCP client

---

## Usage

```
npx mctx-dev <entry-file> [options]
```

**Options:**

| Flag              | Description       | Default |
| ----------------- | ----------------- | ------- |
| `--port <number>` | Port to listen on | `3000`  |
| `-h, --help`      | Show help message |         |

**Environment Variables:**

| Variable       | Description                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`         | Port to listen on (overridden by `--port`)                                                                                                                                                                |
| `MCTX_VERBOSE` | Set to `true` to pretty-print full JSON request and response bodies to stdout for every non-handshake MCP method call. Default (unset): compact one-line logs showing direction, status, and timing only. |

**Examples:**

```bash
# Start on default port 3000
npx mctx-dev index.js

# Start on a custom port
npx mctx-dev index.js --port 8080
```

---

## Visual Testing

Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to test your server interactively in the browser while `mctx-dev` is running.

---

## Pairs With

This package is the dev companion to [@mctx-ai/mcp](https://www.npmjs.com/package/@mctx-ai/mcp) — the zero-dependency MCP framework.

---

<p align="center">
  <a href="https://mctx.ai">mctx</a> · <a href="https://docs.mctx.ai">Docs</a> · <a href="https://github.com/mctx-ai/mcp">GitHub</a><br/>
  MIT License
</p>
