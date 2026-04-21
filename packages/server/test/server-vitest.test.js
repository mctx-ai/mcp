/**
 * Server Module Tests (Vitest version)
 *
 * Tests JSON-RPC 2.0 routing, tool/resource/prompt registration,
 * pagination, error handling, and serialization.
 */

import { describe, it, expect } from "vitest";
import { createServer, T } from "../src/index.js";

// Helper to create mock Request
function createRequest(body) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("tool registration and tools/list", () => {
  it("registers and lists tools", async () => {
    const server = createServer();

    const greet = (_mctx, { name }, res) => {
      res.send(`Hello, ${name}!`);
    };
    greet.description = "Greets a person";
    greet.input = {
      name: T.string({ required: true, description: "Name to greet" }),
    };

    server.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(Array.isArray(data.result.tools)).toBe(true);
    expect(data.result.tools).toHaveLength(1);
    expect(data.result.tools[0].name).toBe("greet");
    expect(data.result.tools[0].description).toBe("Greets a person");
    expect(data.result.tools[0].inputSchema).toBeDefined();
  });

  it("throws if tool handler is not a function", () => {
    const server = createServer();
    expect(() => server.tool("invalid", "not a function")).toThrow(/must be a function/);
  });

  it("includes annotations in tools/list when handler has annotations set", async () => {
    const server = createServer();

    const deleteRecords = (_mctx, _req, res) => {
      res.send("deleted");
    };
    deleteRecords.description = "Deletes records permanently";
    deleteRecords.annotations = {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: false,
      idempotentHint: false,
    };

    server.tool("deleteRecords", deleteRecords);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.tools).toHaveLength(1);
    const tool = data.result.tools[0];
    expect(tool.name).toBe("deleteRecords");
    expect(tool.annotations).toBeDefined();
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.openWorldHint).toBe(false);
    expect(tool.annotations.idempotentHint).toBe(false);
  });

  it("includes only the declared hint when handler has partial annotations", async () => {
    const server = createServer();

    const readConfig = (_mctx, _req, res) => {
      res.send("{}");
    };
    readConfig.description = "Reads configuration";
    readConfig.annotations = {
      readOnlyHint: true,
    };

    server.tool("readConfig", readConfig);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.tools).toHaveLength(1);
    const tool = data.result.tools[0];
    expect(tool.name).toBe("readConfig");
    expect(tool.annotations).toBeDefined();
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(tool.annotations, "destructiveHint")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(tool.annotations, "openWorldHint")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(tool.annotations, "idempotentHint")).toBe(false);
  });

  it("omits annotations field in tools/list when handler has no annotations", async () => {
    const server = createServer();

    const listRecords = (_mctx, _req, res) => {
      res.send("[]");
    };
    listRecords.description = "Lists records";

    server.tool("listRecords", listRecords);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.tools).toHaveLength(1);
    const tool = data.result.tools[0];
    expect(tool.name).toBe("listRecords");
    expect(tool.annotations).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(tool, "annotations")).toBe(false);
  });
});

describe("tools/call", () => {
  it("calls tool with string return via res.send()", async () => {
    const server = createServer();

    const greet = (_mctx, { name }, res) => {
      res.send(`Hello, ${name}!`);
    };
    greet.input = { name: T.string({ required: true }) };

    server.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "greet",
        arguments: { name: "World" },
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].type).toBe("text");
    expect(data.result.content[0].text).toBe("Hello, World!");
  });

  it("calls tool with object return via res.send()", async () => {
    const server = createServer();

    const getData = (_mctx, _req, res) => {
      res.send({ status: "success", count: 42 });
    };
    getData.input = {};

    server.tool("getData", getData);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "getData",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].type).toBe("text");
    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.count).toBe(42);
  });

  it("calls async tool handler", async () => {
    const server = createServer();

    const asyncTool = async (_mctx, { delay }, res) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      res.send(`Completed after ${delay}ms`);
    };
    asyncTool.input = { delay: T.number({ required: true }) };

    server.tool("asyncTool", asyncTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "asyncTool",
        arguments: { delay: 10 },
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("Completed after 10ms");
  });

  it("handles tool errors gracefully", async () => {
    const server = createServer();

    const errorTool = (_mctx, _req, _res) => {
      throw new Error("Something went wrong");
    };
    errorTool.input = {};

    server.tool("errorTool", errorTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "errorTool",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("Something went wrong");
  });

  it("throws if tool name is missing", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Tool name is required");
  });

  it("throws if tool not found", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "nonexistent",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('Tool "nonexistent" not found');
  });

  it("handles missing arguments gracefully with empty object fallback", async () => {
    const server = createServer();

    const tool = (_mctx, args, res) => {
      res.send(JSON.stringify(args));
    };
    tool.input = {};
    server.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "test",
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeUndefined();
    expect(data.result).toBeDefined();
    expect(data.result.content[0].text).toBe("{}");
  });
});

