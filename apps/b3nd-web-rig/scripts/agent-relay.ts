/**
 * Agent Relay — WebSocket server that bridges the Rig to Claude Code CLI.
 *
 * Protocol (JSON over WebSocket):
 *
 * Client → Server:
 *   { action: "dispatch", storyId, prompt, branch, includeFeedback? }
 *   { action: "cancel", storyId }
 *   { action: "list" }
 *   { action: "save-story", storyId, markdown }
 *
 * Server → Client:
 *   { type: "output", storyId, text, timestamp }
 *   { type: "complete", storyId, exitCode, timestamp }
 *   { type: "error", storyId, message, timestamp }
 *   { type: "sessions", sessions: [{ storyId, branch, startedAt }] }
 *   { type: "saved", storyId, ok, error? }
 *   { type: "pr-detected", storyId, url, number, timestamp }
 */

const PORT = parseInt(Deno.env.get("RELAY_PORT") || "9950", 10);
const PROJECT_ROOT = Deno.cwd();
const WORKTREES_DIR = `${PROJECT_ROOT}/../b3nd-worktrees`;
const PR_URL_RE = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/;

interface Session {
  storyId: string;
  branch: string;
  startedAt: number;
  process: Deno.ChildProcess;
}

const sessions = new Map<string, Session>();
const clients = new Set<WebSocket>();

function broadcast(msg: Record<string, unknown>) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function sessionsList() {
  return [...sessions.values()].map((s) => ({
    storyId: s.storyId,
    branch: s.branch,
    startedAt: s.startedAt,
  }));
}

/* -- Git worktree management ------------------------------------------- */

