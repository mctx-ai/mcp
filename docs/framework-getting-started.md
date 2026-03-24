---
title: "Getting Started with the Framework"
description: Build your first MCP server in under 5 minutes using @mctx-ai/app. No protocol knowledge needed.
---

By the end of this page, you will have a working MCP server that AI assistants can talk to. It takes about 13 lines of code.

> **Prefer a template?** The [example-app](https://github.com/mctx-ai/example-app) is a GitHub template — click "Use this template" to get a pre-configured project with CI/CD already set up.

## Set up your project

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @mctx-ai/app
```

Open your `package.json` and add `"type": "module"` so JavaScript imports work correctly:

```json
{
  "name": "my-mcp-server",
  "version": "0.1.0",
  "type": "module"
}
```

## Write your first tool

Create a file called `index.js`. This is your entire server:

```js
import { createServer, T } from "@mctx-ai/app";

const app = createServer();

const greet = ({ name }) => `Hello, ${name}!`;
greet.description = "Greets a person by name";
greet.input = {
  name: T.string({ required: true, description: "Name to greet" }),
};

app.tool("greet", greet);

export default app;
```

That is the whole server. When an AI assistant connects, it will see a tool called `greet` and know how to use it from the description and input schema you provided.

Here is what is happening in those 13 lines:

1. **`createServer()`** sets up all the protocol plumbing -- the JSON-RPC parsing, routing, input validation, error handling, and security protections.
2. **Your function** (`greet`) contains only your business logic. It receives validated input and returns a result.
3. **`T.string()`** describes the input so AI assistants know what to send and the framework can validate it before your code runs.
4. **`app.tool("greet", greet)`** registers the function so AI clients can discover and call it.
5. **`export default app`** exposes the server as an HTTP handler. The `app` object includes a `fetch` method that mctx uses for deployment. You can also write this as `export default { fetch: app.fetch }` -- both forms work.

## Try it locally

Install the dev tooling package, then start the built-in dev server for hot-reload while you work:

```bash
npm install -D @mctx-ai/dev
npx mctx-dev index.js
```

You can test it with any MCP-compatible client, or use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to interact with your server visually.

## Prepare for deployment

Update your `package.json` with the fields mctx needs to deploy your server:

```json
{
  "name": "my-server",
  "version": "0.1.0",
  "description": "My first MCP server",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "esbuild index.js --bundle --minify --platform=node --format=esm --outfile=dist/index.js"
  },
  "devDependencies": {
    "esbuild": "^0.27.0"
  }
}
```

- **`version`** -- mctx detects new deployments by checking this number. Bump it each time you push changes.
- **`description`** -- this is what subscribers see when they discover your server.
- **`main`** -- the path to your built JavaScript file. mctx loads this when running your server.
- **`build` script** -- produces a single bundled JavaScript file. Everything, including all dependencies like `@mctx-ai/app`, must be bundled into one file. esbuild handles this automatically and processes TypeScript natively without needing a separate compilation step.

No custom config files needed. mctx reads standard `package.json` fields and auto-detects your server's capabilities at deploy time.

Build it, push to GitHub, connect to [mctx](https://mctx.ai), and deploy:

```bash
npm run build
```

## Add instructions for AI assistants

Want to give AI models a hint about how to use your server? Pass an `instructions` string when you create the server:

```js
const app = createServer({
  instructions: "Use the 'greet' tool when the user wants to say hello to someone.",
});
```

Instructions are sent to AI clients during the initial handshake, before any tool calls happen. They help the AI understand your server's purpose and when to use each tool.

## What the framework handles for you

Everything you did not write, the framework handles automatically:

- **Protocol negotiation** -- the JSON-RPC handshake that clients use to discover your server
- **Input validation** -- rejects bad input before your code runs, using the schemas you defined with `T`
- **Error handling** -- catches exceptions in your tools and returns safe error responses with secrets redacted
- **Security** -- blocks path traversal, prototype pollution, oversized payloads, and dangerous URI schemes
- **CORS** -- handles cross-origin requests so browser-based clients work out of the box
- **Capability detection** -- advertises the right capabilities based on what you registered (tools, resources, prompts)

For comparison, the same hello-world server built without the framework takes about 190 lines of manual JSON-RPC handling. The framework collapses that to 13.

## Keep building

Now that you have a working server, here is where to go next:

- **[Tools, Resources, and Prompts](/building-apps/tools-and-resources)** -- learn the three building blocks that make MCP servers powerful, with real-world examples
- **[Server Requirements](/building-apps/server-requirements)** -- the complete checklist of what mctx expects from your project
- **[Framework API Reference](./framework-api-reference.md)** -- every export, type, and option documented
- **[Example Server](https://github.com/mctx-ai/example-app)** -- a template repository you can use to start your own server. Click "Use this template" on GitHub, then run `setup.sh` to customize your project
