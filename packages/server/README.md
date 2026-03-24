<p align="center">
  <img src="https://mctx.ai/brand/logo-black.png" alt="mctx logo" width="200"/>
</p>

<p align="center">
  <strong>Express-like API for building MCP servers. Zero dependencies.</strong>
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

Tools are functions that AI can call — like API endpoints. Define a function, attach `.description` and `.input`, and register it.

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

Resources are read-only data that AI can pull for context. They use URI schemes you define — `docs://`, `db://`, anything.

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

### buildInputSchema

`buildInputSchema` converts a T-based input definition into a valid JSON Schema object. The framework calls this internally, but you can use it directly when you need the schema for validation or documentation.

```javascript
import { buildInputSchema, T } from "@mctx-ai/mcp-server";

const schema = buildInputSchema({
  name: T.string({ required: true }),
  age: T.number(),
});
// => { type: 'object', properties: { name: {...}, age: {...} }, required: ['name'] }
```

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

`PROGRESS_DEFAULTS` contains the guardrail values the framework enforces on generator tools: `maxExecutionTime` (60000ms) and `maxYields` (10000). Tools that exceed either limit are stopped automatically.

```javascript
import { PROGRESS_DEFAULTS } from "@mctx-ai/mcp-server";

console.log(PROGRESS_DEFAULTS.maxExecutionTime); // 60000
console.log(PROGRESS_DEFAULTS.maxYields); // 10000
```

### Structured Logging

```javascript
import { log } from "@mctx-ai/mcp-server";

log.info("Server started");
log.warning("Rate limit approaching");
log.error("Connection failed");
```

Levels follow RFC 5424: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

Log entries are buffered internally. Use `getLogBuffer` to read them and `clearLogBuffer` to flush the buffer.

```javascript
import { getLogBuffer, clearLogBuffer } from "@mctx-ai/mcp-server";

const entries = getLogBuffer();
// entries: Array of LogNotification objects with level, logger, and data fields

clearLogBuffer(); // Empties the buffer
```

This is primarily useful for dev tools and middleware that need to surface handler logs — for example, printing handler log output to the console after each request.

### Sampling (ask)

Tools receive an optional `ask` function as their second argument for LLM-in-the-loop patterns.

```javascript
async function summarize({ url }, ask) {
  const content = await fetchPage(url);
  if (ask) {
    return await ask(`Summarize this page:\n\n${content}`);
  }
  return content;
}
```

The full handler signature is `(args, ask)` for tools and prompts, and `(params, ask)` for resource templates. Both parameters are optional — omit any you don't need.

---

## Channel Events

Channel events let your server push real-time notifications to mctx channel subscribers. Each call is fire-and-forget — it returns immediately and does not block your tool's response. When the channel is not configured, `ctx.emit` is a no-op and your code runs unchanged.

```javascript
server.tool("deploy", async (args, ask, ctx) => {
  ctx.emit("Deployment started", {
    eventType: "deploy_status",
    meta: { environment: args.env, version: args.version },
  });

  // ... do deployment work ...

  ctx.emit("Deployment complete", {
    eventType: "deploy_status",
    meta: { environment: args.env, status: "success" },
  });

  return `Deployed ${args.version} to ${args.env}`;
});
```

### API Reference

```typescript
ctx.emit(content: string, options?: ChannelEventOptions): Promise<void>
```

| Parameter           | Type                     | Description                                                                                                                                           |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`           | `string`                 | Display text for the event. Truncated to 500 characters. Empty strings are silently ignored.                                                          |
| `options.eventType` | `string`                 | Event type identifier. Must match `[a-zA-Z0-9_]+`. Defaults to `'notification'` when omitted or invalid.                                              |
| `options.meta`      | `Record<string, string>` | Key/value metadata. All keys must match `[a-zA-Z0-9_]+` and all values must be strings — any violation causes the entire emit call to no-op silently. |

`ctx.emit` returns immediately — the HTTP request to the channel endpoint runs in the background using `waitUntil`. No-ops silently when the channel is not configured.

### Advanced Usage

`createEmit` is exported directly for custom integrations, such as wiring channel events outside of a tool handler.

```javascript
import { createEmit } from "@mctx-ai/mcp-server";

// Bind emit to the Worker environment and execution context
const emit = createEmit(env, executionCtx);

await emit("User completed onboarding", {
  eventType: "milestone",
  meta: { user_id: "u_123" },
});
```

`createEmit` returns a no-op when `MCTX_EVENTS_ENDPOINT`, `MCTX_SERVER_ID`, or `MCTX_EVENTS_SECRET` are missing from `env`, or when the secret is shorter than 32 characters.

### Security

You are responsible for sanitizing user-generated content before passing it to `ctx.emit`. The framework validates that meta key names match `[a-zA-Z0-9_]+` but does not sanitize the `content` string or meta values. Avoid passing raw user input directly.

### Environment Variables

These variables are injected automatically by the mctx deploy worker. You do not set them manually.

| Variable               | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `MCTX_EVENTS_ENDPOINT` | URL of the mctx channel events endpoint            |
| `MCTX_SERVER_ID`       | Identifier for your server, used to route events   |
| `MCTX_EVENTS_SECRET`   | HMAC-SHA256 signing secret (minimum 32 characters) |

---

## Development

Scaffold a new project in one command:

```bash
npm create mctx-server my-server
cd my-server
npm install
npm run dev
```

`npm run dev` starts [@mctx-ai/mcp-dev](https://www.npmjs.com/package/@mctx-ai/mcp-dev) with hot reload and request logging for local testing.

---

## Deploy

Push to GitHub and connect your repo at [mctx.ai](https://mctx.ai). You keep 80% — mctx handles hosting, auth, payments, and distribution.

Full deployment guide at [docs.mctx.ai](https://docs.mctx.ai).

---

## Links

- [Documentation](https://docs.mctx.ai)
- [Example Server](https://github.com/mctx-ai/example-mcp-server)
- [GitHub Issues](https://github.com/mctx-ai/mcp-server/issues)
- [Feedback](https://github.com/mctx-ai/feedback)

---

<p align="center">
  <a href="https://mctx.ai">mctx</a> · <a href="https://docs.mctx.ai">Docs</a> · <a href="https://github.com/mctx-ai/mcp-server">GitHub</a><br/>
  MIT License
</p>