async function ensureWorktree(branch: string): Promise<string> {
  const slug = branch.replace(/\//g, "-");
  const wtPath = `${WORKTREES_DIR}/${slug}`;

  // Reuse existing valid worktree
  try {
    await Deno.stat(`${wtPath}/.git`);
    console.log(`[relay] reusing worktree ${wtPath}`);
    return wtPath;
  } catch {
    // Not valid or doesn't exist
  }

  // Clean up stale directory
  try {
    await Deno.remove(wtPath, { recursive: true });
  } catch {
    // Didn't exist
  }

  // Prune dead worktree entries
  await new Deno.Command("git", {
    args: ["worktree", "prune"],
    cwd: PROJECT_ROOT,
  }).output();

  await Deno.mkdir(WORKTREES_DIR, { recursive: true });

  // Check if branch already exists
  const { success: branchExists } = await new Deno.Command("git", {
    args: ["rev-parse", "--verify", `refs/heads/${branch}`],
    cwd: PROJECT_ROOT,
    stdout: "null",
    stderr: "null",
  }).output();

  const args = branchExists
    ? ["worktree", "add", wtPath, branch]
    : ["worktree", "add", "-b", branch, wtPath, "main"];

  console.log(`[relay] git ${args.join(" ")}`);
  const { success, stderr } = await new Deno.Command("git", {
    args,
    cwd: PROJECT_ROOT,
  }).output();

  if (!success) {
    throw new Error(new TextDecoder().decode(stderr));
  }

  console.log(`[relay] worktree ready at ${wtPath}`);
  return wtPath;
}

/* -- PR detection ------------------------------------------------------- */

function detectPrUrl(text: string): { url: string; number: number } | null {
  const m = text.match(PR_URL_RE);
  return m ? { url: m[0], number: parseInt(m[1], 10) } : null;
}

async function updateStoryPr(storyId: string, pr: { url: string; number: number }) {
  const filePath = `${STORIES_DIR}/${storyId}.json`;
  try {
    const raw = await Deno.readTextFile(filePath);
    const story = JSON.parse(raw);
    story.pr = { number: pr.number, url: pr.url, state: "OPEN", title: story.title ?? storyId };
    story.status = "in-progress";
    await Deno.writeTextFile(filePath, JSON.stringify(story, null, 2) + "\n");
    console.log(`[relay] updated ${storyId} with PR #${pr.number}`);
  } catch (err) {
    console.error(`[relay] updateStoryPr failed:`, err);
  }
}

/* -- Stream reader ------------------------------------------------------ */

async function streamReader(
  stream: ReadableStream<Uint8Array>,
  storyId: string,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        if (!line) continue;
        broadcast({
          type: "output",
          storyId,
          text: line,
          timestamp: Date.now(),
        });
        // Detect PR URL in output
        const pr = detectPrUrl(line);
        if (pr) {
          broadcast({ type: "pr-detected", storyId, ...pr, timestamp: Date.now() });
          updateStoryPr(storyId, pr).catch((e) =>
            console.error("[relay] pr update failed:", e)
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function dispatch(
  storyId: string,
  prompt: string,
  branch: string,
) {
  if (sessions.has(storyId)) {
    broadcast({
      type: "error",
      storyId,
      message: `Session for ${storyId} already running`,
      timestamp: Date.now(),
    });
    return;
  }

  console.log(`[relay] dispatch ${storyId} on branch ${branch}`);

  // Set up git worktree so the agent works on its own branch
  let cwd: string;
  try {
    cwd = await ensureWorktree(branch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[relay] worktree failed for ${storyId}:`, message);
    broadcast({ type: "error", storyId, message: `Worktree setup failed: ${message}`, timestamp: Date.now() });
    return;
  }

  const command = new Deno.Command("claude", {
    args: [
      "--print",
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format", "stream-json",
      "-p", prompt,
    ],
    stdout: "piped",
    stderr: "piped",
    cwd,
    env: { ...Deno.env.toObject() },
  });

  const process = command.spawn();
  const session: Session = {
    storyId,
    branch,
    startedAt: Date.now(),
    process,
  };
  sessions.set(storyId, session);

  broadcast({ type: "sessions", sessions: sessionsList() });

  // Stream stdout and stderr concurrently
  const stdoutDone = streamReader(process.stdout, storyId);
  const stderrDone = streamReader(process.stderr, storyId);

  // Wait for process to finish
  const status = await process.status;
  await Promise.allSettled([stdoutDone, stderrDone]);

  sessions.delete(storyId);

  broadcast({
    type: "complete",
    storyId,
    exitCode: status.code,
    timestamp: Date.now(),
  });
  broadcast({ type: "sessions", sessions: sessionsList() });

  console.log(`[relay] ${storyId} exited with code ${status.code}`);
}

function cancel(storyId: string) {
  const session = sessions.get(storyId);
  if (!session) {
    broadcast({
      type: "error",
      storyId,
      message: `No active session for ${storyId}`,
      timestamp: Date.now(),
    });
    return;
  }

  console.log(`[relay] cancel ${storyId}`);
  try {
    session.process.kill("SIGTERM");
  } catch {
    // Process may have already exited
  }
}

const STORIES_DIR = new URL("../public/roadmap/stories", import.meta.url).pathname;

async function saveStory(storyId: string, markdown: string) {
  const filePath = `${STORIES_DIR}/${storyId}.json`;
  try {
    const raw = await Deno.readTextFile(filePath);
    const story = JSON.parse(raw);
    story.markdown = markdown;
    await Deno.writeTextFile(filePath, JSON.stringify(story, null, 2) + "\n");
    console.log(`[relay] saved ${storyId}`);
    broadcast({ type: "saved", storyId, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[relay] save failed for ${storyId}:`, message);
    broadcast({ type: "saved", storyId, ok: false, error: message });
  }
}

function handleMessage(data: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }

  switch (msg.action) {
    case "dispatch":
      if (
        typeof msg.storyId !== "string" ||
        typeof msg.prompt !== "string" ||
        typeof msg.branch !== "string"
      ) {
        return;
      }
      dispatch(msg.storyId, msg.prompt, msg.branch);
      break;
    case "cancel":
      if (typeof msg.storyId !== "string") return;
      cancel(msg.storyId);
      break;
    case "save-story":
      if (typeof msg.storyId !== "string" || typeof msg.markdown !== "string") return;
      saveStory(msg.storyId, msg.markdown);
      break;
    case "list":
      broadcast({ type: "sessions", sessions: sessionsList() });
      break;
  }
}

Deno.serve({ port: PORT }, (req) => {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Agent Relay — WebSocket only", { status: 200 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    clients.add(socket);
    console.log(`[relay] client connected (${clients.size} total)`);
    // Send current sessions to new client
    socket.send(JSON.stringify({ type: "sessions", sessions: sessionsList() }));
  };

  socket.onmessage = (e) => {
    handleMessage(typeof e.data === "string" ? e.data : "");
  };

  socket.onclose = () => {
    clients.delete(socket);
    console.log(`[relay] client disconnected (${clients.size} total)`);
  };

  socket.onerror = (e) => {
    console.error("[relay] socket error:", e);
    clients.delete(socket);
  };

  return response;
});

console.log(`[relay] Agent relay listening on ws://localhost:${PORT}`);
