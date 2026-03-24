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
const greet = ({ name, greeting }) => `${greeting}, ${name}!`;
greet.description = "Greets a person";
greet.input = {
  name: T.string({ required: true }),
  greeting: T.string({ default: "Hello" }),
};
app.tool("greet", greet);
```

**Handler contract:**

- Receives parsed arguments as first parameter
- Second parameter `ask` is a function when the client advertises sampling capability, or `null` if the client does not support sampling — always check before calling
- Returns `string`, `object` (auto-serialized), or MCP content array
- Attach `.description` and `.input` as properties on the function
- Errors are caught and returned as tool error responses with secrets redacted

Binary content types (ImageContent, AudioContent per MCP spec) are planned for a future release.

### app.resource(uri, handler)

Register a resource. Use exact URIs for static resources, URI templates for dynamic ones.

```js
// Static
const readme = () => "Content here";
readme.mimeType = "text/plain";
app.resource("docs://readme", readme);

// Dynamic (RFC 6570 Level 1 template)
const user = ({ userId }) => JSON.stringify({ id: userId });
user.mimeType = "application/json";
app.resource("user://{userId}", user);
```

Resource handlers receive `(params, ask)`. For static resources `params` is `{}`.

### app.prompt(name, handler)

Register a prompt template. Return a string for single-message prompts, or use `conversation()` for multi-message.

```js
// Single message
const review = ({ code }) => `Review: ${code}`;
review.input = { code: T.string({ required: true }) };
app.prompt("code-review", review);

// Multi-message
const debug = ({ error }) =>
  conversation(({ user, ai }) => [user.say(`Debug: ${error}`), ai.say("Analyzing...")]);
debug.input = { error: T.string({ required: true }) };
app.prompt("debug", debug);
```

Prompt handlers receive `(args, ask)`.

### app.fetch(request, env, ctx)

The fetch handler. Compatible with Cloudflare Workers and mctx platform.

```js
export default { fetch: app.fetch };
```

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

## createProgress(total?)

Creates a step function for generator-based tools.

```js
import { createProgress } from "@mctx-ai/app";

const task = function* ({ data }) {
  const step = createProgress(3);
  yield step();
  yield step();
  yield step();
  return "Done";
};
```

Call `createProgress()` without arguments for indeterminate progress. Progress steps are tracked internally. In the current HTTP transport, progress is tracked but not streamed -- the final result is returned when the generator completes.

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

## Sampling (ask)

All handlers receive a second parameter `ask` that enables LLM-in-the-loop sampling. The framework creates `ask` via `createAsk()`, which checks client capabilities during the MCP `initialize` handshake.

- **`ask` is a function** when the client advertises `sampling` capability.
- **`ask` is `null`** when the client does not support sampling.

Always guard before calling `ask`:

```js
const smart = async ({ question }, ask) => {
  if (!ask) {
    return `Answer: ${question}`;
  }

  // Simple string prompt
  const result = await ask(`Answer this question: ${question}`);
  return result;
};
```

### Advanced usage

Pass an options object for full control over the `sampling/createMessage` request:

```js
const smart = async ({ question }, ask) => {
  if (!ask) return `Answer: ${question}`;

  const result = await ask({
    messages: [{ role: "user", content: { type: "text", text: question } }],
    modelPreferences: { hints: [{ name: "claude-3-5-sonnet" }] },
    systemPrompt: "You are a helpful assistant.",
    maxTokens: 1000,
  });

  return result;
};
```

### ask(promptOrOptions, timeout?)

| Parameter         | Type             | Description                                                       |
| ----------------- | ---------------- | ----------------------------------------------------------------- |
| `promptOrOptions` | `string\|Object` | A plain string prompt, or an options object with `messages` array |
| `timeout`         | `number`         | Request timeout in milliseconds. Default: `30000` (30s)           |

Returns `Promise<string>` — the text content from the client's LLM response.

Throws if the request fails or times out. Sampling is invoked via the MCP `sampling/createMessage` method sent through the active transport's `sendRequest` callback.

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
