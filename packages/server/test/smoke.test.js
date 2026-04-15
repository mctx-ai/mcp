/**
 * Smoke Tests
 *
 * Pre-publish smoke tests to verify package entry point and basic functionality.
 */

import { describe, it, expect } from "vitest";
import * as mcpServer from "../src/index.js";
import {
  createServer,
  T,
  conversation,
  createProgress,
  PROGRESS_DEFAULTS,
  log,
} from "../src/index.js";

describe("package exports", () => {
  it("exports createServer", () => {
    expect(mcpServer.createServer).toBeDefined();
    expect(typeof mcpServer.createServer).toBe("function");
  });

  it("exports T type system", () => {
    expect(mcpServer.T).toBeDefined();
    expect(typeof mcpServer.T).toBe("object");
    expect(typeof mcpServer.T.string).toBe("function");
    expect(typeof mcpServer.T.number).toBe("function");
    expect(typeof mcpServer.T.boolean).toBe("function");
    expect(typeof mcpServer.T.array).toBe("function");
    expect(typeof mcpServer.T.object).toBe("function");
  });

  it("exports buildInputSchema", () => {
    expect(mcpServer.buildInputSchema).toBeDefined();
    expect(typeof mcpServer.buildInputSchema).toBe("function");
  });

  it("exports conversation", () => {
    expect(mcpServer.conversation).toBeDefined();
    expect(typeof mcpServer.conversation).toBe("function");
  });

  it("exports createProgress", () => {
    expect(mcpServer.createProgress).toBeDefined();
    expect(typeof mcpServer.createProgress).toBe("function");
  });

  it("exports PROGRESS_DEFAULTS", () => {
    expect(PROGRESS_DEFAULTS).toBeDefined();
    expect(PROGRESS_DEFAULTS.maxExecutionTime).toBe(60000);
    expect(PROGRESS_DEFAULTS.maxYields).toBe(10000);
  });

  it("exports log", () => {
    expect(mcpServer.log).toBeDefined();
    expect(typeof mcpServer.log).toBe("object");
    expect(typeof mcpServer.log.debug).toBe("function");
    expect(typeof mcpServer.log.info).toBe("function");
    expect(typeof mcpServer.log.error).toBe("function");
  });

  // Security functions are not exported from public API - they are internal
  // If needed, they can be imported directly from '../src/security.js'
});

describe("basic functionality smoke test", () => {
  it("creates a server and responds to tools/list", async () => {
    const app = createServer();

    const greet = (_mctx, { name }) => `Hello, ${name}!`;
    greet.description = "Greets a person";
    greet.input = {
      name: T.string({ required: true }),
    };

    app.tool("greet", greet);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result).toBeDefined();
    expect(data.result.tools).toBeDefined();
    expect(data.result.tools.length).toBeGreaterThan(0);
  });

  it("T type system produces valid JSON Schema", () => {
    const schema = T.object({
      properties: {
        name: T.string({ required: true, minLength: 1 }),
        age: T.number({ min: 0, max: 150 }),
        active: T.boolean({ default: true }),
      },
    });

    expect(schema.type).toBe("object");
    expect(schema.properties.name.type).toBe("string");
    expect(schema.properties.age.type).toBe("number");
    expect(schema.properties.active.type).toBe("boolean");
    expect(schema.required).toEqual(["name"]);
  });

  it("conversation builder creates message arrays", () => {
    const result = conversation(({ user, ai }) => [user.say("Hello"), ai.say("Hi there!")]);

    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("assistant");
  });

  it("createProgress produces notification objects", () => {
    const step = createProgress(3);

    const notification1 = step();
    expect(notification1.type).toBe("progress");
    expect(notification1.progress).toBe(1);
    expect(notification1.total).toBe(3);

    const notification2 = step();
    expect(notification2.progress).toBe(2);
  });

  it("log produces notification objects", () => {
    // log methods return notification objects
    const notification = log.info("Test message");

    expect(notification).toBeDefined();
    expect(notification.type).toBe("log");
    expect(notification.level).toBe("info");
    expect(notification.data).toBe("Test message");
  });
});

describe("import patterns", () => {
  it("supports named imports", () => {
    expect(createServer).toBeDefined();
    expect(T).toBeDefined();
    expect(conversation).toBeDefined();
    expect(createProgress).toBeDefined();
    expect(log).toBeDefined();
  });

  it("supports namespace import", () => {
    expect(mcpServer.createServer).toBeDefined();
    expect(mcpServer.T).toBeDefined();
    expect(mcpServer.conversation).toBeDefined();
    expect(mcpServer.createProgress).toBeDefined();
    expect(mcpServer.log).toBeDefined();
  });
});

describe("type safety", () => {
  it("createServer returns object with expected methods", () => {
    const app = createServer();

    expect(app).toBeDefined();
    expect(typeof app).toBe("object");
    expect(typeof app.tool).toBe("function");
    expect(typeof app.resource).toBe("function");
    expect(typeof app.prompt).toBe("function");
    expect(typeof app.fetch).toBe("function");
  });

  it("T methods return objects with type property", () => {
    expect(T.string().type).toBe("string");
    expect(T.number().type).toBe("number");
    expect(T.boolean().type).toBe("boolean");
    expect(T.array().type).toBe("array");
    expect(T.object().type).toBe("object");
  });

  it("conversation requires function argument", () => {
    expect(() => conversation()).toThrow();
    expect(() => conversation("not a function")).toThrow();
    expect(() => conversation(() => "not an array")).toThrow();
  });

  it("createProgress validates total parameter", () => {
    expect(() => createProgress("not a number")).toThrow();
    expect(() => createProgress(-1)).toThrow();
    expect(() => createProgress(0)).toThrow();
    expect(() => createProgress(10)).not.toThrow();
  });
});

describe("minimal working example", () => {
  it("runs a complete minimal MCP server", async () => {
    // This is the simplest possible working server
    const app = createServer();

    // Register a tool
    const echo = (_mctx, { message }) => message;
    echo.input = {
      message: T.string({ required: true }),
    };
    app.tool("echo", echo);

    // List tools
    const listRequest = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const listResponse = await app.fetch(listRequest);
    const listData = await listResponse.json();

    expect(listData.result.tools).toHaveLength(1);

    // Call tool
    const callRequest = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: { message: "Hello, MCP!" },
        },
      }),
    });

    const callResponse = await app.fetch(callRequest);
    const callData = await callResponse.json();

    expect(callData.result.content[0].text).toBe("Hello, MCP!");
  });
});

describe("version compatibility", () => {
  it("uses ES modules syntax", () => {
    // This test just verifies the module loaded successfully
    expect(typeof createServer).toBe("function");
  });

  it("does not require TypeScript compilation for basic usage", () => {
    // Verify we can use the package without .d.ts files
    const app = createServer();

    const tool = () => "result";
    tool.input = {};

    expect(() => app.tool("test", tool)).not.toThrow();
  });
});

describe("error handling smoke test", () => {
  it("handles invalid requests gracefully", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      body: "invalid json",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32700);
  });

  it("handles missing handlers gracefully", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "nonexistent",
          arguments: {},
        },
      }),
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("not found");
  });

  it("sanitizes errors in production mode", async () => {
    // Import sanitizeError from security.js (not exported from public API)
    const { sanitizeError } = await import("../src/security.js");
    const error = new Error("Failed with key AKIAIOSFODNN7EXAMPLE");

    const sanitized = sanitizeError(error, true);

    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
  });
});
