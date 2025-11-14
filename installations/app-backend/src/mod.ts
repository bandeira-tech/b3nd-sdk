/// <reference lib="deno.ns" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { HttpClient } from "@b3nd/sdk";

import { loadConfig } from "./config.ts";
import { loadServerKeys } from "../../wallet-server/src/server-keys.ts";
import {
  registerApp,
  loadAppConfig,
  validateString,
  performActionWrite,
  type AppRegistration,
} from "./apps.ts";

async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519" = "Ed25519",
): Promise<CryptoKey> {
  const base64 = pem.split("\n").filter((l) => !l.startsWith("-----")).join("");
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey("pkcs8", buffer, { name: "Ed25519", namedCurve: "Ed25519" }, false, ["sign"]);
  } else {
    return await crypto.subtle.importKey("pkcs8", buffer, { name: "X25519", namedCurve: "X25519" }, false, ["deriveBits"]);
  }
}

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

  // Register app with schema and keys (requires identity and encryption)
  app.post("/api/v1/apps/register", async (c) => {
    const body = (await c.req.json()) as AppRegistration;
    if (!body || !body.appKey || !body.accountPrivateKeyPem || !Array.isArray(body.allowedOrigins) || !Array.isArray(body.actions)) {
      return c.json({ success: false, error: "invalid registration payload" }, 400);
    }
    // Require encryption public key to be set at registration time so future encrypted actions are possible
    if (!body.encryptionPublicKeyHex) {
      return c.json({ success: false, error: "encryptionPublicKeyHex required in registration" }, 400);
    }
    // create a token id and return composite token `${appKey}.${tokenId}`
    const tokenIdBytes = crypto.getRandomValues(new Uint8Array(16));
    const tokenId = Array.from(tokenIdBytes).map(b=>b.toString(16).padStart(2,"0")).join("");
    const token = `${body.appKey}.${tokenId}`;

    const res = await registerApp(
      dataClient,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.identityKey.privateKeyPem,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.encryptionKey.publicKeyHex,
      { ...body, tokens: [tokenId] },
    );
    if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
    return c.json({ success: true, token });
  });

  // Update schema only
  app.post("/api/v1/apps/:appKey/schema", async (c) => {
    const appKey = c.req.param("appKey");
    const actions = (await c.req.json()) as any[];
    if (!Array.isArray(actions)) return c.json({ success: false, error: "invalid actions payload" }, 400);

    // Load current to preserve secrets and origins
    const loaded = await loadAppConfig(
      dataClient,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.encryptionKey.privateKeyPem,
      appKey,
    );
    // If new actions include encrypted writes but the stored config has no encryption key, block update
    const wantsEncrypted = Array.isArray(actions) && actions.some((a: any) => a?.write?.encrypted);
    if (wantsEncrypted && !loaded.encryptionPublicKeyHex) {
      return c.json({ success: false, error: "encrypted actions require encryptionPublicKeyHex in app registration" }, 400);
    }

    const reg: AppRegistration = {
      appKey,
      accountPrivateKeyPem: loaded.accountPrivateKeyPem,
      encryptionPublicKeyHex: loaded.encryptionPublicKeyHex || undefined,
      allowedOrigins: loaded.config.allowedOrigins,
      actions: actions as any,
    };
    const res = await registerApp(
      dataClient,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.identityKey.privateKeyPem,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.encryptionKey.publicKeyHex,
      reg,
    );
    if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
    return c.json({ success: true });
  });

  // Fetch current schema (redacted; no secrets)
  app.get("/api/v1/apps/:appKey/schema", async (c) => {
    const appKey = c.req.param("appKey");
    try {
      const loaded = await loadAppConfig(
        dataClient,
        serverKeys.identityKey.publicKeyHex,
        serverKeys.encryptionKey.privateKeyPem,
        appKey,
      );
      return c.json({ success: true, config: loaded.config });
    } catch (e) {
      return c.json({ success: false, error: (e as Error).message || "not found" }, 404);
    }
  });

  // Register a session for an app; body: { token: string }
  app.post("/api/v1/app/:appKey/session", async (c) => {
    const appKey = c.req.param("appKey");
    const origin = c.req.header("Origin") || c.req.header("origin");
    if (!origin) return c.json({ success: false, error: "origin header required" }, 400);
    const body = await c.req.json().catch(() => ({})) as { token?: string };
    const token = body.token;
    if (!token || typeof token !== "string") return c.json({ success: false, error: "token required" }, 400);
    const [tokenAppKey, tokenId] = token.split(".");
    if (!tokenAppKey || !tokenId || tokenAppKey !== appKey) return c.json({ success: false, error: "invalid token" }, 400);

    const { config, accountPrivateKeyPem, encryptionPublicKeyHex, tokens } = await loadAppConfig(
      dataClient,
      serverKeys.identityKey.publicKeyHex,
      serverKeys.encryptionKey.privateKeyPem,
      appKey,
    );
    if (!config.allowedOrigins.includes("*") && !config.allowedOrigins.some((o) => origin.startsWith(o))) {
      return c.json({ success: false, error: "origin not allowed" }, 403);
    }
    if (!tokens.includes(tokenId)) return c.json({ success: false, error: "unknown token" }, 400);

    // create session key
    const sessionBytes = crypto.getRandomValues(new Uint8Array(16));
    const session = Array.from(sessionBytes).map(b=>b.toString(16).padStart(2,"0")).join("");
    const sigInput = new TextEncoder().encode(`${tokenId}.${session}`);
    const digest = await crypto.subtle.digest("SHA-256", sigInput);
    const sigHex = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("").substring(0,32);
    const uri = `mutable://accounts/${appKey}/sessions/${sigHex}`;

    // sign (no encryption) with app account key
    const { createAuthenticatedMessage } = await import("@b3nd/sdk/encrypt");
    const signerKey = await pemToCryptoKey(accountPrivateKeyPem, "Ed25519");
    const msg = await createAuthenticatedMessage(session, [{ privateKey: signerKey, publicKeyHex: appKey }]);
    const res = await dataClient.write(uri, msg);
    if (!res.success) return c.json({ success: false, error: res.error || "write failed" }, 400);
    return c.json({ success: true, session, uri });
  });

  // Invoke action (generic catch-all, must come after specific routes like /session)
  app.post("/api/v1/app/:appKey/:action", async (c) => {
    const appKey = c.req.param("appKey");
    const actionName = c.req.param("action");

    const origin = c.req.header("Origin") || c.req.header("origin");
    if (!origin) return c.json({ success: false, error: "origin header required" }, 400);

    const payload = await c.req.text();
    if (!payload || typeof payload !== "string") return c.json({ success: false, error: "string payload required" }, 400);

    const { config, accountPrivateKeyPem, encryptionPublicKeyHex } = await loadAppConfig(
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

    // Validate
    if (!validateString(payload, action.validation?.stringValue)) {
      return c.json({ success: false, error: "validation failed" }, 400);
    }

    // Perform write
    const { uri, result } = await performActionWrite(
      dataClient,
      action,
      appKey,
      accountPrivateKeyPem,
      encryptionPublicKeyHex,
      payload,
    );
    if (!result.success) return c.json({ success: false, error: result.error || "write failed" }, 400);
    return c.json({ success: true, uri, record: result.record });
  });


  Deno.serve({
    port: config.port,
    onListen: () => {
      console.log(`\n✅ App backend on http://localhost:${config.port}`);
      console.log("   GET    /api/v1/health");
      console.log("   POST   /api/v1/apps/register");
      console.log("   POST   /api/v1/apps/:appKey/schema");
      console.log("   GET    /api/v1/apps/:appKey/schema");
      console.log("   POST   /api/v1/app/:appKey/session");
      console.log("   POST   /api/v1/app/:appKey/:action\n");
    },
    handler: app.fetch,
  });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  Deno.exit(1);
});
