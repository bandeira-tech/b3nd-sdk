import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "@bandeira-tech/b3nd-sdk";
import { FirecatDataClient } from "@firecat/protocol/client";
import { createHandler } from "../src/handler.ts";
import type { HostConfig } from "../src/types.ts";

// ── Test helpers ─────────────────────────────────────────────────────

function makeConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  return {
    backendUrl: "http://localhost:9942",
    port: 8080,
    target: "immutable://accounts/abc/site/v1/",
    ...overrides,
  };
}

function req(path: string, host = "localhost:8080"): Request {
  return new Request(`http://${host}${path}`, {
    headers: { host },
  });
}

// ── Tests ────────────────────────────────────────────────────────────

Deno.test("health endpoint returns json with backend status", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig({ backendUrl: "http://localhost:1" });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/health"));
  const body = await res.json();
  assertEquals(typeof body.status, "string");
  assertEquals(typeof body.timestamp, "number");
  assertEquals(body.backend.url, "http://localhost:1");
});

Deno.test("info endpoint returns type and version", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig();
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/info"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.type, "firecat-host");
  assertEquals(body.version, "0.1.0");
});

Deno.test("serve content from immutable:// target", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  await client.receive([
    ["immutable://accounts/abc/site/v1/index.html", {}, "<h1>Hello</h1>"],
  ]);

  const config = makeConfig({
    target: "immutable://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/index.html"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "<h1>Hello</h1>");
  assertEquals(
    res.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
});

Deno.test("index.html fallback for directory paths", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  await client.receive([
    ["immutable://accounts/abc/site/v1/index.html", {}, "<h1>Root</h1>"],
  ]);
  await client.receive([
    ["immutable://accounts/abc/site/v1/about/index.html", {}, "<h1>About</h1>"],
  ]);

  const config = makeConfig({
    target: "immutable://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  // Root path → index.html
  const res1 = await handler(req("/api/v1/serve"));
  assertEquals(res1.status, 200);
  assertEquals(await res1.text(), "<h1>Root</h1>");

  // Subdir path → subdir/index.html
  const res2 = await handler(req("/api/v1/serve/about"));
  assertEquals(res2.status, 200);
  assertEquals(await res2.text(), "<h1>About</h1>");
});

Deno.test("mutable:// target pointer resolution", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  // Mutable pointer → immutable version
  await client.receive([
    ["mutable://accounts/abc/site", {}, "immutable://accounts/abc/site/v1/"],
  ]);
  await client.receive([
    ["immutable://accounts/abc/site/v1/index.html", {}, "<h1>v1</h1>"],
  ]);

  const config = makeConfig({
    target: "mutable://accounts/abc/site",
  });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/index.html"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "<h1>v1</h1>");
});

Deno.test("link:// protocol following to hash://", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  // Link points to a hash URI
  await client.receive([
    ["link://accounts/abc/site/v1/app.js", {}, "hash://sha256/deadbeef"],
  ]);
  await client.receive([
    ["hash://sha256/deadbeef", {}, "console.log('hello');"],
  ]);

  const config = makeConfig({
    target: "link://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/app.js"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "console.log('hello');");
  assertEquals(
    res.headers.get("content-type"),
    "application/javascript; charset=utf-8",
  );
});

Deno.test("link:// chain following (link → link → hash)", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  await client.receive([
    ["link://accounts/abc/site/v1/style.css", {}, "link://open/redirect/style.css"],
  ]);
  await client.receive([
    ["link://open/redirect/style.css", {}, "hash://sha256/cafebabe"],
  ]);
  await client.receive([
    ["hash://sha256/cafebabe", {}, "body { color: red; }"],
  ]);

  const config = makeConfig({
    target: "link://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/style.css"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "body { color: red; }");
  assertEquals(
    res.headers.get("content-type"),
    "text/css; charset=utf-8",
  );
});

Deno.test("max link depth protection", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  // Create a chain of 12 links (exceeds max depth of 10)
  for (let i = 0; i < 12; i++) {
    await client.receive([
      [`link://open/chain/${i}`, {}, `link://open/chain/${i + 1}`],
    ]);
  }

  const config = makeConfig({ target: "link://open/chain/" });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/0"));
  assertEquals(res.status, 508);
  const text = await res.text();
  assertEquals(text.includes("Too many link redirects"), true);
});

