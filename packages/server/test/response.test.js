/**
 * Response Interface Edge Case Tests
 *
 * Tests the res = { send, progress, ask } interface behavior
 * for tools/call handler dispatch in server.js.
 */

import { describe, it, expect } from "vitest";
import { createServer, T } from "../src/index.js";

// Helper to create a mock POST request with optional headers
function createRequest(body, headers = {}) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// Helper to call a tool and return the parsed response
async function callTool(server, toolName, args = {}, headers = {}) {
  const request = createRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    headers,
  );
  const response = await server.fetch(request);
  return response.json();
}

// Helper to initialize the server with optional client capabilities
async function initialize(server, capabilities = {}) {
  const request = createRequest({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test-client", version: "1.0.0" },
      capabilities,
    },
  });
  await server.fetch(request);
}

// ──────────────────────────────────────────────────────────────
// res.send() behavior
// ──────────────────────────────────────────────────────────────

describe("res.send() behavior", () => {
  it("handler that never calls res.send() returns null content (not an error)", async () => {
    const server = createServer();

    const noSend = (_mctx, _req, _res) => {
      // Intentionally never calls res.send()
    };
    noSend.input = {};

    server.tool("noSend", noSend);

    const data = await callTool(server, "noSend");

    // Should succeed (no isError), content text should be "null" (serialized undefined -> null)
    expect(data.result.isError).toBeUndefined();
    expect(Array.isArray(data.result.content)).toBe(true);
    expect(data.result.content[0].type).toBe("text");
    expect(data.result.content[0].text).toBe("null");
  });

  it("handler that calls res.send() multiple times uses the last value", async () => {
    const server = createServer();

    const multiSend = (_mctx, _req, res) => {
      res.send("first");
      res.send("second");
      res.send("third");
    };
    multiSend.input = {};

    server.tool("multiSend", multiSend);

    const data = await callTool(server, "multiSend");

    expect(data.result.isError).toBeUndefined();
    expect(data.result.content[0].text).toBe("third");
  });

  it("handler that calls res.send(undefined) returns null content", async () => {
    const server = createServer();

    const sendUndefined = (_mctx, _req, res) => {
      res.send(undefined);
    };
    sendUndefined.input = {};

    server.tool("sendUndefined", sendUndefined);

    const data = await callTool(server, "sendUndefined");

    // undefined is serialized to "null" by safeSerialize
    expect(data.result.isError).toBeUndefined();
    expect(data.result.content[0].type).toBe("text");
    expect(data.result.content[0].text).toBe("null");
  });

  it("handler that calls res.send() then throws returns isError: true (error takes precedence)", async () => {
    const server = createServer();

    const sendThenThrow = (_mctx, _req, res) => {
      res.send("this value is lost");
      throw new Error("thrown after send");
    };
    sendThenThrow.input = {};

    server.tool("sendThenThrow", sendThenThrow);

    const data = await callTool(server, "sendThenThrow");

    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("thrown after send");
  });

  it("handler that throws before calling res.send() returns isError: true", async () => {
    const server = createServer();

    const throwBeforeSend = (_mctx, _req, _res) => {
      throw new Error("threw before any send");
    };
    throwBeforeSend.input = {};

    server.tool("throwBeforeSend", throwBeforeSend);

    const data = await callTool(server, "throwBeforeSend");

    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].type).toBe("text");
    expect(data.result.content[0].text).toContain("threw before any send");
  });
});

// ──────────────────────────────────────────────────────────────
// res.progress() behavior
// ──────────────────────────────────────────────────────────────

describe("res.progress() behavior", () => {
  it("handler can call res.progress() with current and total without throwing", async () => {
    const server = createServer();

    // Track whether the handler ran to completion
    let handlerCompleted = false;

    const progressTool = (_mctx, _req, res) => {
      res.progress(1, 3);
      res.progress(2, 3);
      res.progress(3, 3);
      res.send("done");
      handlerCompleted = true;
    };
    progressTool.input = {};

    server.tool("progressTool", progressTool);

    const data = await callTool(server, "progressTool");

    // Handler completed without error
    expect(handlerCompleted).toBe(true);
    expect(data.result.isError).toBeUndefined();
    expect(data.result.content[0].text).toBe("done");
  });

  it("handler can call res.progress() with only current (no total) without throwing", async () => {
    const server = createServer();

    let handlerCompleted = false;

    const progressCurrentOnly = (_mctx, _req, res) => {
      res.progress(5);
      res.send("progress without total");
      handlerCompleted = true;
    };
    progressCurrentOnly.input = {};

    server.tool("progressCurrentOnly", progressCurrentOnly);

    const data = await callTool(server, "progressCurrentOnly");

    expect(handlerCompleted).toBe(true);
    expect(data.result.isError).toBeUndefined();
    expect(data.result.content[0].text).toBe("progress without total");
  });

  it("handler can call res.progress(0, 0) without throwing (zero values)", async () => {
    const server = createServer();

    let handlerCompleted = false;

    const progressZero = (_mctx, _req, res) => {
      res.progress(0, 0);
      res.send("zero progress");
      handlerCompleted = true;
    };
    progressZero.input = {};

    server.tool("progressZero", progressZero);

    const data = await callTool(server, "progressZero");

    expect(handlerCompleted).toBe(true);
    expect(data.result.isError).toBeUndefined();
    expect(data.result.content[0].text).toBe("zero progress");
  });
});

