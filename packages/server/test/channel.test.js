/**
 * Channel Module Tests
 *
 * Tests the createEmit factory and META_KEY_PATTERN for the channel
 * event emission module. Uses mocked Web Crypto API and fetch globals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmit, META_KEY_PATTERN } from "../src/channel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal env object with all required channel vars.
 * Secret is 32+ chars to satisfy M-3 minimum length requirement.
 */
function makeEnv(overrides = {}) {
  return {
    MCTX_EVENTS_ENDPOINT: "https://events.example.com/v1/emit",
    MCTX_SERVER_ID: "server-abc",
    MCTX_EVENTS_SECRET: "supersecret-that-is-at-least-32-chars-long",
    ...overrides,
  };
}

/**
 * Create a stub for crypto.subtle that resolves importKey and sign immediately.
 * sign() resolves with a Uint8Array of known bytes so we can predict the hex.
 */
function makeCryptoSubtle() {
  const mockKey = {};
  const signatureBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const expectedHex = "deadbeef";

  return {
    importKey: vi.fn().mockResolvedValue(mockKey),
    sign: vi.fn().mockResolvedValue(signatureBytes.buffer),
    _expectedHex: expectedHex,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let cryptoSubtle;
let mockFetch;

beforeEach(() => {
  cryptoSubtle = makeCryptoSubtle();

  // Stub globalThis.crypto — preserve randomUUID (used in channel.js)
  vi.stubGlobal("crypto", {
    subtle: cryptoSubtle,
    randomUUID: () => "test-nonce-uuid",
  });

  mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. createEmit() factory
// ---------------------------------------------------------------------------

describe("createEmit() factory", () => {
  it("returns a function when all required env vars are present", () => {
    const emit = createEmit(makeEnv());
    expect(typeof emit).toBe("function");
  });

  it("returns a function when env + executionCtx are both provided", () => {
    const ctx = { waitUntil: vi.fn() };
    const emit = createEmit(makeEnv(), ctx);
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op function when env is null", () => {
    const emit = createEmit(null);
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op when MCTX_EVENTS_ENDPOINT is missing", () => {
    const emit = createEmit(makeEnv({ MCTX_EVENTS_ENDPOINT: undefined }));
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op when MCTX_SERVER_ID is missing", () => {
    const emit = createEmit(makeEnv({ MCTX_SERVER_ID: undefined }));
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op when MCTX_EVENTS_SECRET is missing", () => {
    const emit = createEmit(makeEnv({ MCTX_EVENTS_SECRET: undefined }));
    expect(typeof emit).toBe("function");
  });

  it("no-op resolves without calling fetch", async () => {
    const emit = createEmit(makeEnv({ MCTX_EVENTS_ENDPOINT: undefined }));
    await emit("hello");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns a no-op when secret is shorter than 32 chars", async () => {
    const emit = createEmit(makeEnv({ MCTX_EVENTS_SECRET: "tooshort" }));
    await emit("hello");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. emit() — meta key validation (fire-and-forget contract: no-op on invalid)
// ---------------------------------------------------------------------------

describe("emit() meta key validation", () => {
  it("accepts alphanumeric key", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { foo: "bar" } })).resolves.toBeUndefined();
  });

  it("accepts key with underscores", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { bar_baz: "val" } })).resolves.toBeUndefined();
  });

  it("accepts uppercase alphanumeric key", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { ABC123: "val" } })).resolves.toBeUndefined();
  });

  it("accepts mixed alphanumeric and underscore key", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { a_1_b: "val" } })).resolves.toBeUndefined();
  });

  it("silently no-ops on key with hyphen (fire-and-forget contract)", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { "foo-bar": "val" } })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently no-ops on key with space (fire-and-forget contract)", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { "foo bar": "val" } })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently no-ops on key with dot (fire-and-forget contract)", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { "foo.bar": "val" } })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently no-ops on empty string key (fire-and-forget contract)", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", { meta: { "": "val" } })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently no-ops on non-string meta value (fire-and-forget contract)", async () => {
    const emit = createEmit(makeEnv());
    // @ts-ignore — intentionally passing non-string value to test validation
    await expect(emit("hello", { meta: { key: 42 } })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("works with no options (undefined second arg)", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello")).resolves.toBeUndefined();
  });

  it("works with empty options object {}", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("hello", {})).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. emit() — HMAC signing
