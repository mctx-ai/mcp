<p align="center">
  <img src="https://mctx.ai/brand/logo-black.png" alt="mctx logo" width="200"/>
</p>

<p align="center">
  <strong>mctx — The best way to Build an MCP Server</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp"><img src="https://img.shields.io/npm/v/@mctx-ai/mcp" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@mctx-ai/mcp"><img src="https://img.shields.io/npm/l/@mctx-ai/mcp" alt="license"/></a>
  <a href="https://github.com/mctx-ai/mcp/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mctx-ai/mcp/ci.yml" alt="CI"/></a>
</p>

```bash
npm install @mctx-ai/mcp
```

```javascript
import { createServer, T } from "@mctx-ai/mcp";

const server = createServer({
  instructions: "A greeting server. Use the greet tool to say hello.",
});

function greet(mctx, req, res) {
  res.send(`Hello, ${req.name}!`);
}
greet.description = "Greet someone by name";
greet.input = {
  name: T.string({ required: true, description: "Name to greet" }),
};
server.tool("greet", greet);

export default { fetch: server.fetch };
```

That's a working MCP server. The framework handles protocol negotiation, input validation, error sanitization, CORS, and capability detection. You write the business logic.

---

## Tools

Tools are functions that AI can call — like API endpoints. Define a function, attach `.description` and `.input`, and register it.

```javascript
function add(mctx, req, res) {
  res.send(req.a + req.b);
}
add.description = "Add two numbers";
add.input = {
  a: T.number({ required: true, description: "First number" }),
  b: T.number({ required: true, description: "Second number" }),
};
server.tool("add", add);
```

Call `res.send(result)` to return the result. Return a string and it becomes the tool's text response. Return an object and it gets JSON-serialized automatically.

### ToolAnnotations

Attach behavioral hints to a tool by setting its `.annotations` property. Clients use these hints to adjust permission prompts and UI treatment.

```javascript
function deleteFile(mctx, req, res) {
  fs.unlinkSync(req.path);
  res.send(`Deleted ${req.path}`);
}
deleteFile.description = "Delete a file from disk";
deleteFile.input = { path: T.string({ required: true }) };
deleteFile.annotations = { destructiveHint: true };
server.tool("delete_file", deleteFile);
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
function readme(mctx, req, res) {
  res.send("# My Project\nWelcome to the docs.");
}
readme.mimeType = "text/markdown";
server.resource("docs://readme", readme);

// Dynamic template
function getUser(mctx, req, res) {
  res.send(JSON.stringify(db.findUser(req.userId)));
}
getUser.description = "Fetch a user by ID";
getUser.mimeType = "application/json";
server.resource("user://{userId}", getUser);
```

Static URIs show up in `resources/list`. Templates with `{param}` placeholders show up in `resources/templates/list` and receive extracted params via `req`.

---

## Prompts

Prompts are reusable message templates for AI interactions. Call `res.send()` with a string for simple cases, or use `conversation()` for multi-message flows.

```javascript
function codeReview(mctx, req, res) {
  res.send(`Review this ${req.language} code for bugs and style issues:\n\n${req.code}`);
}
codeReview.description = "Review code for issues";
codeReview.input = {
  code: T.string({ required: true, description: "Code to review" }),
  language: T.string({ description: "Programming language" }),
};
server.prompt("code-review", codeReview);
```

For multi-message prompts with images or embedded resources:

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
import { buildInputSchema, T } from "@mctx-ai/mcp";

const schema = buildInputSchema({
  name: T.string({ required: true }),
  age: T.number(),
});
// => { type: 'object', properties: { name: {...}, age: {...} }, required: ['name'] }
```

---

## Advanced Features

### Progress Reporting

Call `res.progress(current, total?)` for long-running tools.

```javascript
async function migrate(mctx, req, res) {
  for (let i = 0; i < req.tables.length; i++) {
    res.progress(i + 1, req.tables.length);
    await copyTable(req.tables[i]);
  }
  res.send(`Migrated ${req.tables.length} tables`);
}
migrate.description = "Migrate database tables";
migrate.input = {
  tables: T.array({ required: true, items: T.string() }),
};
server.tool("migrate", migrate);
```

### Structured Logging

```javascript
import { log } from "@mctx-ai/mcp";

log.info("Server started");
log.warning("Rate limit approaching");
log.error("Connection failed");
```

Levels follow RFC 5424: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

Log entries are buffered internally. Use `getLogBuffer` to read them and `clearLogBuffer` to flush the buffer.

```javascript
import { getLogBuffer, clearLogBuffer } from "@mctx-ai/mcp";

const entries = getLogBuffer();
// entries: Array of LogNotification objects with level, logger, and data fields

clearLogBuffer(); // Empties the buffer
```

This is primarily useful for dev tools and middleware that need to surface handler logs — for example, printing handler log output to the console after each request.

### Sampling (res.ask)

Call `res.ask(prompt)` for LLM-in-the-loop patterns. Returns `null` if the client does not support sampling — always check before using the result.

```javascript
async function summarize(mctx, req, res) {
  const content = await fetchPage(req.url);
  const result = await res.ask(`Summarize this page:\n\n${content}`);
  if (result) {
    res.send(result);
    return;
  }
  res.send(content);
}
summarize.description = "Summarize a web page";
summarize.input = { url: T.string({ required: true }) };
server.tool("summarize", summarize);
```

---

## Development

Scaffold a new project in one command:

```bash
npm create mctx-server my-server
cd my-server
npm install
npm run dev
```

`npm run dev` starts [@mctx-ai/dev](https://www.npmjs.com/package/@mctx-ai/dev) with hot reload and request logging for local testing.

---

## Deploy

Push to GitHub and connect your repo at [mctx.ai](https://mctx.ai).

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
