/// <reference lib="deno.ns" />
/**
 * TestState - Single source of truth for test results
 *
 * Maintains the current state of all tests, updated by:
 * - Initial run on server start
 * - File watcher triggered re-runs
 *
 * Frontend just reads and filters this state.
 */

import { WsHub } from "./ws-hub.ts";
import {
  classifyTestTheme,
  classifyBackendType,
  type TestTheme,
  type BackendType,
} from "../utils/test-parser.ts";

export interface TestResultState {
  name: string;
  file: string;
  filePath: string;
  theme: TestTheme;
  backend: BackendType;
  status: "passed" | "failed" | "skipped" | "running" | "pending";
  duration?: number;
  error?: {
    message: string;
    stack?: string;
  };
  lastRun: number;
}

export interface TestFileState {
  path: string;
  name: string;
  theme: TestTheme;
  backend: BackendType;
  status: "passed" | "failed" | "running" | "pending";
  tests: Map<string, TestResultState>;
  lastRun: number;
  duration?: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  running: number;
  pending: number;
  duration: number;
  lastRun: number;
}

export type RunTrigger = "startup" | "file-change" | "manual";

export interface RunMetadata {
  trigger: RunTrigger;
  startedAt: number;
  completedAt?: number;
  changedFiles?: string[];
}

export class TestState {
  private files: Map<string, TestFileState> = new Map();
  private wsHub: WsHub;
  private runningFiles: Set<string> = new Set();
  private currentRun: RunMetadata | null = null;
  private lastCompletedRun: RunMetadata | null = null;
  private runLog: string[] = [];

  constructor(wsHub: WsHub) {
    this.wsHub = wsHub;
  }

  /**
   * Start a new test run with metadata
   */
  startRun(trigger: RunTrigger, changedFiles?: string[]): void {
    this.runLog = [];
    this.currentRun = {
      trigger,
      startedAt: Date.now(),
      changedFiles,
    };
    this.broadcastState();
  }

  /**
   * Complete the current run and write static artifacts
   */
  completeRun(): void {
    if (this.currentRun) {
      this.currentRun.completedAt = Date.now();
      this.lastCompletedRun = { ...this.currentRun };
      this.currentRun = null;
    }
    this.broadcastState();

    // Write static artifacts (fire-and-forget)
    this.writeStaticArtifacts().catch((e) => {
      console.error("[TestState] Failed to write static artifacts:", e);
    });
  }

  /**
   * Get current run metadata
   */
  getRunMetadata(): { current: RunMetadata | null; last: RunMetadata | null } {
    return {
      current: this.currentRun,
      last: this.lastCompletedRun,
    };
  }

  /**
   * Append a raw output line to the current run log
   */
  appendLog(line: string): void {
    this.runLog.push(line);
  }

  /**
   * Get raw log from the last (or current) run
   */
  getRunLog(): string[] {
    return this.runLog;
  }

  /**
   * Initialize state with discovered test files
   */
  initializeFiles(testFiles: string[]): void {
    for (const filePath of testFiles) {
      const name = filePath.split("/").pop() || filePath;
      const theme = classifyTestTheme(filePath);
      const backend = classifyBackendType(filePath);

      this.files.set(filePath, {
        path: filePath,
        name,
        theme,
        backend,
        status: "pending",
        tests: new Map(),
        lastRun: 0,
      });
    }

    this.broadcastState();
  }

  /**
   * Mark a file as currently running
   */
  markFileRunning(filePath: string): void {
    const file = this.files.get(filePath);
    if (file) {
      file.status = "running";
      this.runningFiles.add(filePath);
      this.broadcastState();
    }
  }

  /**
   * Add or update a test result
   */
  updateTestResult(result: {
    name: string;
    file: string;
    filePath: string;
    status: "passed" | "failed" | "skipped" | "running";
    duration?: number;
    error?: { message: string; stack?: string };
  }): void {
    let fileState = this.files.get(result.filePath);

    if (!fileState) {
      // Create file state if it doesn't exist
      const theme = classifyTestTheme(result.filePath);
      const backend = classifyBackendType(result.filePath);
      fileState = {
        path: result.filePath,
        name: result.file,
        theme,
        backend,
        status: "running",
        tests: new Map(),
        lastRun: Date.now(),
      };
      this.files.set(result.filePath, fileState);
    }

    const testState: TestResultState = {
      name: result.name,
      file: result.file,
      filePath: result.filePath,
      theme: fileState.theme,
      backend: fileState.backend,
      status: result.status,
      duration: result.duration,
      error: result.error,
      lastRun: Date.now(),
    };

    fileState.tests.set(result.name, testState);
    fileState.lastRun = Date.now();

    // Broadcast individual result
    this.wsHub.broadcast({
      type: "test:result",
      test: testState,
      timestamp: Date.now(),
    });
  }

