/**
 * Dev server HTTP behavior tests
 *
 * Tests the dev server by spawning it as a subprocess via the CLI entry point
 * and making real HTTP requests. This provides end-to-end coverage of the
 * HTTP transport layer (request routing, error handling, JSON-RPC formatting)
 * without leaving dangling server processes in the test runner.
 *
 * formatMethod() is internal — its routing logic is exercised indirectly by
 * verifying that tools/call, resources/read, and prompts/get requests all
 * produce successful responses from the mock app.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { request as httpRequest, createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../src/cli.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a free TCP port by binding to port 0.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Write a minimal ESM mock app that routes JSON-RPC methods to canned
 * responses. Returns the absolute file path.
 */
function writeMockApp(dir, name = "mock-app.js") {
  const src = `
export default {
  fetch: async (req) => {
    const body = await req.json();
    const method = body?.method;
    const headers = { "Content-Type": "application/json" };

    if (method === "tools/call") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } }),
        { status: 200, headers }
      );
    }
    if (method === "resources/read") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { contents: [] } }),
        { status: 200, headers }
      );
    }
    if (method === "prompts/get") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { messages: [] } }),
        { status: 200, headers }
      );
    }
    if (method === "tools/list") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
        { status: 200, headers }
      );
    }
    if (method === "ping") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
        { status: 200, headers }
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "Method not found" } }),
      { status: 404, headers }
    );
  }
};
`;
  const filePath = join(dir, name);
  writeFileSync(filePath, src);
  return filePath;
}

/**
 * Spawn the CLI dev server and wait until it accepts connections.
 * Returns { process: ChildProcess, port: number, kill: () => void }.
 */
async function startServer(appFilePath, extraArgs = []) {
  const port = await getFreePort();
  const child = spawn(
    process.execPath,
    [CLI_PATH, appFilePath, "--port", String(port), ...extraArgs],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // Wait up to 5 seconds for the server to start accepting connections
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;

    function probe() {
      rpcPost(port, { jsonrpc: "2.0", id: 0, method: "ping" })
        .then(() => resolve())
        .catch(() => {
          if (Date.now() < deadline) {
            setTimeout(probe, 80);
          } else {
            reject(new Error(`Server on port ${port} did not start within 5s`));
          }
        });
    }

    probe();
  });

  return {
    process: child,
    port,
    kill() {
      child.kill("SIGTERM");
    },
  };
}

/**
 * POST a JSON-RPC body to the dev server and return { status, body }.
 */
function rpcPost(port, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * POST a raw string body (for malformed JSON tests).
 */
function postRaw(port, raw) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

/**
 * Send a GET request.
 */
function httpGet(port) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path: "/", method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main test suite — shares one server instance for efficiency
// ---------------------------------------------------------------------------

describe("startDevServer HTTP behavior", () => {
  let tmpDir;
  let srv;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mctx-server-test-"));
    const appFile = writeMockApp(tmpDir);
    srv = await startServer(appFile);
  });

  after(() => {
    if (srv) srv.kill();
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  test("responds 405 to non-POST HTTP requests", async () => {
    const { status, body } = await httpGet(srv.port);
    assert.equal(status, 405);
    assert.equal(body?.jsonrpc, "2.0");
    assert.ok(
      body?.error?.message?.toLowerCase().includes("post"),
      `expected 'POST' in error message, got: ${body?.error?.message}`,
    );
  });

  test("responds 400 with JSON-RPC parse error code for malformed JSON body", async () => {
    const { status, body } = await postRaw(srv.port, "{not valid json");
    assert.equal(status, 400);
    assert.equal(body?.jsonrpc, "2.0");
    assert.equal(body?.error?.code, -32700, "should use JSON-RPC parse error code -32700");
    assert.match(body?.error?.message, /parse error/i);
  });

  test("forwards tools/call and returns successful result", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "greet", arguments: { name: "World" } },
    });
    assert.equal(status, 200);
    assert.ok(body?.result, "should return a result object");
    assert.equal(body?.id, 2, "response id should match request id");
  });

  test("forwards resources/read and returns successful result", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "file:///test.txt" },
    });
    assert.equal(status, 200);
    assert.ok(body?.result, "should return a result object");
  });

  test("forwards prompts/get and returns successful result", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 4,
      method: "prompts/get",
      params: { name: "summarize" },
    });
    assert.equal(status, 200);
    assert.ok(body?.result, "should return a result object");
  });

  test("forwards tools/list and returns successful result", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
    });
    assert.equal(status, 200);
    assert.ok(body?.result, "should return a result object");
    assert.ok(Array.isArray(body?.result?.tools), "tools should be an array");
  });

  test("passes request id through in response envelope", async () => {
    const { body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 99,
      method: "tools/list",
    });
    assert.equal(body?.id, 99, "response id should match request id");
  });
});

// ---------------------------------------------------------------------------
// Error recovery tests — one subprocess per scenario
// ---------------------------------------------------------------------------

describe("startDevServer error handling", () => {
  test("returns 503 JSON-RPC error when module has syntax error on startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mctx-syntax-test-"));
    const badSrc = `export default { fetch: async () => {  // unterminated — syntax error`;
    const badFile = join(dir, "bad.js");
    writeFileSync(badFile, badSrc);

    let srv503;
    try {
      srv503 = await startServer(badFile);
      const { status, body } = await rpcPost(srv503.port, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
      });

      assert.equal(status, 503);
      assert.ok(body?.error, "should return a JSON-RPC error object");
      assert.match(
        body?.error?.message,
        /syntax error|initialization failed/i,
        `unexpected error message: ${body?.error?.message}`,
      );
    } finally {
      if (srv503) srv503.kill();
      rmSync(dir, { recursive: true });
    }
  });

  test("returns JSON-RPC error when handler throws, without crashing the server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mctx-throw-test-"));
    const throwSrc = `
export default {
  fetch: async () => { throw new Error("handler exploded"); }
};
`;
    const throwFile = join(dir, "throw-app.js");
    writeFileSync(throwFile, throwSrc);

    let srvThrow;
    try {
      srvThrow = await startServer(throwFile);

      const { body: first } = await rpcPost(srvThrow.port, {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
      });
      assert.ok(first?.error, "should return a JSON-RPC error when handler throws");
      assert.equal(first?.jsonrpc, "2.0");

      // Server should still respond to subsequent requests (not crashed)
      const { body: second } = await rpcPost(srvThrow.port, {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/list",
      });
      assert.ok(second?.error, "server should still be responding after previous error");
    } finally {
      if (srvThrow) srvThrow.kill();
      rmSync(dir, { recursive: true });
    }
  });
});