Deno.test("custom domain lookup and serving", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  // Register domain
  await client.receive([
    ["mutable://open/domains/myapp.com", {}, { target: "immutable://accounts/xyz/site/v1/", created: Date.now() }],
  ]);
  await client.receive([
    ["immutable://accounts/xyz/site/v1/index.html", {}, "<h1>My App</h1>"],
  ]);

  const config = makeConfig({ primaryDomain: "api.firecat.dev" });
  const handler = createHandler(client, config);

  const res = await handler(req("/", "myapp.com"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "<h1>My App</h1>");
});

Deno.test("custom domain with string mapping", async () => {
  const client = new FirecatDataClient(new MemoryStore());

  await client.receive([
    ["mutable://open/domains/simple.com", {}, "immutable://accounts/xyz/site/v2/"],
  ]);
  await client.receive([
    ["immutable://accounts/xyz/site/v2/page.html", {}, "<h1>Simple</h1>"],
  ]);

  const config = makeConfig({ primaryDomain: "api.firecat.dev" });
  const handler = createHandler(client, config);

  const res = await handler(req("/page.html", "simple.com"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "<h1>Simple</h1>");
});

Deno.test("domain-check returns 200 for registered domain", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  await client.receive([
    ["mutable://open/domains/registered.com", {}, { target: "immutable://accounts/xyz/site/", created: Date.now() }],
  ]);

  const config = makeConfig();
  const handler = createHandler(client, config);

  const res = await handler(
    req("/api/v1/domain-check?domain=registered.com"),
  );
  assertEquals(res.status, 200);
});

Deno.test("domain-check returns 404 for unregistered domain", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig();
  const handler = createHandler(client, config);

  const res = await handler(
    req("/api/v1/domain-check?domain=unknown.com"),
  );
  assertEquals(res.status, 404);
});

Deno.test("MIME type detection for various extensions", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const files: [string, string, string][] = [
    ["index.html", "<html></html>", "text/html; charset=utf-8"],
    ["style.css", "body{}", "text/css; charset=utf-8"],
    ["app.js", "var x=1", "application/javascript; charset=utf-8"],
    ["image.png", "PNG", "image/png"],
    ["data.json", "{}", "application/json; charset=utf-8"],
    ["font.woff2", "woff", "font/woff2"],
  ];

  for (const [name, content, expectedType] of files) {
    await client.receive([
      [`immutable://accounts/abc/site/v1/${name}`, {}, content],
    ]);
  }

  const config = makeConfig({
    target: "immutable://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  for (const [name, _content, expectedType] of files) {
    const res = await handler(req(`/api/v1/serve/${name}`));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), expectedType);
  }
});

Deno.test("cache headers for fingerprinted assets", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  await client.receive([
    ["immutable://accounts/abc/site/v1/app.a1b2c3d4.js", {}, "// hashed"],
  ]);
  await client.receive([
    ["immutable://accounts/abc/site/v1/plain.js", {}, "// plain"],
  ]);

  const config = makeConfig({
    target: "immutable://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  // Fingerprinted → immutable cache
  const res1 = await handler(req("/api/v1/serve/app.a1b2c3d4.js"));
  assertEquals(res1.status, 200);
  assertEquals(
    res1.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );

  // Non-fingerprinted → 1h cache
  const res2 = await handler(req("/api/v1/serve/plain.js"));
  assertEquals(res2.status, 200);
  assertEquals(res2.headers.get("cache-control"), "public, max-age=3600");
});

Deno.test("404 for missing content", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig({
    target: "immutable://accounts/abc/site/v1/",
  });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/nonexistent.html"));
  assertEquals(res.status, 404);
});

Deno.test("404 for unknown API endpoint", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig();
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/unknown"));
  assertEquals(res.status, 404);
});

Deno.test("503 when no target configured", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig({ target: undefined });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/index.html"));
  assertEquals(res.status, 503);
});

Deno.test("unsupported protocol returns 400", async () => {
  const client = new FirecatDataClient(new MemoryStore());
  const config = makeConfig({ target: "ftp://example.com/site/" });
  const handler = createHandler(client, config);

  const res = await handler(req("/api/v1/serve/file.txt"));
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text.includes("Unsupported protocol"), true);
});
