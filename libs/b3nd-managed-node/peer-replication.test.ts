import { assertEquals } from "@std/assert";
import { createPeerClients } from "./peer-replication.ts";
import type { PeerSpec } from "./types.ts";

Deno.test("createPeerClients: push peer goes to pushPeers only", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "push" },
  ];
  const { pushPeers, pullPeers } = createPeerClients(peers);
  assertEquals(pushPeers.length, 1);
  assertEquals(pushPeers[0].id, "http://peer1:9942");
  assertEquals(pullPeers.length, 0);
});

Deno.test("createPeerClients: pull peer goes to pullPeers only", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "pull" },
  ];
  const { pushPeers, pullPeers } = createPeerClients(peers);
  assertEquals(pushPeers.length, 0);
  assertEquals(pullPeers.length, 1);
  assertEquals(pullPeers[0].id, "http://peer1:9942");
});

Deno.test("createPeerClients: bidirectional peer goes to both", () => {
  const peers: PeerSpec[] = [
    { url: "http://peer1:9942", direction: "bidirectional" },
  ];
  const { pushPeers, pullPeers } = createPeerClients(peers);
  assertEquals(pushPeers.length, 1);
  assertEquals(pullPeers.length, 1);
});

Deno.test("createPeerClients: mixed directions split correctly", () => {
  const peers: PeerSpec[] = [
    { url: "http://push-only:9942", direction: "push" },
    { url: "http://pull-only:9942", direction: "pull" },
    { url: "http://both:9942", direction: "bidirectional" },
  ];
  const { pushPeers, pullPeers } = createPeerClients(peers);
  assertEquals(pushPeers.length, 2); // push + bidirectional
  assertEquals(pullPeers.length, 2); // pull + bidirectional
});

Deno.test("createPeerClients: empty peers returns empty arrays", () => {
  const { pushPeers, pullPeers } = createPeerClients([]);
  assertEquals(pushPeers.length, 0);
  assertEquals(pullPeers.length, 0);
});

Deno.test("createPeerClients: ids default to peer URL", () => {
  const peers: PeerSpec[] = [
    { url: "http://a.example:9942", direction: "bidirectional" },
    { url: "http://b.example:9942", direction: "push" },
  ];
  const { pushPeers, pullPeers } = createPeerClients(peers);
  const pushIds = pushPeers.map((p) => p.id).sort();
  const pullIds = pullPeers.map((p) => p.id).sort();
  assertEquals(pushIds, ["http://a.example:9942", "http://b.example:9942"]);
  assertEquals(pullIds, ["http://a.example:9942"]);
});
