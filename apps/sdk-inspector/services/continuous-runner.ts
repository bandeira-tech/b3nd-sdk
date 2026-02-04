/// <reference lib="deno.ns" />
/**
 * ContinuousTestRunner - Runs tests automatically
 *
 * - Runs all tests on server startup
 * - Re-runs affected tests when files change
 * - Updates TestState with results
 */

import { TestState } from "./test-state.ts";
import { WsHub } from "./ws-hub.ts";
import {
  classifyBackendType,
  classifyTestTheme,
} from "../utils/test-parser.ts";

// Regex to strip ANSI color codes
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Regex patterns to parse Deno test output
const FILE_HEADER_PATTERN = /^running \d+ tests? from (.+\.test\.ts)/;
const TEST_RESULT_PATTERN =
  /^(.+?)\s+\.\.\.+\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;

function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, "");
}

export class ContinuousTestRunner {
  private testState: TestState;
  private wsHub: WsHub;
  private libsPath: string;
  private integE2ePath: string;
  private currentProcess: Deno.ChildProcess | null = null;
  private testFiles: string[] = [];

  constructor(testState: TestState, wsHub: WsHub) {
    this.testState = testState;
    this.wsHub = wsHub;

    // Determine paths relative to dashboard (apps/sdk-inspector/services -> b3nd root)
    const dashboardDir = new URL(".", import.meta.url).pathname;
    this.libsPath = new URL("../../../libs", `file://${dashboardDir}`).pathname;
    this.integE2ePath =
      new URL("../../../tests", `file://${dashboardDir}`).pathname;
  }

  /**
   * Discover all test files
   */
  async discoverTests(): Promise<string[]> {
    const testFiles: string[] = [];
    const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);

    const walkDir = async (dir: string): Promise<void> => {
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isDirectory && skipDirs.has(entry.name)) {
            continue;
          }