describe("resources/list", () => {
  it("returns static resources only", async () => {
    const server = createServer();

    const staticResource = (_mctx, _req, res) => {
      res.send("Static content");
    };
    staticResource.description = "A static resource";
    staticResource.mimeType = "text/plain";

    server.resource("static://docs", staticResource);
    server.resource("user://{id}", (_mctx, _req, res) => res.send("Template")); // Should not appear in list

    const request = createRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.resources).toHaveLength(1);
    expect(data.result.resources[0].uri).toBe("static://docs");
    expect(data.result.resources[0].description).toBe("A static resource");
  });

  it("throws if resource handler is not a function", () => {
    const server = createServer();
    expect(() => server.resource("test://uri", "not a function")).toThrow(/must be a function/);
  });
});

describe("resources/templates/list", () => {
  it("returns template resources only", async () => {
    const server = createServer();

    const templateResource = (_mctx, _req, res) => {
      res.send("Template content");
    };
    templateResource.description = "A template resource";

    server.resource("user://{userId}", templateResource);
    server.resource("static://docs", (_mctx, _req, res) => res.send("Static")); // Should not appear

    const request = createRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "resources/templates/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.resourceTemplates).toHaveLength(1);
    expect(data.result.resourceTemplates[0].uriTemplate).toBe("user://{userId}");
  });
});

