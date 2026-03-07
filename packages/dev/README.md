<div align="center">
  <img src="https://mctx.ai/brand/logo-black.png" width="120" alt="mctx" />
</div>

# @mctx-ai/mcp-dev

Dev server with hot reload for [@mctx-ai/mcp-server](https://www.npmjs.com/package/@mctx-ai/mcp-server).

[![npm version](https://img.shields.io/npm/v/@mctx-ai/mcp-dev)](https://www.npmjs.com/package/@mctx-ai/mcp-dev)

---

## Quick Start

```bash
npm install -D @mctx-ai/mcp-dev
npx mctx-dev index.js
```

Your server restarts automatically on file changes.

---

## What It Does

- **Hot reload** — watches your files and restarts on save
- **Request logging** — logs every MCP request and response to the console
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

This package is the dev companion to [@mctx-ai/mcp-server](https://www.npmjs.com/package/@mctx-ai/mcp-server) — the zero-dependency MCP framework.

---

<p align="center">
  <a href="https://mctx.ai">mctx</a> · <a href="https://docs.mctx.ai">Docs</a> · <a href="https://github.com/mctx-ai/mcp-server">GitHub</a><br/>
  MIT License
</p>
