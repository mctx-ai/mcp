/**
 * Conversation Module Tests
 *
 * Tests the conversation builder API for creating prompt messages.
 */

import { describe, it, expect } from "vitest";
import { conversation } from "../src/conversation.js";

describe("conversation()", () => {
  it("throws if not given a function", () => {
    expect(() => conversation()).toThrow(/requires a builder function/);
    expect(() => conversation("not a function")).toThrow(/requires a builder function/);
    expect(() => conversation({})).toThrow(/requires a builder function/);
  });

  it("throws if builder does not return array", () => {
    expect(() => conversation(() => "string")).toThrow(/must return an array/);
    expect(() => conversation(() => ({}))).toThrow(/must return an array/);
    expect(() => conversation(() => null)).toThrow(/must return an array/);
  });

  it("returns messages object", () => {
    const result = conversation(({ user }) => [user.say("Hello")]);

    expect(result).toHaveProperty("messages");
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

describe("user.say()", () => {
  it("creates user text message", () => {
    const result = conversation(({ user }) => [user.say("What's the weather?")]);

    expect(result.messages).toEqual([
      {
        role: "user",
        content: {
          type: "text",
          text: "What's the weather?",
        },
      },
    ]);
  });

  it("throws if not given string", () => {
    expect(() => {
      conversation(({ user }) => [user.say(123)]);
    }).toThrow(/requires a string argument/);

    expect(() => {
      conversation(({ user }) => [user.say(null)]);
    }).toThrow(/requires a string argument/);
  });
});

describe("ai.say()", () => {
  it("creates assistant text message", () => {
    const result = conversation(({ ai }) => [ai.say("The weather is sunny.")]);

    expect(result.messages).toEqual([
      {
        role: "assistant",
        content: {
          type: "text",
          text: "The weather is sunny.",
        },
      },
    ]);
  });

  it("throws if not given string", () => {
    expect(() => {
      conversation(({ ai }) => [ai.say({})]);
    }).toThrow(/requires a string argument/);
  });
});

describe("user.attach()", () => {
  it("creates image message with base64 data", () => {
    const result = conversation(({ user }) => [
      user.attach("iVBORw0KGgoAAAANSUhEUgAAAAUA", "image/png"),
    ]);

    expect(result.messages).toEqual([
      {
        role: "user",
        content: {
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAUA",
          mimeType: "image/png",
        },
      },
    ]);
  });

  it("throws if data is not string", () => {
    expect(() => {
      conversation(({ user }) => [user.attach(123, "image/png")]);
    }).toThrow(/requires base64 data as first argument/);
  });

  it("throws if mimeType is missing", () => {
    expect(() => {
      conversation(({ user }) => [user.attach("base64data")]);
    }).toThrow(/requires mimeType as second argument/);

    expect(() => {
      conversation(({ user }) => [user.attach("base64data", null)]);
    }).toThrow(/requires mimeType as second argument/);
  });

  it("throws if mimeType is not string", () => {
    expect(() => {
      conversation(({ user }) => [user.attach("base64data", 123)]);
    }).toThrow(/requires mimeType as second argument/);
  });

  it("accepts various image MIME types", () => {
    const result = conversation(({ user }) => [
      user.attach("data1", "image/jpeg"),
      user.attach("data2", "image/gif"),
      user.attach("data3", "image/webp"),
    ]);

    expect(result.messages[0].content.mimeType).toBe("image/jpeg");
    expect(result.messages[1].content.mimeType).toBe("image/gif");
    expect(result.messages[2].content.mimeType).toBe("image/webp");
  });

  it("validates MIME type format - valid types", () => {
    expect(() => {
      conversation(({ user }) => [user.attach("data", "image/png")]);
    }).not.toThrow();

    expect(() => {
      conversation(({ user }) => [user.attach("data", "application/json")]);
    }).not.toThrow();

    expect(() => {
      conversation(({ user }) => [user.attach("data", "text/plain")]);
    }).not.toThrow();

    expect(() => {
      conversation(({ user }) => [user.attach("data", "application/vnd.api+json")]);
    }).not.toThrow();
  });

  it("validates MIME type format - invalid types", () => {
    expect(() => {
      conversation(({ user }) => [user.attach("data", "notarealtype")]);
    }).toThrow(/Invalid MIME type.*Expected format: type\/subtype/);

    expect(() => {
      conversation(({ user }) => [user.attach("data", "just/a/test/path")]);
    }).toThrow(/Invalid MIME type.*Expected format: type\/subtype/);

    expect(() => {
      conversation(({ user }) => [user.attach("data", "")]);
    }).toThrow(/Invalid MIME type.*Expected format: type\/subtype/);

    expect(() => {
      conversation(({ user }) => [user.attach("data", "/missingtype")]);
    }).toThrow(/Invalid MIME type.*Expected format: type\/subtype/);

    expect(() => {
      conversation(({ user }) => [user.attach("data", "missingsubtype/")]);
    }).toThrow(/Invalid MIME type.*Expected format: type\/subtype/);
  });
});

describe("user.embed()", () => {
  it("creates resource message", () => {
    const result = conversation(({ user }) => [user.embed("db://customers/schema")]);

    expect(result.messages).toEqual([
      {
        role: "user",
        content: {
          type: "resource",
          resource: {
            uri: "db://customers/schema",
            text: "[embedded]",
          },
        },
      },
    ]);
  });

  it("throws if uri is not string", () => {
    expect(() => {
      conversation(({ user }) => [user.embed(null)]);
    }).toThrow(/requires a URI string/);

    expect(() => {
      conversation(({ user }) => [user.embed(123)]);
    }).toThrow(/requires a URI string/);
  });
});

describe("conversation() - multi-turn dialogs", () => {
  it("preserves consecutive same-role messages", () => {
    const result = conversation(({ user, ai }) => [
      user.say("First user message"),
      user.say("Second user message"),
      ai.say("AI response"),
      ai.say("Another AI message"),
    ]);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("user");
    expect(result.messages[2].role).toBe("assistant");
    expect(result.messages[3].role).toBe("assistant");
  });

  it("builds complex multi-turn conversation", () => {
    const result = conversation(({ user, ai }) => [
      user.say("What's in this image?"),
      user.attach("base64imagedata", "image/png"),
      ai.say("I see a database schema diagram."),
      user.say("Can you explain the tables?"),
      user.embed("db://schema"),
      ai.say("The schema has three main tables: users, posts, and comments."),
    ]);

    expect(result.messages).toHaveLength(6);

    expect(result.messages[0].content.type).toBe("text");
    expect(result.messages[1].content.type).toBe("image");
    expect(result.messages[2].role).toBe("assistant");
    expect(result.messages[3].content.type).toBe("text");
    expect(result.messages[4].content.type).toBe("resource");
    expect(result.messages[5].role).toBe("assistant");
  });

  it("handles alternating user/ai messages", () => {
    const result = conversation(({ user, ai }) => [
      user.say("Hello"),
      ai.say("Hi there!"),
      user.say("How are you?"),
      ai.say("I'm doing well, thanks!"),
    ]);

    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("conversation() - mixed content types", () => {
  it("combines text, images, and resources", () => {
    const result = conversation(({ user }) => [
      user.say("Analyze this data:"),
      user.attach("chartdata", "image/png"),
      user.embed("db://analytics/metrics"),
    ]);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content.type).toBe("text");
    expect(result.messages[1].content.type).toBe("image");
    expect(result.messages[2].content.type).toBe("resource");
  });

  it("allows ai.attach() for image generation use cases", () => {
    const result = conversation(({ ai }) => [ai.attach("generatedimage", "image/png")]);

    expect(result.messages).toEqual([
      {
        role: "assistant",
        content: {
          type: "image",
          data: "generatedimage",
          mimeType: "image/png",
        },
      },
    ]);
  });

  it("allows ai.embed() for resource references", () => {
    const result = conversation(({ ai }) => [
      ai.say("I created a report here:"),
      ai.embed("storage://reports/2024-01-15.pdf"),
    ]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content.type).toBe("resource");
  });
});

describe("conversation() - edge cases", () => {
  it("handles empty conversation", () => {
    const result = conversation(() => []);
    expect(result.messages).toEqual([]);
  });

  it("handles single message", () => {
    const result = conversation(({ user }) => [user.say("Single message")]);

    expect(result.messages).toHaveLength(1);
  });

  it("handles empty strings", () => {
    const result = conversation(({ user }) => [user.say("")]);

    expect(result.messages[0].content.text).toBe("");
  });

  it("handles multiline text", () => {
    const result = conversation(({ user }) => [user.say("Line 1\nLine 2\nLine 3")]);

    expect(result.messages[0].content.text).toBe("Line 1\nLine 2\nLine 3");
  });

  it("handles special characters in text", () => {
    const result = conversation(({ user }) => [
      user.say("Special chars: \"quotes\", 'apostrophes', <tags>, & ampersands"),
    ]);

    expect(result.messages[0].content.text).toBe(
      "Special chars: \"quotes\", 'apostrophes', <tags>, & ampersands",
    );
  });
});