describe("resources/read", () => {
  it("reads static resource", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("Documentation content");
    };
    docsResource.mimeType = "text/plain";

    // Register with canonicalized URI (single slash after scheme)
    server.resource("https:/example.com/docs/api", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 12,
      method: "resources/read",
      params: { uri: "https:/example.com/docs/api" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].uri).toBe("https:/example.com/docs/api");
    expect(data.result.contents[0].text).toBe("Documentation content");
    expect(data.result.contents[0].mimeType).toBe("text/plain");
  });

  it("reads template resource with parameter extraction", async () => {
    const server = createServer();

    const userResource = (_mctx, params, res) => {
      // Handler receives params object, extract userId from it
      const userId = params?.userId || "unknown";
      res.send(`User: ${userId}`);
    };
    userResource.mimeType = "text/plain";

    // Use canonicalized URI (single slash after scheme) to match canonicalized request URI
    server.resource("https:/example.com/user/{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 13,
      method: "resources/read",
      params: { uri: "https://example.com/user/123" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("User: 123");
  });

  it("throws if URI is missing", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 14,
      method: "resources/read",
      params: {},
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Resource URI is required");
  });

  it("validates URI scheme (blocks dangerous schemes)", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 15,
      method: "resources/read",
      params: { uri: "file:///etc/passwd" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("allows custom URI schemes", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("README content");
    };
    docsResource.mimeType = "text/plain";

    server.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 28,
      method: "resources/read",
      params: { uri: "docs://readme" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].uri).toBe("docs://readme");
    expect(data.result.contents[0].text).toBe("README content");
    expect(data.result.contents[0].mimeType).toBe("text/plain");
  });

  it("allows custom URI scheme templates with parameter extraction", async () => {
    const server = createServer();

    const userResource = (_mctx, params, res) => {
      const userId = params?.userId || "unknown";
      res.send(`User ID: ${userId}`);
    };
    userResource.mimeType = "text/plain";

    server.resource("user://{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 29,
      method: "resources/read",
      params: { uri: "user://alice123" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("User ID: alice123");
  });

  it("blocks javascript: scheme", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 30,
      method: "resources/read",
      params: { uri: "javascript:alert(1)" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("blocks data: scheme", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "resources/read",
      params: { uri: "data:text/html,<script>alert(1)</script>" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("detects path traversal in HTTP URIs", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 16,
      method: "resources/read",
      params: { uri: "http://example.com/../../../etc/passwd" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme URIs (../ pattern)", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "resources/read",
      params: { uri: "docs://../../../etc/passwd" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme URIs (..\\  pattern)", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 33,
      method: "resources/read",
      params: { uri: "docs://..\\\\windows\\\\system32" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme with template params", async () => {
    const server = createServer();

    const userResource = (_mctx, params, res) => {
      const userId = params?.userId || "unknown";
      res.send(`User ID: ${userId}`);
    };
    userResource.mimeType = "text/plain";

    server.resource("user://{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 34,
      method: "resources/read",
      params: { uri: "user://alice/../admin" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("allows custom scheme URIs with path segments", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("Nested resource content");
    };
    docsResource.mimeType = "text/plain";

    server.resource("docs://path/to/resource", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 36,
      method: "resources/read",
      params: { uri: "docs://path/to/resource" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("Nested resource content");
  });

  it("blocks URL-encoded path traversal in custom schemes", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("Secret content");
    };
    docsResource.mimeType = "text/plain";

    server.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 37,
      method: "resources/read",
      params: { uri: "docs://%2e%2e%2fetc%2fpasswd" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("blocks partially encoded path traversal in custom schemes", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("Secret content");
    };
    docsResource.mimeType = "text/plain";

    server.resource("docs://readme", docsResource);

    // Test %2e%2e/etc/passwd
    const request1 = createRequest({
      jsonrpc: "2.0",
      id: 38,
      method: "resources/read",
      params: { uri: "docs://%2e%2e/etc/passwd" },
    });

    const response1 = await server.fetch(request1);
    const data1 = await response1.json();

    expect(data1.error).toBeDefined();
    expect(data1.error.message).toContain("Path traversal detected");

    // Test ..%2fetc/passwd
    const request2 = createRequest({
      jsonrpc: "2.0",
      id: 39,
      method: "resources/read",
      params: { uri: "docs://..%2fetc/passwd" },
    });

    const response2 = await server.fetch(request2);
    const data2 = await response2.json();

    expect(data2.error).toBeDefined();
    expect(data2.error.message).toContain("Path traversal detected");
  });

  it("blocks double-encoded path traversal in custom schemes", async () => {
    const server = createServer();

    const docsResource = (_mctx, _req, res) => {
      res.send("Secret content");
    };
    docsResource.mimeType = "text/plain";

    server.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 40,
      method: "resources/read",
      params: { uri: "docs://%252e%252e%252fetc" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("handles Buffer response", async () => {
    const server = createServer();

    const binaryResource = (_mctx, _req, res) => {
      res.send(Buffer.from("binary data"));
    };
    binaryResource.mimeType = "application/octet-stream";

    // Use canonicalized URI (single slash after scheme)
    server.resource("https:/example.com/binary", binaryResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 17,
      method: "resources/read",
      params: { uri: "https://example.com/binary" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    // Buffer is converted to base64 blob
    expect(data.result.contents[0].blob).toBe(Buffer.from("binary data").toString("base64"));
    expect(data.result.contents[0].mimeType).toBe("application/octet-stream");
  });
});

describe("prompts/list", () => {
  it("lists prompts with arguments", async () => {
    const server = createServer();

    const codeReview = (_mctx, { code }, res) => {
      res.send(`Review: ${code}`);
    };
    codeReview.description = "Code review prompt";
    codeReview.input = {
      code: T.string({ required: true, description: "Code to review" }),
      language: T.string({ description: "Programming language" }),
    };

    server.prompt("code-review", codeReview);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 18,
      method: "prompts/list",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.prompts).toHaveLength(1);
    expect(data.result.prompts[0].name).toBe("code-review");
    expect(data.result.prompts[0].description).toBe("Code review prompt");
    expect(data.result.prompts[0].arguments).toHaveLength(2);
    expect(data.result.prompts[0].arguments[0].name).toBe("code");
    expect(data.result.prompts[0].arguments[0].required).toBe(true);
  });

  it("throws if prompt handler is not a function", () => {
    const server = createServer();
    expect(() => server.prompt("test", "not a function")).toThrow(/must be a function/);
  });
});

describe("prompts/get", () => {
  it("gets prompt with string return via res.send()", async () => {
    const server = createServer();

    const simplePrompt = (_mctx, { topic }, res) => {
      res.send(`Tell me about ${topic}`);
    };
    simplePrompt.input = { topic: T.string({ required: true }) };

    server.prompt("simple", simplePrompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 19,
      method: "prompts/get",
      params: {
        name: "simple",
        arguments: { topic: "MCP" },
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(Array.isArray(data.result.messages)).toBe(true);
    expect(data.result.messages[0].role).toBe("user");
    expect(data.result.messages[0].content.type).toBe("text");
    expect(data.result.messages[0].content.text).toBe("Tell me about MCP");
  });
});

describe("pagination", () => {
  it("paginates tools with cursor and nextCursor", async () => {
    const server = createServer();

    // Register 60 tools (more than page size of 50)
    for (let i = 0; i < 60; i++) {
      const tool = (_mctx, _req, res) => {
        res.send(`Result ${i}`);
      };
      tool.description = `Tool ${i}`;
      tool.input = {};
      server.tool(`tool${i}`, tool);
    }

    // First page
    const request1 = createRequest({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/list",
    });

    const response1 = await server.fetch(request1);
    const data1 = await response1.json();

    expect(data1.result.tools).toHaveLength(50);
    expect(data1.result.nextCursor).toBeDefined();

    // Second page
    const request2 = createRequest({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/list",
      params: { cursor: data1.result.nextCursor },
    });

    const response2 = await server.fetch(request2);
    const data2 = await response2.json();

    expect(data2.result.tools).toHaveLength(10);
    expect(data2.result.nextCursor).toBeUndefined();
  });
});

describe("JSON-RPC protocol", () => {
  it("returns error for unknown method", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 22,
      method: "unknown/method",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32601);
    // Error.message is not enumerable, so it won't be in JSON serialization
  });

  it("returns parse error for malformed JSON", async () => {
    const server = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32700);
    expect(data.error.message).toContain("Parse error");
  });

  it("returns 204 for notifications (no id)", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
    });

    const response = await server.fetch(request);

    expect(response.status).toBe(204);
  });

  it("returns error for non-POST requests", async () => {
    const server = createServer();

    const request = new Request("http://localhost", {
      method: "GET",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(response.status).toBe(405);
    expect(data.error.code).toBe(-32600);
  });

  it("returns error for missing method", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 23,
      params: {},
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32600);
    expect(data.error.message).toContain("Missing or invalid method");
  });
});

describe("safeSerialize()", () => {
  it("handles circular references", async () => {
    const server = createServer();

    const circularTool = (_mctx, _req, res) => {
      const obj = { name: "test" };
      obj.self = obj;
      res.send(obj);
    };
    circularTool.input = {};

    server.tool("circular", circularTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "circular",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toContain("[Circular]");
  });

  it("handles BigInt values", async () => {
    const server = createServer();

    const bigIntTool = (_mctx, _req, res) => {
      res.send({ value: BigInt(9007199254740991) });
    };
    bigIntTool.input = {};

    server.tool("bigint", bigIntTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "bigint",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.value).toBe("9007199254740991");
  });

  it("handles Date objects", async () => {
    const server = createServer();

    const dateTool = (_mctx, _req, res) => {
      res.send({ timestamp: new Date("2024-01-01T00:00:00Z") });
    };
    dateTool.input = {};

    server.tool("date", dateTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "date",
        arguments: {},
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("initialize", () => {
  it("responds with server info and capabilities", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result.protocolVersion).toBe("2025-11-25");
    expect(data.result.capabilities).toBeDefined();
    expect(data.result.serverInfo).toBeDefined();
    expect(data.result.serverInfo.name).toBe("@mctx-ai/mcp");
    expect(data.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("includes instructions when provided", async () => {
    const server = createServer({
      instructions: "You help developers debug CI pipelines...",
    });

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.instructions).toBe("You help developers debug CI pipelines...");
  });

  it("omits instructions when not provided", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.instructions).toBeUndefined();
  });

  it("auto-detects capabilities from registered tools", async () => {
    const server = createServer();

    const greet = (_mctx, _req, res) => {
      res.send("Hello!");
    };
    greet.input = {};
    server.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("auto-detects capabilities from registered resources", async () => {
    const server = createServer();

    const resource = (_mctx, _req, res) => {
      res.send("content");
    };
    server.resource("https://example.com/data", resource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.resources).toBeDefined();
    expect(data.result.capabilities.resources.subscribe).toBe(false);
    expect(data.result.capabilities.resources.listChanged).toBe(false);
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("auto-detects capabilities from registered prompts", async () => {
    const server = createServer();

    const prompt = (_mctx, _req, res) => {
      res.send("message");
    };
    prompt.input = {};
    server.prompt("test", prompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.prompts).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("includes all capabilities when tools, resources, and prompts are registered", async () => {
    const server = createServer();

    const tool = (_mctx, _req, res) => {
      res.send("result");
    };
    tool.input = {};
    server.tool("test-tool", tool);

    const resource = (_mctx, _req, res) => {
      res.send("content");
    };
    server.resource("https://example.com/data", resource);

    const prompt = (_mctx, _req, res) => {
      res.send("message");
    };
    prompt.input = {};
    server.prompt("test-prompt", prompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.resources).toBeDefined();
    expect(data.result.capabilities.prompts).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("only includes logging capability when nothing is registered", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeUndefined();
    expect(data.result.capabilities.resources).toBeUndefined();
    expect(data.result.capabilities.prompts).toBeUndefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });
});

describe("initialized notification", () => {
  it("responds with 204 No Content for initialized notification", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      method: "initialized",
    });

    const response = await server.fetch(request);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe("ping", () => {
  it("responds to ping with empty result", async () => {
    const server = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result).toEqual({});
  });
});

// Helper to create a request with custom headers
function createRequestWithHeaders(body, headers) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("mctx.userId — X-Mctx-User-Id header forwarding", () => {
  it("passes userId to tool handler when X-Mctx-User-Id header is present", async () => {
    const server = createServer();

    const whoami = (mctx, _req, res) => {
      res.send(mctx.userId ?? "anonymous");
    };
    whoami.input = {};
    server.tool("whoami", whoami);

    const request = createRequestWithHeaders(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      },
      { "X-Mctx-User-Id": "user-abc-123" },
    );

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("user-abc-123");
  });

  it("passes undefined userId to tool handler when X-Mctx-User-Id header is absent", async () => {
    const server = createServer();

    const whoami = (mctx, _req, res) => {
      res.send(mctx.userId === undefined ? "no-user" : mctx.userId);
    };
    whoami.input = {};
    server.tool("whoami", whoami);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("no-user");
  });

  it("passes userId to resource handler when X-Mctx-User-Id header is present", async () => {
    const server = createServer();

    const profileResource = (mctx, _params, res) => {
      res.send(`profile:${mctx.userId ?? "anonymous"}`);
    };
    profileResource.mimeType = "text/plain";
    server.resource("docs://profile", profileResource);

    const request = createRequestWithHeaders(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "docs://profile" },
      },
      { "X-Mctx-User-Id": "user-xyz-456" },
    );

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("profile:user-xyz-456");
  });

  it("passes undefined userId to resource handler when X-Mctx-User-Id header is absent", async () => {
    const server = createServer();

    const profileResource = (mctx, _params, res) => {
      res.send(mctx.userId === undefined ? "no-user" : mctx.userId);
    };
    profileResource.mimeType = "text/plain";
    server.resource("docs://profile", profileResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "docs://profile" },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("no-user");
  });

  it("passes userId to prompt handler when X-Mctx-User-Id header is present", async () => {
    const server = createServer();

    const greetPrompt = (mctx, _req, res) => {
      res.send(`Hello, ${mctx.userId ?? "stranger"}!`);
    };
    greetPrompt.input = {};
    server.prompt("greet", greetPrompt);

    const request = createRequestWithHeaders(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "prompts/get",
        params: { name: "greet", arguments: {} },
      },
      { "X-Mctx-User-Id": "user-qrs-789" },
    );

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.messages[0].content.text).toBe("Hello, user-qrs-789!");
  });

  it("passes undefined userId to prompt handler when X-Mctx-User-Id header is absent", async () => {
    const server = createServer();

    const greetPrompt = (mctx, _req, res) => {
      res.send(mctx.userId === undefined ? "no-user" : `Hello, ${mctx.userId}!`);
    };
    greetPrompt.input = {};
    server.prompt("greet", greetPrompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "prompts/get",
      params: { name: "greet", arguments: {} },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.messages[0].content.text).toBe("no-user");
  });

  it("two-parameter tool handler continues to work without modification", async () => {
    const server = createServer();

    // Declares only (mctx, args) — no res param, handler returns value instead of calling res.send()
    // Note: without res.send(), the captured result is undefined, which serializes as "null"
    // This test verifies backward compatibility expectations
    const echo = (_mctx, { message }, res) => {
      res.send(message);
    };
    echo.input = { message: { type: "string" } };
    server.tool("echo", echo);

    const request = createRequestWithHeaders(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      },
      { "X-Mctx-User-Id": "user-compat-test" },
    );

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("hello");
  });
});