// ---------------------------------------------------------------------------

describe("emit() HMAC signing", () => {
  it("calls crypto.subtle.importKey with raw HMAC-SHA256 params", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event");

    // Allow the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(cryptoSubtle.importKey).toHaveBeenCalledWith(
      "raw",
      expect.any(Uint8Array),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  });

  it("caches the CryptoKey — importKey called only once across multiple emits", async () => {
    const emit = createEmit(makeEnv());
    await emit("event one");
    await new Promise((r) => setTimeout(r, 0));
    await emit("event two");
    await new Promise((r) => setTimeout(r, 0));

    expect(cryptoSubtle.importKey).toHaveBeenCalledTimes(1);
  });

  it("calls crypto.subtle.sign with the imported key", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event");

    await new Promise((r) => setTimeout(r, 0));

    expect(cryptoSubtle.sign).toHaveBeenCalledWith(
      "HMAC",
      expect.any(Object),
      expect.any(Uint8Array),
    );
  });

  it("sends X-Events-Signature header in sha256=<hex> format", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event");

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Events-Signature": `sha256=${cryptoSubtle._expectedHex}`,
        }),
      }),
    );
  });

  it("does not send X-Events-Nonce header (nonce lives in signed body only)", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event");

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Events-Nonce"]).toBeUndefined();
  });

  it("includes nonce in the JSON request body", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event");

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.nonce).toBe("test-nonce-uuid");
  });

  it("includes server_id, event_type, display_text, metadata, nonce in body", async () => {
    const emit = createEmit(makeEnv());
    await emit("test event", { meta: { key1: "val1" } });

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body).toMatchObject({
      server_id: "server-abc",
      event_type: "notification",
      display_text: "test event",
      metadata: { key1: "val1" },
      nonce: "test-nonce-uuid",
    });
  });

  it("posts to the configured MCTX_EVENTS_ENDPOINT", async () => {
    const endpoint = "https://custom.endpoint.test/emit";
    const emit = createEmit(makeEnv({ MCTX_EVENTS_ENDPOINT: endpoint }));
    await emit("hello");

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledWith(endpoint, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// 4. emit() — fire-and-forget semantics
// ---------------------------------------------------------------------------

describe("emit() fire-and-forget semantics", () => {
  it("calls executionCtx.waitUntil with a Promise when ctx is provided", async () => {
    const ctx = { waitUntil: vi.fn() };
    const emit = createEmit(makeEnv(), ctx);
    await emit("hello");

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    const arg = ctx.waitUntil.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Promise);
  });

  it("does not call waitUntil when no executionCtx provided", async () => {
    const ctx = { waitUntil: vi.fn() };
    const emit = createEmit(makeEnv()); // no ctx
    await emit("hello");

    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("fires fetch even when no executionCtx is provided", async () => {
    const emit = createEmit(makeEnv()); // no ctx
    await emit("hello");

    // Give the microtask queue a tick to let the fire-and-forget resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("emit() returns immediately without awaiting the HTTP call", async () => {
    // Use a fetch that never resolves to confirm emit() doesn't hang
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const ctx = { waitUntil: vi.fn() };
    const emit = createEmit(makeEnv(), ctx);

    // Should resolve quickly without waiting for fetch
    const result = await emit("hello");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. emit() — no-op / error handling
// ---------------------------------------------------------------------------

describe("emit() error handling", () => {
  it("does not throw when fetch throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("network failure"));
    const emit = createEmit(makeEnv());

    await expect(emit("hello")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not throw when fetch returns a non-200 status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const emit = createEmit(makeEnv());

    await expect(emit("hello")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not throw when crypto.subtle.sign throws", async () => {
    cryptoSubtle.sign.mockRejectedValue(new Error("crypto failure"));
    const emit = createEmit(makeEnv());

    await expect(emit("hello")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("silently no-ops on empty content string", async () => {
    const emit = createEmit(makeEnv());
    await expect(emit("")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently no-ops on non-string content", async () => {
    const emit = createEmit(makeEnv());
    // @ts-ignore — intentionally passing non-string to test guard
    await expect(emit(42)).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("truncates content longer than 500 chars", async () => {
    const emit = createEmit(makeEnv());
    const longContent = "x".repeat(600);
    await emit(longContent);

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.display_text.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 6. emit() — options API
// ---------------------------------------------------------------------------

describe("emit() options API", () => {
  it("emit('hello') defaults eventType to 'notification', no meta", async () => {
    const emit = createEmit(makeEnv());
    await emit("hello");

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event_type).toBe("notification");
    expect(body.metadata).toBeNull();
  });

  it("emit('hello', { eventType: 'alert' }) sets event type", async () => {
    const emit = createEmit(makeEnv());
    await emit("hello", { eventType: "alert" });

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event_type).toBe("alert");
    expect(body.metadata).toBeNull();
  });

  it("emit('hello', { eventType: 'alert', meta: { key: 'val' } }) uses full options", async () => {
    const emit = createEmit(makeEnv());
    await emit("hello", { eventType: "alert", meta: { key: "val" } });

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event_type).toBe("alert");
    expect(body.metadata).toEqual({ key: "val" });
  });

  it("emit('hello', { meta: { key: 'val' } }) uses meta only, eventType defaults", async () => {
    const emit = createEmit(makeEnv());
    await emit("hello", { meta: { key: "val" } });

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event_type).toBe("notification");
    expect(body.metadata).toEqual({ key: "val" });
  });

  it("silently defaults to 'notification' when eventType fails validation", async () => {
    const emit = createEmit(makeEnv());
    await emit("hello", { eventType: "bad-type!" });

    await new Promise((r) => setTimeout(r, 0));

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.event_type).toBe("notification");
  });
});

// ---------------------------------------------------------------------------
// 7. META_KEY_PATTERN export
// ---------------------------------------------------------------------------

describe("META_KEY_PATTERN", () => {
  it("is a RegExp", () => {
    expect(META_KEY_PATTERN).toBeInstanceOf(RegExp);
  });

  it("matches valid alphanumeric keys", () => {
    expect(META_KEY_PATTERN.test("foo")).toBe(true);
    expect(META_KEY_PATTERN.test("ABC123")).toBe(true);
    expect(META_KEY_PATTERN.test("a")).toBe(true);
  });

  it("matches keys with underscores", () => {
    expect(META_KEY_PATTERN.test("bar_baz")).toBe(true);
    expect(META_KEY_PATTERN.test("a_1_b")).toBe(true);
    expect(META_KEY_PATTERN.test("_leading")).toBe(true);
    expect(META_KEY_PATTERN.test("trailing_")).toBe(true);
  });

  it("rejects keys with hyphens", () => {
    expect(META_KEY_PATTERN.test("foo-bar")).toBe(false);
  });

  it("rejects keys with spaces", () => {
    expect(META_KEY_PATTERN.test("foo bar")).toBe(false);
  });

  it("rejects keys with dots", () => {
    expect(META_KEY_PATTERN.test("foo.bar")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(META_KEY_PATTERN.test("")).toBe(false);
  });

  it("rejects keys with special characters", () => {
    expect(META_KEY_PATTERN.test("foo@bar")).toBe(false);
    expect(META_KEY_PATTERN.test("foo/bar")).toBe(false);
    expect(META_KEY_PATTERN.test("foo#bar")).toBe(false);
  });
});
