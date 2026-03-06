/**
 * Integration Tests
 *
 * End-to-end tests exercising full server with tools, resources, and prompts.
 */

import { describe, it, expect } from "vitest";
import { createServer, T, conversation } from "../src/index.js";

// Helper to create mock Request
function createRequest(body) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("full server integration", () => {
  it("handles initialize with auto-detected capabilities", async () => {
    const app = createServer({
      instructions: "A comprehensive test server for calculator operations",
    });

    // Register tool
    const calculate = ({ operation, a, b }) => {
      switch (operation) {
        case "add":
          return a + b;
        default:
          return 0;
      }
    };
    calculate.input = {
      operation: T.string({ required: true }),
      a: T.number({ required: true }),
      b: T.number({ required: true }),
    };
    app.tool("calculate", calculate);

    // Register resource
    const docs = () => "Calculator documentation";
    app.resource("https://example.com/docs", docs);

    // Register prompt
    const help = () => "How to use the calculator";
    help.input = {};
    app.prompt("help", help);

    // Test initialize
    const initRequest = createRequest({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    });

    const initResponse = await app.fetch(initRequest);
    const initData = await initResponse.json();

    expect(initData.result.protocolVersion).toBe("2025-11-25");
    expect(initData.result.capabilities.tools).toBeDefined();
    expect(initData.result.capabilities.resources).toBeDefined();
    expect(initData.result.capabilities.prompts).toBeDefined();
    expect(initData.result.capabilities.logging).toBeDefined();
    expect(initData.result.serverInfo.name).toBe("@mctx-ai/mcp-server");
    expect(initData.result.instructions).toBe(
      "A comprehensive test server for calculator operations",
    );
  });

  it("creates server with tools, resources, and prompts", async () => {
    const app = createServer();

    // Register tool
    const calculate = ({ operation, a, b }) => {
      switch (operation) {
        case "add":
          return a + b;
        case "subtract":
          return a - b;
        case "multiply":
          return a * b;
        case "divide":
          return a / b;
        default:
          throw new Error("Unknown operation");
      }
    };
    calculate.description = "Performs arithmetic operations";
    calculate.input = {
      operation: T.string({
        required: true,
        enum: ["add", "subtract", "multiply", "divide"],
      }),
      a: T.number({ required: true, description: "First operand" }),
      b: T.number({ required: true, description: "Second operand" }),
    };
    app.tool("calculate", calculate);

    // Register static resource (with canonicalized URI - single slash after scheme)
    const docsResource = () => "API Documentation for Calculator";
    docsResource.description = "Calculator API documentation";
    docsResource.mimeType = "text/plain";
    app.resource("https:/example.com/docs/calculator", docsResource);

    // Register template resource (with canonicalized URI - single slash after scheme)
    const historyResource = ({ operationId }) => {
      return JSON.stringify({
        id: operationId,
        operation: "add",
        result: 42,
        timestamp: "2024-01-01T00:00:00Z",
      });
    };
    historyResource.description = "Operation history";
    historyResource.mimeType = "application/json";
    app.resource("https:/example.com/history/{operationId}", historyResource);

    // Register prompt
    const mathPrompt = ({ problem }) => {
      return conversation(({ user, ai }) => [
        user.say(`Solve this math problem: ${problem}`),
        ai.say("I can help with that. What operation do you need?"),
        user.say("Use the calculate tool"),
      ]);
    };
    mathPrompt.description = "Math problem solving prompt";
    mathPrompt.input = {
      problem: T.string({
        required: true,
        description: "Math problem to solve",
      }),
    };
    app.prompt("math-helper", mathPrompt);

    // Test tools/list
    const toolsListReq = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const toolsListRes = await app.fetch(toolsListReq);
    const toolsList = await toolsListRes.json();

    expect(toolsList.result.tools).toHaveLength(1);
    expect(toolsList.result.tools[0].name).toBe("calculate");

    // Test tools/call
    const toolCallReq = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "calculate",
        arguments: { operation: "add", a: 5, b: 3 },
      },
    });
    const toolCallRes = await app.fetch(toolCallReq);
    const toolCall = await toolCallRes.json();

    expect(toolCall.result.content[0].text).toBe("8");

    // Test resources/list
    const resourcesListReq = createRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list",
    });
    const resourcesListRes = await app.fetch(resourcesListReq);
    const resourcesList = await resourcesListRes.json();

    expect(resourcesList.result.resources).toHaveLength(1);
    expect(resourcesList.result.resources[0].uri).toBe("https:/example.com/docs/calculator");

    // Test resources/templates/list
    const templatesListReq = createRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/templates/list",
    });
    const templatesListRes = await app.fetch(templatesListReq);
    const templatesList = await templatesListRes.json();

    expect(templatesList.result.resourceTemplates).toHaveLength(1);
    expect(templatesList.result.resourceTemplates[0].uriTemplate).toBe(
      "https:/example.com/history/{operationId}",
    );

    // Test resources/read (static) - use registered URI
    const resourceReadReq = createRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "https:/example.com/docs/calculator" },
    });
    const resourceReadRes = await app.fetch(resourceReadReq);
    const resourceRead = await resourceReadRes.json();

    expect(resourceRead.result.contents[0].text).toContain("Calculator");

    // Test resources/read (template) - use URI matching the template pattern
    const templateReadReq = createRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "https:/example.com/history/123" },
    });
    const templateReadRes = await app.fetch(templateReadReq);
    const templateRead = await templateReadRes.json();

    const historyData = JSON.parse(templateRead.result.contents[0].text);
    expect(historyData.id).toBe("123");

    // Test prompts/list
    const promptsListReq = createRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "prompts/list",
    });
    const promptsListRes = await app.fetch(promptsListReq);
    const promptsList = await promptsListRes.json();

    expect(promptsList.result.prompts).toHaveLength(1);
    expect(promptsList.result.prompts[0].name).toBe("math-helper");

    // Test prompts/get
    const promptGetReq = createRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "prompts/get",
      params: {
        name: "math-helper",
        arguments: { problem: "5 + 3" },
      },
    });
    const promptGetRes = await app.fetch(promptGetReq);
    const promptGet = await promptGetRes.json();

    expect(promptGet.result.messages).toHaveLength(3);
    expect(promptGet.result.messages[0].content.text).toContain("5 + 3");
  });
});