  /**
   * Mark a file run as complete and calculate file status
   */
  completeFileRun(filePath: string, duration?: number): void {
    const file = this.files.get(filePath);
    if (!file) return;

    this.runningFiles.delete(filePath);
    file.duration = duration;
    file.lastRun = Date.now();

    // Calculate file status from test results
    let hasFailed = false;
    let allPassed = true;

    for (const test of file.tests.values()) {
      if (test.status === "failed") {
        hasFailed = true;
        allPassed = false;
      } else if (test.status !== "passed") {
        allPassed = false;
      }
    }

    file.status = hasFailed ? "failed" : allPassed ? "passed" : "passed";

    this.broadcastState();
  }

  /**
   * Get current summary
   */
  getSummary(): TestSummary {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let running = 0;
    let pending = 0;
    let duration = 0;
    let lastRun = 0;

    for (const file of this.files.values()) {
      for (const test of file.tests.values()) {
        total++;
        switch (test.status) {
          case "passed": passed++; break;
          case "failed": failed++; break;
          case "skipped": skipped++; break;
          case "running": running++; break;
          case "pending": pending++; break;
        }
        if (test.duration) duration += test.duration;
        if (test.lastRun > lastRun) lastRun = test.lastRun;
      }

      // Count pending files with no tests yet
      if (file.tests.size === 0) {
        pending++;
        total++;
      }
    }

    return { total, passed, failed, skipped, running, pending, duration, lastRun };
  }

  /**
   * Get all test results as array
   */
  getAllResults(): TestResultState[] {
    const results: TestResultState[] = [];
    for (const file of this.files.values()) {
      for (const test of file.tests.values()) {
        results.push(test);
      }
    }
    return results;
  }

  /**
   * Get file states grouped by theme
   */
  getFilesByTheme(): Map<TestTheme, TestFileState[]> {
    const grouped = new Map<TestTheme, TestFileState[]>();

    for (const file of this.files.values()) {
      const existing = grouped.get(file.theme) || [];
      existing.push(file);
      grouped.set(file.theme, existing);
    }

    return grouped;
  }

  /**
   * Get file states grouped by backend
   */
  getFilesByBackend(): Map<BackendType, TestFileState[]> {
    const grouped = new Map<BackendType, TestFileState[]>();

    for (const file of this.files.values()) {
      const existing = grouped.get(file.backend) || [];
      existing.push(file);
      grouped.set(file.backend, existing);
    }

    return grouped;
  }

  /**
   * Check if any tests are currently running
   */
  isRunning(): boolean {
    return this.runningFiles.size > 0;
  }

  /**
   * Get full state for API response
   */
  getFullState(): {
    summary: TestSummary;
    results: TestResultState[];
    files: { path: string; name: string; theme: TestTheme; backend: BackendType; status: string; testCount: number; lastRun: number }[];
    runMetadata: { current: RunMetadata | null; last: RunMetadata | null };
  } {
    return {
      summary: this.getSummary(),
      results: this.getAllResults(),
      files: Array.from(this.files.values()).map(f => ({
        path: f.path,
        name: f.name,
        theme: f.theme,
        backend: f.backend,
        status: f.status,
        testCount: f.tests.size,
        lastRun: f.lastRun,
      })),
      runMetadata: this.getRunMetadata(),
    };
  }

  /**
   * Broadcast current state to all clients
   */
  private broadcastState(): void {
    this.wsHub.broadcast({
      type: "state:update",
      state: this.getFullState(),
      timestamp: Date.now(),
    });
  }

  /**
   * Extract a source snippet around a test name from a file.
   * Returns ~25 lines starting from the test definition.
   */
  private async extractSourceSnippet(
    filePath: string,
    testName: string
  ): Promise<{ source: string; sourceFile: string; sourceStartLine: number } | null> {
    try {
      const content = await Deno.readTextFile(filePath);
      const lines = content.split("\n");

      // Find the line containing the test name
      let startLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(testName)) {
          startLine = i;
          break;
        }
      }

      if (startLine === -1) return null;

      // Extract ~25 lines from the match
      const to = Math.min(lines.length, startLine + 25);
      const snippet = lines.slice(startLine, to).join("\n");

      // Build a relative path for display
      const parts = filePath.split("/");
      const sdkIdx = parts.indexOf("sdk");
      const integIdx = parts.indexOf("integ");
      const fromIdx = sdkIdx >= 0 ? sdkIdx : integIdx >= 0 ? integIdx : Math.max(0, parts.length - 3);
      const relativePath = parts.slice(fromIdx).join("/");

