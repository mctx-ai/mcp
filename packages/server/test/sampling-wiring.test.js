/**
 * Sampling Wiring Tests
 *
 * Verifies the sampling integration wired in server.js:
 * - handleInitialize advertises sampling capability
 * - Client capabilities are stored and passed to tool handlers
 * - ask() is null when client does not support sampling
 * - buildSendRequest sends correct JSON-RPC envelope
 * - buildSendRequest propagates JSON-RPC errors
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "../src/index.js";

// Helper to create a mock POST Request
function createRequest(body, headers = {}) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// Helper to send an initialize request and return the parsed response data
async function initialize(app, capabilities = {}) {
  const request = createRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities,
      clientInfo: { name: "test-client", version: "1.0" },
    },
  });
  const response = await app.fetch(request);
  return response.json();
}

// Helper to call a tool and return the parsed response data
async function callTool(app, toolName, args, headers = {}) {
  const request = createRequest(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    headers,
  );
  const response = await app.fetch(request);
  return response.json();
}

describe("handleInitialize - sampling capability advertisement", () => {
  it("advertises sampling capability in initialize response", async () => {
    const app = createServer();

    const data = await initialize(app);

    expect(data.result.capabilities).toBeDefined();
    expect(data.result.capabilities.sampling).toBeDefined();
    expect(data.result.capabilities.sampling).toEqual({});
  });
});

describe("handleInitialize - client capability storage", () => {
  it("stores sampling capability and provides non-null ask to tool handler", async () => {
    const app = createServer();

    let receivedAsk;
    const probe = (_args, ask) => {
      receivedAsk = ask;
      return "ok";
    };
    probe.description = "Probes the ask function";
    probe.input = {};
    app.tool("probe", probe);

    // Initialize with sampling capability
    await initialize(app, { sampling: {} });

    // Call the tool and capture what was passed as ask
    await callTool(app, "probe", {});

    expect(receivedAsk).not.toBeNull();
    expect(typeof receivedAsk).toBe("function");
  });
});

describe("ask is null when client does not support sampling", () => {
  it("provides null ask to tool handler when client omits sampling capability", async () => {
    const app = createServer();

    let receivedAsk = "sentinel";
    const probe = (_args, ask) => {
      receivedAsk = ask;
      return "ok";
    };
    probe.description = "Probes the ask function";
    probe.input = {};
    app.tool("probe", probe);

    // Initialize WITHOUT sampling capability
    await initialize(app, {});

    // Call the tool and capture what was passed as ask
    await callTool(app, "probe", {});

    expect(receivedAsk).toBeNull();
  });
});

describe("buildSendRequest - JSON-RPC envelope", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts correct JSON-RPC envelope to /_mctx/sampling with session ID header", async () => {
    const app = createServer();

    // Mock fetch to capture the outgoing request
    const fetchCalls = [];
    globalThis.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      // Return a valid sampling response so ask() resolves
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: "mocked response" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const SESSION_ID = "test-session-abc";

    // Register a tool that calls ask()
    const asker = async (_args, ask) => {
      await ask("hello from tool");
      return "done";
    };
    asker.description = "Calls ask";
    asker.input = {};
    app.tool("asker", asker);

    // Initialize with sampling capability
    await initialize(app, { sampling: {} });

    // Call the tool, passing the session ID header
    await callTool(app, "asker", {}, { "Mcp-Session-Id": SESSION_ID });

    expect(fetchCalls).toHaveLength(1);

    const { url, init } = fetchCalls[0];
    expect(url).toBe("/_mctx/sampling");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.jsonrpc).toBe("2.0");
    expect(typeof body.id).toBe("number");
    expect(typeof body.method).toBe("string");
    expect(body.method).toBe("sampling/createMessage");
    expect(body.params).toBeDefined();
    expect(typeof body.params).toBe("object");

    expect(init.headers["Mcp-Session-Id"]).toBe(SESSION_ID);
  });
});

describe("buildSendRequest - JSON-RPC error propagation", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("propagates JSON-RPC error message when server returns an error envelope", async () => {
    const app = createServer();

    // Mock fetch to return a JSON-RPC error response
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Invalid Request" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    let caughtError = null;
    const asker = async (_args, ask) => {
      try {
        await ask("this will fail");
      } catch (err) {
        caughtError = err;
      }
      return "done";
    };
    asker.description = "Catches ask error";
    asker.input = {};
    app.tool("asker", asker);

    // Initialize with sampling capability
    await initialize(app, { sampling: {} });

    // Call the tool
    await callTool(app, "asker", {});

    // The error from JSON-RPC is "Invalid Request", but createAsk wraps it
    // with "Sampling request failed: <original message>"
    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toContain("Invalid Request");
  });
});
