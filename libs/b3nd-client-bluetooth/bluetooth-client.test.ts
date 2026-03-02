/**
 * BluetoothClient Tests
 *
 * Runs the shared NodeProtocolInterface test suite against the
 * BluetoothClient using mock transports, then adds Bluetooth-specific
 * tests for reconnection, transport injection, and error simulation.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import {
  BluetoothClient,
  type BluetoothTransport,
  FailingBluetoothTransport,
  MockBluetoothTransport,
  ValidationFailingBluetoothTransport,
} from "./mod.ts";
import {
  runSharedSuite,
  type TestClientFactories,
} from "../b3nd-testing/shared-suite.ts";

// ---------------------------------------------------------------------------
// Shared suite — verifies BluetoothClient against the full protocol spec
// ---------------------------------------------------------------------------

const factories: TestClientFactories = {
  happy: () => {
    const transport = new MockBluetoothTransport();
    return new BluetoothClient({
      transport,
      reconnect: { enabled: false },
    });
  },

  connectionError: () => {
    const transport = new FailingBluetoothTransport();
    return new BluetoothClient({
      transport,
      timeout: 1000,
      reconnect: { enabled: false },
    });
  },

  validationError: () => {
    const transport = new ValidationFailingBluetoothTransport();
    return new BluetoothClient({
      transport,
      reconnect: { enabled: false },
    });
  },
};

runSharedSuite("BluetoothClient", factories);

// ---------------------------------------------------------------------------
// Bluetooth-specific tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "BluetoothClient - transport injection works",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({ transport });

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

Deno.test({
  name: "BluetoothClient - health reports transport details",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({ transport });

    const health = await client.health();
    assertEquals(health.status, "healthy");
    assertEquals(health.details?.transport, "bluetooth");

    await client.cleanup();
  },
});

Deno.test({
  name: "BluetoothClient - failing transport returns unhealthy",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new FailingBluetoothTransport();
    const client = new BluetoothClient({
      transport,
      timeout: 500,
      reconnect: { enabled: false },
    });

    const health = await client.health();
    assertEquals(health.status, "unhealthy");

    await client.cleanup();
  },
});

Deno.test({
  name: "BluetoothClient - reconnection configuration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({
      transport,
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        interval: 100,
        backoff: "linear",
      },
    });

    // Should work normally
    const result = await client.receive([
      "store://users/test/data",
      { value: 123 },
    ]);
    assertEquals(result.accepted, true);

    await client.cleanup();
  },
});

Deno.test({
  name: "BluetoothClient - custom timeout configuration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({
      transport,
      timeout: 5000,
      reconnect: { enabled: false },
    });

    const result = await client.receive([
      "store://users/test/data",
      { value: 456 },
    ]);
    assertEquals(result.accepted, true);

    await client.cleanup();
  },
});

Deno.test({
  name: "BluetoothClient - cleanup disconnects transport",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({ transport });

    // Do a write to force connection
    await client.receive(["store://users/test/data", { v: 1 }]);
    assertEquals(transport.connected, true);

    await client.cleanup();
    assertEquals(transport.connected, false);
  },
});

Deno.test({
  name: "BluetoothClient - multiple sequential operations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const transport = new MockBluetoothTransport();
    const client = new BluetoothClient({ transport });

    // Write multiple items
    for (let i = 0; i < 5; i++) {
      const result = await client.receive([
        `store://users/batch-${i}/profile`,
        { index: i },
      ]);
      assertEquals(result.accepted, true, `Write ${i} should succeed`);
    }

    // Read them all back
    for (let i = 0; i < 5; i++) {
      const read = await client.read(`store://users/batch-${i}/profile`);
      assertEquals(read.success, true, `Read ${i} should succeed`);
      assertEquals(read.record?.data, { index: i });
    }

    await client.cleanup();
  },
});

Deno.test({
  name: "BluetoothClient - custom transport implementation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Verify that any object implementing BluetoothTransport works
    let connectCalled = false;
    let disconnectCalled = false;
    let sentMessages: string[] = [];
    let messageHandler: ((data: string) => void) | null = null;

    const customTransport: BluetoothTransport = {
      connected: false,
      async connect() {
        connectCalled = true;
        (this as any).connected = true;
      },
      async send(data: string) {
        sentMessages.push(data);
        // Echo back a valid response
        const req = JSON.parse(data);
        const response = {
          id: req.id,
          success: true,
          data: { accepted: true },
        };
        setTimeout(() => messageHandler?.(JSON.stringify(response)), 5);
      },
      onMessage(handler) {
        messageHandler = handler;
      },
      onError(_handler) {},
      onDisconnect(_handler) {},
      async disconnect() {
        disconnectCalled = true;
        (this as any).connected = false;
      },
    };

    const client = new BluetoothClient({
      transport: customTransport,
      reconnect: { enabled: false },
    });

    const result = await client.receive([
      "store://users/custom/data",
      { v: 1 },
    ]);
    assertEquals(result.accepted, true);
    assertEquals(connectCalled, true, "connect() should have been called");
    assertEquals(sentMessages.length, 1, "One message should have been sent");

    await client.cleanup();
    assertEquals(disconnectCalled, true, "disconnect() should have been called");
  },
});
