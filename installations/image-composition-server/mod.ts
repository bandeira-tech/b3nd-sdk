/// <reference lib="deno.ns" />
/**
 * Image Composition Server
 *
 * HTTP server that composes images from b3nd URLs into a single image.
 *
 * Endpoints:
 * - GET  /api/v1/health          - Health check
 * - GET  /api/v1/compose         - Compose images (query params)
 * - POST /api/v1/compose         - Compose images (JSON body)
 *
 * Environment Variables:
 * - PORT: Server port (default: 3000)
 * - BACKEND_URL: b3nd backend URL (required, e.g., "http://localhost:8765" or "memory://")
 * - CORS_ORIGIN: Allowed CORS origin (default: "*")
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { HttpClient, MemoryClient } from "@bandeira-tech/b3nd-sdk";
import type { NodeProtocolInterface, Schema } from "@bandeira-tech/b3nd-sdk";
import {
  composeImages,
  parseComposeRequestFromQuery,
  type ComposeRequest,
} from "./compose.ts";

// Configuration from environment
const PORT = parseInt(Deno.env.get("PORT") || "3000", 10);
const BACKEND_URL = Deno.env.get("BACKEND_URL");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "*";

if (!BACKEND_URL) {
  throw new Error("BACKEND_URL environment variable is required");
}

// Default schema for image storage
const imageSchema: Schema = {
  "images://store": async () => ({ valid: true }),
  "images://public": async () => ({ valid: true }),
  "mutable://images": async () => ({ valid: true }),
  "immutable://images": async () => ({ valid: true }),
};

// Create client based on backend URL
function createClient(backendUrl: string): NodeProtocolInterface {
  if (backendUrl.startsWith("memory://")) {
    return new MemoryClient({ schema: imageSchema });
  }
  if (backendUrl.startsWith("http://") || backendUrl.startsWith("https://")) {
    return new HttpClient({ url: backendUrl });
  }
  throw new Error(`Unsupported BACKEND_URL: ${backendUrl}`);
}

const client = createClient(BACKEND_URL);

// Custom logger middleware
const customLogger = async (c: Context, next: () => Promise<void>) => {
  const startTime = Date.now();
  const startDate = new Date().toISOString();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  await next();

  const duration = Date.now() - startTime;
  const status = c.res.status;
  console.log(`[${startDate}] ${method} ${path} ${status} - ${duration}ms`);
};

// Create Hono app
const app = new Hono();

// Middleware
app.use(
  "/*",
  cors({
    origin: (origin) => (CORS_ORIGIN === "*" ? origin : CORS_ORIGIN),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);
app.use(customLogger);

// Health check endpoint
app.get("/api/v1/health", (c) => {
  return c.json({
    status: "healthy",
    service: "image-composition-server",
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/compose - Compose images using query parameters
app.get("/api/v1/compose", async (c) => {
  const url = new URL(c.req.url);
  const parseResult = parseComposeRequestFromQuery(url.searchParams);

  if ("error" in parseResult) {
    return c.json({ success: false, error: parseResult.error }, 400);
  }

  const result = await composeImages(client, parseResult);

  if (!result.success) {
    return c.json(result, 400);
  }

  // Return as JSON with base64 data
  return c.json(result);
});

// POST /api/v1/compose - Compose images using JSON body
app.post("/api/v1/compose", async (c) => {
  let request: ComposeRequest;

  try {
    request = await c.req.json<ComposeRequest>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  // Validate request
  if (!request.width || !request.height) {
    return c.json({ success: false, error: "width and height are required" }, 400);
  }

  if (!request.layers || !Array.isArray(request.layers)) {
    return c.json({ success: false, error: "layers array is required" }, 400);
  }

  const result = await composeImages(client, request);

  if (!result.success) {
    return c.json(result, 400);
  }

  return c.json(result);
});

// GET /api/v1/compose/image - Return composed image directly as PNG
app.get("/api/v1/compose/image", async (c) => {
  const url = new URL(c.req.url);
  const parseResult = parseComposeRequestFromQuery(url.searchParams);

  if ("error" in parseResult) {
    return c.json({ success: false, error: parseResult.error }, 400);
  }

  const result = await composeImages(client, parseResult);

  if (!result.success || !result.data) {
    return c.json(result, 400);
  }

  // Return as actual image
  const buffer = Buffer.from(result.data, "base64");
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": buffer.length.toString(),
    },
  });
});

// POST /api/v1/compose/image - Return composed image directly as PNG
app.post("/api/v1/compose/image", async (c) => {
  let request: ComposeRequest;

  try {
    request = await c.req.json<ComposeRequest>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!request.width || !request.height) {
    return c.json({ success: false, error: "width and height are required" }, 400);
  }

  if (!request.layers || !Array.isArray(request.layers)) {
    return c.json({ success: false, error: "layers array is required" }, 400);
  }

  const result = await composeImages(client, request);

  if (!result.success || !result.data) {
    return c.json(result, 400);
  }

  const buffer = Buffer.from(result.data, "base64");
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": buffer.length.toString(),
    },
  });
});

// Start server
Deno.serve({
  port: PORT,
  onListen: () => {
    console.log(`\nImage Composition Server running on http://localhost:${PORT}`);
    console.log(`Backend: ${BACKEND_URL}`);
    console.log("\nEndpoints:");
    console.log("  GET    /api/v1/health         - Health check");
    console.log("  GET    /api/v1/compose        - Compose images (returns JSON)");
    console.log("  POST   /api/v1/compose        - Compose images (returns JSON)");
    console.log("  GET    /api/v1/compose/image  - Compose images (returns PNG)");
    console.log("  POST   /api/v1/compose/image  - Compose images (returns PNG)");
    console.log("\nQuery format: ?width=W&height=H&image1=uri,x,y[,w,h]&image2=...");
    console.log("Or JSON body: { width, height, layers: [{ uri, x, y, width?, height? }] }\n");
  },
  handler: app.fetch,
});

// Export for testing
export { app, createClient, imageSchema };