describe("error handling end-to-end", () => {
  it("handles tool errors with sanitization", async () => {
    const app = createServer();

    const failingTool = () => {
      throw new Error("Database connection failed with AKIAIOSFODNN7EXAMPLE");
    };
    failingTool.input = {};
    app.tool("failing", failingTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "failing",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("[REDACTED_AWS_KEY]");
    expect(data.result.content[0].text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("handles resource errors with sanitization", async () => {
    const app = createServer();

    const failingResource = () => {
      throw new Error("Failed to fetch from postgres://user:password@localhost/db");
    };
    // Register with canonicalized URI (single slash after scheme)
    app.resource("https:/example.com/data", failingResource);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "https:/example.com/data" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    // Error message is wrapped by server with "Failed to read resource" prefix
    expect(data.error.message).toContain("Failed to read resource");
    expect(data.error.message).toContain("[REDACTED_CONNECTION_STRING]");
    expect(data.error.message).not.toContain("user:password");
  });

  it("handles prompt errors with sanitization", async () => {
    const app = createServer();

    const failingPrompt = () => {
      throw new Error("Template error with token Bearer sk_live_123456");
    };
    failingPrompt.input = {};
    app.prompt("failing", failingPrompt);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: {
        name: "failing",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Bearer [REDACTED]");
    expect(data.error.message).not.toContain("sk_live_123456");
  });
});

describe("JSON-RPC protocol compliance", () => {
  it("returns correct JSON-RPC 2.0 response format", async () => {
    const app = createServer();

    const tool = () => "success";
    tool.input = {};
    app.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "test",
        arguments: {},
      },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result).toBeDefined();
    expect(data.error).toBeUndefined();
  });

  it("returns correct error response format", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "nonexistent/method",
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601);
    // Error.message is not enumerable, so it won't be in JSON
    expect(data.result).toBeUndefined();
  });

  it("handles notifications correctly (no id)", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
    });

    const response = await app.fetch(request);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe("security integration", () => {
  it("validates request size", async () => {
    const app = createServer();

    const largePayload = "x".repeat(2000000); // 2MB
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { data: largePayload },
      }),
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    // validateRequestSize throws before JSON parsing, so it's a Parse error (-32700)
    expect(data.error.code).toBe(-32700);
    expect(data.error.message).toContain("Parse error");
  });

  it("prevents prototype pollution in tool arguments", async () => {
    const app = createServer();

    const tool = (args) => {
      // Check if __proto__ key is present in sanitized args
      return { hasPollution: Object.hasOwnProperty.call(args, "__proto__") };
    };
    tool.input = {};
    app.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
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

    const result = JSON.parse(data.result.content[0].text);
    expect(result.hasPollution).toBe(false);
  });

  it("validates URI schemes in resources", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "javascript:alert(1)" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Disallowed URI scheme");
  });

  it("prevents path traversal in resources", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "http://example.com/../../../etc/passwd" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });

  it("includes HTTP security headers in all responses", async () => {
    const app = createServer();

    const tool = () => "success";
    tool.input = {};
    app.tool("test", tool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "test",
        arguments: {},
      },
    });

    const response = await app.fetch(request);

    // Verify all security headers are present
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("includes security headers in error responses", async () => {
    const app = createServer();

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "nonexistent/method",
    });

    const response = await app.fetch(request);

    // Verify security headers in error responses
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("includes security headers in parse error responses", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    const response = await app.fetch(request);

    // Verify security headers in parse error responses
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("includes security headers in method not allowed responses", async () => {
    const app = createServer();

    const request = new Request("http://localhost", {
      method: "GET",
    });

    const response = await app.fetch(request);

    // Verify security headers in 405 responses
    expect(response.status).toBe(405);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("method chaining", () => {
  it("allows chaining tool registrations", () => {
    const app = createServer();

    const tool1 = () => "result1";
    tool1.input = {};

    const tool2 = () => "result2";
    tool2.input = {};

    const result = app.tool("tool1", tool1).tool("tool2", tool2);

    expect(result).toBe(app);
  });

  it("allows chaining resource registrations", () => {
    const app = createServer();

    const resource1 = () => "content1";
    const resource2 = () => "content2";

    const result = app
      .resource("https://example.com/1", resource1)
      .resource("https://example.com/2", resource2);

    expect(result).toBe(app);
  });

  it("allows chaining prompt registrations", () => {
    const app = createServer();

    const prompt1 = () => "prompt1";
    prompt1.input = {};

    const prompt2 = () => "prompt2";
    prompt2.input = {};

    const result = app.prompt("prompt1", prompt1).prompt("prompt2", prompt2);

    expect(result).toBe(app);
  });

  it("allows mixed chaining", () => {
    const app = createServer();

    const tool = () => "result";
    tool.input = {};

    const resource = () => "content";
    const prompt = () => "message";
    prompt.input = {};

    const result = app
      .tool("tool", tool)
      .resource("https://example.com", resource)
      .prompt("prompt", prompt);

    expect(result).toBe(app);
  });
});