          const fullPath = `${dir}/${entry.name}`;
          if (entry.isFile && entry.name.endsWith(".test.ts")) {
            testFiles.push(fullPath);
          } else if (entry.isDirectory) {
            await walkDir(fullPath);
          }
        }
      } catch (e) {
        console.error(`[ContinuousRunner] Failed to read directory ${dir}:`, e);
      }
    };

    // Walk all b3nd-* lib directories for test files
    try {
      for await (const entry of Deno.readDir(this.libsPath)) {
        if (entry.isDirectory && entry.name.startsWith("b3nd-")) {
          await walkDir(`${this.libsPath}/${entry.name}`);
        }
      }
    } catch (e) {
      console.error(`[ContinuousRunner] Failed to read libs directory:`, e);
    }
    await walkDir(this.integE2ePath);
    return testFiles;
  }

  /**
   * Initialize and run all tests
   */
  async start(): Promise<void> {
    console.log("[ContinuousRunner] Discovering test files...");
    this.testFiles = await this.discoverTests();
    console.log(`[ContinuousRunner] Found ${this.testFiles.length} test files`);

    // Initialize state with all files
    this.testState.initializeFiles(this.testFiles);

    // Run all tests
    console.log("[ContinuousRunner] Running initial test suite...");
    await this.runAllTests("startup");
  }

  /**
   * Check if a file is an E2E test (lives under integ/)
   */
  private isE2eTest(file: string): boolean {
    return file.startsWith(this.integE2ePath);
  }

  /**
   * Run all tests
   */
  async runAllTests(
    trigger: "startup" | "file-change" | "manual" = "manual",
    changedFiles?: string[],
  ): Promise<void> {
    const hasPostgres = Boolean(
      Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL"),
    );
    const hasMongo = Boolean(Deno.env.get("MONGODB_URL"));

    console.log(
      `[ContinuousRunner] Database config: postgres=${hasPostgres}, mongo=${hasMongo}`,
    );

    // Separate SDK tests from E2E tests (different cwd needed)
    const sdkTestsToRun: string[] = [];
    const e2eTestsToRun: string[] = [];
    const testsToSkip: string[] = [];

    for (const file of this.testFiles) {
      const name = file.split("/").pop() || "";

      // E2E tests go into their own group
      if (this.isE2eTest(file)) {
        e2eTestsToRun.push(file);
        continue;
      }

      // Skip browser tests (need browser environment)
      if (
        file.includes("/browser/") || name === "indexed-db-client.test.ts" ||
        name === "local-storage-client.test.ts"
      ) {
        testsToSkip.push(name);
        continue;
      }

      // Skip websocket tests (need running server)
      if (name === "websocket-client.test.ts") {
        testsToSkip.push(name);
        continue;
      }

      // Skip postgres if not configured
      if (name === "postgres-client.test.ts" && !hasPostgres) {
        testsToSkip.push(name);
        continue;
      }

      // Skip mongo if not configured
      if (name === "mongo-client.test.ts" && !hasMongo) {
        testsToSkip.push(name);
        continue;
      }

      sdkTestsToRun.push(file);
    }

    console.log(
      `[ContinuousRunner] Running ${sdkTestsToRun.length} SDK + ${e2eTestsToRun.length} E2E test files, skipping ${testsToSkip.length}`,
    );
    if (testsToSkip.length > 0) {
      console.log(`[ContinuousRunner] Skipped: ${testsToSkip.join(", ")}`);
    }

    this.testState.startRun(trigger, changedFiles);

    // Run SDK tests (cwd: sdk/)
    if (sdkTestsToRun.length > 0) {
      const args = ["test", "-A", ...sdkTestsToRun];
      await this.runTestCommand(args, this.libsPath);
    }

    // Run E2E tests (cwd: integ/e2e/ — separate deno.json scope)
    if (e2eTestsToRun.length > 0) {
      const args = ["test", "-A", ...e2eTestsToRun];
      await this.runTestCommand(args, this.integE2ePath);
    }

    this.testState.completeRun();
  }

  /**
   * Run tests for specific files
   */
  async runTestFiles(
    files: string[],
    trigger: "startup" | "file-change" | "manual" = "manual",
    changedFiles?: string[],
  ): Promise<void> {
    if (files.length === 0) return;

    this.testState.startRun(trigger, changedFiles);

    for (const file of files) {
      this.testState.markFileRunning(file);
    }

    // Group files by scope
    const sdkFiles = files.filter((f) => !this.isE2eTest(f));
    const e2eFiles = files.filter((f) => this.isE2eTest(f));

    if (sdkFiles.length > 0) {
      await this.runTestCommand(["test", "-A", ...sdkFiles], this.libsPath);
    }
    if (e2eFiles.length > 0) {
      await this.runTestCommand(["test", "-A", ...e2eFiles], this.integE2ePath);
    }

    this.testState.completeRun();
  }

  /**
   * Run a deno test command and parse output
   */
  private async runTestCommand(
    args: string[],
    cwd: string = this.libsPath,
  ): Promise<void> {
    // Stop any existing run before starting a new one
    if (this.currentProcess) {
      console.log("[ContinuousRunner] Stopping previous test run...");
      this.stop();
    }

    console.log(`[ContinuousRunner] Running: deno ${args.join(" ")}`);

    this.wsHub.broadcast({
      type: "run:start",
      timestamp: Date.now(),
    });

    try {
      const command = new Deno.Command("deno", {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      });

      const process = command.spawn();
      this.currentProcess = process;

      let currentFile = "";
      let currentFilePath = "";
      const seenFiles = new Set<string>(); // Track all files we've seen
      const decoder = new TextDecoder();
      const startTime = Date.now();

      const readStream = async (
        stream: ReadableStream<Uint8Array>,
      ): Promise<void> => {
        const reader = stream.getReader();
        let buffer = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim()) this.testState.appendLog(line);
              this.parseLine(line, (file, path) => {
                // Complete previous file when switching to new one
                if (currentFilePath && currentFilePath !== path) {
                  this.testState.completeFileRun(currentFilePath);
                }
                currentFile = file;
                currentFilePath = path;
                seenFiles.add(path);
              }, () => ({ file: currentFile, path: currentFilePath }));
            }
          }

          if (buffer.trim()) {
            this.testState.appendLog(buffer);
            this.parseLine(buffer, (file, path) => {
              if (currentFilePath && currentFilePath !== path) {
                this.testState.completeFileRun(currentFilePath);
              }
              currentFile = file;
              currentFilePath = path;
              seenFiles.add(path);
            }, () => ({ file: currentFile, path: currentFilePath }));
          }
        } finally {
          reader.releaseLock();
        }
      };

      await Promise.all([
        readStream(process.stdout),
        readStream(process.stderr),
      ]);

      const status = await process.status;
      const duration = Date.now() - startTime;

      // Mark all seen files as complete
      for (const filePath of seenFiles) {
        this.testState.completeFileRun(filePath);
      }

      this.wsHub.broadcast({
        type: "run:complete",
        exitCode: status.code,
        duration,
        summary: this.testState.getSummary(),
        timestamp: Date.now(),
      });

      console.log(
        `[ContinuousRunner] Test run completed (exit code: ${status.code}, files: ${seenFiles.size})`,
      );
    } catch (error) {
      console.error("[ContinuousRunner] Error running tests:", error);
      this.wsHub.broadcast({
        type: "run:error",
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    } finally {
      this.currentProcess = null;
    }
  }

  /**
   * Resolve a test file path from Deno's output against known base directories
   */
  private resolveTestPath(relativePath: string): string {
    if (relativePath.startsWith("/")) {
      return relativePath;
    }

    const cleaned = relativePath.replace(/^\.\//, "");

    // Check if this file exists under integE2ePath
    const e2eCandidate = `${this.integE2ePath}/${cleaned}`;
    const sdkCandidate = `${this.libsPath}/${cleaned}`;

    // Prefer the path that matches a known test file
    for (const file of this.testFiles) {
      if (file === e2eCandidate) return e2eCandidate;
      if (file === sdkCandidate) return sdkCandidate;
    }

    // Default to sdk path for backwards compatibility
    return sdkCandidate;
  }

  /**
   * Parse a line of test output
   */
  private parseLine(
    line: string,
    setCurrentFile: (file: string, path: string) => void,
    getCurrentFile: () => { file: string; path: string },
  ): void {
    const clean = stripAnsi(line).trim();
    if (!clean) return;

    // Check for file header
    const fileMatch = clean.match(FILE_HEADER_PATTERN);
    if (fileMatch) {
      const relativePath = fileMatch[1];
      const fullPath = this.resolveTestPath(relativePath);

      setCurrentFile(relativePath.split("/").pop() || relativePath, fullPath);
      this.testState.markFileRunning(fullPath);
      console.log(`[ContinuousRunner] Running tests from: ${relativePath}`);
      return;
    }

    // Check for test result
    const resultMatch = clean.match(TEST_RESULT_PATTERN);
    if (resultMatch) {
      const [, name, result, durationStr, durationUnit] = resultMatch;
      const { file, path } = getCurrentFile();

      let status: "passed" | "failed" | "skipped";
      switch (result) {
        case "ok":
          status = "passed";
          break;
        case "FAILED":
          status = "failed";
          break;
        case "ignored":
          status = "skipped";
          break;
        default:
          status = "failed";
      }

      let duration: number | undefined;
      if (durationStr) {
        duration = parseInt(durationStr, 10);
        if (durationUnit === "s") duration *= 1000;
      }

      this.testState.updateTestResult({
        name: name.trim(),
        file,
        filePath: path,
        status,
        duration,
      });
    }
  }

  /**
   * Handle file change - determine which tests to re-run
   */
  async onFileChange(changedFiles: string[]): Promise<void> {
    const testsToRun: string[] = [];

    for (const file of changedFiles) {
      // If it's a test file, re-run it
      if (file.endsWith(".test.ts")) {
        testsToRun.push(file);
      } else {
        // If it's a source file, find related tests
        // Simple heuristic: re-run tests in the same directory or with similar names
        const baseName = file.split("/").pop()?.replace(".ts", "") || "";

        for (const testFile of this.testFiles) {
          if (
            testFile.includes(baseName) || this.isRelatedTest(file, testFile)
          ) {
            testsToRun.push(testFile);
          }
        }
      }
    }

    if (testsToRun.length > 0) {
      console.log(
        `[ContinuousRunner] Re-running ${testsToRun.length} tests due to file changes`,
      );
      await this.runTestFiles(
        [...new Set(testsToRun)],
        "file-change",
        changedFiles,
      );
    }
  }

  /**
   * Check if a test file is related to a source file
   */
  private isRelatedTest(sourceFile: string, testFile: string): boolean {
    // Extract directory paths
    const sourceParts = sourceFile.split("/");
    const testParts = testFile.split("/");

    // Check if they share common parent directories
    const sourceDir = sourceParts.slice(0, -1).join("/");
    const testDir = testParts.slice(0, -1).join("/");

    return sourceDir.includes("/libs/b3nd-") && testDir.includes("/libs/b3nd-");
  }

  /**
   * Stop any running tests
   */
  stop(): void {
    if (this.currentProcess) {
      try {
        this.currentProcess.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
      this.currentProcess = null;
    }
  }
}
