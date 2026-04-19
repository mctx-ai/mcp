#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// Read version from own package.json
const selfPkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const version = selfPkg.version;

const projectName = process.argv[2];

if (!projectName) {
  console.error("Usage: npm create mctx-server <project-name>");
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
  description: "Built with mctx — The best way to Build an MCP Server",
  type: "module",
  main: "dist/index.js",
  scripts: {
    dev: "npx mctx-dev index.js",
    build:
      "esbuild index.js --bundle --minify --platform=node --format=esm --outfile=dist/index.js",
  },
  dependencies: {
    "@mctx-ai/mcp": `${version}`,
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
const indexJs = `import { createServer, T } from '@mctx-ai/mcp';

const server = createServer({
  instructions: 'This server provides a simple greeting tool. Use the greet tool to say hello to someone by name.',
});

// A simple greeting tool
function greet(mctx, req, res) {
  res.send(\`Hello, \${req.name}! (user: \${mctx.userId || "anonymous"})\`);
}
greet.description = 'Greet someone by name';
greet.input = {
  name: T.string({ required: true, description: 'Name to greet' }),
};
server.tool('greet', greet);

// Learn more: https://docs.mctx.ai/framework/tools

export default server;
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

An MCP server built with mctx — The best way to Build an MCP Server. See [@mctx-ai/mcp](https://github.com/mctx-ai/app) for the framework.

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
import { T } from '@mctx-ai/mcp';

// Handlers receive (mctx, req, res):
//   mctx — model context
//            mctx.userId — stable, opaque user identifier (undefined if unauthenticated)
//   req  — validated input fields (req.field1, req.field2, etc.)
//   res  — output port
//            res.send(result)              — send the final result
//            res.progress(current, total?) — report progress
//            res.ask(prompt)               — LLM sampling (null if client doesn't support it)
export function myTool(mctx, req, res) {
  res.send(\`Result: \${req.input}\`);
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
server.tool('my-tool', myTool);
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
