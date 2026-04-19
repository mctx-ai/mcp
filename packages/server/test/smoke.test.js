/**
 * Smoke Tests
 *
 * Pre-publish smoke tests to verify package entry point and basic functionality.
 */

import { describe, it, expect } from "vitest";
import { createServer, T, conversation, log } from "../src/index.js";

describe("basic functionality smoke test", () => {
  it("creates a server and responds to tools/list", async () => {
    const server = createServer();

    const greet = (_mctx, { name }, res) => {
      res.send(`Hello, ${name}!`);
    };
    greet.description = "Greets a person";
    greet.input = {
      name: T.string({ required: true }),
    };

    server.tool("greet", greet);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const response = await server.fetch(request);
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

  it("log produces notification objects", () => {
    // log methods return notification objects
    const notification = log.info("Test message");

    expect(notification).toBeDefined();
    expect(notification.type).toBe("log");
    expect(notification.level).toBe("info");
    expect(notification.data).toBe("Test message");
  });
});

describe("type safety", () => {
  it("createServer returns object with expected methods", () => {
    const server = createServer();

    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
    expect(typeof server.tool).toBe("function");
    expect(typeof server.resource).toBe("function");
    expect(typeof server.prompt).toBe("function");
    expect(typeof server.fetch).toBe("function");
  });

  it("T methods return objects with type property", () => {
    expect(T.string().type).toBe("string");
    expect(T.number().type).toBe("number");
    expect(T.boolean().type).toBe("boolean");
    expect(T.array().type).toBe("array");
    expect(T.object().type).toBe("object");
  });
});

describe("minimal working example", () => {
  it("runs a complete minimal MCP server", async () => {
    // This is the simplest possible working server
    const server = createServer();

    // Register a tool
    const echo = (_mctx, { message }, res) => {
      res.send(message);
    };
    echo.input = {
      message: T.string({ required: true }),
    };
    server.tool("echo", echo);

    // List tools
    const listRequest = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const listResponse = await server.fetch(listRequest);
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

    const callResponse = await server.fetch(callRequest);
    const callData = await callResponse.json();

    expect(callData.result.content[0].text).toBe("Hello, MCP!");
  });
});

describe("error handling smoke test", () => {
  it("handles invalid requests gracefully", async () => {
    const server = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      body: "invalid json",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32700);
  });

  it("handles missing handlers gracefully", async () => {
    const server = createServer();

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

    const response = await server.fetch(request);
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
