/// <reference lib="deno.ns" />
/**
 * B3nd Transaction Server
 *
 * A transaction node server that:
 * - Receives transactions via HTTP POST /txn
 * - Validates using a configurable validator
 * - Propagates to configured peers
 * - Provides a WebSocket subscription endpoint
 *
 * Environment Variables:
 * - PORT: Server port (required)
 * - CORS_ORIGIN: CORS allowed origin (required)
 * - VALIDATOR_MODULE: Path to validator module (required)
 * - READ_BACKEND_URL: URL for read state (required)
 * - PEER_URLS: Comma-separated peer URLs (optional)
 * - AWAIT_PROPAGATION: Whether to wait for propagation (default: false)
 */

import {
  firstMatchSequence,
  HttpClient,
  MemoryClient,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";
import type { NodeProtocolInterface, Schema } from "@bandeira-tech/b3nd-sdk";
import {
  createTransactionNode,
  type Transaction,
  type TransactionValidator,
} from "@bandeira-tech/b3nd-sdk/txn";
import { Hono } from "hono";
import { cors } from "hono/cors";

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

const PORT_VALUE = Deno.env.get("PORT");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN");
const VALIDATOR_MODULE = Deno.env.get("VALIDATOR_MODULE");
const READ_BACKEND_URL = Deno.env.get("READ_BACKEND_URL");
const PEER_URLS = Deno.env.get("PEER_URLS");
const AWAIT_PROPAGATION = Deno.env.get("AWAIT_PROPAGATION") === "true";

if (!PORT_VALUE) {
  throw new Error("PORT env var is required");
}
if (!CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN env var is required");
}
if (!VALIDATOR_MODULE) {
  throw new Error("VALIDATOR_MODULE env var is required");
}
if (!READ_BACKEND_URL) {
  throw new Error("READ_BACKEND_URL env var is required");
}

const PORT = Number(PORT_VALUE);
if (!Number.isFinite(PORT)) {
  throw new Error("PORT env var must be a valid number");
}

// =============================================================================
// VALIDATOR SETUP
// =============================================================================

// Dynamically import validator module provided by user
const imported = await import(VALIDATOR_MODULE);
const validate: TransactionValidator = imported.default as TransactionValidator;
if (!validate || typeof validate !== "function") {
  throw new Error("VALIDATOR_MODULE must export default TransactionValidator function");
}

// =============================================================================
// READ BACKEND SETUP
// =============================================================================

function createReadClient(url: string): NodeProtocolInterface {
  if (url.startsWith("memory://")) {
    return new MemoryClient({
      schema: {},
    });
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return new HttpClient({
      url,
    });
  }

  throw new Error(`Unsupported READ_BACKEND_URL: ${url}`);
}

// Parse read backend URLs (comma-separated for fallback chain)
const readUrls = READ_BACKEND_URL.split(",").map((s) => s.trim()).filter(Boolean);
if (readUrls.length === 0) {
  throw new Error("READ_BACKEND_URL must contain at least one URL");
}

const readClients = readUrls.map(createReadClient);
const readBackend = readClients.length === 1
  ? readClients[0]
  : firstMatchSequence(readClients);

// =============================================================================
// PEER SETUP
// =============================================================================

const peers: NodeProtocolInterface[] = [];

if (PEER_URLS) {
  const peerUrls = PEER_URLS.split(",").map((s) => s.trim()).filter(Boolean);

  for (const url of peerUrls) {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      peers.push(new HttpClient({ url }));
    } else if (url.startsWith("memory://")) {
      peers.push(new MemoryClient({ schema: {} }));
    } else {
      console.warn(`Unsupported peer URL, skipping: ${url}`);
    }
  }
}

// =============================================================================
// TRANSACTION NODE
// =============================================================================

const node = createTransactionNode({
  validate,
  read: readBackend,
  peers,
  awaitPropagation: AWAIT_PROPAGATION,
});

// =============================================================================
// HTTP SERVER
// =============================================================================

const app = new Hono();

// CORS middleware
app.use(
  "/*",
  cors({ origin: (origin) => (CORS_ORIGIN === "*" ? origin : CORS_ORIGIN) }),
);

// Logging middleware
app.use(async (c, next) => {
  const startTime = Date.now();
  const startDate = new Date().toISOString();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  await next();

  const duration = Date.now() - startTime;
  const status = c.res.status;
  console.log(`[${startDate}] ${method} ${path} ${status} - ${duration}ms`);
});

// POST /txn - Submit a transaction
app.post("/txn", async (c) => {
  try {
    const body = await c.req.json();

    // Validate transaction structure
    if (!Array.isArray(body) || body.length !== 2) {
      return c.json(
        { accepted: false, error: "Transaction must be [uri, data] tuple" },
        400,
      );
    }

    const [uri, data] = body as Transaction;
    if (typeof uri !== "string") {
      return c.json(
        { accepted: false, error: "Transaction URI must be a string" },
        400,
      );
    }

    const result = await node.receive([uri, data]);

    return c.json(result, result.accepted ? 200 : 400);
  } catch (error) {
    return c.json(
      {
        accepted: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      500,
    );
  }
});

// GET /txn/:uri - Read a transaction (if stored locally)
app.get("/txn/*", async (c) => {
  const path = c.req.path.replace("/txn/", "");
  const uri = `txn://${path}`;

  const result = await readBackend.read(uri);
  if (!result.success) {
    return c.json({ success: false, error: result.error || "not_found" }, 404);
  }

  return c.json(result);
});

// GET /health - Health check
app.get("/health", async (c) => {
  const health = await node.health();
  const status = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
  return c.json(health, status);
});

// GET /subscribe - WebSocket subscription (upgrade)
// Note: WebSocket handling requires additional setup depending on deployment
app.get("/subscribe", async (c) => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json(
      { error: "WebSocket upgrade required. Connect with ws:// protocol." },
      426,
    );
  }

  // Deno-specific WebSocket handling
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

  const filter = c.req.query("prefix")
    ? { prefix: c.req.query("prefix") }
    : undefined;

  // Set up subscription
  socket.onopen = async () => {
    console.log("WebSocket client connected");

    try {
      for await (const tx of node.subscribe(filter)) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(tx));
        } else {
          break;
        }
      }
    } catch (error) {
      console.error("Subscription error:", error);
    }
  };

  socket.onclose = () => {
    console.log("WebSocket client disconnected");
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  return response;
});

// =============================================================================
// START SERVER
// =============================================================================

Deno.serve({ port: PORT }, app.fetch);

console.log(`B3nd Transaction Server listening on port ${PORT}`);
console.log(`  Read backend: ${READ_BACKEND_URL}`);
console.log(`  Peers: ${PEER_URLS || "(none)"}`);
console.log(`  Await propagation: ${AWAIT_PROPAGATION}`);
