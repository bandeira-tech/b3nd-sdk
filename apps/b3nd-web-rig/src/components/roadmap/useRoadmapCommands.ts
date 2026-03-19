import { useCallback, useRef } from "react";
import { useAppStore } from "../../stores/appStore";

const CMD_PREFIX = "mutable://open/rig/roadmap/cmd/";
const RES_PREFIX = "mutable://open/rig/roadmap/res/";
const POLL_MS = 500;
const TIMEOUT_MS = 30_000;

interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RoadmapCommand {
  type: string;
  requestId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

function useBaseUrl(): string {
  return useAppStore((s) => {
    const backend = s.backends.find((b) => b.id === s.activeBackendId);
    return backend?.adapter?.baseUrl ?? "";
  });
}

async function sendCommand(baseUrl: string, cmd: RoadmapCommand): Promise<void> {
  const uri = `${CMD_PREFIX}${cmd.requestId}`;
  const res = await fetch(`${baseUrl}/api/v1/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([uri, cmd]),
  });
  if (!res.ok) throw new Error(`Failed to send command: ${res.status}`);
}

async function pollResponse(baseUrl: string, requestId: string): Promise<CommandResult> {
  const uri = `${RES_PREFIX}${requestId}`;
  const apiPath = "/api/v1/read/" + uri.replace("://", "/");
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}${apiPath}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data ?? json;
        if (data && typeof data === "object" && "requestId" in data) {
          return { success: data.success, data: data.data, error: data.error };
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  return { success: false, error: "Timeout waiting for response" };
}

export function useRoadmapCommands() {
  const baseUrl = useBaseUrl();
  const inflightRef = useRef(false);

  const exec = useCallback(async (
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<CommandResult> => {
    if (!baseUrl) return { success: false, error: "No backend connected" };
    if (inflightRef.current) return { success: false, error: "Command already in flight" };

    inflightRef.current = true;
    const requestId = crypto.randomUUID();

    try {
      await sendCommand(baseUrl, {
        type,
        requestId,
        timestamp: Date.now(),
        payload,
      });
      return await pollResponse(baseUrl, requestId);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      inflightRef.current = false;
    }
  }, [baseUrl]);

  const rebuild = useCallback(
    (skipPRs = false) => exec("rebuild", { skipPRs }),
    [exec],
  );

  const pull = useCallback(
    () => exec("pull", {}),
    [exec],
  );

  const push = useCallback(
    (storyIds?: string[]) => exec("push", storyIds ? { storyIds } : {}),
    [exec],
  );

  const createStory = useCallback(
    (payload: {
      id: string;
      title: string;
      group: string;
      category?: string;
      section?: string;
      priority?: string;
      tags?: string[];
    }) => exec("create-story", payload),
    [exec],
  );

  const updateStory = useCallback(
    (id: string, fields: Record<string, unknown>) => exec("update-story", { id, fields }),
    [exec],
  );

  return { rebuild, pull, push, createStory, updateStory, connected: !!baseUrl };
}
