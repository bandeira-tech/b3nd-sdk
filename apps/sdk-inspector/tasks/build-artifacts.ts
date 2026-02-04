/// <reference lib="deno.ns" />
/**
 * Build static dashboard artifacts
 *
 * Runs `deno test` directly and parses the output to generate
 * static JSON artifacts for the frontend.
 *
 * Usage:
 *   deno task dashboard:build
 */

import { load as loadEnv } from "@std/dotenv";
import {
  classifyBackendType,
  classifyTestTheme,
} from "../utils/test-parser.ts";

const DASHBOARD_ROOT = new URL("..", import.meta.url).pathname;
const LIBS_PATH = new URL("../../../libs", import.meta.url).pathname;
const E2E_PATH = new URL("../../../tests", import.meta.url).pathname;
const OUTPUT_DIR =
  new URL("../../b3nd-web-rig/public/dashboard/", import.meta.url).pathname;

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const FILE_HEADER = /^running \d+ tests? from (.+\.test\.ts)/;
const TEST_RESULT =
  /^(.+?)\s+\.\.\.+\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;

interface TestResult {
  name: string;
  file: string;
  filePath: string;
  theme: string;
  backend: string;
  status: string;
  duration?: number;
  lastRun: number;
  source?: string;
  sourceFile?: string;
  sourceStartLine?: number;
}

// =============================================================================
// Source Code Extraction
// =============================================================================

interface ExtractedTest {
  name: string;
  isTemplate: boolean;
  source: string;
  sourceFile: string;
  startLine: number;
}

/**
 * Extract all Deno.test() and t.step() blocks from a source file.
 * Uses paren counting to find the end of each test block.
 */
