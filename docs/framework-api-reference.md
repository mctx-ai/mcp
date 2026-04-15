---
title: Framework API Reference
description: Complete reference for @mctx-ai/app — all exports, types, and patterns.
---

```bash
npm install @mctx-ai/app
```

## createServer()

Creates an MCP server instance.

```js
import { createServer } from "@mctx-ai/app";
const app = createServer();
```

Returns an object with `.tool()`, `.resource()`, `.prompt()`, and `.fetch()` methods.

### app.tool(name, handler)

Register a tool that AI clients can call.

```js
const greet = (mctx, req, res) => {
  res.send(`${req.greeting}, ${req.name}!`);
};
greet.description = "Greets a person";
greet.input = {
  name: T.string({ required: true }),
  greeting: T.string({ default: "Hello" }),
};
app.tool("greet", greet);
```

**Handler contract:**

- Receives `mctx` (ModelContext) as the first parameter — provides `mctx.userId`
- Receives validated input as `req` (second parameter) — access fields directly: `req.name`, `req.query`, etc.
- Receives `res` (third parameter) — the output port with `res.send()`, `res.progress()`, and `res.ask()`
- Call `res.send(result)` to return the result — do not use `return`
- Attach `.description` and `.input` as properties on the function
- Errors are caught and returned as tool error responses with secrets redacted

Binary content types (ImageContent, AudioContent per MCP spec) are planned for a future release.

### app.resource(uri, handler)

Register a resource. Use exact URIs for static resources, URI templates for dynamic ones.

```js
// Static
const readme = (mctx, req, res) => {
  res.send("Content here");
};
readme.mimeType = "text/plain";
app.resource("docs://readme", readme);

// Dynamic (RFC 6570 Level 1 template)
const user = (mctx, req, res) => {
  res.send(JSON.stringify({ id: req.userId }));
};
user.mimeType = "application/json";
app.resource("user://{userId}", user);
```

Resource handlers receive `(mctx, req, res)`. `mctx` is the ModelContext. For static resources `req` is `{}`. URI template parameters are available on `req` by name.

### app.prompt(name, handler)

Register a prompt template. Call `res.send()` with a string for single-message prompts, or pass a `conversation()` result for multi-message.

```js
// Single message
const review = (mctx, req, res) => {
  res.send(`Review: ${req.code}`);
};
review.input = { code: T.string({ required: true }) };
app.prompt("code-review", review);

// Multi-message
const debug = (mctx, req, res) => {
  res.send(
    conversation(({ user, ai }) => [user.say(`Debug: ${req.error}`), ai.say("Analyzing...")]),
  );
};
debug.input = { error: T.string({ required: true }) };
app.prompt("debug", debug);
```

Prompt handlers receive `(mctx, req, res)`. `mctx` is the ModelContext.

### app.fetch(request, env, ctx)

The fetch handler. Compatible with Cloudflare Workers and the mctx platform.

```js
export default { fetch: app.fetch };
```

---

## Handler Parameters

### mctx (ModelContext)

The first parameter of every handler. Provides per-request context.

| Property | Type                  | Description                                                                                                                                 |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `userId` | `string \| undefined` | Stable, opaque identifier for the authenticated user. Extracted from the `X-Mctx-User-Id` header. `undefined` for unauthenticated requests. |

### req (Input)

The second parameter of every handler. Contains the validated input fields as direct properties.

```js
// Given input: { name: T.string({ required: true }), age: T.number() }
// Access as:
req.name; // string
req.age; // number | undefined
```

For static resources, `req` is `{}`. For URI template resources, `req` contains the extracted template parameters.

### res (Output Port)

The third parameter of every handler. Use `res` to send results, report progress, or perform LLM sampling.

#### res.send(result)

Sends the final result. Call once per handler invocation.

```js
res.send("Hello, world!");
res.send({ status: "ok", count: 42 });
```

**Parameters:**

- `result` — A string, object (auto-serialized), or MCP content array.

#### res.progress(current, total?)

Reports progress to the client during long-running operations.

```js
async function processItems(mctx, req, res) {
  for (let i = 0; i < req.items.length; i++) {
    res.progress(i + 1, req.items.length);
    await processItem(req.items[i]);
  }
  res.send("Done");
}
```

**Parameters:**

- `current` — Current step number (integer).
- `total` — Total number of steps (integer, optional). Omit for indeterminate progress.

#### res.ask(promptOrOptions, timeout?)

Performs LLM sampling via the connected client. Returns `null` if the client does not support sampling — always check before using the result.

```js
const smart = async (mctx, req, res) => {
  const result = await res.ask(`Answer this question: ${req.question}`);
  if (!result) {
    res.send(`Answer: ${req.question}`);
    return;
  }
  res.send(result);
};
```

**Advanced usage** — pass an options object for full control:

```js
const result = await res.ask({
  messages: [{ role: "user", content: { type: "text", text: req.question } }],
  modelPreferences: { hints: [{ name: "claude-3-5-sonnet" }] },
  systemPrompt: "You are a helpful assistant.",
  maxTokens: 1000,
});
```

