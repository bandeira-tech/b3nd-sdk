import { assertEquals } from "@std/assert";
import { bestEffortClient, createPeerClients } from "./peer-replication.ts";
import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import type { PeerSpec } from "./types.ts";

// ── Stub client that records calls ─────────────────────────────────

function createStubClient(opts?: {
  receiveError?: boolean;
}): NodeProtocolInterface & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async receive(msg) {
      calls.push(`receive:${msg[0]}`);
      if (opts?.receiveError) throw new Error("peer down");
      return { accepted: true };
    },
    async read<T = unknown>(uris: string | string[]) {
      const uriList = Array.isArray(uris) ? uris : [uris];
      calls.push(`read:${uriList.join(",")}`);
      return uriList.map((uri) => ({
        success: true as const,
        uri,
        record: { ts: Date.now(), data: { stub: true } as unknown as T },
      }));
    },
    async status() {
      calls.push("status");
      return { status: "healthy" as const, schemas: [] };
    },
  };
}

// ── createPeerClients ──────────────────────────────────────────────

Deno.test("createPeerClients: push peer goes to pushClients only", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "push" },
  ];
  const { pushClients, pullClients } = createPeerClients(peers);
  assertEquals(pushClients.length, 1);
  assertEquals(pullClients.length, 0);
});

Deno.test("createPeerClients: pull peer goes to pullClients only", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "pull" },
  ];
  const { pushClients, pullClients } = createPeerClients(peers);
  assertEquals(pushClients.length, 0);
  assertEquals(pullClients.length, 1);
});

Deno.test("createPeerClients: bidirectional peer goes to both", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "bidirectional" },
  ];
  const { pushClients, pullClients } = createPeerClients(peers);
  assertEquals(pushClients.length, 1);
  assertEquals(pullClients.length, 1);
});

Deno.test("createPeerClients: mixed directions split correctly", () => {
  const peers: PeerSpec[] = [
    { url: "http://push-only:9942", direction: "push" },
    { url: "http://pull-only:9942", direction: "pull" },
    { url: "http://both:9942", direction: "bidirectional" },
  ];
  const { pushClients, pullClients } = createPeerClients(peers);
  assertEquals(pushClients.length, 2); // push + bidirectional
  assertEquals(pullClients.length, 2); // pull + bidirectional
});

Deno.test("createPeerClients: empty peers returns empty arrays", () => {
  const { pushClients, pullClients } = createPeerClients([]);
  assertEquals(pushClients.length, 0);
  assertEquals(pullClients.length, 0);
});

// ── bestEffortClient ───────────────────────────────────────────────

Deno.test("bestEffortClient: swallows receive errors and returns accepted", async () => {
  const stub = createStubClient({ receiveError: true });
  const wrapped = bestEffortClient(stub);

  const result = await wrapped.receive(["mutable://open/test", { data: 1 }]);
  assertEquals(result.accepted, true);
  assertEquals(stub.calls, ["receive:mutable://open/test"]);
});

Deno.test("bestEffortClient: passes through successful receive", async () => {
  const stub = createStubClient();
  const wrapped = bestEffortClient(stub);

  const result = await wrapped.receive(["mutable://open/test", { data: 1 }]);
  assertEquals(result.accepted, true);
  assertEquals(stub.calls, ["receive:mutable://open/test"]);
});

Deno.test("bestEffortClient: read delegates unchanged", async () => {
  const stub = createStubClient();
  const wrapped = bestEffortClient(stub);

  const results = await wrapped.read("mutable://open/test");
  assertEquals(results[0].success, true);
  assertEquals(stub.calls, ["read:mutable://open/test"]);
});

Deno.test("bestEffortClient: status delegates unchanged", async () => {
  const stub = createStubClient();
  const wrapped = bestEffortClient(stub);

  const result = await wrapped.status();
  assertEquals(result.status, "healthy");
  assertEquals(stub.calls, ["status"]);
});
