import { Hono } from "hono";
import { TestState } from "../services/test-state.ts";
import { ContinuousTestRunner } from "../services/continuous-runner.ts";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * State routes - serve the current test state
 */
export function stateRouter(
  testState: TestState,
  runner: ContinuousTestRunner,
): Hono {
  const app = new Hono();

  /**
   * GET /state - Get full test state
   */
  app.get("/", (c) => {
    return c.json(testState.getFullState());
  });

  /**
   * GET /state/summary - Get just the summary
   */
  app.get("/summary", (c) => {
    return c.json(testState.getSummary());
  });

  /**
   * GET /state/results - Get all test results
   */
  app.get("/results", (c) => {
    return c.json(testState.getAllResults());
  });

  /**
   * GET /state/logs - Get raw output from the last test run
   */
  app.get("/logs", (c) => {
    const logs = testState.getRunLog();
    const format = c.req.query("format");

    if (format === "text") {
      return c.text(logs.join("\n"));
    }

    const runMeta = testState.getRunMetadata();
    return c.json({
      runMetadata: runMeta.current ?? runMeta.last,
      lines: logs,
      lineCount: logs.length,
    });
  });

  /**
   * GET /state/source - Get source code of a test file
   */
  app.get("/source", async (c) => {
    const filePath = c.req.query("file");
    if (!filePath) {
      return c.json({ error: "file query parameter is required" }, 400);
    }

    // Security: only allow reading files under the project root
    const dashboardDir = new URL(".", import.meta.url).pathname;
    const projectRoot = new URL("../../..", `file://${dashboardDir}`).pathname;

    // Resolve the file path - accept both absolute and relative to project root
    let resolvedPath = filePath;
    if (!filePath.startsWith("/")) {
      resolvedPath = `${projectRoot}/${filePath}`;
    }

    // Ensure the resolved path is within the project root
    if (!resolvedPath.startsWith(projectRoot)) {
      return c.json({
        error: "Access denied: file must be within project root",
      }, 403);
    }

    try {
      const content = await Deno.readTextFile(resolvedPath);
      const lines = content.split("\n");
      return c.json({
        file: resolvedPath,
        relativePath: resolvedPath.replace(projectRoot + "/", ""),
        content,
        lineCount: lines.length,
      });
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return c.json({ error: `File not found: ${resolvedPath}` }, 404);
      }
      return c.json({
        error: `Failed to read file: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }, 500);
    }
  });

  /**
   * POST /state/rerun - Trigger a full re-run
   */
  app.post("/rerun", async (c) => {
    if (testState.isRunning()) {
      return c.json({ error: "Tests already running" }, 400);
    }

    // Run in background
    runner.runAllTests().catch((e) => {
      console.error("[StateRouter] Re-run failed:", e);
    });

    return c.json({ status: "started" });
  });

  /**
   * POST /state/cancel - Stop running tests
   */
  app.post("/cancel", (c) => {
    runner.stop();
    return c.json({ status: "cancelled" });
  });

  return app;
}
