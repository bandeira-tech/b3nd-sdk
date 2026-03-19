import { create } from "zustand";
import { useEffect } from "react";
import { useAppStore } from "../../stores/appStore";

const RELAY_URL = "ws://localhost:9950";
const RECONNECT_DELAY = 3000;

export interface AgentSession {
  storyId: string;
  branch: string;
  startedAt: number;
  status: "running" | "complete" | "error" | "cancelled";
  exitCode?: number;
  pr?: { url: string; number: number };
}

interface AgentRelayState {
  connected: boolean;
  sessions: Map<string, AgentSession>;
  outputs: Map<string, string[]>;
}

interface AgentRelayActions {
  setConnected: (v: boolean) => void;
  setSessions: (list: { storyId: string; branch: string; startedAt: number }[]) => void;
  appendOutput: (storyId: string, text: string) => void;
  markComplete: (storyId: string, exitCode: number) => void;
  markError: (storyId: string, message: string) => void;
  setPr: (storyId: string, pr: { url: string; number: number }) => void;
  clearOutput: (storyId: string) => void;
}

export const useAgentRelayStore = create<AgentRelayState & AgentRelayActions>(
  (set) => ({
    connected: false,
    sessions: new Map(),
    outputs: new Map(),

    setConnected: (v) => set({ connected: v }),

    setSessions: (list) =>
      set((state) => {
        const next = new Map(state.sessions);
        const activeIds = new Set(list.map((s) => s.storyId));

        // Add/update sessions from server
        for (const s of list) {
          const existing = next.get(s.storyId);
          if (!existing || existing.status === "running") {
            next.set(s.storyId, {
              storyId: s.storyId,
              branch: s.branch,
              startedAt: s.startedAt,
              status: "running",
            });
          }
        }

        // Mark sessions that disappeared from the list as complete (if still running)
        for (const [id, session] of next) {
          if (session.status === "running" && !activeIds.has(id)) {
            next.set(id, { ...session, status: "complete" });
          }
        }

        return { sessions: next };
      }),

    appendOutput: (storyId, text) =>
      set((state) => {
        const next = new Map(state.outputs);
        const lines = next.get(storyId) ?? [];
        const updated = [...lines, text];
        // Cap at 2000 lines to prevent unbounded memory growth
        next.set(storyId, updated.length > 2000 ? updated.slice(-2000) : updated);
        return { outputs: next };
      }),

    markComplete: (storyId, exitCode) =>
      set((state) => {
        const next = new Map(state.sessions);
        const session = next.get(storyId);
        if (session) {
          next.set(storyId, {
            ...session,
            status: exitCode === 0 ? "complete" : "error",
            exitCode,
          });
        }
        return { sessions: next };
      }),

    markError: (storyId, message) =>
      set((state) => {
        const next = new Map(state.sessions);
        const session = next.get(storyId);
        if (session) {
          next.set(storyId, { ...session, status: "error" });
        }
        // Also append the error as output
        const outputs = new Map(state.outputs);
        const lines = outputs.get(storyId) ?? [];
        outputs.set(storyId, [...lines, `[error] ${message}`]);
        return { sessions: next, outputs };
      }),

    setPr: (storyId, pr) =>
      set((state) => {
        const next = new Map(state.sessions);
        const session = next.get(storyId);
        if (session) {
          next.set(storyId, { ...session, pr });
        }
        return { sessions: next };
      }),

    clearOutput: (storyId) =>
      set((state) => {
        const next = new Map(state.outputs);
        next.delete(storyId);
        const sessions = new Map(state.sessions);
        sessions.delete(storyId);
        return { outputs: next, sessions };
      }),
  }),
);

// Singleton WebSocket ref shared across hook instances
let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _refCount = 0;

function connectRelay() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    _ws = new WebSocket(RELAY_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  _ws.onopen = () => {
    useAgentRelayStore.getState().setConnected(true);
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
  };

  _ws.onmessage = (e) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }

    const store = useAgentRelayStore.getState();
    const addLog = useAppStore.getState().addLogEntry;

    switch (msg.type) {
      case "output":
        store.appendOutput(msg.storyId as string, msg.text as string);
        break;
      case "complete":
        store.markComplete(msg.storyId as string, msg.exitCode as number);
        addLog({
          source: "roadmap",
          message: `Agent for ${msg.storyId} completed (exit ${msg.exitCode})`,
          level: (msg.exitCode as number) === 0 ? "success" : "error",
        });
        break;
      case "error":
        store.markError(msg.storyId as string, msg.message as string);
        addLog({
          source: "roadmap",
          message: `Agent error for ${msg.storyId}: ${msg.message}`,
          level: "error",
        });
        break;
      case "pr-detected":
        store.setPr(msg.storyId as string, {
          url: msg.url as string,
          number: msg.number as number,
        });
        addLog({
          source: "roadmap",
          message: `PR #${msg.number} created for ${msg.storyId}`,
          level: "success",
        });
        break;
      case "sessions":
        store.setSessions(
          msg.sessions as { storyId: string; branch: string; startedAt: number }[],
        );
        break;
    }
  };

  _ws.onclose = () => {
    useAgentRelayStore.getState().setConnected(false);
    _ws = null;
    scheduleReconnect();
  };

  _ws.onerror = () => {
    // onclose fires after this and handles reconnect
  };
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  if (_refCount <= 0) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (_refCount > 0) connectRelay();
  }, RECONNECT_DELAY);
}

function disconnectRelay() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.onclose = null;
    _ws.close();
    _ws = null;
  }
  useAgentRelayStore.getState().setConnected(false);
}

function sendCommand(cmd: Record<string, unknown>) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(cmd));
  }
}

/** Connect to the relay when mounted, disconnect when all consumers unmount. */
export function useAgentRelayConnection() {
  useEffect(() => {
    _refCount++;
    connectRelay();

    return () => {
      _refCount--;
      if (_refCount <= 0) {
        _refCount = 0;
        disconnectRelay();
      }
    };
  }, []);
}

/** Actions for dispatching/cancelling agent sessions. */
export function useAgentRelayActions() {
  return {
    dispatch: (storyId: string, prompt: string, branch: string) => {
      sendCommand({ action: "dispatch", storyId, prompt, branch });
      useAppStore.getState().addLogEntry({
        source: "roadmap",
        message: `Dispatched agent for ${storyId}`,
        level: "info",
      });
    },
    cancel: (storyId: string) => {
      sendCommand({ action: "cancel", storyId });
    },
    listSessions: () => {
      sendCommand({ action: "list" });
    },
    saveStory: (storyId: string, markdown: string) => {
      sendCommand({ action: "save-story", storyId, markdown });
    },
  };
}
