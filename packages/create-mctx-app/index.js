#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// Read version from own package.json
const selfPkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const version = selfPkg.version;

const projectName = process.argv[2];

if (!projectName) {
  console.error("Usage: npm create mctx-app <project-name>");
  process.exit(1);
}

if (existsSync(projectName)) {
  console.error(`Error: Directory "${projectName}" already exists`);
  process.exit(1);
}

// Create project directory
mkdirSync(projectName, { recursive: true });

// Generate package.json
const packageJson = {
  name: projectName,
  version: "0.0.1",
  description: "An App built with @mctx-ai/app",
  type: "module",
  main: "dist/index.js",
  scripts: {
    dev: "npx mctx-dev index.js",
    build:
      "esbuild index.js --bundle --minify --platform=node --format=esm --outfile=dist/index.js",
  },
  dependencies: {
    "@mctx-ai/app": `${version}`,
  },
  devDependencies: {
    "@mctx-ai/dev": `${version}`,
    esbuild: "0.27.0",
  },
  engines: {
    node: ">=22.0.0",
    npm: ">=10.8.0",
  },
};

writeFileSync(join(projectName, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

// Generate index.js
const indexJs = `import { createServer, T } from '@mctx-ai/app';

const app = createServer({
  instructions: 'This server provides a simple greeting tool. Use the greet tool to say hello to someone by name.',
});

// A simple greeting tool
function greet(mctx, { name }) {
  return \`Hello, \${name}! Welcome to mctx.\`;
}
greet.description = 'Greet someone by name';
greet.input = {
  name: T.string({ required: true, description: 'Name to greet' }),
};
app.tool('greet', greet);

// Learn more: https://docs.mctx.ai/framework/tools

export default app;
`;

writeFileSync(join(projectName, "index.js"), indexJs);

// Generate .gitignore
const gitignore = `node_modules/
dist/
`;

writeFileSync(join(projectName, ".gitignore"), gitignore);

// Generate .npmrc
const npmrc = `save-exact=true
`;

writeFileSync(join(projectName, ".npmrc"), npmrc);

// Generate README.md
const readme = `# ${projectName}

An App built with [@mctx-ai/app](https://github.com/mctx-ai/app).

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

The dev server runs on port 3000 by default. Set the \`PORT\` environment variable or use the \`--port\` flag to change it:

\`\`\`bash
PORT=8080 npm run dev
# or
npx mctx-dev index.js --port 8080
\`\`\`

## Add a Tool

Create a separate file for your handler (e.g. \`tools/my-tool.js\`):

\`\`\`javascript
// tools/my-tool.js
import { T } from '@mctx-ai/app';

// Handlers receive (mctx, { field1, field2 }, ask):
//   mctx               — request context
//                          mctx.userId — stable, opaque user identifier (undefined if unauthenticated)
//                          mctx.emit   — emit a channel event (returns eventId)
//                          mctx.cancel — cancel a previously emitted scheduled event
//   { field1, field2 } — destructured validated input fields
//   ask                — LLM sampling function (null if client doesn't support it)
export function myTool(mctx, { input }) {
  return \`Result: \${input}\`;
}
myTool.description = 'What this tool does';
myTool.input = {
  input: T.string({ required: true, description: 'Input description' }),
};
\`\`\`

Then import and register it in \`index.js\`:

\`\`\`javascript
// index.js
import { myTool } from './tools/my-tool.js';
app.tool('my-tool', myTool);
\`\`\`

## Build

\`\`\`bash
npm run build
\`\`\`

This bundles your server into a single \`dist/index.js\` file ready for deployment.

## Deploy

1. Push to GitHub
2. Connect your repo at [mctx.ai](https://mctx.ai)
3. Deploy — mctx reads \`package.json\` and runs your server

## Learn More

- [Framework Docs](https://docs.mctx.ai/docs/building-apps/framework-getting-started)
- [API Reference](https://docs.mctx.ai/docs/building-apps/framework-api-reference)
- [MCP Specification](https://modelcontextprotocol.io)
`;

writeFileSync(join(projectName, "README.md"), readme);

// Copy template files (e.g. .github/ CI workflows)
const templateDir = join(fileURLToPath(new URL(".", import.meta.url)), "template");
cpSync(templateDir, projectName, { recursive: true });

// Success message
console.log(`✓ Created ${projectName}

  cd ${projectName}
  npm install
  npm run dev

Learn more: https://docs.mctx.ai`);
