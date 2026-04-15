---
title: Migrating from v1 to v2
description: Upgrade guide for @mctx-ai/app v1 to v2. One breaking change, several improvements.
---

v2 has one breaking change: the handler signature reordered context to the first position, Go-style. Everything else is backward-compatible.

## Quick upgrade checklist

- [ ] Update `@mctx-ai/app` to `^2.0.0` and `@mctx-ai/dev` to `^2.0.0`
- [ ] Move the context parameter from the third position to the first in every handler, and rename it `mctx`
- [ ] Update destructuring patterns — `mctx` is now `(mctx, { name, ...rest })`, not `({ name, ...rest }, ask, ctx)`
- [ ] Verify any handlers that used `ask` — it moved from second to third position
- [ ] If you import `startDevServer` programmatically, update to `import { startDevServer } from '@mctx-ai/dev'`

---

## Breaking change: handler parameter order

### What changed

All handler types — tools, resources, and prompts — now receive `mctx` as the **first** parameter, not the third. This aligns with Go-style context-first conventions and makes it natural to add context-aware behavior without touching parameter positions for `args` or `ask`.

**v1 signature (old):**

```
handler(args, ask, ctx)
```

**v2 signature (new):**

```
handler(mctx, args, ask)
```

The `mctx` object shape is unchanged: `{ userId, emit, cancel }`.

---

### Tool handlers

**v1 — before:**

```js
const deploy = async ({ environment, version }, ask, ctx) => {
  const eventId = ctx.emit(`Deploying ${version} to ${environment}`);
  return { deployed: true, eventId };
};
deploy.description = "Deploy a version to an environment";
deploy.input = {
  environment: T.string({ required: true }),
  version: T.string({ required: true }),
};
app.tool("deploy", deploy);
```

**v2 — after:**

```js
const deploy = async (mctx, { environment, version }, ask) => {
  const eventId = mctx.emit(`Deploying ${version} to ${environment}`);
  return { deployed: true, eventId };
};
deploy.description = "Deploy a version to an environment";
deploy.input = {
  environment: T.string({ required: true }),
  version: T.string({ required: true }),
};
app.tool("deploy", deploy);
```

Tools that do not use `ask` or `mctx` can omit trailing parameters:

```js
// Fine in both v1 and v2 — just be explicit about which positional params you want
const greet = (mctx, { name }) => `Hello, ${name}!`;
```

---

### Generator tool handlers (progress tracking)

**v1 — before:**

```js
function* migrate({ tables }, ask, ctx) {
  const step = createProgress(tables.length);
  for (const table of tables) {
    yield step();
    ctx.emit(`Migrating table: ${table}`);
    await copyTable(table);
  }
  return "Migration complete";
}
migrate.input = { tables: T.array({ items: T.string(), required: true }) };
app.tool("migrate", migrate);
```

**v2 — after:**

```js
function* migrate(mctx, { tables }, ask) {
  const step = createProgress(tables.length);
  for (const table of tables) {
    yield step();
    mctx.emit(`Migrating table: ${table}`);
    await copyTable(table);
  }
  return "Migration complete";
}
migrate.input = { tables: T.array({ items: T.string(), required: true }) };
app.tool("migrate", migrate);
```

Async generators follow the same pattern:

```js
// v2 async generator
async function* processQueue(mctx, { queueUrl }, ask) {
  const step = createProgress();
  while (true) {
    const msg = await poll(queueUrl);
    if (!msg) break;
    yield step();
    mctx.emit(`Processed: ${msg.id}`);
  }
  return "Queue drained";
}
```

---

### Resource handlers (static)

Static resources receive no URL parameters, so the practical change is that `mctx` moves to the front if you use it.

**v1 — before:**

```js
const schema = (_params, _ask, ctx) => {
  return JSON.stringify({ requestedBy: ctx.userId });
};
app.resource("db://schema", schema);
```

**v2 — after:**

```js
const schema = (mctx) => {
  return JSON.stringify({ requestedBy: mctx.userId });
};
app.resource("db://schema", schema);
```

