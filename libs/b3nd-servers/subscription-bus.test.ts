import { assertEquals } from "@std/assert";
import { SubscriptionBus } from "./subscription-bus.ts";

Deno.test("SubscriptionBus - notify fires matching subscriber", () => {
  const bus = new SubscriptionBus();
  const events: { uri: string; data: unknown }[] = [];

  bus.subscribe("mutable://data/market", (e) => {
    events.push({ uri: e.uri, data: e.data });
  });

  bus.notify("mutable://data/market/X/msg1", { price: 42 }, Date.now());

  assertEquals(events.length, 1);
  assertEquals(events[0].uri, "mutable://data/market/X/msg1");
  assertEquals(events[0].data, { price: 42 });
});

Deno.test("SubscriptionBus - no match does not fire", () => {
  const bus = new SubscriptionBus();
  let called = false;

  bus.subscribe("mutable://data/market", () => {
    called = true;
  });

  bus.notify("mutable://other/path", {}, Date.now());
  assertEquals(called, false);
});

Deno.test("SubscriptionBus - wildcard * matches everything", () => {
  const bus = new SubscriptionBus();
  const uris: string[] = [];

  bus.subscribe("*", (e) => {
    uris.push(e.uri);
  });

  bus.notify("mutable://a", {}, 1);
  bus.notify("hash://b", {}, 2);

  assertEquals(uris, ["mutable://a", "hash://b"]);
});

Deno.test("SubscriptionBus - multiple subscribers for same prefix", () => {
  const bus = new SubscriptionBus();
  const calls: string[] = [];

  bus.subscribe("mutable://app", () => {
    calls.push("a");
  });
  bus.subscribe("mutable://app", () => {
    calls.push("b");
  });

  bus.notify("mutable://app/test", {}, Date.now());
  assertEquals(calls, ["a", "b"]);
});

Deno.test("SubscriptionBus - unsubscribe removes handler", () => {
  const bus = new SubscriptionBus();
  let count = 0;

  const unsub = bus.subscribe("mutable://app", () => {
    count++;
  });

  bus.notify("mutable://app/test", {}, Date.now());
  assertEquals(count, 1);

  unsub();
  bus.notify("mutable://app/test", {}, Date.now());
  assertEquals(count, 1); // not called again
});

Deno.test("SubscriptionBus - size tracks listeners", () => {
  const bus = new SubscriptionBus();
  assertEquals(bus.size, 0);

  const u1 = bus.subscribe("a://", () => {});
  assertEquals(bus.size, 1);

  const u2 = bus.subscribe("b://", () => {});
  assertEquals(bus.size, 2);

  u1();
  assertEquals(bus.size, 1);

  u2();
  assertEquals(bus.size, 0);
});

Deno.test("SubscriptionBus - handler errors don't break other handlers", () => {
  const bus = new SubscriptionBus();
  let secondCalled = false;

  bus.subscribe("mutable://app", () => {
    throw new Error("boom");
  });
  bus.subscribe("mutable://app", () => {
    secondCalled = true;
  });

  bus.notify("mutable://app/test", {}, Date.now());
  assertEquals(secondCalled, true);
});

Deno.test("SubscriptionBus - multiple prefixes match same URI", () => {
  const bus = new SubscriptionBus();
  const hits: string[] = [];

  bus.subscribe("mutable://", (e) => {
    hits.push("broad");
  });
  bus.subscribe("mutable://data/market", (e) => {
    hits.push("specific");
  });

  bus.notify("mutable://data/market/X", {}, Date.now());
  assertEquals(hits, ["broad", "specific"]);
});
