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

import {
  classifyTestTheme,
  classifyBackendType,
} from "../utils/test-parser.ts";

const SDK_PATH = new URL("../../../sdk", import.meta.url).pathname;
const OUTPUT_DIR = new URL("../../app/public/dashboard/", import.meta.url).pathname;

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const FILE_HEADER = /^running \d+ tests? from (.+\.test\.ts)/;
const TEST_RESULT = /^(.+?)\s+\.\.\.+\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;

interface TestResult {
  name: string;
  file: string;
  filePath: string;
  theme: string;
  backend: string;
  status: string;
  duration?: number;
  lastRun: number;
}

async function discoverTestFiles(): Promise<string[]> {
  const files: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);

  async function walk(dir: string) {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory && skipDirs.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isFile && entry.name.endsWith(".test.ts")) {
        files.push(full);
      } else if (entry.isDirectory) {
        await walk(full);
      }
    }
  }

  await walk(SDK_PATH);
  return files;
}

function filterTestFiles(files: string[]): { run: string[]; skip: string[] } {
  const hasPostgres = Boolean(Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL"));
  const hasMongo = Boolean(Deno.env.get("MONGODB_URL"));

  const run: string[] = [];
  const skip: string[] = [];

  for (const file of files) {
    const name = file.split("/").pop() || "";
    if (file.includes("/browser/") || name === "websocket-client.test.ts") {
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

async function main() {
  console.log("Building dashboard artifacts...");

  const allFiles = await discoverTestFiles();
  const { run, skip } = filterTestFiles(allFiles);
  console.log(`Running ${run.length} test files, skipping ${skip.length}`);
  if (skip.length > 0) console.log(`Skipped: ${skip.join(", ")}`);

  const startedAt = Date.now();

  // Run deno test and capture output (5 minute timeout)
  const cmd = new Deno.Command("deno", {
    args: ["test", "-A", "--no-check", ...run],
    cwd: SDK_PATH,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  const completedAt = Date.now();

  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  const rawOutput = stdout + (stderr ? "\n" + stderr : "");

  // Parse results
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
        : `${SDK_PATH}/${rel.replace(/^\.\//, "")}`;
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

      results.push({
        name: name.trim(),
        file: currentFile,
        filePath: currentFilePath,
        theme: classifyTestTheme(currentFilePath),
        backend: classifyBackendType(currentFilePath),
        status: result === "ok" ? "passed" : result === "FAILED" ? "failed" : "skipped",
        duration,
        lastRun: completedAt,
      });
    }
  }

  // Build summary
  let passed = 0, failed = 0, skipped = 0, totalDuration = 0;
  for (const r of results) {
    if (r.status === "passed") passed++;
    else if (r.status === "failed") failed++;
    else if (r.status === "skipped") skipped++;
    if (r.duration) totalDuration += r.duration;
  }

  // Build file info
  const fileMap = new Map<string, { path: string; name: string; theme: string; backend: string; status: string; testCount: number }>();
  for (const r of results) {
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
    generatedAt: completedAt,
    runMetadata: {
      trigger: "build",
      startedAt,
      completedAt,
      environment: {
        deno: Deno.version.deno,
        platform: Deno.build.os,
        hasPostgres: Boolean(Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL")),
        hasMongo: Boolean(Deno.env.get("MONGODB_URL")),
      },
    },
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      duration: totalDuration,
    },
    results,
    files: Array.from(fileMap.values()),
  };

  // Write artifacts
  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  await Deno.writeTextFile(
    `${OUTPUT_DIR}/test-results.json`,
    JSON.stringify(artifact, null, 2)
  );
  await Deno.writeTextFile(`${OUTPUT_DIR}/test-logs.txt`, rawOutput);

  console.log(`\nArtifacts written to: ${OUTPUT_DIR}`);
  console.log(`  test-results.json (${results.length} tests)`);
  console.log(`  test-logs.txt (${rawOutput.split("\n").length} lines)`);
  console.log(`  Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`  Exit code: ${output.code}`);

  Deno.exit(output.code);
}

main();
