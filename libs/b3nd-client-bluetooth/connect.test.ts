/**
 * Tests for Bluetooth URL parsing and transport connector
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  createBluetoothTransport,
  parseBluetoothUrl,
  registerBluetoothTransport,
} from "./connect.ts";
import { BluetoothClient, MockBluetoothTransport } from "./mod.ts";
import type { BluetoothTransport } from "./mod.ts";

// ---------------------------------------------------------------------------
// URL Parsing
// ---------------------------------------------------------------------------

Deno.test("parseBluetoothUrl - mock address", () => {
  const spec = parseBluetoothUrl("bluetooth://mock");
  assertEquals(spec.address, "mock");
  assertEquals(spec.transportType, "mock");
  assertEquals(spec.timeout, 30000);
  assertEquals(spec.channel, undefined);
});

Deno.test("parseBluetoothUrl - web address", () => {
  const spec = parseBluetoothUrl("bluetooth://web");
  assertEquals(spec.address, "web");
  assertEquals(spec.transportType, "web");
});

Deno.test("parseBluetoothUrl - web with filters", () => {
  const spec = parseBluetoothUrl(
    "bluetooth://web?service=b3nd0001&name=MyNode&timeout=60000",
  );
  assertEquals(spec.address, "web");
  assertEquals(spec.transportType, "web");
  assertEquals(spec.serviceUuid, "b3nd0001");
  assertEquals(spec.nameFilter, "MyNode");
  assertEquals(spec.timeout, 60000);
});

Deno.test("parseBluetoothUrl - MAC address", () => {
  const spec = parseBluetoothUrl("bluetooth://AA:BB:CC:DD:EE:FF");
  assertEquals(spec.address, "AA:BB:CC:DD:EE:FF");
  assertEquals(spec.channel, undefined);
  assertEquals(spec.transportType, "auto");
});

Deno.test("parseBluetoothUrl - MAC address lowercase normalized", () => {
  const spec = parseBluetoothUrl("bluetooth://aa:bb:cc:dd:ee:ff");
  assertEquals(spec.address, "AA:BB:CC:DD:EE:FF");
});

Deno.test("parseBluetoothUrl - MAC address with channel", () => {
  const spec = parseBluetoothUrl("bluetooth://AA:BB:CC:DD:EE:FF:3");
  assertEquals(spec.address, "AA:BB:CC:DD:EE:FF");
  assertEquals(spec.channel, 3);
  assertEquals(spec.transportType, "rfcomm");
});

Deno.test("parseBluetoothUrl - forced transport type", () => {
  const spec = parseBluetoothUrl(
    "bluetooth://AA:BB:CC:DD:EE:FF?transport=ble",
  );
  assertEquals(spec.address, "AA:BB:CC:DD:EE:FF");
  assertEquals(spec.transportType, "ble");
});

Deno.test("parseBluetoothUrl - custom timeout", () => {
  const spec = parseBluetoothUrl("bluetooth://mock?timeout=5000");
  assertEquals(spec.timeout, 5000);
});

Deno.test("parseBluetoothUrl - rejects non-bluetooth URL", () => {
  try {
    parseBluetoothUrl("http://example.com");
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("must start with bluetooth://"),
      true,
    );
  }
});

Deno.test("parseBluetoothUrl - rejects invalid transport type", () => {
  try {
    parseBluetoothUrl("bluetooth://mock?transport=invalid");
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Invalid transport type"),
      true,
    );
  }
});

// ---------------------------------------------------------------------------
// Transport Connector
// ---------------------------------------------------------------------------

Deno.test({
  name: "createBluetoothTransport - mock transport connects and works",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = await createBluetoothTransport("bluetooth://mock");
    assertEquals(transport.connected, true);

    // Full round-trip via client
    const client = new BluetoothClient({
      transport,
      reconnect: { enabled: false },
    });

    const result = await client.receive([
      "store://users/alice/profile",
      { name: "Alice" },
    ]);
    assertEquals(result.accepted, true);

    const read = await client.read("store://users/alice/profile");
    assertEquals(read.success, true);
    assertEquals(read.record?.data, { name: "Alice" });

    await client.cleanup();
  },
});

Deno.test("createBluetoothTransport - rejects unregistered transport", async () => {
  await assertRejects(
    () => createBluetoothTransport("bluetooth://web"),
    Error,
    "No Bluetooth transport factory registered",
  );
});

Deno.test("createBluetoothTransport - rejects auto without factory", async () => {
  await assertRejects(
    () => createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF"),
    Error,
    "No Bluetooth transport registered",
  );
});

Deno.test({
  name: "createBluetoothTransport - custom factory registration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let factoryCalled = false;
    let receivedSpec: any = null;

    // Register a custom "ble" factory
    registerBluetoothTransport("ble", async (spec) => {
      factoryCalled = true;
      receivedSpec = spec;
      // Use a mock under the hood
      const transport = new MockBluetoothTransport();
      await transport.connect();
      return transport;
    });

    const transport = await createBluetoothTransport(
      "bluetooth://AA:BB:CC:DD:EE:FF?transport=ble&timeout=5000",
    );

    assertEquals(factoryCalled, true);
    assertEquals(receivedSpec.address, "AA:BB:CC:DD:EE:FF");
    assertEquals(receivedSpec.timeout, 5000);
    assertEquals(transport.connected, true);

    await transport.disconnect();
  },
});

Deno.test({
  name: "createBluetoothTransport - rfcomm factory with channel",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let receivedSpec: any = null;

    registerBluetoothTransport("rfcomm", async (spec) => {
      receivedSpec = spec;
      const transport = new MockBluetoothTransport();
      await transport.connect();
      return transport;
    });

    const transport = await createBluetoothTransport(
      "bluetooth://AA:BB:CC:DD:EE:FF:3",
    );

    assertEquals(receivedSpec.address, "AA:BB:CC:DD:EE:FF");
    assertEquals(receivedSpec.channel, 3);
    assertEquals(receivedSpec.transportType, "rfcomm");
    assertEquals(transport.connected, true);

    await transport.disconnect();
  },
});

Deno.test({
  name:
    "createBluetoothTransport - rejects factory that returns disconnected transport",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Register a factory under an allowed name that returns without connecting
    registerBluetoothTransport("ble", async (_spec) => {
      // Intentionally return without connecting
      return new MockBluetoothTransport();
    });

    await assertRejects(
      () =>
        createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF?transport=ble"),
      Error,
      "disconnected transport",
    );
  },
});

// ---------------------------------------------------------------------------
// End-to-end: URL → Transport → Client → CRUD
// ---------------------------------------------------------------------------

Deno.test({
  name: "end-to-end: bluetooth://mock URL through full CRUD",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = await createBluetoothTransport("bluetooth://mock");
    const client = new BluetoothClient({
      transport,
      reconnect: { enabled: false },
    });

    // Write
    const w = await client.receive([
      "store://users/e2e/profile",
      { name: "E2E Test", value: 42 },
    ]);
    assertEquals(w.accepted, true);

    // Read
    const r = await client.read("store://users/e2e/profile");
    assertEquals(r.success, true);
    assertEquals(r.record?.data, { name: "E2E Test", value: 42 });

    // List
    const l = await client.list("store://users/e2e");
    assertEquals(l.success, true);
    if (l.success) {
      assertEquals(l.data.length, 1);
    }

    // Delete
    const d = await client.delete("store://users/e2e/profile");
    assertEquals(d.success, true);

    // Verify deleted
    const r2 = await client.read("store://users/e2e/profile");
    assertEquals(r2.success, false);

    // Health
    const h = await client.health();
    assertEquals(h.status, "healthy");

    await client.cleanup();
  },
});
