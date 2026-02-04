/// <reference lib="deno.ns" />
import { WsHub } from "./ws-hub.ts";
import {
  classifyTestTheme,
  classifyBackendType,
  getTestFileName,
  type TestTheme,
  type BackendType,
} from "../utils/test-parser.ts";

export interface TestFilter {
  themes?: TestTheme[];
  backends?: BackendType[];
  file?: string;
  pattern?: string;
}

export interface TestRunConfig {
  filter?: TestFilter;
  runId: string;
}

export interface TestResult {
  name: string;
  file: string;
  theme: TestTheme;
  status: "running" | "passed" | "failed" | "skipped";
  duration?: number;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

// Regex to strip ANSI color codes
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Regex patterns to parse Deno test output
const FILE_HEADER_PATTERN = /^running \d+ tests? from (?:\.\/)?(.+\.test\.ts)/;
const TEST_RESULT_PATTERN = /^(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;
const SUMMARY_PATTERN = /^ok \| (\d+) passed(?: \| (\d+) failed)?(?: \| (\d+) ignored)? \(([^)]+)\)/;
const FAIL_SUMMARY_PATTERN = /^FAILED \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)? \(([^)]+)\)/;

/**
 * Strip ANSI color codes from a string
 */
function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, "");
}

/**
 * Spawns and manages deno test processes, streaming results via WebSocket
 */
export class TestRunner {
  private wsHub: WsHub;
  private currentProcess: Deno.ChildProcess | null = null;
  private currentRunId: string | null = null;
  private sdkPath: string;
  private integPath: string;

  constructor(wsHub: WsHub) {
    this.wsHub = wsHub;
    // Determine paths relative to dashboard location (dashboard -> explorer -> b3nd root)
    const dashboardDir = new URL(".", import.meta.url).pathname;
    this.sdkPath = new URL("../../../sdk", `file://${dashboardDir}`).pathname;
    this.integPath = new URL("../../../integ", `file://${dashboardDir}`).pathname;
  }

