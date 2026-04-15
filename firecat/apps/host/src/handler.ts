/**
 * Request handler for firecat-host.
 *
 * Two modes:
 *
 * 1. API Mode (primary domain):
 *    - /api/v1/health, /api/v1/info, /api/v1/serve/*, /api/v1/domain-check
 *
 * 2. Custom Domain Mode:
 *    - Host header looked up in mutable://open/domains/{domain}
 *    - Content served at / (no prefix)
 *
 * Protocol resolution:
 *   - link://   → read value (a URI string), recursively resolve
 *   - hash://   → read content-addressed data, serve directly
 *   - mutable://, immutable:// → read and serve directly
 */

import type { NodeProtocolReadInterface } from "@bandeira-tech/b3nd-sdk";
import type { DomainMapping, HostConfig } from "./types.ts";
import { getCacheControl, getContentType } from "./mime.ts";

// ── Utilities ────────────────────────────────────────────────────────

/** Error response headers: plain text, no cache */
function errorHeaders(): HeadersInit {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

/** Extract protocol name from a URI (e.g. "link://foo" → "link") */
function getProtocol(uri: string): string {
  const match = uri.match(/^([a-z]+):\/\//);
  return match ? match[1] : "";
}

/** Check if a path has a file extension */
function hasFileExtension(path: string): boolean {
  const lastSegment = path.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

/** Check if a host is a custom domain (not the primary/API domain) */
function isCustomDomain(host: string, config: HostConfig): boolean {
  const domain = host.split(":")[0].toLowerCase();
  if (domain === "localhost" || domain === "127.0.0.1") return false;
  if (config.primaryDomain) {
    return domain !== config.primaryDomain.toLowerCase();
  }
  return true;
}

/**
 * Data is stored directly — no wrapping.
 * In the new primitive, data is the third element of [uri, values, data].
 */
function unwrapData<T>(data: T): T {
  return data;
}

// ── Handler factory ──────────────────────────────────────────────────

const MAX_LINK_DEPTH = 10;

/**
 * Create the request handler.
 *
 * @param client - B3nd read client (HttpClient or Store-backed client)
 * @param config - Host configuration
 * @returns Hono-compatible request handler
 */
export function createHandler(
  client: NodeProtocolReadInterface,
  config: HostConfig,
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const host = req.headers.get("host") ||
      req.headers.get("x-forwarded-host") || "";

    // Custom domain → serve from domain registry
    if (isCustomDomain(host, config)) {
      return handleCustomDomain(client, host, path);
    }

    // API endpoints (primary domain)
    if (path === "/api/v1/health") return handleHealth(config);
    if (path === "/api/v1/info") return handleInfo(config);

    if (path === "/api/v1/domain-check") {
      return handleDomainCheck(client, url);
    }

    if (path.startsWith("/api/v1/serve/") || path === "/api/v1/serve") {
      return handleServe(client, config, path);
    }

    return new Response("Not found", { status: 404, headers: errorHeaders() });
  };
}

// ── API endpoint handlers ────────────────────────────────────────────

async function handleHealth(config: HostConfig): Promise<Response> {
  let backendStatus: "ok" | "error" = "error";
  try {
    const res = await fetch(`${config.backendUrl}/api/v1/health`);
    if (res.ok) backendStatus = "ok";
  } catch {
    backendStatus = "error";
  }

  const body = {
    status: backendStatus === "ok" ? "ok" : "degraded",
    timestamp: Date.now(),
    backend: { url: config.backendUrl, status: backendStatus },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: backendStatus === "ok" ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
}

function handleInfo(config: HostConfig): Response {
  const info = {
    type: "firecat-host",
    version: "0.1.0",
    target: config.target,
  };
  return new Response(JSON.stringify(info, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleDomainCheck(
  client: NodeProtocolReadInterface,
  url: URL,
): Promise<Response> {
  const domain = url.searchParams.get("domain");
  if (!domain) {
    return new Response("Missing domain parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const uri = `mutable://open/domains/${domain.toLowerCase()}`;
  const results = await client.read<DomainMapping | string>(uri);
  const result = results[0];

  if (result?.success && result.record?.data) {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Domain not registered", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}

// ── Content serving ──────────────────────────────────────────────────

async function handleServe(
  client: NodeProtocolReadInterface,
  config: HostConfig,
  path: string,
): Promise<Response> {
  const contentPath = path.replace(/^\/api\/v1\/serve\/?/, "");

  const target = await resolveTarget(client, config);
  if (!target) {
    return new Response("No target configured", {
      status: 503,
      headers: errorHeaders(),
    });
  }

  try {
    return await handleContent(client, target, contentPath);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Resolve the base target URI.
 * - If target ends with "/", use directly as base path
 * - If mutable:// without trailing "/", read as pointer
 * - Otherwise use directly
 */
async function resolveTarget(
  client: NodeProtocolReadInterface,
  config: HostConfig,
): Promise<string | null> {
  const { target } = config;
  if (!target) return null;

  if (target.endsWith("/")) return target;

  if (target.startsWith("mutable://")) {
    const results = await client.read<string>(target);
    const result = results[0];
    if (result?.success && result.record?.data) {
      const resolved = unwrapData(result.record.data);
      if (typeof resolved === "string") return resolved;
    }
  }

  return target;
}

async function handleCustomDomain(
  client: NodeProtocolReadInterface,
  host: string,
  path: string,
): Promise<Response> {
  const domain = host.split(":")[0].toLowerCase();

  const mappingUri = `mutable://open/domains/${domain}`;
  const results = await client.read<DomainMapping | string>(mappingUri);
  const result = results[0];

  if (!result?.success || !result.record?.data) {
    return new Response(`Domain not configured: ${domain}`, {
      status: 404,
      headers: errorHeaders(),
    });
  }

  const data = unwrapData(result.record.data);

  let baseUri: string;
  if (typeof data === "string") {
    baseUri = data;
  } else if (data && typeof data === "object" && "target" in data) {
    baseUri = data.target;
  } else {
    return new Response(`Invalid domain mapping for: ${domain}`, {
      status: 500,
      headers: errorHeaders(),
    });
  }

  const contentPath = path === "/" ? "" : path.slice(1);

  try {
    return await handleContent(client, baseUri, contentPath);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Compose base + path, resolve by protocol, serve content.
 * Falls back to index.html for directory-like paths.
 */
async function handleContent(
  client: NodeProtocolReadInterface,
  baseUri: string,
  contentPath: string,
): Promise<Response> {
  const normalizedBase = baseUri.endsWith("/") ? baseUri : `${baseUri}/`;
  const fullUri = contentPath
    ? `${normalizedBase}${contentPath}`
    : normalizedBase;

  let response = await resolveByProtocol(client, fullUri, contentPath);

  // index.html fallback for directory-like paths
  if (response.status === 404 && !hasFileExtension(contentPath)) {
    const basePath = contentPath.replace(/\/$/, "");
    const indexPath = basePath ? `${basePath}/index.html` : "index.html";
    const indexUri = `${normalizedBase}${indexPath}`;
    response = await resolveByProtocol(client, indexUri, indexPath);
  }

  return response;
}

/**
 * Resolve a URI based on its protocol.
 *
 * - link://   → read value (URI string), recursively resolve
 * - hash://   → read content-addressed data, serve directly
 * - mutable://, immutable:// → read and serve directly
 */
async function resolveByProtocol(
  client: NodeProtocolReadInterface,
  uri: string,
  originalPath: string,
  depth = 0,
): Promise<Response> {
  if (depth > MAX_LINK_DEPTH) {
    return new Response(`Too many link redirects (max ${MAX_LINK_DEPTH})`, {
      status: 508,
      headers: errorHeaders(),
    });
  }

  const protocol = getProtocol(uri);

  switch (protocol) {
    case "link": {
      const result = (await client.read<unknown>(uri))[0];
      if (!result?.success || !result.record?.data) {
        return new Response(`Link not found: ${uri}`, {
          status: 404,
          headers: errorHeaders(),
        });
      }

      const data = unwrapData(result.record.data);
      if (typeof data !== "string") {
        return new Response(
          `Invalid link value at ${uri}: expected URI string`,
          { status: 500, headers: errorHeaders() },
        );
      }

      return resolveByProtocol(client, data, originalPath, depth + 1);
    }

    case "hash": {
      const result = (await client.read<unknown>(uri))[0];
      if (!result?.success || !result.record?.data) {
        return new Response(`Hash not found: ${uri}`, {
          status: 404,
          headers: errorHeaders(),
        });
      }

      const data = unwrapData(result.record.data);
      return serveContent(data, originalPath);
    }

    case "mutable":
    case "immutable": {
      const result = (await client.read<unknown>(uri))[0];
      if (!result?.success || !result.record?.data) {
        return new Response(`Not found: ${uri}`, {
          status: 404,
          headers: errorHeaders(),
        });
      }

      const data = unwrapData(result.record.data);
      return serveContent(data, originalPath || uri);
    }

    default:
      return new Response(`Unsupported protocol: ${protocol}`, {
        status: 400,
        headers: errorHeaders(),
      });
  }
}

/** Serve content with appropriate Content-Type and Cache-Control headers */
function serveContent(data: unknown, uri: string): Response {
  const headers = new Headers();

  if (typeof data === "string") {
    headers.set("Content-Type", getContentType(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data, { status: 200, headers });
  }

  if (data instanceof Uint8Array) {
    headers.set("Content-Type", getContentType(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data as unknown as BodyInit, { status: 200, headers });
  }

  if (ArrayBuffer.isView(data)) {
    headers.set("Content-Type", getContentType(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Response(bytes as unknown as BodyInit, { status: 200, headers });
  }

  // Object/JSON fallback
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", getCacheControl(uri));
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers });
}

function handleError(error: unknown): Response {
  console.error("Error:", error);
  const message = error instanceof Error ? error.message : "Unknown error";
  return new Response(`Error: ${message}`, {
    status: 500,
    headers: errorHeaders(),
  });
}