// ──────────────────────────────────────────────────────────────
// res.ask() behavior
// ──────────────────────────────────────────────────────────────

describe("res.ask() behavior", () => {
  it("res.ask is null when client does not declare sampling capability", async () => {
    const server = createServer();

    let capturedAsk;

    const inspectAsk = (_mctx, _req, res) => {
      capturedAsk = res.ask;
      res.send("inspected");
    };
    inspectAsk.input = {};

    server.tool("inspectAsk", inspectAsk);

    // Initialize without sampling capability
    await initialize(server, {});

    const data = await callTool(server, "inspectAsk");

    expect(capturedAsk).toBeNull();
    expect(data.result.isError).toBeUndefined();
  });

  it("res.ask is a function when client declares sampling capability", async () => {
    const server = createServer();

    let capturedAsk;

    const inspectAsk = (_mctx, _req, res) => {
      capturedAsk = res.ask;
      res.send("inspected");
    };
    inspectAsk.input = {};

    server.tool("inspectAsk", inspectAsk);

    // Initialize WITH sampling capability
    await initialize(server, { sampling: {} });

    const data = await callTool(server, "inspectAsk");

    expect(typeof capturedAsk).toBe("function");
    expect(data.result.isError).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────
// Handler parameter validation
// ──────────────────────────────────────────────────────────────

describe("handler parameter validation", () => {
  it("mctx.userId is populated from X-Mctx-User-Id request header", async () => {
    const server = createServer();

    let capturedUserId;

    const captureUserId = (mctx, _req, res) => {
      capturedUserId = mctx.userId;
      res.send("captured");
    };
    captureUserId.input = {};

    server.tool("captureUserId", captureUserId);

    const data = await callTool(server, "captureUserId", {}, { "x-mctx-user-id": "user-abc-123" });

    expect(capturedUserId).toBe("user-abc-123");
    expect(data.result.isError).toBeUndefined();
  });

  it("mctx.userId is undefined when X-Mctx-User-Id header is absent", async () => {
    const server = createServer();

    let capturedUserId = "NOT_SET";

    const captureUserId = (mctx, _req, res) => {
      capturedUserId = mctx.userId;
      res.send("captured");
    };
    captureUserId.input = {};

    server.tool("captureUserId", captureUserId);

    // No x-mctx-user-id header
    const data = await callTool(server, "captureUserId", {}, {});

    expect(capturedUserId).toBeUndefined();
    expect(data.result.isError).toBeUndefined();
  });

  it("handler receives flattened input args as req (req.name, not req.args.name)", async () => {
    const server = createServer();

    let capturedReq;

    const captureReq = (_mctx, req, res) => {
      capturedReq = req;
      res.send("captured");
    };
    captureReq.input = {
      name: T.string({ required: true }),
      count: T.number({ required: true }),
    };

    server.tool("captureReq", captureReq);

    const data = await callTool(server, "captureReq", { name: "Alice", count: 42 });

    // Args are flattened directly onto req, not nested under req.args
    expect(capturedReq.name).toBe("Alice");
    expect(capturedReq.count).toBe(42);
    expect(capturedReq.args).toBeUndefined();
    expect(data.result.isError).toBeUndefined();
  });

  it("tool with no input schema receives empty object as req", async () => {
    const server = createServer();

    let capturedReq;

    const noInput = (_mctx, req, res) => {
      capturedReq = req;
      res.send("ok");
    };
    // No input property set — matches "tool with no input schema"

    server.tool("noInput", noInput);

    const data = await callTool(server, "noInput");

    expect(capturedReq).toBeDefined();
    expect(typeof capturedReq).toBe("object");
    expect(Object.keys(capturedReq)).toHaveLength(0);
    expect(data.result.isError).toBeUndefined();
  });
});
