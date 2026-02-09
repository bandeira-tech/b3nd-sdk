/// <reference lib="deno.ns" />
import "@std/dotenv/load";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRouter } from "./routes/health.ts";
import { stateRouter } from "./routes/state.ts";
import { FileWatcher } from "./services/file-watcher.ts";
import { HealthMonitor } from "./services/health-monitor.ts";
import { TestState } from "./services/test-state.ts";
import { ContinuousTestRunner } from "./services/continuous-runner.ts";

const PORT = Number(Deno.env.get("DASHBOARD_PORT") || "5556");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "http://localhost:5555";

// B3nd persistence — defaults write to local node at mutable://open/local/inspector.
// Override with B3ND_URL / B3ND_URI env vars. Set B3ND_URI="" to disable.
const B3ND_URL = Deno.env.get("B3ND_URL") || "http://localhost:9942";
const B3ND_URI = Deno.env.get("B3ND_URI") ?? "mutable://open/local/inspector";

// Create shared services
const testState = new TestState({
  b3ndUrl: B3ND_URL || undefined,
  b3ndUri: B3ND_URI || undefined,
});
const runner = new ContinuousTestRunner(testState);
const fileWatcher = new FileWatcher();
const healthMonitor = new HealthMonitor();

// Create Hono app
const app = new Hono();

// CORS configuration
app.use(
  "/*",
  cors({
    origin: (origin) => (CORS_ORIGIN === "*" ? origin : CORS_ORIGIN),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Request logging middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  console.log(
    `[${new Date().toISOString()}] ${method} ${path} ${status} - ${duration}ms`,
  );
});

// Mount routers
app.route("/state", stateRouter(testState, runner));
app.route("/health", healthRouter(healthMonitor));

// Root status
app.get("/", (c) => {
  const summary = testState.getSummary();
  return c.json({
    name: "B3nd Dashboard Server",
    version: "0.2.0",
    status: summary.failed > 0
      ? "failing"
      : summary.running > 0
      ? "running"
      : "ok",
    tests: summary,
    timestamp: Date.now(),
  });
});

// Connect file watcher to runner
fileWatcher.onFilesChanged = async (files: string[]) => {
  console.log(`[Dashboard] Files changed: ${files.length} files`);
  await runner.onFileChange(files);
};

// Start services
fileWatcher.start();
healthMonitor.start();

// Start server first, then run tests
console.log(`B3nd Dashboard Server starting on port ${PORT}...`);
console.log(`CORS Origin: ${CORS_ORIGIN}`);
if (B3ND_URL && B3ND_URI) {
  console.log(`B3nd: ${B3ND_URI} via ${B3ND_URL}`);
} else {
  console.log(`B3nd: disabled (static file mode)`);
}

Deno.serve({ port: PORT }, app.fetch);

// Run initial tests after server starts
setTimeout(() => {
  runner.start().catch((e) => {
    console.error("[Dashboard] Initial test run failed:", e);
  });
}, 1000);

// Cleanup on shutdown
Deno.addSignalListener("SIGINT", () => {
  console.log("\nShutting down dashboard server...");
  runner.stop();
  fileWatcher.stop();
  healthMonitor.stop();
  Deno.exit(0);
});
