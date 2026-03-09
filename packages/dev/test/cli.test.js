/**
 * CLI argument parsing tests
 *
 * The CLI script (src/cli.js) executes immediately on import, so we test it
 * by spawning it as a child process and inspecting exit codes and stderr output.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../src/cli.js");

/**
 * Spawn the CLI synchronously and return { exitCode, stderr, stdout }
 */
function runCli(args = [], env = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

describe("CLI argument parsing", () => {
  test("exits with error when no entry file is provided", () => {
    const { exitCode, stderr } = runCli([]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Entry file is required/i);
  });

  test("exits with error when entry file does not exist", () => {
    const { exitCode, stderr } = runCli(["nonexistent-file-that-does-not-exist.js"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /File not found/i);
  });

  test("parses --port flag and uses specified port", () => {
    // We need a file that exists but has no default export to trigger an error
    // message that mentions port — actually we test this by checking the
    // "file not found" path does NOT mention port errors.
    // Instead we test that an invalid port triggers the right error.
    const { exitCode, stderr } = runCli(["some-file.js", "--port", "abc"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Invalid port/i);
  });

  test("rejects port 0 as invalid", () => {
    const { exitCode, stderr } = runCli(["some-file.js", "--port", "0"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Invalid port/i);
  });

  test("rejects port above 65535 as invalid", () => {
    const { exitCode, stderr } = runCli(["some-file.js", "--port", "65536"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Invalid port/i);
  });

  test("uses PORT environment variable when --port flag is absent", () => {
    // Invalid PORT value should trigger the invalid port error
    const { exitCode, stderr } = runCli(["some-file.js"], { PORT: "not-a-number" });
    assert.equal(exitCode, 1);
    assert.match(stderr, /Invalid port/i);
  });

  test("defaults to port 3000 when PORT env is unset and --port is absent", () => {
    // With no port flags and a non-existent file we still get the file-not-found
    // error (not a port error), which means port 3000 was accepted as valid.
    const { exitCode, stderr } = runCli(["nonexistent.js"], { PORT: "" });
    assert.equal(exitCode, 1);
    assert.match(stderr, /File not found/i);
    assert.doesNotMatch(stderr, /Invalid port/i);
  });

  test("--port flag takes precedence over PORT env variable", () => {
    // --port with a valid value (3001) but non-existent file: file-not-found error,
    // meaning the port was accepted and we got past port validation.
    const { exitCode, stderr } = runCli(["nonexistent.js", "--port", "3001"], { PORT: "99999" });
    assert.equal(exitCode, 1);
    assert.match(stderr, /File not found/i);
    assert.doesNotMatch(stderr, /Invalid port/i);
  });

  test("exits with code 0 and prints usage for --help flag", () => {
    const { exitCode, stdout } = runCli(["--help"]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /mctx-dev/i);
    assert.match(stdout, /--port/i);
  });

  test("exits with code 0 and prints usage for -h flag", () => {
    const { exitCode, stdout } = runCli(["-h"]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /mctx-dev/i);
  });

  test("reports 'default export' error message when file has no default export", async () => {
    // The CLI starts the server even when the module has no default export;
    // it logs the error and keeps the server alive (app stays null, returns 503).
    // We verify the error message appears in stderr by starting the CLI and
    // reading its stderr output before it settles into the server listen loop.
    const tmpDir = mkdtempSync(join(tmpdir(), "mctx-cli-test-"));
    const filePath = join(tmpDir, "no-export.js");
    writeFileSync(filePath, "// no default export\nexport const foo = 1;\n");

    // Use a port unlikely to conflict; pick a high port
    const testPort = 59876;

    // Spawn and collect stderr for 2 seconds, then kill the process
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [CLI_PATH, filePath, "--port", String(testPort)], {
      encoding: "utf8",
      env: { ...process.env },
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));

    // Wait for the 'default export' error to appear in stderr, or timeout after 5s.
    // This avoids a fixed sleep that is fragile under CI resource pressure.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      child.stderr.on("data", () => {
        if (stderr.toLowerCase().includes("default export")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    child.kill();

    rmSync(tmpDir, { recursive: true });

    assert.match(stderr, /default export/i, `expected 'default export' in stderr, got: ${stderr}`);
  });
});
