---
title: Migrating from v1 to v2
description: Upgrade guide for @mctx-ai/app v1 to v2. Breaking changes and migration examples.
---

v2 introduces a redesigned handler signature. Instead of returning values and using generator-based progress, handlers now receive an explicit output port (`res`) and call methods on it. Channel events (`emit`/`cancel`) have been removed entirely.

## Quick upgrade checklist

- [ ] Replace `@mctx-ai/app` with `@mctx-ai/mcp` in `package.json` and update all imports
- [ ] Update `@mctx-ai/dev` to `^2.0.0`
- [ ] Rename all handler signatures from `(args, ask, ctx)` or `(mctx, args, ask)` to `(mctx, req, res)`
- [ ] Replace `return value` with `res.send(value)` in every handler
- [ ] Replace `yield step()` progress tracking with `res.progress(current, total?)`
- [ ] Replace the `ask` parameter with `res.ask(prompt)` calls
- [ ] Remove all `mctx.emit(...)` and `mctx.cancel(...)` calls — channel events no longer exist
- [ ] If you import `startDevServer` programmatically, update to `import { startDevServer } from '@mctx-ai/dev'`

---

## Breaking changes

### 1. Handler signature: `(mctx, req, res)`

All handler types — tools, resources, and prompts — now use a three-parameter signature:

- `mctx` — model context: `{ userId?: string }`
- `req` — validated input fields accessed directly (`req.name`, `req.query`, etc.)
- `res` — output port with `res.send()`, `res.progress()`, and `res.ask()`

**Before (v1):**

```
handler(args, ask, ctx)
```

**After (v2):**

```
handler(mctx, req, res)
```

### 2. Return values replaced by `res.send()`

Handlers no longer return a value. Call `res.send(result)` to emit the result.

### 3. Generator progress replaced by `res.progress()`

Generator functions (`function*`) and `createProgress` are gone. Call `res.progress(current, total?)` directly.

### 4. `ask` parameter replaced by `res.ask()`

The `ask` parameter is no longer passed as a function argument. Use `res.ask(prompt)` instead.

### 5. Channel events removed

`mctx.emit()` and `mctx.cancel()` have been removed entirely. There is no replacement in v2. Remove all channel event calls from your handlers.

---

## Migration examples

### Simple tool

**Before:**

```js
const greet = (mctx, { name }, ask) => {
  return `Hello, ${name}!`;
};
greet.description = "Greet someone by name";
greet.input = { name: T.string({ required: true }) };
app.tool("greet", greet);
```

**After:**

```js
const greet = (mctx, req, res) => {
  res.send(`Hello, ${req.name}!`);
};
greet.description = "Greet someone by name";
greet.input = { name: T.string({ required: true }) };
server.tool("greet", greet);
```

---

### Tool with progress

**Before:**

```js
function* migrate(mctx, { tables }, ask) {
  const step = createProgress(tables.length);
  for (const table of tables) {
    yield step();
    await copyTable(table);
  }
  return "Migration complete";
}
migrate.input = { tables: T.array({ items: T.string(), required: true }) };
app.tool("migrate", migrate);
```

**After:**

```js
async function migrate(mctx, req, res) {
  for (let i = 0; i < req.tables.length; i++) {
    res.progress(i + 1, req.tables.length);
    await copyTable(req.tables[i]);
  }
  res.send("Migration complete");
}
migrate.input = { tables: T.array({ items: T.string(), required: true }) };
server.tool("migrate", migrate);
```

---

### Tool with sampling

**Before:**

```js
const smart = async (mctx, { question }, ask) => {
  if (!ask) return `Answer: ${question}`;
  return ask(`Answer this question: ${question}`);
};
smart.input = { question: T.string({ required: true }) };
app.tool("smart", smart);
```

**After:**

```js
const smart = async (mctx, req, res) => {
  if (!res.ask) {
    res.send(`Answer: ${req.question}`);
    return;
  }
  const result = await res.ask(`Answer this question: ${req.question}`);
  res.send(result);
};
smart.input = { question: T.string({ required: true }) };
server.tool("smart", smart);
```

---

### Resource handler

**Before:**

```js
const schema = (mctx) => {
  return JSON.stringify({ requestedBy: mctx.userId });
};
app.resource("db://schema", schema);
```

**After:**

```js
const schema = (mctx, req, res) => {
  res.send(JSON.stringify({ requestedBy: mctx.userId }));
};
server.resource("db://schema", schema);
```

For dynamic URI template resources:

**Before:**

```js
const getCustomer = async (mctx, { customerId }, ask) => {
  const customer = await db.customers.find(customerId);
  return JSON.stringify(customer);
};
getCustomer.mimeType = "application/json";
app.resource("db://customers/{customerId}", getCustomer);
```

**After:**

```js
const getCustomer = async (mctx, req, res) => {
  const customer = await db.customers.find(req.customerId);
  res.send(JSON.stringify(customer));
};
getCustomer.mimeType = "application/json";
server.resource("db://customers/{customerId}", getCustomer);
```

---

### Prompt handler

**Before:**

```js
const codeReview = (mctx, { code, language }, ask) => {
  return conversation(({ user }) => [
    user.say(`Review this ${language} code for user ${mctx.userId}:`),
    user.say(code),
  ]);
};
codeReview.input = {
  code: T.string({ required: true }),
  language: T.string({ default: "javascript" }),
};
app.prompt("code-review", codeReview);
```

**After:**

```js
const codeReview = (mctx, req, res) => {
  res.send(
    conversation(({ user }) => [
      user.say(`Review this ${req.language} code for user ${mctx.userId}:`),
      user.say(req.code),
    ]),
  );
};
codeReview.input = {
  code: T.string({ required: true }),
  language: T.string({ default: "javascript" }),
};
server.prompt("code-review", codeReview);
```

---

## What's new in v2

These improvements ship alongside the breaking changes.

### `serverInfo.version` reads from package.json

The server reports your `package.json` version dynamically during the MCP `initialize` handshake. No action required.

### Tools with no arguments no longer throw

Calling a tool with no `.input` defined now defaults to an empty args object `{}` instead of throwing.

### Method-not-found errors include the method name

Error responses for unknown JSON-RPC methods now include the method name, making debugging easier.

### Dev server: `startDevServer` is now importable

```js
import { startDevServer } from "@mctx-ai/dev";

await startDevServer(entryUrl, port);
```

The CLI (`npx mctx-dev index.js`) continues to work unchanged.

### Scaffolded projects: exact version pins and `.npmrc`

`create-mctx-server` generates projects with exact dependency version pins, `.npmrc` with `save-exact=true`, and `engines` enforcing Node >=22.

---

## See also

- [Framework API Reference](./framework-api-reference.md) — complete reference for all exports and types
- [Getting Started with the Framework](./framework-getting-started.md) — build your first server from scratch