      return {
        source: snippet,
        sourceFile: relativePath,
        sourceStartLine: startLine + 1, // 1-based
      };
    } catch {
      return null;
    }
  }

  /**
   * Write test-results.json and test-logs.txt to the explorer app's public directory.
   * This is the canonical data source for the frontend.
   */
  private async writeStaticArtifacts(): Promise<void> {
    const servicesDir = new URL(".", import.meta.url).pathname;
    const publicDir = new URL("../b3nd-web-rig/public/dashboard", `file://${servicesDir}`).pathname;

    // Ensure directory exists
    try {
      await Deno.mkdir(publicDir, { recursive: true });
    } catch {
      // Already exists
    }

    const results = this.getAllResults();
    const summary = this.getSummary();

    // Extract source snippets for all results (batch by file to avoid re-reading)
    const fileCache = new Map<string, string>();
    const enrichedResults: Array<TestResultState & { source?: string; sourceFile?: string; sourceStartLine?: number }> = [];

    for (const result of results) {
      // Read file once, cache for reuse
      if (!fileCache.has(result.filePath)) {
        try {
          const content = await Deno.readTextFile(result.filePath);
          fileCache.set(result.filePath, content);
        } catch {
          fileCache.set(result.filePath, "");
        }
      }

      const content = fileCache.get(result.filePath) || "";
      let source: string | undefined;
      let sourceFile: string | undefined;
      let sourceStartLine: number | undefined;

      if (content) {
        const lines = content.split("\n");
        let matchLine = -1;

        // Try exact name match first
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(result.name)) {
            matchLine = i;
            break;
          }
        }

        // For shared suite tests like "MemoryClient - receive transaction and read",
        // the literal name doesn't appear in source. Try the suffix after " - ".
        if (matchLine === -1 && result.name.includes(" - ")) {
          const suffix = result.name.split(" - ").slice(1).join(" - ");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(suffix)) {
              matchLine = i;
              break;
            }
          }
          // If found in a different file (shared suite), read that file instead
          if (matchLine === -1) {
            // Search for the suffix in known shared suite files
            const suiteFiles = [
              result.filePath.replace(/[^/]+$/, "shared-suite.ts"),
              result.filePath.replace(/[^/]+$/, "node-suite.ts"),
            ];
            for (const suiteFile of suiteFiles) {
              try {
                const suiteContent = fileCache.get(suiteFile) ?? await Deno.readTextFile(suiteFile);
                fileCache.set(suiteFile, suiteContent);
                const suiteLines = suiteContent.split("\n");
                for (let i = 0; i < suiteLines.length; i++) {
                  if (suiteLines[i].includes(suffix)) {
                    matchLine = i;
                    // Switch content to the suite file for extraction
                    const to = Math.min(suiteLines.length, matchLine + 25);
                    source = suiteLines.slice(matchLine, to).join("\n");
                    sourceStartLine = matchLine + 1;
                    const sParts = suiteFile.split("/");
                    const sIdx = sParts.indexOf("sdk");
                    const sFrom = sIdx >= 0 ? sIdx : Math.max(0, sParts.length - 3);
                    sourceFile = sParts.slice(sFrom).join("/");
                    break;
                  }
                }
                if (matchLine >= 0) break;
              } catch {
                // Suite file doesn't exist
              }
            }
          }
        }

        // Extract from original file if matched there
        if (matchLine >= 0 && !source) {
          const to = Math.min(lines.length, matchLine + 25);
          source = lines.slice(matchLine, to).join("\n");
          sourceStartLine = matchLine + 1;
        }

        // Build relative sourceFile path if not already set
        if (source && !sourceFile) {
          const parts = result.filePath.split("/");
          const sdkIdx = parts.indexOf("sdk");
          const integIdx = parts.indexOf("integ");
          const fromIdx = sdkIdx >= 0 ? sdkIdx : integIdx >= 0 ? integIdx : Math.max(0, parts.length - 3);
          sourceFile = parts.slice(fromIdx).join("/");
        }
      }

      enrichedResults.push({
        ...result,
        source,
        sourceFile,
        sourceStartLine,
      });
    }

    // Build the static data artifact
    const artifact = {
      version: "1.0",
      generatedAt: Date.now(),
      runMetadata: this.lastCompletedRun
        ? {
            trigger: this.lastCompletedRun.trigger,
            startedAt: this.lastCompletedRun.startedAt,
            completedAt: this.lastCompletedRun.completedAt || Date.now(),
            environment: {
              deno: Deno.version.deno,
              platform: Deno.build.os,
              hasPostgres: Boolean(Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL")),
              hasMongo: Boolean(Deno.env.get("MONGODB_URL")),
            },
          }
        : undefined,
      summary: {
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        total: summary.total,
        duration: summary.duration,
      },
      results: enrichedResults,
      files: Array.from(this.files.values()).map((f) => ({
        path: f.path,
        name: f.name,
        theme: f.theme,
        backend: f.backend,
        status: f.status,
        testCount: f.tests.size,
      })),
    };

    // Write test-results.json
    const jsonPath = `${publicDir}/test-results.json`;
    await Deno.writeTextFile(jsonPath, JSON.stringify(artifact, null, 2));
    console.log(`[TestState] Wrote ${enrichedResults.length} results to ${jsonPath}`);

    // Write test-logs.txt
    const logsPath = `${publicDir}/test-logs.txt`;
    await Deno.writeTextFile(logsPath, this.runLog.join("\n"));
    console.log(`[TestState] Wrote ${this.runLog.length} log lines to ${logsPath}`);
  }
}