**Parameters:**

| Parameter         | Type             | Description                                                       |
| ----------------- | ---------------- | ----------------------------------------------------------------- |
| `promptOrOptions` | `string\|Object` | A plain string prompt, or an options object with `messages` array |
| `timeout`         | `number`         | Request timeout in milliseconds. Default: `30000` (30s)           |

Returns `Promise<string | null>` — the text content from the LLM response, or `null` if the client does not support sampling.

---

## T (Type System)

Defines input schemas for tools and prompts. Produces JSON Schema.

```js
import { T } from "@mctx-ai/app";
```

### T.string(options?)

| Option        | Type       | Description                    |
| ------------- | ---------- | ------------------------------ |
| `required`    | `boolean`  | Mark as required               |
| `description` | `string`   | Human-readable description     |
| `enum`        | `string[]` | Allowed values                 |
| `default`     | `string`   | Default value                  |
| `minLength`   | `number`   | Minimum length                 |
| `maxLength`   | `number`   | Maximum length                 |
| `pattern`     | `string`   | Regex pattern                  |
| `format`      | `string`   | Format hint (email, uri, etc.) |

### T.number(options?)

| Option        | Type      | Description                |
| ------------- | --------- | -------------------------- |
| `required`    | `boolean` | Mark as required           |
| `description` | `string`  | Human-readable description |
| `min`         | `number`  | Minimum value              |
| `max`         | `number`  | Maximum value              |
| `default`     | `number`  | Default value              |

### T.boolean(options?)

| Option        | Type      | Description                |
| ------------- | --------- | -------------------------- |
| `required`    | `boolean` | Mark as required           |
| `description` | `string`  | Human-readable description |
| `default`     | `boolean` | Default value              |

### T.array(options?)

```js
T.array({ items: T.string() }); // string array
T.array({ items: T.number(), required: true }); // required
```

### T.object(options?)

```js
T.object({
  properties: {
    name: T.string({ required: true }),
    age: T.number(),
  },
});
```

### buildInputSchema(input)

Compiles a `fn.input` object into a JSON Schema `inputSchema` with `required` array. Used internally by the framework — available if you need raw schema generation.

```js
import { buildInputSchema } from "@mctx-ai/app";

const schema = buildInputSchema({
  name: T.string({ required: true }),
  age: T.number(),
});
// { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name'] }
```

---

## conversation()

Builds multi-message prompt responses.

```js
import { conversation } from "@mctx-ai/app";

conversation(({ user, ai }) => [
  user.say("Hello"), // text message
  user.attach(data, "application/json"), // embedded data
  user.embed("image://logo"), // embedded resource
  ai.say("How can I help?"), // AI message
]);
```

---

## log

Structured logging with RFC 5424 severity levels.

```js
import { log } from "@mctx-ai/app";

log.debug("Detailed info");
log.info("Informational");
log.notice("Significant event");
log.warning("Warning");
log.error("Error");
log.critical("Critical");
log.alert("Immediate action needed");
log.emergency("System unusable");
```

Logs are buffered internally with FIFO eviction at 10,000 entries. The buffer persists until explicitly cleared. `mctx-dev` reads the buffer after each request using `getLogBuffer()` and `clearLogBuffer()` to surface logs in the dev console. In production, the server or hosting layer is responsible for pulling and forwarding buffered logs.

### getLogBuffer()

Returns a copy of the current log buffer without clearing it.

```js
import { getLogBuffer } from "@mctx-ai/app";

const entries = getLogBuffer();
// [{ type: 'log', level: 'info', data: 'Server started' }, ...]
```

**Returns:** `Array<{ type: 'log', level: string, data: * }>` — a snapshot of all buffered log entries. The array is a copy; mutating it does not affect the internal buffer.

### clearLogBuffer()

Clears all entries from the log buffer.

```js
import { clearLogBuffer } from "@mctx-ai/app";

clearLogBuffer();
```

**Returns:** `void`.

### Pull-after-request pattern

The intended usage is to read and clear the buffer after each request completes, which is exactly how `mctx-dev` works:

```js
import { getLogBuffer, clearLogBuffer } from "@mctx-ai/app";

// After handling a request:
const logs = getLogBuffer();
clearLogBuffer();
// Forward `logs` to your log sink
```

---

## Security

The framework applies security protections automatically:

- **Error sanitization** — redacts AWS keys, JWTs, connection strings, Bearer tokens, API keys
- **Size limits** — prevents DoS via large request/response bodies
- **URI validation** — blocks `file://`, `javascript:`, `data:` schemes
- **Path traversal** — detects `../` sequences including encoded variants
- **Prototype pollution** — strips `__proto__`, `constructor`, `prototype` keys

These protections are internal and applied automatically. You don't need to configure them.

---

## See Also

- [Getting Started with the Framework](./framework-getting-started.md) — Build your first server in 5 minutes
- [Tools, Resources, and Prompts](/building-apps/tools-and-resources) — Practical examples and patterns
- [Server Requirements](/building-apps/server-requirements) — Package structure and deployment checklist
