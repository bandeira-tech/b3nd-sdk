import { Hono } from "hono";
import { WsHub } from "../services/ws-hub.ts";
import { TestRunner, type TestFilter } from "../services/test-runner.ts";
import {
  groupTestsByTheme,
  groupTestsByBackend,
  getThemeOrder,
  getBackendOrder,
  classifyBackendType,
} from "../utils/theme-classifier.ts";
import { TEST_THEMES, BACKEND_TYPES } from "../utils/test-parser.ts";

/**
 * Creates test routes with dependency injection of WsHub
 */
export function testsRouter(wsHub: WsHub): Hono {
  const app = new Hono();
  const testRunner = new TestRunner(wsHub);

  /**
   * GET /tests - List available tests grouped by theme and backend
   */
  app.get("/", async (c) => {
    try {
      const testFiles = await testRunner.discoverTests();
      const groupedByTheme = groupTestsByTheme(testFiles);
      const groupedByBackend = groupTestsByBackend(testFiles);
      const themeOrder = getThemeOrder();
      const backendOrder = getBackendOrder();

      // Build theme groups
      const themes = themeOrder.map((themeId) => {
        const themeInfo = TEST_THEMES.find((t) => t.id === themeId);
        const files = groupedByTheme.get(themeId) || [];

        return {
          id: themeId,
          label: themeInfo?.label || "Other",
          description: themeInfo?.description || "Uncategorized tests",
          testCount: files.length,
          files: files.map((f) => {
            const parts = f.split("/");
            return {
              path: f,
              name: parts[parts.length - 1],
              backend: classifyBackendType(f),
            };
          }),
        };
      }).filter((t) => t.testCount > 0);

      // Build backend groups (storage/transport backends only)
      const backends = backendOrder.map((backendId) => {
        const backendInfo = BACKEND_TYPES.find((b) => b.id === backendId);
        const files = groupedByBackend.get(backendId) || [];

        return {
          id: backendId,
          label: backendInfo?.label || "Other",
          theme: backendInfo?.theme || "other",
          testCount: files.length,
          files: files.map((f) => {
            const parts = f.split("/");
            return {
              path: f,
              name: parts[parts.length - 1],
              backend: backendId,
            };
          }),
        };
      }).filter((b) => b.testCount > 0);

      return c.json({
        themes,
        backends,
        totalTests: testFiles.length,
      });
    } catch (e) {
      console.error("[TestsRouter] Failed to discover tests:", e);
      return c.json({ error: "Failed to discover tests" }, 500);
    }
  });

  /**
   * POST /tests/run - Start a test run
   */
  app.post("/run", async (c) => {
    try {
      const body = await c.req.json();
      const filter: TestFilter | undefined = body.filter;

      // Generate unique run ID
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Start test run in background
      testRunner.run({ runId, filter }).catch((e) => {
        console.error("[TestsRouter] Test run error:", e);
      });

      return c.json({
        runId,
        status: "started",
        filter: filter || null,
      });
    } catch (e) {
      console.error("[TestsRouter] Failed to start test run:", e);
      return c.json({ error: "Failed to start test run" }, 500);
    }
  });

  /**
   * POST /tests/cancel - Cancel the current test run
   */
  app.post("/cancel", async (c) => {
    try {
      if (!testRunner.isRunning()) {
        return c.json({ error: "No test run in progress" }, 400);
      }

      const runId = testRunner.getCurrentRunId();
      await testRunner.cancel();

      return c.json({
        status: "cancelled",
        runId,
      });
    } catch (e) {
      console.error("[TestsRouter] Failed to cancel test run:", e);
      return c.json({ error: "Failed to cancel test run" }, 500);
    }
  });

  /**
   * GET /tests/status - Get current test run status
   */
  app.get("/status", (c) => {
    return c.json({
      isRunning: testRunner.isRunning(),
      currentRunId: testRunner.getCurrentRunId(),
    });
  });

  /**
   * GET /tests/themes - Get theme definitions
   */
  app.get("/themes", (c) => {
    return c.json({
      themes: TEST_THEMES.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
      })),
    });
  });

  return app;
}
