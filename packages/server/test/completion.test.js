/**
 * Completion Module Tests
 *
 * Tests auto-completion generation for prompts and resources.
 */

import { describe, it, expect, vi } from "vitest";
import { generateCompletions } from "../src/completion.js";
import { T } from "../src/types.js";

describe("generateCompletions() - validation", () => {
  it("returns empty completion for invalid registeredItems", () => {
    const result = generateCompletions(null, { type: "ref/prompt-argument" });
    expect(result).toEqual({
      completion: {
        values: [],
        hasMore: false,
      },
    });
  });

  it("returns empty completion for missing ref", () => {
    const result = generateCompletions({}, null);
    expect(result).toEqual({
      completion: {
        values: [],
        hasMore: false,
      },
    });
  });

  it("returns empty completion for ref without type", () => {
    const result = generateCompletions({}, { name: "test" });
    expect(result).toEqual({
      completion: {
        values: [],
        hasMore: false,
      },
    });
  });

  it("returns empty completion for unknown ref type", () => {
    const result = generateCompletions({}, { type: "ref/unknown" });
    expect(result).toEqual({
      completion: {
        values: [],
        hasMore: false,
      },
    });
  });
});

describe("generateCompletions() - prompt arguments with T.enum", () => {
  it("auto-generates from T.enum values", () => {
    const prompts = {
      search: {
        input: {
          status: T.string({ enum: ["pending", "active", "completed"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "search", argumentName: "status" },
      "",
    );

    expect(result.completion.values).toEqual(["pending", "active", "completed"]);
    expect(result.completion.hasMore).toBe(false);
  });

  it("filters values by partial match (case-insensitive)", () => {
    const prompts = {
      search: {
        input: {
          status: T.string({ enum: ["pending", "active", "completed"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "search", argumentName: "status" },
      "p",
    );

    expect(result.completion.values).toEqual(["pending"]);
  });

  it("handles case-insensitive filtering", () => {
    const prompts = {
      search: {
        input: {
          status: T.string({ enum: ["PENDING", "Active", "completed"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "search", argumentName: "status" },
      "act",
    );

    expect(result.completion.values).toEqual(["Active"]);
  });

  it("returns empty when no values match", () => {
    const prompts = {
      search: {
        input: {
          status: T.string({ enum: ["pending", "active", "completed"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "search", argumentName: "status" },
      "xyz",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("returns all values when partial is empty", () => {
    const prompts = {
      search: {
        input: {
          status: T.string({ enum: ["pending", "active", "completed"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "search", argumentName: "status" },
      "",
    );

    expect(result.completion.values).toEqual(["pending", "active", "completed"]);
  });
});

describe("generateCompletions() - custom completion handlers", () => {
  it("uses custom complete function for prompts", () => {
    const prompts = {
      "list-customers": {
        complete: (argName, _partialValue) => {
          if (argName === "status") {
            return ["active", "inactive", "pending"];
          }
          return [];
        },
      },
    };

    const result = generateCompletions(
      prompts,
      {
        type: "ref/prompt-argument",
        name: "list-customers",
        argumentName: "status",
      },
      "",
    );

    expect(result.completion.values).toEqual(["active", "inactive", "pending"]);
  });

  it("filters custom completion results", () => {
    const prompts = {
      "list-customers": {
        complete: () => ["active", "inactive", "pending"],
      },
    };

    const result = generateCompletions(
      prompts,
      {
        type: "ref/prompt-argument",
        name: "list-customers",
        argumentName: "status",
      },
      "act",
    );

    expect(result.completion.values).toEqual(["active"]);
  });

  it("passes argumentName to custom handler", () => {
    const completeFn = vi.fn(() => ["value1", "value2"]);
    const prompts = {
      test: {
        complete: completeFn,
      },
    };

    generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "myArg" },
      "val",
    );

    expect(completeFn).toHaveBeenCalledWith("myArg", "val");
  });

  it("returns empty on custom handler error", () => {
    const prompts = {
      test: {
        complete: () => {
          throw new Error("Handler error");
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("throws error for async completion handler", async () => {
    const prompts = {
      test: {
        complete: async () => ["value"],
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("returns empty if custom handler returns non-array", () => {
    const prompts = {
      test: {
        complete: () => "not an array",
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });
});

describe("generateCompletions() - 100-item cap", () => {
  it("caps results at 100 items", () => {
    const values = Array.from({ length: 150 }, (_, i) => `item${i}`);
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: values }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toHaveLength(100);
    expect(result.completion.hasMore).toBe(true);
  });

  it("sets hasMore=false when results under 100", () => {
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: ["a", "b", "c"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.hasMore).toBe(false);
  });

  it("caps at exactly 100 items", () => {
    const values = Array.from({ length: 100 }, (_, i) => `item${i}`);
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: values }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toHaveLength(100);
    expect(result.completion.hasMore).toBe(false);
  });

  it("applies cap after filtering", () => {
    const values = Array.from({ length: 150 }, (_, i) => `item${i}`);
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: values }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "item1",
    );

    // Matches: item1, item10, item11, ..., item19, item100, item101, ..., item149
    // Total: 1 + 10 + 50 = 61 matches (all under the 100-item cap)
    expect(result.completion.values.length).toBe(61);
  });
});

describe("generateCompletions() - resources", () => {
  it("uses custom complete function for resources", () => {
    const resources = {
      "db://customers": {
        complete: () => ["customer-1", "customer-2", "customer-3"],
      },
    };

    const result = generateCompletions(
      resources,
      { type: "ref/resource", uri: "db://customers" },
      "",
    );

    expect(result.completion.values).toEqual(["customer-1", "customer-2", "customer-3"]);
  });

  it("filters resource completion results", () => {
    const resources = {
      "db://customers": {
        complete: () => ["customer-1", "customer-2", "order-1"],
      },
    };

    const result = generateCompletions(
      resources,
      { type: "ref/resource", uri: "db://customers" },
      "cust",
    );

    expect(result.completion.values).toEqual(["customer-1", "customer-2"]);
  });

  it("returns empty for resource without custom handler", () => {
    const resources = {
      "db://customers": {
        // No complete handler
      },
    };

    const result = generateCompletions(
      resources,
      { type: "ref/resource", uri: "db://customers" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("passes null argumentName to resource handler", () => {
    const completeFn = vi.fn(() => ["value"]);
    const resources = {
      "db://test": {
        complete: completeFn,
      },
    };

    generateCompletions(resources, { type: "ref/resource", uri: "db://test" }, "val");

    expect(completeFn).toHaveBeenCalledWith(null, "val");
  });
});

describe("generateCompletions() - edge cases", () => {
  it("handles non-existent prompt", () => {
    const prompts = {};

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "nonexistent", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("handles non-existent argument", () => {
    const prompts = {
      test: {
        input: {
          otherArg: T.string({ enum: ["a", "b"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      {
        type: "ref/prompt-argument",
        name: "test",
        argumentName: "nonexistent",
      },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("handles prompt without input", () => {
    const prompts = {
      test: {
        // No input defined
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("handles argument without enum", () => {
    const prompts = {
      test: {
        input: {
          arg: T.string({ description: "No enum" }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual([]);
  });

  it("filters out non-string enum values", () => {
    const prompts = {
      test: {
        input: {
          arg: { enum: ["valid", 123, null, "another", undefined] },
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      "",
    );

    expect(result.completion.values).toEqual(["valid", "another"]);
  });

  it("handles undefined partialValue", () => {
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: ["a", "b", "c"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      undefined,
    );

    expect(result.completion.values).toEqual(["a", "b", "c"]);
  });

  it("handles null partialValue", () => {
    const prompts = {
      test: {
        input: {
          arg: T.string({ enum: ["a", "b", "c"] }),
        },
      },
    };

    const result = generateCompletions(
      prompts,
      { type: "ref/prompt-argument", name: "test", argumentName: "arg" },
      null,
    );

    expect(result.completion.values).toEqual(["a", "b", "c"]);
  });
});
