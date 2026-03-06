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

describe("createServer()", () => {
  it("returns app with registration methods", () => {
    const app = createServer();

    expect(typeof app.tool).toBe("function");
    expect(typeof app.resource).toBe("function");
    expect(typeof app.prompt).toBe("function");
    expect(typeof app.fetch).toBe("function");
  });
});

describe("tool registration and tools/list", () => {
  it("registers and lists tools", async () => {
    const app = createServer();

    const greet = ({ name }) => `Hello, ${name}!`;
    greet.description = "Greets a person";
    greet.input = {
      name: T.string({ required: true, description: "Name to greet" }),
    };

    app.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const response = await app.fetch(request);
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
    const app = createServer();
    expect(() => app.tool("invalid", "not a function")).toThrow(/must be a function/);
  });
});

describe("tools/call", () => {
  it("calls tool with string return", async () => {
    const app = createServer();

    const greet = ({ name }) => `Hello, ${name}!`;
    greet.input = { name: T.string({ required: true }) };

    app.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "greet",
        arguments: { name: "World" },
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].type).toBe("text");
    expect(data.result.content[0].text).toBe("Hello, World!");
  });

  it("calls tool with object return", async () => {
    const app = createServer();

    const getData = () => ({ status: "success", count: 42 });
    getData.input = {};

    app.tool("getData", getData);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "getData",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].type).toBe("text");
    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.count).toBe(42);
  });

  it("calls async tool handler", async () => {
    const app = createServer();

    const asyncTool = async ({ delay }) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `Completed after ${delay}ms`;
    };
    asyncTool.input = { delay: T.number({ required: true }) };

    app.tool("asyncTool", asyncTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "asyncTool",
        arguments: { delay: 10 },
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("Completed after 10ms");
  });

  it("handles tool errors gracefully", async () => {
    const app = createServer();

    const errorTool = () => {
      throw new Error("Something went wrong");
    };
    errorTool.input = {};

    app.tool("errorTool", errorTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "errorTool",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("Something went wrong");
  });

  it("throws if tool name is missing", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Tool name is required");
  });

  it("throws if tool not found", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "nonexistent",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('Tool "nonexistent" not found');
  });

  it("throws if arguments are missing", async () => {
    const app = createServer();

    const tool = () => "result";
    tool.input = {};
    app.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "test",
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Tool arguments are required");
  });

  it("sanitizes input arguments (prototype pollution)", async () => {
    const app = createServer();

    const tool = (args) => {
      // Check if __proto__ is an own property (should be false after sanitization)
      return { hasProto: Object.hasOwnProperty.call(args, "__proto__") };
    };
    tool.input = {};
    app.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "test",
        arguments: {
          __proto__: { isAdmin: true },
          data: "test",
        },
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.hasProto).toBe(false);
  });
});

describe("resources/list", () => {
  it("returns static resources only", async () => {
    const app = createServer();

    const staticResource = () => "Static content";
    staticResource.description = "A static resource";
    staticResource.mimeType = "text/plain";

    app.resource("static://docs", staticResource);
    app.resource("user://{id}", () => "Template"); // Should not appear in list

    const request = createRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/list",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.resources).toHaveLength(1);
    expect(data.result.resources[0].uri).toBe("static://docs");
    expect(data.result.resources[0].description).toBe("A static resource");
  });

  it("throws if resource handler is not a function", () => {
    const app = createServer();
    expect(() => app.resource("test://uri", "not a function")).toThrow(/must be a function/);
  });
});

describe("resources/templates/list", () => {
  it("returns template resources only", async () => {
    const app = createServer();

    const templateResource = () => "Template content";
    templateResource.description = "A template resource";

    app.resource("user://{userId}", templateResource);
    app.resource("static://docs", () => "Static"); // Should not appear

    const request = createRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "resources/templates/list",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.resourceTemplates).toHaveLength(1);
    expect(data.result.resourceTemplates[0].uriTemplate).toBe("user://{userId}");
  });
});

