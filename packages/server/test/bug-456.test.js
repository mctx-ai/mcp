/**
 * Test for resource template matching with various userId values
 *
 * This test ensures that dynamic resource templates work correctly
 * regardless of the specific userId value used in the request.
 */

import { describe, it, expect } from "vitest";
import { createServer } from "../src/index.js";

// Helper to create mock Request
function createRequest(body) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("dynamic resource template matching", () => {
  it("should handle multiple numeric userId values consistently", async () => {
    const app = createServer();

    const userResource = (_mctx, params, res) => {
      const userId = params?.userId || "unknown";
      res.send(`User ID: ${userId}`);
    };
    userResource.mimeType = "text/plain";

    app.resource("user://{userId}", userResource);

    // Test various numeric values
    const testCases = [
      { uri: "user://123", expected: "User ID: 123" },
      { uri: "user://456", expected: "User ID: 456" },
      { uri: "user://789", expected: "User ID: 789" },
      { uri: "user://001", expected: "User ID: 001" },
    ];

    for (const { uri, expected } of testCases) {
      const request = createRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri },
      });

      const response = await app.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.result.contents[0].text).toBe(expected);
    }
  });

  it("should handle alphanumeric userId values", async () => {
    const app = createServer();

    const userResource = (_mctx, params, res) => {
      const userId = params?.userId || "unknown";
      res.send(`User: ${userId}`);
    };
    userResource.mimeType = "text/plain";

    app.resource("user://{userId}", userResource);

    const testCases = [
      { uri: "user://alice", expected: "User: alice" },
      { uri: "user://bob123", expected: "User: bob123" },
      { uri: "user://user_456", expected: "User: user_456" },
    ];

    for (const { uri, expected } of testCases) {
      const request = createRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri },
      });

      const response = await app.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.result.contents[0].text).toBe(expected);
    }
  });

  it("should still block path traversal in request URIs", async () => {
    const app = createServer();

    const userResource = (_mctx, params, res) => {
      res.send(`User: ${params?.userId || "unknown"}`);
    };
    userResource.mimeType = "text/plain";

    app.resource("user://{userId}", userResource);

    // Path traversal should still be blocked in user requests
    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "user://../admin" },
    });

    const response = await app.fetch(request);
    const data = await response.json();

    expect(data.error).toBeDefined();
    expect(data.error.message).toContain("Path traversal detected");
  });
});
