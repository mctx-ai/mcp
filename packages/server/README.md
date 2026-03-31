<p align="center">
  <img src="https://mctx.ai/brand/logo-black.png" alt="mctx logo" width="200"/>
</p>

<p align="center">
  <strong>Express-like API for building MCP servers. Zero dependencies.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mctx-ai/app"><img src="https://img.shields.io/npm/v/@mctx-ai/app" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@mctx-ai/app"><img src="https://img.shields.io/npm/l/@mctx-ai/app" alt="license"/></a>
  <a href="https://github.com/mctx-ai/app/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mctx-ai/app/ci.yml" alt="CI"/></a>
</p>

```bash
npm install @mctx-ai/app
```

```javascript
import { createServer, T } from "@mctx-ai/app";

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

### ToolAnnotations

Attach behavioral hints to a tool by setting its `.annotations` property. Clients use these hints to adjust permission prompts and UI treatment.

```javascript
function deleteFile({ path }) {
  fs.unlinkSync(path);
  return `Deleted ${path}`;
}
deleteFile.description = "Delete a file from disk";
deleteFile.input = { path: T.string({ required: true }) };
deleteFile.annotations = { destructiveHint: true };
app.tool("delete_file", deleteFile);
```

Available hints (all optional booleans):

| Hint              | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `readOnlyHint`    | Tool only reads data and does not modify state                 |
| `destructiveHint` | Tool may perform destructive or irreversible actions           |
| `openWorldHint`   | Tool may interact with external systems (network, filesystem)  |
| `idempotentHint`  | Repeated calls with identical arguments cause no extra effects |

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
import { conversation } from "@mctx-ai/app";

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
import { buildInputSchema, T } from "@mctx-ai/app";

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
import { createProgress } from "@mctx-ai/app";

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
import { PROGRESS_DEFAULTS } from "@mctx-ai/app";

console.log(PROGRESS_DEFAULTS.maxExecutionTime); // 60000
console.log(PROGRESS_DEFAULTS.maxYields); // 10000
```

### Structured Logging

```javascript
import { log } from "@mctx-ai/app";

log.info("Server started");
log.warning("Rate limit approaching");
log.error("Connection failed");
```

Levels follow RFC 5424: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

Log entries are buffered internally. Use `getLogBuffer` to read them and `clearLogBuffer` to flush the buffer.

```javascript
import { getLogBuffer, clearLogBuffer } from "@mctx-ai/app";

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

The full handler signature is `(args, ask, ctx)` for tools and prompts, and `(params, ask, ctx)` for resource templates. All parameters are optional — omit any you don't need.

---

## Channel Events

Channel events let your server push real-time notifications to mctx channel subscribers. `ctx.emit` writes events as `X-Mctx-Event` response headers. The dispatch worker reads those headers and writes the events to D1. No configuration required — channel events work automatically in production.

```javascript
app.tool("deploy", (args, ask, ctx) => {
  const startEventId = ctx.emit("Deployment started", {
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
ctx.emit(content: string, options?: ChannelEventOptions): string
ctx.cancel(eventId: string): void
```

**emit()**

| Parameter           | Type                     | Description                                                                                                                                           |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`           | `string`                 | Display text for the event. Truncated to 500 characters. Empty strings are silently ignored.                                                          |
| `options.eventType` | `string`                 | Event type identifier. Must match `[a-zA-Z0-9_]+`. Defaults to `'channel'` when omitted or invalid.                                                   |
| `options.meta`      | `Record<string, string>` | Key/value metadata. All keys must match `[a-zA-Z0-9_]+` and all values must be strings — any violation causes the entire emit call to no-op silently. |
| `options.deliverAt` | `string`                 | ISO timestamp for scheduled/deferred delivery. Silently ignored if not a non-empty string.                                                            |
| `options.key`       | `string`                 | Correlation key for deduplication and cancellation. Must be a non-empty string matching `/^[a-zA-Z0-9_]+$/`. Silently ignored if invalid.             |
| `options.expiresAt` | `string` (auto-computed) | ISO timestamp after which the event is discarded. Automatically set to 7 days from emit time. Not currently configurable via options.                 |

Returns the `eventId` (UUID string) synchronously. Returns `""` on no-op (invalid input).

**cancel()**

Cancels a pending scheduled event by `eventId`. Appends an `X-Mctx-Cancel` response header with the `eventId` as a plain string.

```javascript
app.tool("schedule_and_cancel", (args, ask, ctx) => {
  const eventId = ctx.emit("Reminder", {
    eventType: "reminder",
    deliverAt: "2026-04-01T09:00:00.000Z",
    key: "daily_reminder",
  });

  // Later, cancel it
  ctx.cancel(eventId);

  return "Event cancelled";
});
```

### Security

You are responsible for sanitizing user-generated content before passing it to `ctx.emit`. The framework validates that meta key names match `[a-zA-Z0-9_]+` but does not sanitize the `content` string or meta values. Avoid passing raw user input directly.

---

## Development

Scaffold a new project in one command:

```bash
npm create mctx-app my-app
cd my-app
npm install
npm run dev
```

`npm run dev` starts [@mctx-ai/dev](https://www.npmjs.com/package/@mctx-ai/dev) with hot reload and request logging for local testing.

---

## Deploy

Push to GitHub and connect your repo at [mctx.ai](https://mctx.ai). You keep 80% — mctx handles hosting, auth, payments, and distribution.

Full deployment guide at [docs.mctx.ai](https://docs.mctx.ai).

---

## Links

- [Documentation](https://docs.mctx.ai)
- [Example Server](https://github.com/mctx-ai/example-app)
- [GitHub Issues](https://github.com/mctx-ai/app/issues)
- [Feedback](https://github.com/mctx-ai/feedback)

---

<p align="center">
  <a href="https://mctx.ai">mctx</a> · <a href="https://docs.mctx.ai">Docs</a> · <a href="https://github.com/mctx-ai/app">GitHub</a><br/>
  MIT License
</p>
