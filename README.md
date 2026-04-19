<p align="center">
  <img src="https://mctx.ai/brand/logo-purple.png" alt="mctx logo" width="200"/>
</p>

<p align="center">
  <strong>mctx — The best way to Build an MCP Server</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp"><img src="https://img.shields.io/npm/v/@mctx-ai/mcp" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp"><img src="https://img.shields.io/npm/l/@mctx-ai/mcp" alt="license"/></a>
  <a href="https://github.com/mctx-ai/app/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mctx-ai/app/ci.yml" alt="CI"/></a>
</p>

`@mctx-ai/mcp` is the best way to Build an MCP Server. Register tools, resources, and prompts — the framework handles protocol negotiation, input validation, error sanitization, and CORS. You write the business logic.

---

## Quick Start

```javascript
import { createServer, T } from "@mctx-ai/mcp";

const server = createServer({
  instructions: "A greeting server. Use the greet tool to say hello.",
});

function greet(mctx, req, res) {
  res.send(`Hello, ${req.name}! (user: ${mctx.userId || "anonymous"})`);
}

greet.description = "Greet someone by name";
greet.input = {
  name: T.string({ required: true, description: "Name to greet" }),
};

server.tool("greet", greet);

export default { fetch: server.fetch };
```

That's a working MCP server. Run it locally with `npx mctx-dev index.js`.

---

## Installation

**Scaffold a new project (recommended):**

```bash
npx create-mctx-server my-app
cd my-app
npm install
npx mctx-dev index.js
```

**Use the template repo:**

[github.com/mctx-ai/example-app](https://github.com/new?template_name=example-app&template_owner=mctx-ai) — click "Use this template" on GitHub.

**Add to an existing project:**

```bash
npm install @mctx-ai/mcp
```

**Run the dev server:**

```bash
npx mctx-dev index.js
```

Hot reload is included. Changes to `index.js` restart the server automatically.

---

## Features

- **Zero runtime dependencies** — ships nothing you don't need
- **TypeScript-ready** — full `.d.ts` type definitions included
- **Hot reload dev server** — `mctx-dev` watches your files and restarts on change
- **Input validation** — JSON Schema validation via the `T` type system
- **Error sanitization** — secrets and stack traces never leak to clients
- **MCP protocol handled** — capability negotiation, JSON-RPC 2.0, CORS — all automatic
- **Cloudflare Workers** — exports a standard `fetch` handler, deploys anywhere

---

## API

### Handler Signature

Every handler — tools, resources, and prompts — uses the same three-argument signature:

```javascript
function myHandler(mctx, req, res) {
  res.send("result");
}
```

| Parameter | Type           | Description                                                                       |
| --------- | -------------- | --------------------------------------------------------------------------------- |
| `mctx`    | `ModelContext` | Per-request context. `mctx.userId` is the authenticated user ID (or `undefined`). |
| `req`     | `object`       | Input arguments, validated against the handler's `input` schema.                  |
| `res`     | `Response`     | Output port. Call `res.send()` to return a result.                                |

### Tools

Tools are functions AI can call — like API endpoints.

```javascript
function search(mctx, req, res) {
  const results = db.query(req.query, { limit: req.limit });
  res.send(results);
}

search.description = "Search the database";
search.input = {
  query: T.string({ required: true, description: "Search query" }),
  limit: T.number({ default: 10, description: "Max results" }),
};

server.tool("search", search);
```

For long-running tools, report progress with `res.progress(current, total)`:

```javascript
async function migrate(mctx, req, res) {
  for (let i = 0; i < req.tables.length; i++) {
    await copyTable(req.tables[i]);
    res.progress(i + 1, req.tables.length);
  }
  res.send(`Migrated ${req.tables.length} tables`);
}

migrate.description = "Migrate database tables";
migrate.input = {
  tables: T.array({ required: true, items: T.string() }),
};

server.tool("migrate", migrate);
```

### Resources

Resources are read-only data AI can pull for context. Use static URIs or URI templates.

```javascript
// Static resource
function readme(mctx, req, res) {
  res.send("# My Project\nWelcome to the docs.");
}

readme.mimeType = "text/markdown";
server.resource("docs://readme", readme);

// Dynamic template — {userId} is extracted and available on req
function getUser(mctx, req, res) {
  res.send(JSON.stringify(db.findUser(req.userId)));
}

getUser.description = "Fetch a user by ID";
getUser.mimeType = "application/json";
server.resource("user://{userId}", getUser);
```

### Prompts

Prompts are reusable message templates for initializing AI conversations.

```javascript
function codeReview(mctx, req, res) {
  res.send(`Review this ${req.language} code for bugs:\n\n${req.code}`);
}

codeReview.description = "Review code for issues";
codeReview.input = {
  code: T.string({ required: true }),
  language: T.string({ description: "Programming language" }),
};

server.prompt("code-review", codeReview);
```

For multi-message prompts with images or embedded resources, use `conversation()`:

```javascript
import { conversation } from "@mctx-ai/mcp";

function debug(mctx, req, res) {
  res.send(
    conversation(({ user, ai }) => [
      user.say("I hit this error:"),
      user.say(req.error),
      user.attach(req.screenshot, "image/png"),
      ai.say("I'll analyze the error and screenshot together."),
    ]),
  );
}

debug.description = "Debug with error + screenshot";
debug.input = {
  error: T.string({ required: true }),
  screenshot: T.string({ required: true, description: "Base64 image data" }),
};

server.prompt("debug", debug);
```

### LLM Sampling

Use `res.ask()` to request an LLM completion from the client (LLM-in-the-loop):

```javascript
async function summarize(mctx, req, res) {
  const content = await fetchPage(req.url);
  const summary = res.ask ? await res.ask(`Summarize:\n\n${content}`) : content;
  res.send(summary);
}
```

`res.ask` is `null` when the client does not support sampling — always check before calling.

### Type System

`T` builds JSON Schema definitions for tool and prompt inputs.

| Type          | Example                                          |
| ------------- | ------------------------------------------------ |
| `T.string()`  | `T.string({ required: true, enum: ["a", "b"] })` |
| `T.number()`  | `T.number({ min: 0, max: 100 })`                 |
| `T.boolean()` | `T.boolean({ default: false })`                  |
| `T.array()`   | `T.array({ items: T.string() })`                 |
| `T.object()`  | `T.object({ properties: { key: T.string() } })`  |

All types accept `required`, `description`, and `default`.

### Logging

```javascript
import { log } from "@mctx-ai/mcp";

log.info("Server started");
log.warning("Rate limit approaching");
log.error("Connection failed");
```

Levels follow RFC 5424: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

---

## Deploy

Push to GitHub and connect your repo at [mctx.ai](https://mctx.ai). Your server goes live.

Full deployment guide at [docs.mctx.ai](https://docs.mctx.ai).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [GitHub Issues](https://github.com/mctx-ai/app/issues).

---

## Links

- [Documentation](https://docs.mctx.ai)
- [Example Server](https://github.com/new?template_name=example-app&template_owner=mctx-ai)
- [npm: @mctx-ai/mcp](https://www.npmjs.com/package/@mctx-ai/mcp)

---

<p align="center">
  mctx is a trademark of mctx, Inc.<br/>
  Licensed under MIT
</p>
