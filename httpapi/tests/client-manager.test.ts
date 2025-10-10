/**
 * Tests for Client Manager functionality
 */

import { assert, assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { getClientManager, resetClientManager } from "../src/clients.ts";
import { createTestClient } from "./test-utils.ts";

Deno.test("ClientManager - clean state after reset", () => {
  resetClientManager();
  const manager = getClientManager();

  assertEquals(manager.getInstanceNames().length, 0);
  assertEquals(manager.getDefaultInstance(), undefined);
});

Deno.test("ClientManager - register and retrieve client", () => {
  resetClientManager();
  const manager = getClientManager();

  const client = createTestClient("test1");
  manager.registerClient("test1", client);

  const retrievedClient = manager.getClient("test1");
  assertEquals(retrievedClient, client);
});

Deno.test("ClientManager - register default client", () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("client1");
  const client2 = createTestClient("client2");

  manager.registerClient("client1", client1);
  manager.registerClient("client2", client2, true); // Set as default

  assertEquals(manager.getDefaultInstance(), "client2");
  assertEquals(manager.getClient(), client2); // Should return default
});

Deno.test("ClientManager - auto-set first client as default", () => {
  resetClientManager();
  const manager = getClientManager();

  const client = createTestClient("only");
  manager.registerClient("only", client);

  assertEquals(manager.getDefaultInstance(), "only");
  assertEquals(manager.getClient(), client);
});

Deno.test("ClientManager - get all instance names", () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("alpha");
  const client2 = createTestClient("beta");
  const client3 = createTestClient("gamma");

  manager.registerClient("alpha", client1);
  manager.registerClient("beta", client2);
  manager.registerClient("gamma", client3);

  const names = manager.getInstanceNames();
  assertEquals(names.length, 3);
  assert(names.includes("alpha"));
  assert(names.includes("beta"));
  assert(names.includes("gamma"));
});

Deno.test("ClientManager - get non-existent client throws error", async () => {
  resetClientManager();
  const manager = getClientManager();

  await assertRejects(
    async () => manager.getClient("nonexistent"),
    Error,
    "Client instance 'nonexistent' not found"
  );
});

Deno.test("ClientManager - get client with no default throws error", async () => {
  resetClientManager();
  const manager = getClientManager();

  await assertRejects(
    async () => manager.getClient(),
    Error,
    "No instance name provided and no default instance set"
  );
});

Deno.test("ClientManager - get schemas from all clients", async () => {
  resetClientManager();
  const manager = getClientManager();

  const schema1 = { "users://": async () => ({ valid: true }) };
  const schema2 = { "posts://": async () => ({ valid: true }) };

  const client1 = new MemoryClient({ schema: schema1 });
  const client2 = new MemoryClient({ schema: schema2 });

  manager.registerClient("client1", client1);
  manager.registerClient("client2", client2);

  const schemas = await manager.getSchemas();

  assertEquals(Object.keys(schemas).length, 2);
  assertEquals(schemas.client1, ["users://"]);
  assertEquals(schemas.client2, ["posts://"]);
});

Deno.test("ClientManager - initialize with config", async () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("init1");
  const client2 = createTestClient("init2");

  await manager.initialize({
    clients: [
      { name: "init1", client: client1 },
      { name: "init2", client: client2, isDefault: true }
    ]
  });

  assertEquals(manager.getInstanceNames().length, 2);
  assertEquals(manager.getDefaultInstance(), "init2");
  assertEquals(manager.getClient("init1"), client1);
  assertEquals(manager.getClient("init2"), client2);
});

Deno.test("ClientManager - cleanup removes all clients", async () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("cleanup1");
  const client2 = createTestClient("cleanup2");

  manager.registerClient("cleanup1", client1);
  manager.registerClient("cleanup2", client2);

  assertEquals(manager.getInstanceNames().length, 2);

  await manager.cleanup();

  assertEquals(manager.getInstanceNames().length, 0);
  assertEquals(manager.getDefaultInstance(), undefined);
});

Deno.test("ClientManager - reset removes singleton instance", () => {
  const manager1 = getClientManager();
  const client = createTestClient("reset");
  manager1.registerClient("reset", client);

  resetClientManager();

  const manager2 = getClientManager();
  assertEquals(manager2.getInstanceNames().length, 0);
  assert(manager1 !== manager2); // Should be different instances
});

Deno.test("ClientManager - multiple registrations with same name overwrite", () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("duplicate");
  const client2 = createTestClient("duplicate");

  manager.registerClient("duplicate", client1);
  manager.registerClient("duplicate", client2);

  assertEquals(manager.getClient("duplicate"), client2);
  assertEquals(manager.getInstanceNames().length, 1);
});

Deno.test("ClientManager - register client with isDefault flag", () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("first");
  const client2 = createTestClient("second");

  manager.registerClient("first", client1);
  manager.registerClient("second", client2, true); // Explicitly set as default

  assertEquals(manager.getDefaultInstance(), "second");
  assertEquals(manager.getClient(), client2);
});

Deno.test("ClientManager - default client selection when multiple registered", () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = createTestClient("client1");
  const client2 = createTestClient("client2");
  const client3 = createTestClient("client3");

  // Register without specifying default
  manager.registerClient("client1", client1);
  manager.registerClient("client2", client2);
  manager.registerClient("client3", client3);

  // First one should be default
  assertEquals(manager.getDefaultInstance(), "client1");
});