  /**
   * Start a test run with optional filtering
   */
  async run(config: TestRunConfig): Promise<void> {
    // Cancel any existing run
    if (this.currentProcess) {
      await this.cancel();
    }

    this.currentRunId = config.runId;

    // Build command arguments - use default pretty reporter
    const args = ["test", "-A"];

    // Add filter arguments
    if (config.filter?.pattern) {
      args.push(`--filter=${config.filter.pattern}`);
    }

    // Determine test paths based on filter
    const testPaths: string[] = [];
    const hasBackendFilter = config.filter?.backends && config.filter.backends.length > 0;
    const hasThemeFilter = config.filter?.themes && config.filter.themes.length > 0;

    if (config.filter?.file) {
      // Run specific file
      testPaths.push(config.filter.file);
    } else if (hasBackendFilter || hasThemeFilter) {
      // Run tests matching backends and/or themes
      const allFiles = await this.discoverTests();
      const matchingFiles = allFiles.filter((f) => {
        const fileBackend = classifyBackendType(f);
        const fileTheme = classifyTestTheme(f);

        // If backends specified, file must match one of them
        if (hasBackendFilter && !config.filter!.backends!.includes(fileBackend)) {
          return false;
        }

        // If themes specified, file must match one of them
        if (hasThemeFilter && !config.filter!.themes!.includes(fileTheme)) {
          return false;
        }

        return true;
      });

      if (matchingFiles.length === 0) {
        const filterDesc = [
          hasBackendFilter ? `backends: ${config.filter!.backends!.join(", ")}` : "",
          hasThemeFilter ? `themes: ${config.filter!.themes!.join(", ")}` : "",
        ].filter(Boolean).join("; ");

        console.log(`[TestRunner] No files found for filter: ${filterDesc}`);
        this.wsHub.broadcast({
          type: "test:error",
          runId: config.runId,
          error: `No test files found for filter: ${filterDesc}`,
          timestamp: Date.now(),
        });
        return;
      }

      testPaths.push(...matchingFiles);
    } else {
      // Default to SDK tests, excluding browser tests and integration-heavy tests
      testPaths.push(`${this.sdkPath}/tests/`);
      args.push(
        "--ignore=tests/browser",
        "--ignore=tests/mongo-client.test.ts",
        "--ignore=tests/postgres-client.test.ts",
        "--ignore=tests/websocket-client.test.ts"
      );
    }

    args.push(...testPaths);

    // Broadcast test:start event
    this.wsHub.broadcast({
      type: "test:start",
      runId: config.runId,
      filter: config.filter || null,
      timestamp: Date.now(),
    });

    console.log(`[TestRunner] Starting: deno ${args.join(" ")}`);

    try {
      const command = new Deno.Command("deno", {
        args,
        cwd: this.sdkPath,
        stdout: "piped",
        stderr: "piped",
      });

      this.currentProcess = command.spawn();

      const summary: TestRunSummary = {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
      };

      let currentFile = "";
      const startTime = Date.now();
      const decoder = new TextDecoder();

      // Read both stdout and stderr concurrently
      const readStream = async (
        stream: ReadableStream<Uint8Array>,
        name: string
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
              const clean = stripAnsi(line).trim();
              if (clean) {
                // Log non-empty lines for debugging
                if (!clean.startsWith("Check") && clean.length > 0) {
                  console.log(`[TestRunner] ${name}: ${clean.substring(0, 100)}`);
                }
                this.parseLine(line, config.runId, summary, (file) => { currentFile = file; }, () => currentFile);
              }
            }
          }

          // Process any remaining buffer
          if (buffer.trim()) {
            this.parseLine(buffer, config.runId, summary, (file) => { currentFile = file; }, () => currentFile);
          }
        } finally {
          reader.releaseLock();
        }
      };

      // Read both streams concurrently
      await Promise.all([
        readStream(this.currentProcess.stdout, "stdout"),
        readStream(this.currentProcess.stderr, "stderr"),
      ]);

      // Wait for process to complete
      const status = await this.currentProcess.status;

      // Calculate total duration if not parsed from output
      if (summary.duration === 0) {
        summary.duration = Date.now() - startTime;
      }

      // Broadcast completion
      this.wsHub.broadcast({
        type: "test:complete",
        runId: config.runId,
        summary,
        exitCode: status.code,
        timestamp: Date.now(),
      });

      console.log(`[TestRunner] Completed with exit code ${status.code}`);
    } catch (error) {
      console.error("[TestRunner] Error:", error);
      this.wsHub.broadcast({
        type: "test:error",
        runId: config.runId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    } finally {
      this.currentProcess = null;
      this.currentRunId = null;
    }
  }

  /**
   * Parse a line of Deno test output
   */
  private parseLine(
    line: string,
    runId: string,
    summary: TestRunSummary,
    setCurrentFile: (file: string) => void,
    getCurrentFile: () => string
  ): void {
    // Strip ANSI color codes
    const clean = stripAnsi(line).trim();
    if (!clean) return;

    // Check for file header (e.g., "running 13 tests from ./tests/binary-operations.test.ts")
    const fileMatch = clean.match(FILE_HEADER_PATTERN);
    if (fileMatch) {
      setCurrentFile(fileMatch[1]);
      console.log(`[TestRunner] Parsing file: ${fileMatch[1]}`);
      return;
    }

    // Check for test result line (e.g., "test name ... ok (5ms)")
    const resultMatch = clean.match(TEST_RESULT_PATTERN);
    if (resultMatch) {
      const [, name, result, durationStr, durationUnit] = resultMatch;
      const currentFile = getCurrentFile();
      const theme = classifyTestTheme(currentFile);

      let status: "passed" | "failed" | "skipped";
      switch (result) {
        case "ok":
          status = "passed";
          summary.passed++;
          break;
        case "FAILED":
          status = "failed";
          summary.failed++;
          break;
        case "ignored":
          status = "skipped";
          summary.skipped++;
          break;
        default:
          status = "failed";
          summary.failed++;
      }
      summary.total++;

      let duration: number | undefined;
      if (durationStr) {
        duration = parseInt(durationStr, 10);
        // Handle seconds vs milliseconds
        if (durationUnit === "s") {
          duration *= 1000;
        }
      }

      const backendType = classifyBackendType(currentFile);

      this.wsHub.send({
        type: "test:result",
        runId,
        test: {
          name: name.trim(),
          file: currentFile,
          filePath: this.resolveFilePath(currentFile),
          theme,
          backend: backendType,
          status,
          duration,
        },
        timestamp: Date.now(),
      });
      return;
    }

    // Check for success summary (e.g., "ok | 10 passed | 2 ignored (1s)")
    const okMatch = clean.match(SUMMARY_PATTERN);
    if (okMatch) {
      const [, passed, failed, ignored, duration] = okMatch;
      summary.passed = parseInt(passed, 10);
      summary.failed = parseInt(failed || "0", 10);
      summary.skipped = parseInt(ignored || "0", 10);
      summary.total = summary.passed + summary.failed + summary.skipped;
      summary.duration = this.parseDuration(duration);
      return;
    }

    // Check for failure summary
    const failMatch = clean.match(FAIL_SUMMARY_PATTERN);
    if (failMatch) {
      const [, passed, failed, ignored, duration] = failMatch;
      summary.passed = parseInt(passed, 10);
      summary.failed = parseInt(failed, 10);
      summary.skipped = parseInt(ignored || "0", 10);
      summary.total = summary.passed + summary.failed + summary.skipped;
      summary.duration = this.parseDuration(duration);
      return;
    }
  }

  /**
   * Resolve a relative file path from Deno output to an absolute path
   */
  private resolveFilePath(relativePath: string): string {
    if (relativePath.startsWith("/")) return relativePath;
    const cleaned = relativePath.replace(/^\.\//, "");
    // If the path starts with something other than "tests/", it could be
    // auth/tests, integ/e2e, or another scope. Try integ path first.
    if (cleaned.includes("e2e") || cleaned.includes("integ")) {
      return `${this.integPath}/${cleaned}`;
    }
    return `${this.sdkPath}/${cleaned}`;
  }

  /**
   * Parse duration string like "1s", "500ms", "1m30s"
   */
  private parseDuration(durationStr: string): number {
    let ms = 0;
    const minMatch = durationStr.match(/(\d+)m/);
    const secMatch = durationStr.match(/(\d+)s/);
    const msMatch = durationStr.match(/(\d+)ms/);

    if (minMatch) ms += parseInt(minMatch[1], 10) * 60000;
    if (secMatch) ms += parseInt(secMatch[1], 10) * 1000;
    if (msMatch) ms += parseInt(msMatch[1], 10);

    return ms;
  }

  /**
   * Cancel the current test run
   */
  async cancel(): Promise<void> {
    if (!this.currentProcess) return;

    const runId = this.currentRunId;
    console.log(`[TestRunner] Cancelling run ${runId}`);

    try {
      this.currentProcess.kill("SIGTERM");
      await this.currentProcess.status;
    } catch {
      // Process may already be dead
    }

    this.wsHub.broadcast({
      type: "test:cancelled",
      runId,
      timestamp: Date.now(),
    });

    this.currentProcess = null;
    this.currentRunId = null;
  }

  /**
   * Check if a test run is in progress
   */
  isRunning(): boolean {
    return this.currentProcess !== null;
  }

  /**
   * Get the current run ID if running
   */
  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  /**
   * Discover all test files (recursive)
   */
  async discoverTests(): Promise<string[]> {
    const testFiles: string[] = [];

    // Directories to skip
    const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);

    // Recursively walk a directory for test files
    const walkDir = async (dir: string): Promise<void> => {
      try {
        for await (const entry of Deno.readDir(dir)) {
          // Skip excluded directories
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
        // Directory may not exist or not be readable
        console.error(`[TestRunner] Failed to read directory ${dir}:`, e);
      }
    };

    // Walk entire SDK directory to find all test files
    await walkDir(this.sdkPath);

    // Walk integ directory for E2E tests
    await walkDir(this.integPath);

    return testFiles;
  }
}
