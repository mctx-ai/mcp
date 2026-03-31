/**
 * Channel Module Tests
 *
 * Tests the createEmit and createCancel factories for the header-based
 * channel event emission module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmit, createCancel, META_KEY_PATTERN } from "../src/channel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock Headers object that tracks multiple appended values per name.
 * Node's built-in Headers joins duplicate names with ", " which makes it
 * impossible to split JSON values reliably. This mock preserves each appended
 * value separately, matching the dispatch worker's header-reading contract.
 */
function makeHeaders() {
  const store = new Map(); // name -> [value, value, ...]

  return {
    append(name, value) {
      const key = name.toLowerCase();
      if (!store.has(key)) store.set(key, []);
      store.get(key).push(value);
    },
    get(name) {
      const key = name.toLowerCase();
      const values = store.get(key);
      return values && values.length > 0 ? values[0] : null;
    },
    getAll(name) {
      const key = name.toLowerCase();
      return store.get(key) || [];
    },
    forEach(fn) {
      for (const [name, values] of store.entries()) {
        for (const value of values) {
          fn(value, name);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Stub globalThis.crypto — preserve randomUUID used in channel.js
  vi.stubGlobal("crypto", {
    randomUUID: vi
      .fn()
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000001")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000002")
      .mockReturnValue("00000000-0000-0000-0000-000000000003"),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. createEmit() factory
// ---------------------------------------------------------------------------

describe("createEmit() factory", () => {
  it("returns a function when a Headers object is provided", () => {
    const emit = createEmit(makeHeaders());
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op function when responseHeaders is null", () => {
    const emit = createEmit(null);
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op function when responseHeaders is undefined", () => {
    const emit = createEmit(undefined);
    expect(typeof emit).toBe("function");
  });

  it("returns a no-op function when responseHeaders has no append method", () => {
    const emit = createEmit({});
    expect(typeof emit).toBe("function");
  });

  it("no-op returns empty string", () => {
    const emit = createEmit(null);
    expect(emit("hello")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. emit() — return value (eventId)
// ---------------------------------------------------------------------------

describe("emit() return value", () => {
  it("returns the eventId as a string synchronously", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const result = emit("hello");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the UUID used as eventId in the header", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const eventId = emit("hello");
    const headerValue = headers.get("X-Mctx-Event");
    const event = JSON.parse(headerValue);
    expect(event.eventId).toBe(eventId);
  });

  it("returns empty string when content is invalid (no-op)", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("")).toBe("");
    // @ts-ignore
    expect(emit(42)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. emit() — X-Mctx-Event header shape
// ---------------------------------------------------------------------------

describe("emit() header shape", () => {
  it("appends X-Mctx-Event header with correct JSON shape", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("test event");

    const headerValue = headers.get("X-Mctx-Event");
    expect(headerValue).not.toBeNull();
    const event = JSON.parse(headerValue);
    expect(event).toMatchObject({
      eventId: expect.any(String),
      eventType: "channel",
      content: "test event",
      metadata: null,
      deliverAt: null,
      expiresAt: expect.any(String),
      key: null,
    });
  });

  it("appends multiple X-Mctx-Event headers for multiple emit() calls", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("event one");
    emit("event two");

    const allValues = headers.getAll("X-Mctx-Event");
    expect(allValues.length).toBe(2);
    const event1 = JSON.parse(allValues[0]);
    const event2 = JSON.parse(allValues[1]);
    expect(event1.content).toBe("event one");
    expect(event2.content).toBe("event two");
  });

  it("uses unique eventIds for each emit() call", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const id1 = emit("event one");
    const id2 = emit("event two");
    expect(id1).not.toBe(id2);
  });

  it("sets expiresAt to approximately 7 days from now", () => {
    const before = Date.now();
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("test");
    const after = Date.now();

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    const expiresMs = new Date(event.expiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

// ---------------------------------------------------------------------------
// 4. emit() — content validation
// ---------------------------------------------------------------------------

describe("emit() content validation", () => {
  it("silently no-ops on empty content string", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const result = emit("");
    expect(result).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("silently no-ops on non-string content", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    // @ts-ignore
    expect(emit(42)).toBe("");
    // @ts-ignore
    expect(emit(null)).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("truncates content longer than 500 chars", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const longContent = "x".repeat(600);
    emit(longContent);

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.content.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 5. emit() — options API
// ---------------------------------------------------------------------------

describe("emit() options API", () => {
  it("defaults eventType to 'channel' when no options provided", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello");

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.eventType).toBe("channel");
  });

  it("uses provided eventType when valid", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { eventType: "deploy_status" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.eventType).toBe("deploy_status");
  });

  it("defaults to 'channel' when eventType fails validation", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { eventType: "bad-type!" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.eventType).toBe("channel");
  });

  it("sets metadata when valid meta provided", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { meta: { key1: "val1", key2: "val2" } });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.metadata).toEqual({ key1: "val1", key2: "val2" });
  });

  it("sets metadata to null when no meta provided", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello");

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.metadata).toBeNull();
  });

  it("passes deliverAt ISO string when valid", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const iso = "2026-04-01T12:00:00.000Z";
    emit("hello", { deliverAt: iso });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBe(iso);
  });

  it("sets deliverAt to null when not provided", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello");

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBeNull();
  });

  it("sets deliverAt to null when deliverAt is an empty string", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { deliverAt: "" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBeNull();
  });

  it("sets deliverAt to null when deliverAt is a non-string", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    // @ts-ignore
    emit("hello", { deliverAt: 1700000000000 });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBeNull();
  });

  it("sets deliverAt to null when deliverAt does not match ISO 8601 pattern", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { deliverAt: "April 1st, 2026" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBeNull();
  });

  it("passes deliverAt when it matches basic ISO 8601 pattern (with offset)", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { deliverAt: "2026-04-01T12:00:00+05:30" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.deliverAt).toBe("2026-04-01T12:00:00+05:30");
  });

  it("passes key in payload when key matches META_KEY_PATTERN", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { key: "my_event_key" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.key).toBe("my_event_key");
  });

  it("sets key to null when key is not provided", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello");

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.key).toBeNull();
  });

  it("sets key to null when key contains invalid characters", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { key: "invalid-key!" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.key).toBeNull();
  });

  it("sets key to null when key is an empty string", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    emit("hello", { key: "" });

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.key).toBeNull();
  });

  it("works with empty options object {}", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const result = emit("hello", {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. emit() — meta key validation
// ---------------------------------------------------------------------------

describe("emit() meta key validation", () => {
  it("accepts alphanumeric key", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { foo: "bar" } })).not.toBe("");
  });

  it("accepts key with underscores", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { bar_baz: "val" } })).not.toBe("");
  });

  it("accepts uppercase alphanumeric key", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { ABC123: "val" } })).not.toBe("");
  });

  it("silently no-ops on key with hyphen", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { "foo-bar": "val" } })).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("silently no-ops on key with space", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { "foo bar": "val" } })).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("silently no-ops on key with dot", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { "foo.bar": "val" } })).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("silently no-ops on empty string key", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    expect(emit("hello", { meta: { "": "val" } })).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
  });

  it("silently no-ops on non-string meta value", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    // @ts-ignore
    expect(emit("hello", { meta: { key: 42 } })).toBe("");
    expect(headers.get("X-Mctx-Event")).toBeNull();
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

// ---------------------------------------------------------------------------
// 8. createCancel() factory
// ---------------------------------------------------------------------------

describe("createCancel() factory", () => {
  it("returns a function when a Headers object is provided", () => {
    const cancel = createCancel(makeHeaders());
    expect(typeof cancel).toBe("function");
  });

  it("returns a no-op function when responseHeaders is null", () => {
    const cancel = createCancel(null);
    expect(typeof cancel).toBe("function");
  });

  it("returns a no-op function when responseHeaders is undefined", () => {
    const cancel = createCancel(undefined);
    expect(typeof cancel).toBe("function");
  });

  it("returns a no-op function when responseHeaders has no append method", () => {
    const cancel = createCancel({});
    expect(typeof cancel).toBe("function");
  });

  it("no-op does not throw", () => {
    const cancel = createCancel(null);
    expect(() => cancel("some-event-id")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. cancel() — X-Mctx-Cancel header behavior
// ---------------------------------------------------------------------------

describe("cancel() behavior", () => {
  it("appends X-Mctx-Cancel header with the eventId as plain string", () => {
    const headers = makeHeaders();
    const cancel = createCancel(headers);
    cancel("00000000-0000-0000-0000-000000000001");

    expect(headers.get("X-Mctx-Cancel")).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("appends multiple X-Mctx-Cancel headers for multiple cancel() calls", () => {
    const headers = makeHeaders();
    const cancel = createCancel(headers);
    cancel("event-id-1");
    cancel("event-id-2");

    const allValues = headers.getAll("X-Mctx-Cancel");
    expect(allValues.length).toBe(2);
    expect(allValues[0]).toBe("event-id-1");
    expect(allValues[1]).toBe("event-id-2");
  });

  it("silently no-ops on empty eventId string", () => {
    const headers = makeHeaders();
    const cancel = createCancel(headers);
    cancel("");
    expect(headers.get("X-Mctx-Cancel")).toBeNull();
  });

  it("silently no-ops on non-string eventId", () => {
    const headers = makeHeaders();
    const cancel = createCancel(headers);
    // @ts-ignore
    cancel(42);
    // @ts-ignore
    cancel(null);
    expect(headers.get("X-Mctx-Cancel")).toBeNull();
  });

  it("does not throw on any input", () => {
    const headers = makeHeaders();
    const cancel = createCancel(headers);
    expect(() => cancel("valid-id")).not.toThrow();
    expect(() => cancel("")).not.toThrow();
    // @ts-ignore
    expect(() => cancel(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. Integration: emit() + cancel() on same Headers object
// ---------------------------------------------------------------------------

describe("emit() + cancel() integration", () => {
  it("emit() and cancel() can both append to the same Headers object", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const cancel = createCancel(headers);

    const eventId = emit("something happened");
    cancel(eventId);

    expect(headers.get("X-Mctx-Event")).not.toBeNull();
    expect(headers.get("X-Mctx-Cancel")).toBe(eventId);
  });

  it("emitting then cancelling uses the returned eventId", () => {
    const headers = makeHeaders();
    const emit = createEmit(headers);
    const cancel = createCancel(headers);

    const id = emit("scheduled event", { deliverAt: "2026-04-01T00:00:00.000Z" });
    cancel(id);

    const event = JSON.parse(headers.get("X-Mctx-Event"));
    expect(event.eventId).toBe(id);
    expect(headers.get("X-Mctx-Cancel")).toBe(id);
  });
});