describe("resources/read", () => {
  it("reads static resource", async () => {
    const app = createServer();

    const docsResource = () => "Documentation content";
    docsResource.mimeType = "text/plain";

    // Register with canonicalized URI (single slash after scheme)
    app.resource("https:/example.com/docs/api", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 12,
      method: "resources/read",
      params: { uri: "https:/example.com/docs/api" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].uri).toBe("https:/example.com/docs/api");
    expect(data.result.contents[0].text).toBe("Documentation content");
    expect(data.result.contents[0].mimeType).toBe("text/plain");
  });

  it("reads template resource with parameter extraction", async () => {
    const app = createServer();

    const userResource = (params) => {
      // Handler receives params object, extract userId from it
      const userId = params?.userId || "unknown";
      return `User: ${userId}`;
    };
    userResource.mimeType = "text/plain";

    // Use canonicalized URI (single slash after scheme) to match canonicalized request URI
    app.resource("https:/example.com/user/{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 13,
      method: "resources/read",
      params: { uri: "https://example.com/user/123" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("User: 123");
  });

  it("throws if URI is missing", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 14,
      method: "resources/read",
      params: {},
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Resource URI is required");
  });

  it("validates URI scheme (blocks dangerous schemes)", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 15,
      method: "resources/read",
      params: { uri: "file:///etc/passwd" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("allows custom URI schemes", async () => {
    const app = createServer();

    const docsResource = () => "README content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 28,
      method: "resources/read",
      params: { uri: "docs://readme" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].uri).toBe("docs://readme");
    expect(data.result.contents[0].text).toBe("README content");
    expect(data.result.contents[0].mimeType).toBe("text/plain");
  });

  it("allows custom URI scheme templates with parameter extraction", async () => {
    const app = createServer();

    const userResource = (params) => {
      const userId = params?.userId || "unknown";
      return `User ID: ${userId}`;
    };
    userResource.mimeType = "text/plain";

    app.resource("user://{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 29,
      method: "resources/read",
      params: { uri: "user://alice123" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("User ID: alice123");
  });

  it("blocks javascript: scheme", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 30,
      method: "resources/read",
      params: { uri: "javascript:alert(1)" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("blocks data: scheme", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "resources/read",
      params: { uri: "data:text/html,<script>alert(1)</script>" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("detects path traversal in HTTP URIs", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 16,
      method: "resources/read",
      params: { uri: "http://example.com/../../../etc/passwd" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme URIs (../ pattern)", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "resources/read",
      params: { uri: "docs://../../../etc/passwd" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme URIs (..\\  pattern)", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 33,
      method: "resources/read",
      params: { uri: "docs://..\\\\windows\\\\system32" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("detects path traversal in custom scheme with template params", async () => {
    const app = createServer();

    const userResource = (params) => {
      const userId = params?.userId || "unknown";
      return `User ID: ${userId}`;
    };
    userResource.mimeType = "text/plain";

    app.resource("user://{userId}", userResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 34,
      method: "resources/read",
      params: { uri: "user://alice/../admin" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("allows legitimate custom scheme URIs without traversal", async () => {
    const app = createServer();

    const docsResource = () => "README content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 35,
      method: "resources/read",
      params: { uri: "docs://readme" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("README content");
  });

  it("allows custom scheme URIs with path segments", async () => {
    const app = createServer();

    const docsResource = () => "Nested resource content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://path/to/resource", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 36,
      method: "resources/read",
      params: { uri: "docs://path/to/resource" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.contents[0].text).toBe("Nested resource content");
  });

  it("blocks URL-encoded path traversal in custom schemes", async () => {
    const app = createServer();

    const docsResource = () => "Secret content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 37,
      method: "resources/read",
      params: { uri: "docs://%2e%2e%2fetc%2fpasswd" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("blocks partially encoded path traversal in custom schemes", async () => {
    const app = createServer();

    const docsResource = () => "Secret content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://readme", docsResource);

    // Test %2e%2e/etc/passwd
    const request1 = createRequest({
      jsonrpc: "2.0",
      id: 38,
      method: "resources/read",
      params: { uri: "docs://%2e%2e/etc/passwd" },
    });

    const response1 = await app.fetch(request1);
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

    const response2 = await app.fetch(request2);
    const data2 = await response2.json();

    expect(data2.error).toBeDefined();
    expect(data2.error.message).toContain("Path traversal detected");
  });

  it("blocks double-encoded path traversal in custom schemes", async () => {
    const app = createServer();

    const docsResource = () => "Secret content";
    docsResource.mimeType = "text/plain";

    app.resource("docs://readme", docsResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 40,
      method: "resources/read",
      params: { uri: "docs://%252e%252e%252fetc" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("handles Buffer response", async () => {
    const app = createServer();

    const binaryResource = () => Buffer.from("binary data");
    binaryResource.mimeType = "application/octet-stream";

    // Use canonicalized URI (single slash after scheme)
    app.resource("https:/example.com/binary", binaryResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 17,
      method: "resources/read",
      params: { uri: "https://example.com/binary" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    // Buffer is converted to base64 blob
    expect(data.result.contents[0].blob).toBe(Buffer.from("binary data").toString("base64"));
    expect(data.result.contents[0].mimeType).toBe("application/octet-stream");
  });
});

describe("prompts/list", () => {
  it("lists prompts with arguments", async () => {
    const app = createServer();

    const codeReview = ({ code }) => `Review: ${code}`;
    codeReview.description = "Code review prompt";
    codeReview.input = {
      code: T.string({ required: true, description: "Code to review" }),
      language: T.string({ description: "Programming language" }),
    };

    app.prompt("code-review", codeReview);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 18,
      method: "prompts/list",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.prompts).toHaveLength(1);
    expect(data.result.prompts[0].name).toBe("code-review");
    expect(data.result.prompts[0].description).toBe("Code review prompt");
    expect(data.result.prompts[0].arguments).toHaveLength(2);
    expect(data.result.prompts[0].arguments[0].name).toBe("code");
    expect(data.result.prompts[0].arguments[0].required).toBe(true);
  });

  it("throws if prompt handler is not a function", () => {
    const app = createServer();
    expect(() => app.prompt("test", "not a function")).toThrow(/must be a function/);
  });
});

describe("prompts/get", () => {
  it("gets prompt with string return", async () => {
    const app = createServer();

    const simplePrompt = ({ topic }) => `Tell me about ${topic}`;
    simplePrompt.input = { topic: T.string({ required: true }) };

    app.prompt("simple", simplePrompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 19,
      method: "prompts/get",
      params: {
        name: "simple",
        arguments: { topic: "MCP" },
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(Array.isArray(data.result.messages)).toBe(true);
    expect(data.result.messages[0].role).toBe("user");
    expect(data.result.messages[0].content.type).toBe("text");
    expect(data.result.messages[0].content.text).toBe("Tell me about MCP");
  });
});

describe("pagination", () => {
  it("paginates tools with cursor and nextCursor", async () => {
    const app = createServer();

    // Register 60 tools (more than page size of 50)
    for (let i = 0; i < 60; i++) {
      const tool = () => `Result ${i}`;
      tool.description = `Tool ${i}`;
      tool.input = {};
      app.tool(`tool${i}`, tool);
    }

    // First page
    const request1 = createRequest({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/list",
    });

    const response1 = await app.fetch(request1);
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

    const response2 = await app.fetch(request2);
    const data2 = await response2.json();

    expect(data2.result.tools).toHaveLength(10);
    expect(data2.result.nextCursor).toBeUndefined();
  });
});

describe("JSON-RPC protocol", () => {
  it("returns error for unknown method", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 22,
      method: "unknown/method",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32601);
    // Error.message is not enumerable, so it won't be in JSON serialization
  });

  it("returns parse error for malformed JSON", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32700);
    expect(data.error.message).toContain("Parse error");
  });

  it("returns 204 for notifications (no id)", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
    });

    const response = await app.fetch(request);

    expect(response.status).toBe(204);
  });

  it("returns error for non-POST requests", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "GET",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(response.status).toBe(405);
    expect(data.error.code).toBe(-32600);
  });

  it("returns error for missing method", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 23,
      params: {},
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error.code).toBe(-32600);
    expect(data.error.message).toContain("Missing or invalid method");
  });
});

describe("safeSerialize()", () => {
  it("handles circular references", async () => {
    const app = createServer();

    const circularTool = () => {
      const obj = { name: "test" };
      obj.self = obj;
      return obj;
    };
    circularTool.input = {};

    app.tool("circular", circularTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "circular",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toContain("[Circular]");
  });

  it("handles BigInt values", async () => {
    const app = createServer();

    const bigIntTool = () => ({ value: BigInt(9007199254740991) });
    bigIntTool.input = {};

    app.tool("bigint", bigIntTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "bigint",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.value).toBe("9007199254740991");
  });

  it("handles Date objects", async () => {
    const app = createServer();

    const dateTool = () => ({ timestamp: new Date("2024-01-01T00:00:00Z") });
    dateTool.input = {};

    app.tool("date", dateTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "date",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("error sanitization", () => {
  it("redacts AWS keys from errors", async () => {
    const app = createServer();

    const errorTool = () => {
      throw new Error("Failed with key AKIAIOSFODNN7EXAMPLE");
    };
    errorTool.input = {};

    app.tool("error", errorTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "error",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toContain("[REDACTED_AWS_KEY]");
    expect(data.result.content[0].text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("initialize", () => {
  it("responds with server info and capabilities", async () => {
    const app = createServer();

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

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result.protocolVersion).toBe("2025-11-25");
    expect(data.result.capabilities).toBeDefined();
    expect(data.result.serverInfo).toBeDefined();
    expect(data.result.serverInfo.name).toBe("@mctx-ai/mcp-server");
    expect(data.result.serverInfo.version).toBe("0.3.0");
  });

  it("includes instructions when provided", async () => {
    const app = createServer({
      instructions: "You help developers debug CI pipelines...",
    });

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.instructions).toBe("You help developers debug CI pipelines...");
  });

  it("omits instructions when not provided", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.instructions).toBeUndefined();
  });

  it("auto-detects capabilities from registered tools", async () => {
    const app = createServer();

    const greet = () => "Hello!";
    greet.input = {};
    app.tool("greet", greet);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("auto-detects capabilities from registered resources", async () => {
    const app = createServer();

    const resource = () => "content";
    app.resource("https://example.com/data", resource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.resources).toBeDefined();
    expect(data.result.capabilities.resources.subscribe).toBe(false);
    expect(data.result.capabilities.resources.listChanged).toBe(false);
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("auto-detects capabilities from registered prompts", async () => {
    const app = createServer();

    const prompt = () => "message";
    prompt.input = {};
    app.prompt("test", prompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.prompts).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("includes all capabilities when tools, resources, and prompts are registered", async () => {
    const app = createServer();

    const tool = () => "result";
    tool.input = {};
    app.tool("test-tool", tool);

    const resource = () => "content";
    app.resource("https://example.com/data", resource);

    const prompt = () => "message";
    prompt.input = {};
    app.prompt("test-prompt", prompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.resources).toBeDefined();
    expect(data.result.capabilities.prompts).toBeDefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });

  it("only includes logging capability when nothing is registered", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.capabilities.tools).toBeUndefined();
    expect(data.result.capabilities.resources).toBeUndefined();
    expect(data.result.capabilities.prompts).toBeUndefined();
    expect(data.result.capabilities.logging).toBeDefined();
  });
});

describe("initialized notification", () => {
  it("responds with 204 No Content for initialized notification", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      method: "initialized",
    });

    const response = await app.fetch(request);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe("ping", () => {
  it("responds to ping with empty result", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result).toEqual({});
  });
});