function extractTestBlocks(content: string, filePath: string): ExtractedTest[] {
  const lines = content.split("\n");
  const tests: ExtractedTest[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Match Deno.test( or t.step( / await t.step(
    const denoTestIdx = trimmed.indexOf("Deno.test(");
    const stepMatch = trimmed.match(/(?:await\s+)?t\.step\(/);
    const testIdx = denoTestIdx >= 0
      ? denoTestIdx
      : stepMatch
      ? trimmed.indexOf(stepMatch[0])
      : -1;
    const marker = denoTestIdx >= 0
      ? "Deno.test("
      : stepMatch
      ? stepMatch[0]
      : null;
    if (testIdx === -1 || !marker) continue;
    // Must be the main statement (not inside a comment or string)
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Find the matching closing ) by counting parens from the opening (
    let depth = 0;
    let started = false;
    let endLine = i;
    let inString: string | null = null;

    outer:
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      for (
        let k = j === i ? lines[i].indexOf(marker) : 0;
        k < line.length;
        k++
      ) {
        const ch = line[k];

        // Handle string tracking (skip contents)
        if (inString) {
          if (ch === inString && line[k - 1] !== "\\") {
            inString = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        // Skip line comments
        if (ch === "/" && line[k + 1] === "/") break;

        if (ch === "(") {
          depth++;
          started = true;
        } else if (ch === ")") {
          depth--;
          if (started && depth === 0) {
            endLine = j;
            break outer;
          }
        }
      }
    }

    const source = lines.slice(i, endLine + 1).join("\n");

    // Extract test name
    let name = "";
    let isTemplate = false;

    // Pattern 1: Deno.test("name", ...) or Deno.test('name', ...)
    const literalMatch = source.match(/Deno\.test\(\s*["']([^"']+)["']/);
    // Pattern 1b: t.step("name", ...) or await t.step("name", ...)
    const stepLiteral = source.match(/t\.step\(\s*["']([^"']+)["']/);
    // Pattern 2: Deno.test(`...`, ...) — template literal
    const templateMatch = source.match(/Deno\.test\(\s*`([^`]+)`/);
    // Pattern 2b: t.step(`...`, ...)
    const stepTemplate = source.match(/t\.step\(\s*`([^`]+)`/);
    // For object form, only search the header (first 300 chars) to avoid
    // matching `name: "Alice"` in the test body
    const header = source.slice(0, 300);
    // Pattern 3: Deno.test({ name: `...`, ... }) — template in object (check first!)
    const objTemplate = header.match(/name:\s*`([^`]+)`/);
    // Pattern 4: Deno.test({ name: "name", ... }) — literal in object
    const objLiteral = header.match(/name:\s*["']([^"']+)["']/);

    if (literalMatch) {
      name = literalMatch[1];
    } else if (stepLiteral) {
      name = stepLiteral[1];
    } else if (templateMatch) {
      name = templateMatch[1];
      isTemplate = true;
    } else if (stepTemplate) {
      name = stepTemplate[1];
      isTemplate = true;
    } else if (objTemplate) {
      name = objTemplate[1];
      isTemplate = true;
    } else if (objLiteral) {
      name = objLiteral[1];
    }

    if (name) {
      tests.push({
        name,
        isTemplate,
        source,
        sourceFile: filePath,
        startLine: i + 1,
      });
    }

    // Skip past this block
    i = endLine;
  }

  return tests;
}

/**
 * Check if a filename contains test definitions (test files + suite files).
 */
function isTestSourceFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith("-suite.ts");
}

/**
 * Discover all source files that contain test definitions.
 * Includes .test.ts files and *-suite.ts files (shared test suites with template tests).
 */
async function discoverSourceFiles(): Promise<string[]> {
  const files: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);

  async function walk(dir: string) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory && skipDirs.has(entry.name)) continue;
        const full = `${dir}/${entry.name}`;
        if (entry.isFile && isTestSourceFile(entry.name)) {
          files.push(full);
        } else if (entry.isDirectory) {
          await walk(full);
        }
      }
    } catch { /* directory may not exist */ }
  }

  // Walk all b3nd-* lib directories
  try {
    for await (const entry of Deno.readDir(LIBS_PATH)) {
      if (entry.isDirectory && entry.name.startsWith("b3nd-")) {
        await walk(`${LIBS_PATH}/${entry.name}`);
      }
    }
  } catch { /* libs directory may not exist */ }
  await walk(E2E_PATH);
  return files;
}

/**
 * Build an index of test name → source code
 */
async function buildSourceIndex(): Promise<
  Map<string, { source: string; sourceFile: string; startLine: number }>
> {
  const sourceFiles = await discoverSourceFiles();
  const allBlocks: ExtractedTest[] = [];

  for (const filePath of sourceFiles) {
    try {
      const content = await Deno.readTextFile(filePath);
      const blocks = extractTestBlocks(content, filePath);
      allBlocks.push(...blocks);
    } catch {
      // Skip unreadable files
    }
  }

  const index = new Map<
    string,
    { source: string; sourceFile: string; startLine: number }
  >();

  // First pass: index literal (non-template) names
  for (const block of allBlocks) {
    if (!block.isTemplate) {
      index.set(block.name, {
        source: block.source,
        sourceFile: block.sourceFile,
        startLine: block.startLine,
      });
    }
  }

  // Second pass: for template names, create regex patterns
  const templateBlocks = allBlocks.filter((b) => b.isTemplate);

  return {
    get(testName: string) {
      // Exact match first
      const exact = index.get(testName);
      if (exact) return exact;

      // Try template matching
      for (const block of templateBlocks) {
        // Replace ${...} with (.+) to create a regex
        const pattern = block.name
          .replace(/\$\{[^}]+\}/g, "(.+)")
          .replace(
            /[.*+?^${}()|[\]\\]/g,
            (m) =>
              m === "(" || m === ")" || m === "." && block.name.includes("(.+)")
                ? m
                : "\\" + m,
          );

        // Simpler approach: replace ${...} with a wildcard
        const escaped = block.name
          .replace(/\$\{[^}]+\}/g, "___WILDCARD___")
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/___WILDCARD___/g, ".+");

        const regex = new RegExp(`^${escaped}$`);
        if (regex.test(testName)) {
          return {
            source: block.source,
            sourceFile: block.sourceFile,
            startLine: block.startLine,
          };
        }
      }

      return undefined;
    },
    set: index.set.bind(index),
  } as Map<string, { source: string; sourceFile: string }>;
}

// =============================================================================
// Test Discovery & Filtering
// =============================================================================

async function discoverTestFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);

  async function walk(d: string) {
    try {
      for await (const entry of Deno.readDir(d)) {
        if (entry.isDirectory && skipDirs.has(entry.name)) continue;
        const full = `${d}/${entry.name}`;
        if (entry.isFile && entry.name.endsWith(".test.ts")) {
          files.push(full);
        } else if (entry.isDirectory) {
          await walk(full);
        }
      }
    } catch { /* directory may not exist */ }
  }

  await walk(dir);
  return files;
}

function filterSdkTestFiles(
  files: string[],
): { run: string[]; skip: string[] } {
  const hasPostgres = Boolean(
    Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL"),
  );
  const hasMongo = Boolean(Deno.env.get("MONGODB_URL"));

  const run: string[] = [];
  const skip: string[] = [];

  for (const file of files) {
    const name = file.split("/").pop() || "";
    if (
      file.includes("/browser/") || name === "websocket-client.test.ts" ||
      name === "indexed-db-client.test.ts" ||
      name === "local-storage-client.test.ts"
    ) {
      skip.push(name);
    } else if (name === "postgres-client.test.ts" && !hasPostgres) {
      skip.push(name);
    } else if (name === "mongo-client.test.ts" && !hasMongo) {
      skip.push(name);
    } else {
      run.push(file);
    }
  }

  return { run, skip };
}

// =============================================================================
// Main
// =============================================================================

/**
 * Run `deno test` in a directory, parse output, and return results.
 */
async function runAndParse(
  files: string[],
  cwd: string,
  sourceIndex: Map<
    string,
    { source: string; sourceFile: string; startLine: number }
  >,
  completedAt: number,
): Promise<
  { results: TestResult[]; stdout: string; stderr: string; exitCode: number }
> {
  const cmd = new Deno.Command("deno", {
    args: ["test", "-A", "--no-check", ...files],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  const results: TestResult[] = [];
  let currentFile = "";
  let currentFilePath = "";

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(ANSI_PATTERN, "").trim();
    if (!line) continue;

    const fileMatch = line.match(FILE_HEADER);
    if (fileMatch) {
      const rel = fileMatch[1];
      currentFile = rel.split("/").pop() || rel;
      currentFilePath = rel.startsWith("/")
        ? rel
        : `${cwd}/${rel.replace(/^\.\//, "")}`;
      continue;
    }

    const resultMatch = line.match(TEST_RESULT);
    if (resultMatch) {
      const [, name, result, durStr, durUnit] = resultMatch;
      let duration: number | undefined;
      if (durStr) {
        duration = parseInt(durStr, 10);
        if (durUnit === "s") duration *= 1000;
      }

      const testName = name.trim();
      const sourceInfo = sourceIndex.get(testName);

      results.push({
        name: testName,
        file: currentFile,
        filePath: currentFilePath,
        theme: classifyTestTheme(currentFilePath),
        backend: classifyBackendType(currentFilePath),
        status: result === "ok"
          ? "passed"
          : result === "FAILED"
          ? "failed"
          : "skipped",
        duration,
        lastRun: completedAt,
        source: sourceInfo?.source,
        sourceFile: sourceInfo?.sourceFile,
        sourceStartLine: sourceInfo?.startLine,
      });
    }
  }

  return { results, stdout, stderr, exitCode: output.code };
}

async function main() {
  console.log("Building dashboard artifacts...");

  // Load .env from dashboard root
  try {
    await loadEnv({ envPath: `${DASHBOARD_ROOT}/.env`, export: true });
    console.log("Loaded .env configuration");
  } catch {
    console.log("No .env file found, using environment variables");
  }

  // Discover lib and E2E test files separately
  const libFiles: string[] = [];
  try {
    for await (const entry of Deno.readDir(LIBS_PATH)) {
      if (entry.isDirectory && entry.name.startsWith("b3nd-")) {
        const files = await discoverTestFiles(`${LIBS_PATH}/${entry.name}`);
        libFiles.push(...files);
      }
    }
  } catch { /* libs directory may not exist */ }
  const e2eFiles = await discoverTestFiles(E2E_PATH);
  const { run: sdkRun, skip } = filterSdkTestFiles(libFiles);

  console.log(
    `SDK: ${sdkRun.length} test files to run, ${skip.length} skipped`,
  );
  if (skip.length > 0) console.log(`  Skipped: ${skip.join(", ")}`);
  console.log(`E2E: ${e2eFiles.length} test files to run`);

  // Build source index in parallel with running tests
  const sourceIndexPromise = buildSourceIndex();

  const startedAt = Date.now();

  // Run SDK tests
  const sourceIndex = await sourceIndexPromise;
  const completedAt = Date.now();

  let maxExitCode = 0;
  const allResults: TestResult[] = [];
  let rawOutput = "";

  // Run lib tests (cwd: libs/)
  if (sdkRun.length > 0) {
    console.log(`\nRunning ${sdkRun.length} lib test files...`);
    const sdk = await runAndParse(sdkRun, LIBS_PATH, sourceIndex, Date.now());
    allResults.push(...sdk.results);
    rawOutput += sdk.stdout + (sdk.stderr ? "\n" + sdk.stderr : "");
    if (sdk.exitCode > maxExitCode) maxExitCode = sdk.exitCode;
    console.log(
      `  SDK: ${sdk.results.length} tests (exit code: ${sdk.exitCode})`,
    );
  }

  // Run E2E tests (cwd: tests/ — separate deno.json scope)
  if (e2eFiles.length > 0) {
    console.log(`\nRunning ${e2eFiles.length} E2E test files...`);
    const e2e = await runAndParse(e2eFiles, E2E_PATH, sourceIndex, Date.now());
    allResults.push(...e2e.results);
    rawOutput += (rawOutput ? "\n" : "") + e2e.stdout +
      (e2e.stderr ? "\n" + e2e.stderr : "");
    if (e2e.exitCode > maxExitCode) maxExitCode = e2e.exitCode;
    console.log(
      `  E2E: ${e2e.results.length} tests (exit code: ${e2e.exitCode})`,
    );
  }

  const finalCompletedAt = Date.now();

  // Build summary
  let passed = 0, failed = 0, skipped = 0, totalDuration = 0;
  for (const r of allResults) {
    if (r.status === "passed") passed++;
    else if (r.status === "failed") failed++;
    else if (r.status === "skipped") skipped++;
    if (r.duration) totalDuration += r.duration;
  }

  // Build file info
  const fileMap = new Map<
    string,
    {
      path: string;
      name: string;
      theme: string;
      backend: string;
      status: string;
      testCount: number;
    }
  >();
  for (const r of allResults) {
    const existing = fileMap.get(r.filePath);
    if (!existing) {
      fileMap.set(r.filePath, {
        path: r.filePath,
        name: r.file,
        theme: r.theme,
        backend: r.backend,
        status: r.status,
        testCount: 1,
      });
    } else {
      existing.testCount++;
      if (r.status === "failed") existing.status = "failed";
    }
  }

  const artifact = {
    version: "1.0",
    generatedAt: finalCompletedAt,
    runMetadata: {
      trigger: "build",
      startedAt,
      completedAt: finalCompletedAt,
      environment: {
        deno: Deno.version.deno,
        platform: Deno.build.os,
        hasPostgres: Boolean(
          Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL"),
        ),
        hasMongo: Boolean(Deno.env.get("MONGODB_URL")),
      },
    },
    summary: {
      total: allResults.length,
      passed,
      failed,
      skipped,
      duration: totalDuration,
    },
    results: allResults,
    files: Array.from(fileMap.values()),
  };

  // Write artifacts
  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  await Deno.writeTextFile(
    `${OUTPUT_DIR}/test-results.json`,
    JSON.stringify(artifact, null, 2),
  );
  await Deno.writeTextFile(`${OUTPUT_DIR}/test-logs.txt`, rawOutput);

  // Count how many tests have source
  const withSource = allResults.filter((r) => r.source).length;

  console.log(`\nArtifacts written to: ${OUTPUT_DIR}`);
  console.log(
    `  test-results.json (${allResults.length} tests, ${withSource} with source)`,
  );
  console.log(`  test-logs.txt (${rawOutput.split("\n").length} lines)`);
  console.log(
    `  Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );
  console.log(`  Exit code: ${maxExitCode}`);

  Deno.exit(maxExitCode);
}

main();
