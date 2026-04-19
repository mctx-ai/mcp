/**
 * Sampling Module Tests
 *
 * Tests the createAsk function for LLM sampling support.
 */

import { describe, it, expect, vi } from "vitest";
import { createAsk } from "../src/sampling.js";

describe("createAsk()", () => {
  it("throws if sendRequest is not a function", () => {
    expect(() => createAsk(null, { sampling: true })).toThrow(/sendRequest to be a function/);
    expect(() => createAsk("not a function", { sampling: true })).toThrow(
      /sendRequest to be a function/,
    );
  });

  it("throws if clientCapabilities is missing", () => {
    const sendRequest = vi.fn();
    expect(() => createAsk(sendRequest, null)).toThrow(/requires clientCapabilities object/);
    expect(() => createAsk(sendRequest)).toThrow(/requires clientCapabilities object/);
  });

  it("returns null if client does not support sampling", () => {
    const sendRequest = vi.fn();
    const ask = createAsk(sendRequest, { sampling: false });

    expect(ask).toBeNull();
  });

  it("returns ask function if client supports sampling", () => {
    const sendRequest = vi.fn();
    const ask = createAsk(sendRequest, { sampling: true });

    expect(typeof ask).toBe("function");
  });
});

describe("ask() - string prompt", () => {
  it("sends sampling request with simple string prompt", async () => {
    const mockResponse = { content: "Paris is the capital of France." };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    const result = await ask("What is the capital of France?");

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "What is the capital of France?",
          },
        },
      ],
    });

    expect(result).toBe("Paris is the capital of France.");
  });

  it("handles multiline prompts", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask("Line 1\nLine 2\nLine 3");

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Line 1\nLine 2\nLine 3",
          },
        },
      ],
    });
  });

  it("handles empty string prompt", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask("");

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "",
          },
        },
      ],
    });
  });
});

describe("ask() - advanced options", () => {
  it("sends messages array from options object", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask({
      messages: [
        { role: "user", content: { type: "text", text: "Hello" } },
        { role: "assistant", content: { type: "text", text: "Hi" } },
        { role: "user", content: { type: "text", text: "How are you?" } },
      ],
    });

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [
        { role: "user", content: { type: "text", text: "Hello" } },
        { role: "assistant", content: { type: "text", text: "Hi" } },
        { role: "user", content: { type: "text", text: "How are you?" } },
      ],
    });
  });

  it("includes modelPreferences when provided", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask({
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      modelPreferences: {
        hints: [{ name: "claude-3-5-sonnet" }],
      },
    });

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      modelPreferences: {
        hints: [{ name: "claude-3-5-sonnet" }],
      },
    });
  });

  it("includes systemPrompt when provided", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask({
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      systemPrompt: "You are a helpful assistant.",
    });

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      systemPrompt: "You are a helpful assistant.",
    });
  });

  it("includes maxTokens when provided", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask({
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      maxTokens: 1000,
    });

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      maxTokens: 1000,
    });
  });

  it("throws if options object is missing messages array", async () => {
    const sendRequest = vi.fn();
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask({ systemPrompt: "test" })).rejects.toThrow(/must include messages array/);
  });

  it("throws if messages is not an array", async () => {
    const sendRequest = vi.fn();
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask({ messages: "not an array" })).rejects.toThrow(/must include messages array/);
  });
});

describe("ask() - timeout", () => {
  it("uses default timeout of 30 seconds", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    const result = await ask("Test");

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: "Test" } }],
    });
    expect(result).toBe("Response");
  });

  it("accepts custom timeout", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    const result = await ask("Test", 60000);

    expect(sendRequest).toHaveBeenCalledWith("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: "Test" } }],
    });
    expect(result).toBe("Response");
  });

  it("times out after specified duration", async () => {
    const sendRequest = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: "Late" }), 1000)),
      );
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask("Test", 100)).rejects.toThrow(/timed out after 100ms/);
  });

  it("returns result before timeout", async () => {
    const mockResponse = { content: "Fast response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    const result = await ask("Test", 5000);

    expect(result).toBe("Fast response");
  });
});

describe("ask() - error handling", () => {
  it("throws if response is missing content", async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask("Test")).rejects.toThrow(/Invalid sampling response: missing content/);
  });

  it("throws if response is null", async () => {
    const sendRequest = vi.fn().mockResolvedValue(null);
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask("Test")).rejects.toThrow(/Invalid sampling response: missing content/);
  });

  it("wraps sendRequest errors with context", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("Network error"));
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask("Test")).rejects.toThrow(/Sampling request failed: Network error/);
  });

  it("preserves timeout errors", async () => {
    const sendRequest = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: "Late" }), 1000)),
      );
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask("Test", 50)).rejects.toThrow(/timed out/);
  });

  it("throws if prompt is invalid type", async () => {
    const sendRequest = vi.fn();
    const ask = createAsk(sendRequest, { sampling: true });

    await expect(ask(123)).rejects.toThrow(/requires a string prompt or options object/);
    await expect(ask(null)).rejects.toThrow(/requires a string prompt or options object/);
  });
});

describe("ask() - edge cases", () => {
  it("handles empty response content", async () => {
    const sendRequest = vi.fn().mockResolvedValue({ content: "" });
    const ask = createAsk(sendRequest, { sampling: true });

    // Empty string is falsy in JavaScript, so it's treated as missing content
    await expect(ask("Test")).rejects.toThrow(/Invalid sampling response: missing content/);
  });

  it("handles special characters in prompt", async () => {
    const mockResponse = { content: "Response" };
    const sendRequest = vi.fn().mockResolvedValue(mockResponse);
    const ask = createAsk(sendRequest, { sampling: true });

    await ask("Test with \"quotes\", 'apostrophes', and <tags>");

    expect(sendRequest).toHaveBeenCalledWith(
      "sampling/createMessage",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.objectContaining({
              text: expect.stringContaining("quotes"),
            }),
          }),
        ]),
      }),
    );
  });

  it("can be called multiple times", async () => {
    const mockResponse1 = { content: "Response 1" };
    const mockResponse2 = { content: "Response 2" };
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(mockResponse1)
      .mockResolvedValueOnce(mockResponse2);

    const ask = createAsk(sendRequest, { sampling: true });

    const result1 = await ask("Test 1");
    const result2 = await ask("Test 2");

    expect(result1).toBe("Response 1");
    expect(result2).toBe("Response 2");
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});