If you do not use `mctx`, nothing changes in practice:

```js
// Works identically in v1 and v2
const readme = () => "# My API\n...";
readme.mimeType = "text/plain";
app.resource("docs://readme", readme);
```

---

### Resource template handlers (dynamic)

Dynamic resources receive URI template parameters in the second position.

**v1 — before:**

```js
const getCustomer = async ({ customerId }, ask, ctx) => {
  const customer = await db.customers.find(customerId);
  ctx.emit(`Fetched customer ${customerId}`, { meta: { user_id: ctx.userId } });
  return JSON.stringify(customer);
};
getCustomer.mimeType = "application/json";
app.resource("db://customers/{customerId}", getCustomer);
```

**v2 — after:**

```js
const getCustomer = async (mctx, { customerId }, ask) => {
  const customer = await db.customers.find(customerId);
  mctx.emit(`Fetched customer ${customerId}`, { meta: { user_id: mctx.userId } });
  return JSON.stringify(customer);
};
getCustomer.mimeType = "application/json";
app.resource("db://customers/{customerId}", getCustomer);
```

---

### Prompt handlers

**v1 — before:**

```js
const codeReview = ({ code, language }, ask, ctx) => {
  return conversation(({ user }) => [
    user.say(`Review this ${language} code for user ${ctx.userId}:`),
    user.say(code),
  ]);
};
codeReview.input = {
  code: T.string({ required: true }),
  language: T.string({ default: "javascript" }),
};
app.prompt("code-review", codeReview);
```

**v2 — after:**

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

---

### Using `ask` with the new signature

`ask` is now the third parameter in every handler type. Update any handlers that call into LLM sampling:

**v1 — before:**

```js
const smart = async ({ question }, ask) => {
  if (!ask) return `Answer: ${question}`;
  return ask(`Answer: ${question}`);
};
```

**v2 — after:**

```js
const smart = async (mctx, { question }, ask) => {
  if (!ask) return `Answer: ${question}`;
  return ask(`Answer: ${question}`);
};
```

The `ask` function itself is unchanged — only its position moved.

---

## What's new in v2

These improvements ship alongside the breaking change. No code changes needed unless noted.

### `serverInfo.version` reads from package.json

The server now reports your `package.json` version dynamically during the MCP `initialize` handshake, rather than a hardcoded `0.3.0`. No action required — the framework reads your version automatically at startup.

### Tools with no arguments no longer throw

Calling a tool that has no `.input` defined now gracefully defaults to an empty args object `{}` instead of throwing. If you had defensive guards around empty args, you can remove them.

### Method-not-found errors include the method name

Error responses for unknown JSON-RPC methods now include the method name that was not found, making debugging easier.

### `createEmit` and `createCancel` marked `@internal`

These two exports are framework internals. Use `mctx.emit` and `mctx.cancel` in your handler code. If you imported `createEmit` or `createCancel` directly in application code, switch to the `mctx` equivalents.

### Dev server: `startDevServer` is now importable

You can now use the dev server programmatically in addition to the CLI:

```js
import { startDevServer } from "@mctx-ai/dev";

await startDevServer(entryUrl, port);
```

The CLI (`npx mctx-dev index.js`) continues to work unchanged.

### Dev server: ESLint configured, watcher improved, error hints scoped

`@mctx-ai/dev` now has ESLint configured on its own source. The file watcher had reliability improvements. Error hint output is scoped to reduce noise — these are internal changes with no API impact.

### Scaffolded projects: exact version pins and `.npmrc`

`create-mctx-app` now generates projects with:

- Exact dependency version pins (no `^` or `~` ranges)
- `.npmrc` with `save-exact=true`
- `engines` field in `package.json` enforcing Node >=22
- `mctx` documented in the generated scaffold

If you created a project with v1 of the scaffolding, you may want to add these manually. None are required for a working server.

---

## See also

- [Framework API Reference](./framework-api-reference.md) — complete reference for all exports and types
- [Getting Started with the Framework](./framework-getting-started.md) — build your first server from scratch
