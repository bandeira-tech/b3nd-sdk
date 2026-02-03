/// <reference lib="deno.ns" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { HttpClient } from "@b3nd/sdk";

import { loadConfig } from "./config.ts";
import { loadServerKeys } from "./server-keys.ts";
import {
  loadAppConfig,
  validateString,
  performActionWrite,
  saveAppConfig,
  verifySignedRequest,
  type SignedRequest,
  type StoredAppConfig,
} from "./apps.ts";

async function main() {
  const config = loadConfig();
  const serverKeys = loadServerKeys();

  const dataClient = new HttpClient({ url: config.dataNodeUrl });

  const app = new Hono();
  app.use("/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));

  app.use(async (c: Context, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path} ${c.res.status} - ${ms}ms`);
  });

  app.get("/api/v1/health", (c) => c.json({ status: "ok", server: "b3nd-app-backend", ts: new Date().toISOString() }));

  async function readSignedRequest<T>(c: Context): Promise<SignedRequest<T>> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new Error("invalid signed request");
    return body as SignedRequest<T>;
  }

  // Update allowed origins (and optional encryption public key)
  app.post("/api/v1/apps/origins/:appKey", async (c) => {
    const appKey = c.req.param("appKey");
    try {
      const message = await readSignedRequest<{
        allowedOrigins?: string[];
        encryptionPublicKeyHex?: string | null;
      }>(c);
      const valid = await verifySignedRequest(appKey, message);
      if (!valid) return c.json({ success: false, error: "signature invalid" }, 401);

      const allowedOrigins = Array.isArray(message.payload.allowedOrigins) ? message.payload.allowedOrigins : ["*"];
      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      const merged: StoredAppConfig = {
        appKey,
        allowedOrigins,
        actions: loaded.actions,
        encryptionPublicKeyHex: message.payload.encryptionPublicKeyHex ?? loaded.encryptionPublicKeyHex ?? null,
        googleClientId: loaded.googleClientId ?? null,
      };
      const res = await saveAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.identityKey.privateKeyPem,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.publicKeyHex,
        merged,
      );
      if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message || "failed" }, 400);
    }
  });

  // Update Google Client ID (signed by app key)
  app.post("/api/v1/apps/google-client-id/:appKey", async (c) => {
    const appKey = c.req.param("appKey");
    try {
      const message = await readSignedRequest<{ googleClientId: string | null }>(c);
      const valid = await verifySignedRequest(appKey, message);
      if (!valid) return c.json({ success: false, error: "signature invalid" }, 401);

      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      const merged: StoredAppConfig = {
        ...loaded,
        googleClientId: message.payload.googleClientId ?? null,
      };
      const res = await saveAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.identityKey.privateKeyPem,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.publicKeyHex,
        merged,
      );
      if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message || "failed" }, 400);
    }
  });

  // Update schema only (signed by app key)
  app.post("/api/v1/apps/schema/:appKey", async (c) => {
    const appKey = c.req.param("appKey");
    try {
      const message = await readSignedRequest<{ actions: any[]; encryptionPublicKeyHex?: string | null }>(c);
      const valid = await verifySignedRequest(appKey, message);
      if (!valid) return c.json({ success: false, error: "signature invalid" }, 401);
      if (!Array.isArray(message.payload.actions)) {
        return c.json({ success: false, error: "invalid actions payload" }, 400);
      }

      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      const wantsEncrypted = message.payload.actions.some((a: any) => a?.write?.encrypted);
      const encryptionPublicKeyHex = message.payload.encryptionPublicKeyHex ?? loaded.encryptionPublicKeyHex ?? null;
      if (wantsEncrypted && !encryptionPublicKeyHex) {
        return c.json({ success: false, error: "encrypted actions require encryptionPublicKeyHex" }, 400);
      }

      const merged: StoredAppConfig = {
        appKey,
        allowedOrigins: loaded.allowedOrigins,
        actions: message.payload.actions as any,
        encryptionPublicKeyHex,
        googleClientId: loaded.googleClientId ?? null,
      };
      const res = await saveAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.identityKey.privateKeyPem,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.publicKeyHex,
        merged,
      );
      if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message || "failed" }, 400);
    }
  });

  // Fetch current schema (public)
  app.get("/api/v1/apps/schema/:appKey", async (c) => {
    const appKey = c.req.param("appKey");
    try {
      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      return c.json({ success: true, config: loaded });
    } catch (e) {
      return c.json({ success: false, error: (e as Error).message || "not found" }, 404);
    }
  });

  // Read and (if needed) decrypt a record for an app
  app.get("/api/v1/app/:appKey/read", async (c) => {
    const appKey = c.req.param("appKey");
    const url = new URL(c.req.url);
    const uri = url.searchParams.get("uri");
    if (!uri) return c.json({ success: false, error: "uri is required" }, 400);

    try {
      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );

      const readRes = await dataClient.read<any>(uri);
      if (!readRes.success || !readRes.record) {
        return c.json({ success: false, error: readRes.error || "not found" }, 404);
      }

      const raw = readRes.record.data;
      let data: unknown = raw;
      const hasPayload = raw && typeof raw === 'object' && 'payload' in (raw as any);
      // If payload is present and not encrypted, unwrap it for convenience
      const maybeEncrypted = hasPayload && (raw as any).payload && typeof (raw as any).payload === 'object' && 'nonce' in (raw as any).payload && 'data' in (raw as any).payload;
      if (!maybeEncrypted && hasPayload) {
        data = (raw as any).payload;
      }

      return c.json({ success: true, uri, record: { ts: readRes.record.ts, data }, raw: readRes.record.data });
    } catch (e) {
      return c.json({ success: false, error: (e as Error).message || "read failed" }, 500);
    }
  });

  // Register a session for an app; body: signed message { auth, payload: { sessionPubkey } }
  // Session approval flow:
  // 1. Client generates session keypair
  // 2. Client requests approval here with sessionPubkey
  // 3. App writes approval: mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
  // 4. Client uses session keypair for login (wallet validates session exists and equals 1)
  app.post("/api/v1/app/:appKey/session", async (c) => {
    const appKey = c.req.param("appKey");
    const origin = c.req.header("Origin") || c.req.header("origin");
    try {
      const message = await readSignedRequest<{ sessionPubkey?: string; session?: string }>(c);
      const valid = await verifySignedRequest(appKey, message);
      if (!valid) return c.json({ success: false, error: "signature invalid" }, 401);

      // Support both new (sessionPubkey) and legacy (session) fields during transition
      const sessionPubkey = message.payload.sessionPubkey || message.payload.session;
      if (!sessionPubkey || typeof sessionPubkey !== "string") {
        return c.json({ success: false, error: "sessionPubkey required" }, 400);
      }

      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      if (origin && !loaded.allowedOrigins.includes("*") && !loaded.allowedOrigins.some((o) => origin.startsWith(o))) {
        return c.json({ success: false, error: "origin not allowed" }, 403);
      }

      // Write session approval with value 1 (approved)
      // Session pubkey is used directly as the identifier (no hashing)
      const uri = `mutable://accounts/${appKey}/sessions/${sessionPubkey}`;

      // Write just the value 1 to indicate approval (0 would mean revoked)
      const res = await dataClient.receive([uri, 1]);
      if (!res.accepted) return c.json({ success: false, error: res.error || "write failed" }, 400);
      return c.json({ success: true, sessionPubkey, uri });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message || "failed" }, 400);
    }
  });

  // Invoke action (generic catch-all, must come after specific routes like /session)
  app.post("/api/v1/app/:appKey/:action", async (c) => {
    const appKey = c.req.param("appKey");
    const actionName = c.req.param("action");

    const origin = c.req.header("Origin") || c.req.header("origin");
    if (!origin) return c.json({ success: false, error: "origin header required" }, 400);

    const signedMessage = await readSignedRequest<any>(c);
    const valid = await verifySignedRequest(appKey, signedMessage);
    if (!valid) return c.json({ success: false, error: "signature invalid" }, 401);
    const payload = signedMessage.payload;

    const config = await loadAppConfig(
      dataClient,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.encryptionKey.privateKeyPem,
      appKey,
    );

    if (!config.allowedOrigins.includes("*") && !config.allowedOrigins.some((o) => origin.startsWith(o))) {
      return c.json({ success: false, error: "origin not allowed" }, 403);
    }

    const action = config.actions.find((a) => a.action === actionName);
    if (!action) return c.json({ success: false, error: "action not found" }, 404);

    // Validate (only for plain string payloads)
    if (!action.write.encrypted && typeof payload === "string" && !validateString(payload, action.validation?.stringValue)) {
      return c.json({ success: false, error: "validation failed" }, 400);
    }

    const { uri, result } = await performActionWrite(dataClient, action, appKey, signedMessage);
    if (!result.success) return c.json({ success: false, error: result.error || "write failed" }, 400);
    return c.json({ success: true, uri, record: result.record });
  });


  Deno.serve({
    port: config.port,
    onListen: () => {
      console.log(`\n✅ App backend on http://localhost:${config.port}`);
      console.log("   GET    /api/v1/health");
      console.log("   POST   /api/v1/apps/origins/:appKey");
      console.log("   POST   /api/v1/apps/google-client-id/:appKey");
      console.log("   POST   /api/v1/apps/schema/:appKey");
      console.log("   GET    /api/v1/apps/schema/:appKey");
      console.log("   POST   /api/v1/app/:appKey/session");
      console.log("   GET    /api/v1/app/:appKey/read");
      console.log("   POST   /api/v1/app/:appKey/:action\n");
    },
    handler: app.fetch,
  });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  Deno.exit(1);
});
