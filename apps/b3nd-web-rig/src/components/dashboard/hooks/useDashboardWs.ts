import { useEffect, useRef, useCallback } from "react";
import { useDashboardStore } from "../stores/dashboardStore";
import type { WsMessage, TestResult, ServiceHealth, FileChangeEvent, TestFilter, TestTheme, RunMetadata } from "../types";

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * WebSocket hook for live dashboard updates.
 *
 * The static file (public/dashboard/test-results.json) is the primary data source
 * (loaded by DashboardLayoutSlot via loadStaticData). This hook provides:
 * - Live run status (start/complete/cancel)
 * - Streaming individual test results during a run
 * - Run metadata updates
 * - File change notifications
 * - Service health updates
 *
 * After a run completes, the backend writes a new static file. This hook
 * triggers a reload of that file so the frontend picks up fresh results
 * (including source snippets).
 */
export function useDashboardWs() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<number | null>(null);

  const {
    setWsConnected,
    setWsError,
    startRun,
    addTestResult,
    completeRun,
    cancelRun,
    setServices,
    addFileChange,
    addRawOutput,
    autoRunEnabled,
    setRunMetadata,
    loadStaticData,
  } = useDashboardStore();

  const DASHBOARD_WS_URL = "ws://localhost:5556/ws";
  const DASHBOARD_API_URL = "http://localhost:5556";

  // Fetch just run metadata from the backend (not results — those come from static file)
  const fetchRunMetadata = useCallback(async () => {
    try {
      const response = await fetch(`${DASHBOARD_API_URL}/state`);
      if (!response.ok) return;

      const data = await response.json() as {
        runMetadata: { current: RunMetadata | null; last: RunMetadata | null };
      };

      setRunMetadata(data.runMetadata);
    } catch (e) {
      console.error("[DashboardWs] Failed to fetch run metadata:", e);
    }
  }, [setRunMetadata]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log("[DashboardWs] Connecting to", DASHBOARD_WS_URL);

    try {
      const ws = new WebSocket(DASHBOARD_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[DashboardWs] Connected");
        setWsConnected(true);
        setWsError(null);
        reconnectAttempts.current = 0;

        // Only fetch run metadata — results come from static file
        fetchRunMetadata();
      };

      ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error("[DashboardWs] Failed to parse message:", e);
        }
      };

      ws.onerror = (e) => {
        console.error("[DashboardWs] WebSocket error:", e);
        setWsError("WebSocket connection error");
      };

      ws.onclose = () => {
        console.log("[DashboardWs] Disconnected");
        setWsConnected(false);
        wsRef.current = null;

        // Attempt reconnection
        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current++;
          console.log(
            `[DashboardWs] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts.current})`
          );
          reconnectTimeout.current = window.setTimeout(connect, RECONNECT_DELAY);
        } else {
          setWsError("Connection lost. Please refresh the page.");
        }
      };
    } catch (e) {
      console.error("[DashboardWs] Failed to connect:", e);
      setWsError("Failed to connect to dashboard server");
    }
  }, [setWsConnected, setWsError, fetchRunMetadata]);

  const handleMessage = useCallback(
    (message: WsMessage) => {
      switch (message.type) {
        case "connected":
          console.log("[DashboardWs] Server acknowledged connection");
          break;

        case "test:start": {
          const rawFilter = message.filter as { themes?: string[]; file?: string; pattern?: string } | null;
          const filter: TestFilter | null = rawFilter
            ? {
                themes: rawFilter.themes as TestTheme[] | undefined,
                file: rawFilter.file,
                pattern: rawFilter.pattern,
              }
            : null;
          startRun(message.runId as string, filter);
          addRawOutput(`[Test Run Started] Run ID: ${message.runId}`);
          break;
        }

        case "test:result": {
          const test = message.test as TestResult;
          addTestResult(test);

          const statusIcon = {
            running: "\u23f3",
            passed: "\u2705",
            failed: "\u274c",
            skipped: "\u23ed\ufe0f",
            pending: "\u23f8\ufe0f",
          }[test.status];

          addRawOutput(
            `${statusIcon} [${test.file}] ${test.name}${
              test.duration ? ` (${test.duration}ms)` : ""
            }`
          );

          if (test.error) {
            addRawOutput(`   Error: ${test.error.message}`);
          }
          break;
        }

        case "test:complete": {
          const summary = message.summary as {
            passed: number;
            failed: number;
            skipped: number;
            total?: number;
            duration: number;
          };
          completeRun({
            passed: summary.passed,
            failed: summary.failed,
            skipped: summary.skipped,
            total: summary.total || summary.passed + summary.failed + summary.skipped,
            duration: summary.duration,
          });
          addRawOutput(
            `\n[Test Run Complete] Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`
          );

          // Reload static file — backend just wrote it with fresh results + source
          setTimeout(() => loadStaticData(), 500);
          break;
        }

        case "test:cancelled":
          cancelRun();
          addRawOutput(`[Test Run Cancelled]`);
          break;

        case "test:error":
          addRawOutput(`[Test Error] ${message.error}`);
          break;

        case "health:update":
          setServices(message.services as ServiceHealth[]);
          break;

        case "file:change": {
          const fileEvent: FileChangeEvent = {
            kind: message.kind as FileChangeEvent["kind"],
            files: message.files as string[],
            timestamp: message.timestamp as number,
          };
          addFileChange(fileEvent);

          // Auto-run tests if enabled
          if (autoRunEnabled) {
            console.log("[DashboardWs] Auto-running tests due to file change");
            fetch(`${DASHBOARD_API_URL}/state/rerun`, {
              method: "POST",
            }).catch((e) => console.error("[DashboardWs] Auto-run failed:", e));
          }
          break;
        }

        case "pong":
          break;

        case "state:update": {
          const state = message.state as {
            runMetadata: { current: RunMetadata | null; last: RunMetadata | null };
          };
          if (state.runMetadata) {
            setRunMetadata(state.runMetadata);
          }
          break;
        }

        case "run:start":
          addRawOutput(`[Run Started] Trigger: ${(message as { trigger?: string }).trigger || "unknown"}`);
          break;

        case "run:complete":
          addRawOutput(`[Run Complete] Exit code: ${message.exitCode}, Duration: ${message.duration}ms`);
          // Reload static file after backend writes it
          setTimeout(() => loadStaticData(), 500);
          break;

        default:
          console.log("[DashboardWs] Unknown message type:", message.type);
      }
    },
    [
      startRun,
      addTestResult,
      completeRun,
      cancelRun,
      setServices,
      addFileChange,
      addRawOutput,
      autoRunEnabled,
      setRunMetadata,
      loadStaticData,
    ]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Heartbeat ping every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      sendMessage({ type: "ping" });
    }, 30000);

    return () => clearInterval(interval);
  }, [sendMessage]);

  return {
    connect,
    disconnect,
    sendMessage,
  };
}
