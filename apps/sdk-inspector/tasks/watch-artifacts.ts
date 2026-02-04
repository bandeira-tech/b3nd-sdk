/// <reference lib="deno.ns" />
/**
 * Watch mode — regenerate dashboard artifacts on file changes
 *
 * Usage:
 *   deno task dashboard:watch
 *
 * Watches sdk/ for changes and re-runs tests, updating
 * the static artifacts that the frontend reads.
 */

import { TestState } from "../services/test-state.ts";
import { WsHub } from "../services/ws-hub.ts";
import { ContinuousTestRunner } from "../services/continuous-runner.ts";
import { debounce } from "@std/async";

const OUTPUT_DIR = new URL("../../b3nd-web-rig/public/dashboard/", import.meta.url)
  .pathname;

const SDK_PATH = new URL("../../../libs/b3nd-sdk", import.meta.url).pathname;

const WATCH_PATHS = [
  `${SDK_PATH}/src`,
  `${SDK_PATH}/clients`,
  `${SDK_PATH}/txn`,
  `${SDK_PATH}/txn-data`,
];

async function writeArtifacts(
  testState: TestState
): Promise<void> {
  const fullState = testState.getFullState();
  const rawLogs = testState.getRunLog();

  const artifact = {
    version: "1.0",
    generatedAt: Date.now(),
    runMetadata: {
      trigger: "file-change",
      startedAt: fullState.runMetadata.last?.startedAt || Date.now(),
      completedAt: fullState.runMetadata.last?.completedAt || Date.now(),
      environment: {
        deno: Deno.version.deno,
        platform: Deno.build.os,
        hasPostgres: Boolean(
          Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL")
        ),
        hasMongo: Boolean(Deno.env.get("MONGODB_URL")),
      },
    },
    summary: {
      total: fullState.summary.total,
      passed: fullState.summary.passed,
      failed: fullState.summary.failed,
      skipped: fullState.summary.skipped,
      duration: fullState.summary.duration,
    },
    results: fullState.results.map((r) => ({
      name: r.name,
      file: r.file,
      filePath: r.filePath,
      theme: r.theme,
      backend: r.backend,
      status: r.status,
      duration: r.duration,
      error: r.error,
      lastRun: r.lastRun,
    })),
    files: fullState.files,
  };

  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  await Deno.writeTextFile(
    `${OUTPUT_DIR}/test-results.json`,
    JSON.stringify(artifact, null, 2)
  );
  await Deno.writeTextFile(`${OUTPUT_DIR}/test-logs.txt`, rawLogs.join("\n"));

  console.log(
    `[watch] Updated artifacts (${artifact.summary.passed}/${artifact.summary.total} passed)`
  );
}

async function main() {
  console.log("[watch] Starting watch mode...");

  const wsHub = new WsHub();
  const testState = new TestState(wsHub);
  const runner = new ContinuousTestRunner(testState, wsHub);

  // Initial build
  console.log("[watch] Running initial test suite...");
  await runner.start();
  await writeArtifacts(testState);
  console.log("[watch] Initial artifacts written.");

  // Set up debounced rebuild
  let isRunning = false;
  const rebuild = debounce(async (changedFiles: string[]) => {
    if (isRunning) return;
    isRunning = true;
    try {
      console.log(
        `[watch] Files changed: ${changedFiles.map((f) => f.split("/").pop()).join(", ")}`
      );
      await runner.onFileChange(changedFiles);
      await writeArtifacts(testState);
    } catch (e) {
      console.error("[watch] Rebuild error:", e);
    } finally {
      isRunning = false;
    }
  }, 500);

  // Watch for file changes
  const watcher = Deno.watchFs(WATCH_PATHS);
  console.log("[watch] Watching for file changes... (Ctrl+C to stop)");

  for await (const event of watcher) {
    if (event.kind === "modify" || event.kind === "create") {
      const tsFiles = event.paths.filter((p) => p.endsWith(".ts"));
      if (tsFiles.length > 0) {
        rebuild(tsFiles);
      }
    }
  }
}

main();
