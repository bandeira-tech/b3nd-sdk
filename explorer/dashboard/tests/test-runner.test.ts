/**
 * Test the test runner to verify it correctly parses Deno test output
 */
import { assertEquals, assertExists } from "@std/assert";

// Import the stripAnsi function and patterns by testing the module
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const FILE_HEADER_PATTERN = /^running \d+ tests? from \.\/tests\/(.+\.test\.ts)/;
const TEST_RESULT_PATTERN = /^(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;

function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, "");
}

Deno.test("stripAnsi removes color codes", () => {
  const input = "\x1b[0m\x1b[38;5;245mrunning 13 tests from ./tests/binary-operations.test.ts\x1b[0m";
  const expected = "running 13 tests from ./tests/binary-operations.test.ts";
  assertEquals(stripAnsi(input), expected);
});

Deno.test("FILE_HEADER_PATTERN matches file header", () => {
  const line = "running 13 tests from ./tests/binary-operations.test.ts";
  const match = line.match(FILE_HEADER_PATTERN);
  assertExists(match);
  assertEquals(match[1], "binary-operations.test.ts");
});

Deno.test("TEST_RESULT_PATTERN matches ok result", () => {
  const line = "Binary Operations - setup ... ok (1ms)";
  const match = line.match(TEST_RESULT_PATTERN);
  assertExists(match);
  assertEquals(match[1], "Binary Operations - setup");
  assertEquals(match[2], "ok");
  assertEquals(match[3], "1");
  assertEquals(match[4], "ms");
});

Deno.test("TEST_RESULT_PATTERN matches FAILED result", () => {
  const line = "Some failing test ... FAILED (50ms)";
  const match = line.match(TEST_RESULT_PATTERN);
  assertExists(match);
  assertEquals(match[1], "Some failing test");
  assertEquals(match[2], "FAILED");
});

Deno.test("TEST_RESULT_PATTERN matches ignored result", () => {
  const line = "Skipped test ... ignored";
  const match = line.match(TEST_RESULT_PATTERN);
  assertExists(match);
  assertEquals(match[1], "Skipped test");
  assertEquals(match[2], "ignored");
});

Deno.test("Full pipeline: strip ANSI then match", () => {
  const rawLine = "\x1b[0mBinary - write and read PNG image ... \x1b[32mok\x1b[0m \x1b[38;5;245m(11ms)\x1b[0m";
  const clean = stripAnsi(rawLine).trim();
  const match = clean.match(TEST_RESULT_PATTERN);
  assertExists(match);
  assertEquals(match[1], "Binary - write and read PNG image");
  assertEquals(match[2], "ok");
  assertEquals(match[3], "11");
});

// Integration test: actually run deno test and verify we can parse output
Deno.test("Integration: parse actual deno test output", async () => {
  const command = new Deno.Command("deno", {
    args: ["test", "-A", "--filter=MemoryClient - receive transaction and read", "tests/memory-client.test.ts"],
    cwd: new URL("../../../sdk", import.meta.url).pathname,
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();
  const decoder = new TextDecoder();

  let stdout = "";
  const reader = process.stdout.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();

  // Also read stderr
  let stderr = "";
  const stderrReader = process.stderr.getReader();
  while (true) {
    const { value, done } = await stderrReader.read();
    if (done) break;
    stderr += decoder.decode(value, { stream: true });
  }
  stderrReader.releaseLock();

  await process.status;

  const allOutput = stdout + stderr;
  const lines = allOutput.split("\n");

  let foundFile = false;
  let foundResult = false;

  for (const line of lines) {
    const clean = stripAnsi(line).trim();
    if (FILE_HEADER_PATTERN.test(clean)) {
      foundFile = true;
    }
    if (TEST_RESULT_PATTERN.test(clean)) {
      foundResult = true;
    }
  }

  assertEquals(foundFile, true, "Should find file header in output");
  assertEquals(foundResult, true, "Should find test result in output");
});
