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
    if (method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock", version: "1.0.0" } } }),
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
function httpGet(port, path = "/") {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
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

  test("GET /.well-known/oauth-authorization-server returns 404", async () => {
    const { status } = await httpGet(srv.port, "/.well-known/oauth-authorization-server");
    assert.equal(status, 404);
  });

  test("GET /.well-known/oauth-protected-resource returns 404", async () => {
    const { status } = await httpGet(srv.port, "/.well-known/oauth-protected-resource");
    assert.equal(status, 404);
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

  // createRequest() integration tests — verify the Web API Request constructed
  // by createRequest() correctly forwards headers and body to the app fetch handler.

  test("POST initialize request returns successful JSON-RPC response (not parse error, not headers.get error)", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    assert.equal(status, 200, "initialize should return HTTP 200");
    assert.equal(body?.jsonrpc, "2.0", "response should be JSON-RPC 2.0");
    assert.ok(!body?.error, `should not return a JSON-RPC error: ${JSON.stringify(body?.error)}`);
    assert.ok(body?.result, "initialize should return a result object");
  });

  test("POST tools/list with Content-Type application/json header is properly forwarded to the fetch handler", async () => {
    // The app's fetch handler calls req.json() which requires Content-Type: application/json.
    // If createRequest() drops the header, req.json() may fail or the body may not be parsed.
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/list",
    });
    assert.equal(status, 200, "tools/list should return HTTP 200 when Content-Type is forwarded");
    assert.equal(body?.jsonrpc, "2.0");
    assert.ok(
      !body?.error,
      `handler should not see a parse error due to missing Content-Type: ${JSON.stringify(body?.error)}`,
    );
    assert.ok(Array.isArray(body?.result?.tools), "tools should be an array");
  });

  test("POST body is properly passed through to the fetch handler (not double-parsed, not dropped)", async () => {
    // Verifies the raw body string is forwarded intact so the mock app can parse it
    // and route by method name. A dropped or re-serialized body would lose the id
    // field or produce a method-not-found error.
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 42,
      method: "ping",
    });
    assert.equal(status, 200, "ping should return HTTP 200");
    assert.equal(body?.jsonrpc, "2.0");
    assert.ok(!body?.error, `should not return an error: ${JSON.stringify(body?.error)}`);
    assert.equal(
      body?.id,
      42,
      "response id must match request id — body was passed through intact",
    );
  });
});

// ---------------------------------------------------------------------------
// Header forwarding tests — verify incoming headers reach the fetch handler
// ---------------------------------------------------------------------------

describe("startDevServer header forwarding", () => {
  let tmpDir;
  let srv;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mctx-header-test-"));

    // Mock app that echoes back the X-Mctx-User-Id header value in the result
    const src = `
export default {
  fetch: async (req) => {
    const userId = req.headers.get("x-mctx-user-id") ?? null;
    const headers = { "Content-Type": "application/json" };
    const body = await req.json().catch(() => ({}));
    if (body?.method === "ping") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
        { status: 200, headers }
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, result: { userId } }),
      { status: 200, headers }
    );
  }
};
`;
    const filePath = join(tmpDir, "header-app.js");
    writeFileSync(filePath, src);
    srv = await startServer(filePath);
  });

  after(() => {
    if (srv) srv.kill();
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  test("X-Mctx-User-Id header is forwarded through dev server to the core fetch handler", async () => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const { status, body } = await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: srv.port,
          path: "/",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "X-Mctx-User-Id": "user-abc-123",
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

    assert.equal(status, 200, "request should succeed");
    assert.equal(
      body?.result?.userId,
      "user-abc-123",
      `X-Mctx-User-Id should reach the fetch handler, got: ${body?.result?.userId}`,
    );
  });

  test("requests without X-Mctx-User-Id header receive null userId in fetch handler", async () => {
    const { status, body } = await rpcPost(srv.port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    assert.equal(status, 200, "request should succeed");
    assert.equal(
      body?.result?.userId,
      null,
      `userId should be null when header is absent, got: ${body?.result?.userId}`,
    );
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
