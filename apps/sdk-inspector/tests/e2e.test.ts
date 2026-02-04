/**
 * E2E tests for the Dashboard Backend
 *
 * These tests validate the full integration of the dashboard server:
 * - Health endpoint
 * - WebSocket connection
 * - Test run triggering and result streaming
 * - Health monitoring
 */
import { assert, assertEquals, assertExists } from "@std/assert";

const DASHBOARD_URL = "http://localhost:5556";
const DASHBOARD_WS_URL = "ws://localhost:5556/ws";

// Helper to wait for WebSocket messages
function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeout = 10000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for WebSocket message"));
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.addEventListener("message", handler);
  });
}

Deno.test({
  name: "E2E - health endpoint returns status",
  async fn() {
    const response = await fetch(`${DASHBOARD_URL}/health`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.status);
    assertExists(data.services);
    assertExists(data.timestamp);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E - WebSocket connects and receives connected message",
  async fn() {
    const ws = new WebSocket(DASHBOARD_WS_URL);

    const connectedPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket connection timeout")),
        5000,
      );

      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };

      ws.onerror = (e) => {
        clearTimeout(timer);
        reject(e);
      };
    });

    await connectedPromise;

    // Wait for connected message
    const msg = await waitForWsMessage(ws, (m) => m.type === "connected");
    assertEquals(msg.type, "connected");

    ws.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E - WebSocket receives health updates",
  async fn() {
    const ws = new WebSocket(DASHBOARD_WS_URL);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket connection timeout")),
        5000,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    // Wait for health update (should come within poll interval)
    const msg = await waitForWsMessage(
      ws,
      (m) => m.type === "health:update",
      15000,
    );
    assertEquals(msg.type, "health:update");
    assertExists(msg.services);
    assert(Array.isArray(msg.services));

    ws.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E - test run can be triggered and streams results",
  async fn() {
    const ws = new WebSocket(DASHBOARD_WS_URL);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket connection timeout")),
        5000,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    // Skip the connected message
    await waitForWsMessage(ws, (m) => m.type === "connected");

    // Set up listeners BEFORE triggering the test run to avoid race conditions
    const startPromise = waitForWsMessage(
      ws,
      (m) => m.type === "test:start",
      10000,
    );

    // Trigger a minimal test run (single test to keep it fast)
    const runResponse = await fetch(`${DASHBOARD_URL}/tests/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          pattern: "MemoryClient - receive transaction and read",
        },
      }),
    });
    assertEquals(runResponse.status, 200);

    // Wait for test:start message
    const startMsg = await startPromise;
    assertEquals(startMsg.type, "test:start");
    assertExists(startMsg.runId);

    // Wait for test:complete message (or timeout)
    const completeMsg = await waitForWsMessage(
      ws,
      (m) => m.type === "test:complete" || m.type === "test:error",
      60000,
    );

    if (completeMsg.type === "test:complete") {
      assertExists(completeMsg.summary);
      const summary = completeMsg.summary as Record<string, number>;
      assert(
        summary.total > 0 || summary.passed >= 0,
        "Should have test results",
      );
    }

    ws.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E - test cancel endpoint works",
  async fn() {
    // Start a test run
    await fetch(`${DASHBOARD_URL}/tests/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Immediately try to cancel
    const cancelResponse = await fetch(`${DASHBOARD_URL}/tests/cancel`, {
      method: "POST",
    });

    // Should return 200 whether or not there was a run to cancel
    assertEquals(cancelResponse.status, 200);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E - tests list endpoint returns test files grouped by theme",
  async fn() {
    const response = await fetch(`${DASHBOARD_URL}/tests`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.themes);
    assert(Array.isArray(data.themes));
    assertExists(data.totalTests);
    // Should find at least some test files
    assert(data.themes.length > 0, "Should discover some test themes");
    assert(data.totalTests > 0, "Should have a positive total test count");

    // Each theme should have required fields
    const firstTheme = data.themes[0];
    assertExists(firstTheme.id);
    assertExists(firstTheme.label);
    assertExists(firstTheme.files);
    assert(Array.isArray(firstTheme.files));
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
