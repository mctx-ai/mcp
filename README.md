<p align="center">
  <img src="https://mctx.ai/brand/logo-purple.png" alt="mctx logo" width="200"/>
</p>

<p align="center">
  <strong>Build MCP servers with an Express-like API.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp-server"><img src="https://img.shields.io/npm/v/@mctx-ai/mcp-server" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp-server"><img src="https://img.shields.io/npm/l/@mctx-ai/mcp-server" alt="license"/></a>
  <a href="https://github.com/mctx-ai/mcp-server/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mctx-ai/mcp-server/ci.yml" alt="CI"/></a>
</p>

```bash
npm install @mctx-ai/mcp-server
```

```javascript
import { createServer, T } from "@mctx-ai/mcp-server";

const app = createServer({
  instructions: "A greeting server. Use the greet tool to say hello.",
});

function greet({ name }) {
  return `Hello, ${name}!`;
}
greet.description = "Greet someone by name";
greet.input = {
  name: T.string({ required: true, description: "Name to greet" }),
};
app.tool("greet", greet);

export default { fetch: app.fetch };
```

That's a working MCP server. The framework handles protocol negotiation, input validation, error sanitization, CORS, and capability detection. You write the business logic.

---

## Tools

Tools are functions that AI can call -- like API endpoints. Define a function, attach `.description` and `.input`, and register it.

```javascript
function add({ a, b }) {
  return a + b;
}
add.description = "Add two numbers";
add.input = {
  a: T.number({ required: true, description: "First number" }),
  b: T.number({ required: true, description: "Second number" }),
};
app.tool("add", add);
```

Return a string and it becomes the tool's text response. Return an object and it gets JSON-serialized automatically.

---

## Resources

Resources are read-only data that AI can pull for context. They use URI schemes you define -- `docs://`, `db://`, anything.

```javascript
// Static resource
function readme() {
  return "# My Project\nWelcome to the docs.";
}
readme.mimeType = "text/markdown";
app.resource("docs://readme", readme);

// Dynamic template
function getUser({ userId }) {
  return JSON.stringify(db.findUser(userId));
}
getUser.description = "Fetch a user by ID";
getUser.mimeType = "application/json";
app.resource("user://{userId}", getUser);
```

Static URIs show up in `resources/list`. Templates with `{param}` placeholders show up in `resources/templates/list` and receive extracted params as the first argument.

---

## Prompts

Prompts are reusable message templates for AI interactions. Return a string for simple cases, or use `conversation()` for multi-message flows.

```javascript
function codeReview({ code, language }) {
  return `Review this ${language} code for bugs and style issues:\n\n${code}`;
}
codeReview.description = "Review code for issues";
codeReview.input = {
  code: T.string({ required: true, description: "Code to review" }),
  language: T.string({ description: "Programming language" }),
};
app.prompt("code-review", codeReview);
```

For multi-message prompts with images or embedded resources:

```javascript
import { conversation } from "@mctx-ai/mcp-server";

function debug({ error, screenshot }) {
  return conversation(({ user, ai }) => [
    user.say("I hit this error:"),
    user.say(error),
    user.attach(screenshot, "image/png"),
    ai.say("I'll analyze the error and screenshot together."),
  ]);
}
debug.description = "Debug with error + screenshot";
debug.input = {
  error: T.string({ required: true }),
  screenshot: T.string({ required: true, description: "Base64 image data" }),
};
app.prompt("debug", debug);
```

---

## Type System

The `T` object builds JSON Schema definitions for tool and prompt inputs.

| Type          | Example                             | Key Options                                           |
| ------------- | ----------------------------------- | ----------------------------------------------------- |
| `T.string()`  | `T.string({ required: true })`      | `enum`, `minLength`, `maxLength`, `pattern`, `format` |
| `T.number()`  | `T.number({ min: 0, max: 100 })`    | `min`, `max`, `enum`                                  |
| `T.boolean()` | `T.boolean({ default: false })`     | `default`                                             |
| `T.array()`   | `T.array({ items: T.string() })`    | `items`                                               |
| `T.object()`  | `T.object({ properties: { ... } })` | `properties`, `additionalProperties`                  |

All types accept `required`, `description`, and `default`.

---

## Advanced Features

### Progress Reporting

Use generator functions and `createProgress()` for long-running tools.

```javascript
import { createProgress } from "@mctx-ai/mcp-server";

function* migrate({ tables }) {
  const step = createProgress(tables.length);
  for (const table of tables) {
    yield step();
    copyTable(table);
  }
  return `Migrated ${tables.length} tables`;
}
migrate.description = "Migrate database tables";
migrate.input = {
  tables: T.array({ required: true, items: T.string() }),
};
app.tool("migrate", migrate);
```

### Structured Logging

```javascript
import { log } from "@mctx-ai/mcp-server";

log.info("Server started");
log.warning("Rate limit approaching");
log.error("Connection failed");
```

Levels follow RFC 5424: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

### Sampling (ask)

Tools receive an optional `ask` function as their second argument for LLM-in-the-loop patterns.

```javascript
async function summarize({ url }, ask) {
  const content = await fetchPage(url);
  const summary = await ask(`Summarize this page:\n\n${content}`);
  return summary;
}
```

---

## Development

Scaffold a new project:

```bash
npm create mctx-server my-server
cd my-server
npm install
npm run dev
```

`npm run dev` starts `mctx-dev` with hot reload for local testing.

---

## Deploy

Push to GitHub and connect your repo at [mctx.ai](https://mctx.ai). Set your price per request and start earning.

Full deployment guide at [docs.mctx.ai](https://docs.mctx.ai).

---

## Links

- [Documentation](https://docs.mctx.ai)
- [Example Server](https://github.com/mctx-ai/example-mcp-server)
- [GitHub Issues](https://github.com/mctx-ai/mcp-server/issues)

---

<p align="center">
  mctx is a trademark of mctx, Inc.<br/>
  Licensed under MIT
</p>
