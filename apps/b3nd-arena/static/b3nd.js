/**
 * Minimal in-browser b3nd client for the arena.
 *
 * Three primitives against the server's HTTP API:
 *   receive(uri, data)  — POST /api/v1/receive
 *   read(uri)           — GET  /api/v1/read/...   (trailing slash = list)
 *   observe(prefix, on) — EventSource /api/v1/observe/...
 */

const API = "/api/v1";

/** Convert a b3nd URI → URL path segment: "tick://arena/a/b" → "tick/arena/a/b" */
const uriPath = (uri) => uri.replace("://", "/");

export async function receive(uri, data, values = {}) {
  const res = await fetch(`${API}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([uri, values, data]),
  });
  return res.json();
}

export async function read(uri) {
  const res = await fetch(`${API}/read/${uriPath(uri)}`);
  if (res.status === 404) return { success: false };
  if (!res.ok) return { success: false };
  const body = await res.json();
  // Trailing slash list → array; single read → { values, data }
  return uri.endsWith("/") ? { success: true, items: body } : { success: true, ...body };
}

/**
 * Subscribe to a URI prefix via SSE.
 * Calls `onWrite(uri, data)` for each event.
 * Returns a dispose function.
 */
export function observe(prefix, onWrite) {
  const url = `${API}/observe/${uriPath(prefix)}`;
  const src = new EventSource(url);

  src.addEventListener("write", (e) => {
    try {
      const { uri, data } = JSON.parse(e.data);
      onWrite(uri, data);
    } catch { /* ignore malformed events */ }
  });

  src.onerror = () => {
    // EventSource auto-reconnects; we surface the state via readyState elsewhere.
  };

  return {
    close: () => src.close(),
    source: src,
  };
}

/** Generate a short pseudo-random id (not cryptographically secure). */
export function shortId(prefix = "") {
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix + rnd + Date.now().toString(36).slice(-4);
}

/** Strong-ish pubkey for this browser session — persisted in localStorage. */
export function localPubkey() {
  const key = "b3nd-arena:pubkey";
  let v = localStorage.getItem(key);
  if (!v) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    v = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, v);
  }
  return v;
}
