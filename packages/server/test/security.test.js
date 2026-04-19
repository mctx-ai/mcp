/**
 * Security Module Tests
 *
 * Tests security protections including error sanitization, size validation,
 * URI scheme validation, path traversal prevention, and prototype pollution protection.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeError,
  validateRequestSize,
  validateResponseSize,
  validateStringInput,
  validateUriScheme,
  canonicalizePath,
  sanitizeInput,
} from "../src/security.js";

describe("sanitizeError() - stack traces", () => {
  it("strips stack traces in production", () => {
    const error = new Error("Test error");
    error.stack = "Error: Test error\n    at Object.<anonymous> (/path/to/file.js:10:15)";

    const sanitized = sanitizeError(error, true);

    expect(sanitized).toBe("Test error");
    expect(sanitized).not.toContain("at Object");
    expect(sanitized).not.toContain("/path/to/file.js");
  });

  it("preserves stack traces in development", () => {
    const error = new Error("Test error");
    error.stack = "Error: Test error\n    at Object.<anonymous> (/path/to/file.js:10:15)";

    const sanitized = sanitizeError(error, false);

    expect(sanitized).toContain("Test error");
    expect(sanitized).toContain("at Object");
  });

  it("handles errors without stack property", () => {
    const error = new Error("Simple error");
    delete error.stack;

    const sanitized = sanitizeError(error, true);
    expect(sanitized).toBe("Simple error");
  });

  it("handles null error", () => {
    const sanitized = sanitizeError(null, true);
    expect(sanitized).toBe("Unknown error");
  });

  it("handles undefined error", () => {
    const sanitized = sanitizeError(undefined, true);
    expect(sanitized).toBe("Unknown error");
  });

  it("handles non-Error objects", () => {
    const sanitized = sanitizeError("string error", true);
    expect(sanitized).toBe("string error");
  });
});

describe("sanitizeError() - AWS key redaction", () => {
  it("redacts AWS access keys in message", () => {
    const error = new Error("Failed with key AKIAIOSFODNN7EXAMPLE");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts multiple AWS keys", () => {
    const error = new Error("Keys: AKIAIOSFODNN7EXAMPLE and AKIAJ7EXAMPLE1234567");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(sanitized).not.toContain("AKIAJ7EXAMPLE1234567");
  });

  it("redacts AWS keys in stack traces (development)", () => {
    const error = new Error("Error");
    error.stack = "Error: Failed with AKIAIOSFODNN7EXAMPLE\n    at /path/to/file.js:10";

    const sanitized = sanitizeError(error, false);

    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("sanitizeError() - JWT redaction", () => {
  it("redacts JWT tokens in message", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const error = new Error(`Auth failed: ${jwt}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_JWT]");
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts multiple JWTs", () => {
    const error = new Error("Token1: eyJa.eyJz.Sfl and Token2: eyJb.eyJt.Xyz");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_JWT]");
    expect(sanitized).not.toContain("eyJa.eyJz.Sfl");
  });
});

describe("sanitizeError() - connection string redaction", () => {
  it("redacts MongoDB connection strings", () => {
    const error = new Error("Failed: mongodb://user:pass@localhost:27017/db");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_CONNECTION_STRING]");
    expect(sanitized).not.toContain("mongodb://user:pass@localhost");
  });

  it("redacts PostgreSQL connection strings", () => {
    const error = new Error("Error: postgres://user:pass@localhost/db");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_CONNECTION_STRING]");
    expect(sanitized).not.toContain("postgres://user:pass");
  });

  it("redacts MySQL connection strings", () => {
    const error = new Error("Failed: mysql://root:secret@localhost:3306/database");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_CONNECTION_STRING]");
    expect(sanitized).not.toContain("root:secret");
  });
});

describe("sanitizeError() - Bearer token redaction", () => {
  it("redacts Bearer tokens", () => {
    const error = new Error("Auth failed with Bearer abc123def456ghi789");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).not.toContain("abc123def456ghi789");
  });
});

describe("sanitizeError() - API key redaction", () => {
  it("redacts api_key values", () => {
    const error = new Error("Failed: api_key=sk_live_1234567890abcdef");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("sk_live_1234567890abcdef");
  });

  it("redacts token values", () => {
    const error = new Error('Config: token="ghp_1234567890abcdefghij"');
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("ghp_1234567890abcdefghij");
  });

  it("redacts secret values", () => {
    const error = new Error("Env: secret: my_super_secret_key_12345");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("my_super_secret_key_12345");
  });
});

describe("sanitizeError() - GitHub token redaction", () => {
  it("redacts GitHub personal access tokens (ghp_)", () => {
    // GitHub tokens are 36 chars after prefix: ghp_ + 36 chars
    const token = "ghp_1234567890abcdefghij1234567890abcdef";
    const error = new Error(`Auth failed with ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const token = "gho_abcdefghijklmnopqrstuvwxyz0123456789";
    const error = new Error(`Token: ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("redacts GitHub server tokens (ghs_)", () => {
    const token = "ghs_XyZ1234567890AbCdEfGhIjKlMnOpQrStUv";
    const error = new Error(`Server token: ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("redacts GitHub refresh tokens (ghr_)", () => {
    const token = "ghr_0987654321ZyXwVuTsRqPoNmLkJiHgFeD";
    const error = new Error(`Refresh: ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).not.toContain(token);
  });
});

describe("sanitizeError() - Slack token redaction", () => {
  it("redacts Slack bot tokens (xoxb-)", () => {
    const token = "xoxb-FAKEFAKE-TESTTOKEN"; // pragma: fake test token
    const error = new Error(`Slack error: ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_SLACK_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("redacts Slack user tokens (xoxp-)", () => {
    const token = "xoxp-FAKEFAKE-TESTTOKEN"; // pragma: fake test token
    const error = new Error(`Token: ${token}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_SLACK_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("redacts Slack app tokens (xoxa-)", () => {
    const error = new Error("App: xoxa-1111111111-2222222222-abcdefg");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_SLACK_TOKEN]");
    expect(sanitized).not.toContain("xoxa-1111111111-2222222222-abcdefg");
  });
});

describe("sanitizeError() - Private key redaction", () => {
  it("redacts RSA private keys", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    const error = new Error(`Key leaked: ${key}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_PRIVATE_KEY]");
    expect(sanitized).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(sanitized).not.toContain("MIIEpAIBAAKCAQEA");
  });

  it("redacts EC private keys", () => {
    const key = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEII...\n-----END EC PRIVATE KEY-----";
    const error = new Error(`Exposed: ${key}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_PRIVATE_KEY]");
    expect(sanitized).not.toContain("BEGIN EC PRIVATE KEY");
  });

  it("redacts generic private keys", () => {
    const key = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG...\n-----END PRIVATE KEY-----";
    const error = new Error(`Leaked: ${key}`);
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_PRIVATE_KEY]");
    expect(sanitized).not.toContain("BEGIN PRIVATE KEY");
  });
});

describe("sanitizeError() - GCP API key redaction", () => {
  it("redacts GCP API keys", () => {
    const error = new Error("GCP key: AIzaSyDxVxF3c4N-RgZqP8mK9jL2hY1wBtCvXyZ");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GCP_KEY]");
    expect(sanitized).not.toContain("AIzaSyDxVxF3c4N-RgZqP8mK9jL2hY1wBtCvXyZ");
  });

  it("redacts multiple GCP keys", () => {
    const error = new Error("Keys: AIzaSyABC123def456GHI789jkl and AIzaSyXYZ987wvu654TSR321qpo");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_GCP_KEY]");
    expect(sanitized).not.toContain("AIzaSyABC123def456GHI789jkl");
    expect(sanitized).not.toContain("AIzaSyXYZ987wvu654TSR321qpo");
  });
});

describe("sanitizeError() - Azure key redaction", () => {
  it("redacts Azure AccountKey values", () => {
    const error = new Error("Connection: AccountKey=abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG==");
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_AZURE_KEY]");
    expect(sanitized).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG==");
  });

  it("redacts Azure storage connection strings", () => {
    const error = new Error(
      "Failed: DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    );
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_AZURE_KEY]");
    expect(sanitized).not.toContain(
      "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    );
  });
});

describe("validateRequestSize()", () => {
  it("passes for requests under limit", () => {
    const body = JSON.stringify({ data: "test" });
    expect(() => validateRequestSize(body)).not.toThrow();
  });

  it("throws for requests over default 1MB limit", () => {
    const body = "x".repeat(1048577); // 1MB + 1 byte
    expect(() => validateRequestSize(body)).toThrow(/Request body too large/);
  });

  it("accepts custom max size", () => {
    const body = "x".repeat(2000);
    expect(() => validateRequestSize(body, 1000)).toThrow(/Request body too large/);
    expect(() => validateRequestSize(body, 3000)).not.toThrow();
  });

  it("validates object bodies", () => {
    const body = { data: "x".repeat(2000) };
    expect(() => validateRequestSize(body, 1000)).toThrow(/Request body too large/);
  });

  it("handles null body", () => {
    expect(() => validateRequestSize(null)).not.toThrow();
  });

  it("handles undefined body", () => {
    expect(() => validateRequestSize(undefined)).not.toThrow();
  });

  it("includes size in error message", () => {
    const body = "x".repeat(2000);
    expect(() => validateRequestSize(body, 1000)).toThrow(/2000 bytes/);
    expect(() => validateRequestSize(body, 1000)).toThrow(/max: 1000 bytes/);
  });
});

describe("validateResponseSize()", () => {
  it("passes for responses under limit", () => {
    const body = JSON.stringify({ result: "success" });
    expect(() => validateResponseSize(body)).not.toThrow();
  });

  it("throws for responses over default 1MB limit", () => {
    const body = { data: "x".repeat(1048577) };
    expect(() => validateResponseSize(body)).toThrow(/Response body too large/);
  });

  it("accepts custom max size", () => {
    const body = "x".repeat(2000);
    expect(() => validateResponseSize(body, 1000)).toThrow(/Response body too large/);
    expect(() => validateResponseSize(body, 3000)).not.toThrow();
  });

  it("handles null body", () => {
    expect(() => validateResponseSize(null)).not.toThrow();
  });
});

describe("validateStringInput()", () => {
  it("passes for strings under limit", () => {
    expect(() => validateStringInput("test string")).not.toThrow();
  });

  it("throws for strings over default 10MB limit", () => {
    const longString = "x".repeat(10485761);
    expect(() => validateStringInput(longString)).toThrow(/String input too long/);
  });

  it("accepts custom max length", () => {
    const str = "x".repeat(2000);
    expect(() => validateStringInput(str, 1000)).toThrow(/String input too long/);
    expect(() => validateStringInput(str, 3000)).not.toThrow();
  });

  it("ignores non-string values", () => {
    expect(() => validateStringInput(123)).not.toThrow();
    expect(() => validateStringInput(null)).not.toThrow();
    expect(() => validateStringInput({})).not.toThrow();
  });

  it("includes length in error message", () => {
    const str = "x".repeat(2000);
    expect(() => validateStringInput(str, 1000)).toThrow(/2000 chars/);
    expect(() => validateStringInput(str, 1000)).toThrow(/max: 1000 chars/);
  });
});

describe("validateUriScheme()", () => {
  it("allows http:// (safe scheme)", () => {
    expect(validateUriScheme("http://example.com")).toBe(true);
  });

  it("allows https:// (safe scheme)", () => {
    expect(validateUriScheme("https://example.com")).toBe(true);
  });

  it("allows custom schemes (e.g., docs://)", () => {
    expect(validateUriScheme("docs://readme")).toBe(true);
    expect(validateUriScheme("user://alice")).toBe(true);
    expect(validateUriScheme("db://localhost")).toBe(true);
    expect(validateUriScheme("custom://resource")).toBe(true);
  });

  it("allows ftp:// (not in denylist)", () => {
    expect(validateUriScheme("ftp://example.com")).toBe(true);
  });

  it("blocks file:// (dangerous scheme)", () => {
    expect(validateUriScheme("file:///etc/passwd")).toBe(false);
  });

  it("blocks javascript: (dangerous scheme)", () => {
    expect(validateUriScheme("javascript:alert(1)")).toBe(false);
  });

  it("blocks data: (dangerous scheme)", () => {
    expect(validateUriScheme("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks vbscript: (dangerous scheme)", () => {
    expect(validateUriScheme("vbscript:msgbox(1)")).toBe(false);
  });

  it("blocks about: (dangerous scheme)", () => {
    expect(validateUriScheme("about:blank")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(validateUriScheme("HTTP://example.com")).toBe(true);
    expect(validateUriScheme("HTTPS://example.com")).toBe(true);
    expect(validateUriScheme("DOCS://readme")).toBe(true);
    expect(validateUriScheme("FILE:///etc/passwd")).toBe(false);
    expect(validateUriScheme("JAVASCRIPT:alert(1)")).toBe(false);
  });

  it("returns false for URIs without scheme", () => {
    expect(validateUriScheme("example.com")).toBe(false);
    expect(validateUriScheme("/path/to/resource")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(validateUriScheme(null)).toBe(false);
    expect(validateUriScheme(undefined)).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(validateUriScheme(123)).toBe(false);
    expect(validateUriScheme({})).toBe(false);
  });

  it("handles complex URIs", () => {
    expect(validateUriScheme("https://user:pass@example.com:8080/path?query=1#hash")).toBe(true);
    expect(validateUriScheme("docs://section/subsection?version=2#anchor")).toBe(true);
  });

  it("rejects scheme starting with digit (RFC 3986)", () => {
    expect(validateUriScheme("123://invalid")).toBe(false);
    expect(validateUriScheme("9abc://test")).toBe(false);
  });

  it("rejects scheme with underscore (not in RFC 3986)", () => {
    expect(validateUriScheme("my_scheme://test")).toBe(false);
    expect(validateUriScheme("test_underscore://resource")).toBe(false);
  });

  it("accepts scheme with valid RFC 3986 special chars (+.-)", () => {
    expect(validateUriScheme("a+b://test")).toBe(true);
    expect(validateUriScheme("a.b://test")).toBe(true);
    expect(validateUriScheme("a-b://test")).toBe(true);
    expect(validateUriScheme("a+b.c-d://test")).toBe(true);
  });

  it("rejects scheme longer than 32 characters", () => {
    const longScheme = "a".repeat(33);
    expect(validateUriScheme(`${longScheme}://test`)).toBe(false);
  });

  it("accepts scheme exactly 32 characters", () => {
    const scheme32 = "a".repeat(32);
    expect(validateUriScheme(`${scheme32}://test`)).toBe(true);
  });

  it("rejects scheme with invalid special characters", () => {
    expect(validateUriScheme("my@scheme://test")).toBe(false);
    expect(validateUriScheme("my#scheme://test")).toBe(false);
    expect(validateUriScheme("my$scheme://test")).toBe(false);
    expect(validateUriScheme("my%scheme://test")).toBe(false);
  });
});

describe("canonicalizePath()", () => {
  it("returns normalized path for valid URI", () => {
    const result = canonicalizePath("db://customers/schema");
    // Function removes duplicate slashes, including in the scheme
    expect(result).toBe("db:/customers/schema");
  });

  it("throws on ../ traversal", () => {
    expect(() => canonicalizePath("db://../etc/passwd")).toThrow(/Path traversal detected/);
    expect(() => canonicalizePath("db://data/../../../etc/passwd")).toThrow(
      /Path traversal detected/,
    );
  });

  it("throws on ..\\ traversal (Windows-style)", () => {
    expect(() => canonicalizePath("db://..\\etc\\passwd")).toThrow(/Path traversal detected/);
  });

  it("throws on URL-encoded traversal", () => {
    expect(() => canonicalizePath("db://%2e%2e%2fetc/passwd")).toThrow(/Path traversal detected/);
    expect(() => canonicalizePath("db://%2e%2e/etc/passwd")).toThrow(/Path traversal detected/);
    expect(() => canonicalizePath("db://..%2fetc/passwd")).toThrow(/Path traversal detected/);
  });

  it("is case-insensitive for encoded traversal", () => {
    expect(() => canonicalizePath("db://%2E%2E%2Fetc/passwd")).toThrow(/Path traversal detected/);
  });

  it("detects double-encoded path traversal", () => {
    // %252e = encoded '%2e'
    expect(() => canonicalizePath("db://%252e%252e%252fetc/passwd")).toThrow(
      /Path traversal detected/,
    );
  });

  it("detects triple-encoded path traversal", () => {
    // %25252e = double-encoded '%2e'
    expect(() => canonicalizePath("db://%25252e%25252e%25252fetc/passwd")).toThrow(
      /Path traversal detected/,
    );
  });

  it("detects null byte injection (encoded)", () => {
    expect(() => canonicalizePath("db://file.txt%00.jpg")).toThrow(/null byte injection/);
  });

  it("detects null byte injection (literal)", () => {
    expect(() => canonicalizePath("db://file.txt\0.jpg")).toThrow(/null byte injection/);
  });

  it("detects mixed encoding (%2e./)", () => {
    expect(() => canonicalizePath("db://%2e./etc/passwd")).toThrow(/Path traversal detected/);
  });

  it("detects mixed encoding (.%2e/)", () => {
    expect(() => canonicalizePath("db://.%2e/etc/passwd")).toThrow(/Path traversal detected/);
  });

  it("detects Unicode-encoded path traversal", () => {
    // \u002e = '.', \u002f = '/'
    expect(() => canonicalizePath("db://\u002e\u002e\u002fetc/passwd")).toThrow(
      /Unicode-encoded ..\/|Path traversal detected/,
    );
  });

  it("normalizes path separators", () => {
    const result = canonicalizePath("db://path\\to\\resource");
    // Function converts backslashes and removes duplicate slashes
    expect(result).toBe("db:/path/to/resource");
  });

  it("removes duplicate slashes", () => {
    const result = canonicalizePath("db://path//to///resource");
    // Function removes ALL duplicate slashes, including in scheme
    expect(result).toBe("db:/path/to/resource");
  });

  it("throws for null/undefined", () => {
    expect(() => canonicalizePath(null)).toThrow(/Invalid URI/);
    expect(() => canonicalizePath(undefined)).toThrow(/Invalid URI/);
  });

  it("throws for non-string", () => {
    expect(() => canonicalizePath(123)).toThrow(/Invalid URI/);
  });

  it("throws for empty string", () => {
    expect(() => canonicalizePath("")).toThrow(/Invalid URI/);
  });

  it("handles single dots (not traversal)", () => {
    const result = canonicalizePath("db://./resource");
    // Function removes duplicate slashes in scheme
    expect(result).toBe("db:/./resource");
  });

  it("allows legitimate paths with dots in names", () => {
    const result = canonicalizePath("db://data.json");
    // Function removes duplicate slashes in scheme
    expect(result).toBe("db:/data.json");
  });
});

describe("sanitizeInput() - prototype pollution", () => {
  it("strips __proto__ key", () => {
    const malicious = { __proto__: { isAdmin: true }, name: "test" };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized).toEqual({ name: "test" });
    expect(Object.hasOwnProperty.call(sanitized, "__proto__")).toBe(false);
  });

  it("strips constructor key", () => {
    const malicious = {
      constructor: { prototype: { isAdmin: true } },
      name: "test",
    };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized).toEqual({ name: "test" });
  });

  it("strips prototype key", () => {
    const malicious = { prototype: { isAdmin: true }, name: "test" };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized).toEqual({ name: "test" });
  });

  it("handles nested objects", () => {
    const malicious = {
      user: {
        __proto__: { isAdmin: true },
        name: "alice",
      },
    };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized.user).toEqual({ name: "alice" });
    expect(Object.hasOwnProperty.call(sanitized.user, "__proto__")).toBe(false);
  });

  it("handles arrays", () => {
    const malicious = [{ __proto__: { isAdmin: true }, id: 1 }, { name: "test" }];
    const sanitized = sanitizeInput(malicious);

    expect(sanitized).toEqual([{ id: 1 }, { name: "test" }]);
  });

  it("handles deeply nested structures", () => {
    const malicious = {
      level1: {
        level2: {
          level3: {
            __proto__: { isAdmin: true },
            data: "value",
          },
        },
      },
    };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized.level1.level2.level3).toEqual({ data: "value" });
  });

  it("returns primitives unchanged", () => {
    expect(sanitizeInput("string")).toBe("string");
    expect(sanitizeInput(123)).toBe(123);
    expect(sanitizeInput(true)).toBe(true);
    expect(sanitizeInput(null)).toBe(null);
  });

  it("does not mutate original object", () => {
    const original = JSON.parse('{"__proto__": {"isAdmin": true}, "name": "test"}');
    const sanitized = sanitizeInput(original);

    // Original should still have __proto__ as an own property (when created via JSON.parse)
    expect(Object.hasOwnProperty.call(original, "__proto__")).toBe(true);
    // Sanitized should NOT have __proto__ as an own property
    expect(Object.hasOwnProperty.call(sanitized, "__proto__")).toBe(false);
    expect(sanitized).not.toBe(original);
  });

  it("handles mixed arrays and objects", () => {
    const malicious = {
      users: [
        { __proto__: { role: "admin" }, name: "alice" },
        { constructor: {}, name: "bob" },
      ],
      config: {
        __proto__: { debug: true },
        timeout: 5000,
      },
    };
    const sanitized = sanitizeInput(malicious);

    expect(sanitized.users[0]).toEqual({ name: "alice" });
    expect(sanitized.users[1]).toEqual({ name: "bob" });
    expect(sanitized.config).toEqual({ timeout: 5000 });
  });

  it("handles empty objects", () => {
    expect(sanitizeInput({})).toEqual({});
  });

  it("handles empty arrays", () => {
    expect(sanitizeInput([])).toEqual([]);
  });

  it("preserves normal properties when sanitizing input", () => {
    const obj = { normalProp: "value" };
    const sanitized = sanitizeInput(obj);

    expect(sanitized).toEqual({ normalProp: "value" });
  });
});

describe("security integration", () => {
  it("accepts a normal-sized JSON request body without error", () => {
    const rawBody = JSON.stringify({
      method: "test",
      params: { __proto__: { isAdmin: true }, data: "safe" },
    });

    expect(() => validateRequestSize(rawBody)).not.toThrow();
  });

  it("removes __proto__ keys from parsed request params", () => {
    const rawBody = JSON.stringify({
      method: "test",
      params: { __proto__: { isAdmin: true }, data: "safe" },
    });

    const parsed = JSON.parse(rawBody);
    const sanitized = sanitizeInput(parsed);

    expect(sanitized.params).toEqual({ data: "safe" });
  });

  it("prevents multiple attack vectors simultaneously", () => {
    const maliciousUri = "file://../../../etc/passwd";

    expect(validateUriScheme(maliciousUri)).toBe(false);
    expect(() => canonicalizePath(maliciousUri)).toThrow();
  });

  it("sanitizes errors containing sensitive data", () => {
    const error = new Error(
      "Failed to access file://../../../etc/passwd with key AKIAIOSFODNN7EXAMPLE",
    );
    const sanitized = sanitizeError(error, true);

    expect(sanitized).toContain("[REDACTED_AWS_KEY]");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    // Note: sanitizeError only redacts secrets, not path information
    expect(sanitized).toContain("etc/passwd");
  });
});
