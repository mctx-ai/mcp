#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

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
  description: "An MCP server built with @mctx-ai/mcp-server",
  type: "module",
  main: "dist/index.js",
  scripts: {
    dev: "npx mctx-dev index.js",
    build: "esbuild index.js --bundle --platform=node --format=esm --outfile=dist/index.js",
  },
  dependencies: {
    "@mctx-ai/mcp-server": `^${version}`,
  },
  devDependencies: {
    "@mctx-ai/mcp-dev": `^${version}`,
    esbuild: "^0.20.0",
  },
};

writeFileSync(join(projectName, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

// Generate index.js
const indexJs = `import { createServer, T } from '@mctx-ai/mcp-server';

const app = createServer({
  instructions: 'This server provides a simple greeting tool. Use the greet tool to say hello to someone by name.',
});

// A simple greeting tool
function greet({ name }) {
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

// Generate README.md
const readme = `# ${projectName}

An MCP server built with [@mctx-ai/mcp-server](https://github.com/mctx-ai/mcp-server).

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Add a Tool

\`\`\`javascript
// Handlers receive (params, ask):
//   params — validated input object
//   ask    — LLM sampling function (undefined if client doesn't support it)
const myTool = ({ input }) => {
  return \`Result: \${input}\`;
};
myTool.description = 'What this tool does';
myTool.input = {
  input: T.string({ required: true, description: 'Input description' }),
};
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

- [Framework Docs](https://docs.mctx.ai/docs/building-mcp-servers/framework-getting-started)
- [API Reference](https://docs.mctx.ai/docs/building-mcp-servers/framework-api-reference)
- [MCP Specification](https://modelcontextprotocol.io)
`;

writeFileSync(join(projectName, "README.md"), readme);

// Success message
console.log(`✓ Created ${projectName}

  cd ${projectName}
  npm install
  npm run dev

Learn more: https://docs.mctx.ai`);
