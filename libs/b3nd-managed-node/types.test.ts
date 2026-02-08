import { assertEquals } from "@std/assert";
import {
  networkManifestUri,
  nodeConfigUri,
  nodeMetricsUri,
  nodeStatusUri,
} from "./types.ts";

const PUBKEY = "abc123def456";
const NODE_ID = "node-1";
const NETWORK_ID = "net-42";

Deno.test("nodeConfigUri produces correct URI", () => {
  assertEquals(
    nodeConfigUri(PUBKEY, NODE_ID),
    `mutable://nodes/${PUBKEY}/${NODE_ID}/config`,
  );
});

Deno.test("nodeStatusUri produces correct URI", () => {
  assertEquals(
    nodeStatusUri(PUBKEY, NODE_ID),
    `mutable://nodes/${PUBKEY}/${NODE_ID}/status`,
  );
});

Deno.test("nodeMetricsUri produces correct URI", () => {
  assertEquals(
    nodeMetricsUri(PUBKEY, NODE_ID),
    `mutable://nodes/${PUBKEY}/${NODE_ID}/metrics`,
  );
});

Deno.test("networkManifestUri produces correct URI", () => {
  assertEquals(
    networkManifestUri(PUBKEY, NETWORK_ID),
    `mutable://networks/${PUBKEY}/${NETWORK_ID}`,
  );
});

Deno.test("URI helpers handle empty strings", () => {
  assertEquals(nodeConfigUri("", ""), "mutable://nodes///config");
  assertEquals(nodeStatusUri("", ""), "mutable://nodes///status");
  assertEquals(nodeMetricsUri("", ""), "mutable://nodes///metrics");
  assertEquals(networkManifestUri("", ""), "mutable://networks//");
});

Deno.test("URI helpers handle special characters in IDs", () => {
  const pubkey = "aabbccdd";
  const nodeId = "node-with-dashes";
  assertEquals(
    nodeConfigUri(pubkey, nodeId),
    "mutable://nodes/aabbccdd/node-with-dashes/config",
  );
});
