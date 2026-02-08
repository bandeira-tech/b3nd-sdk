import { assertEquals } from "@std/assert";
import {
  networkManifestUri,
  nodeConfigUri,
  nodeMetricsUri,
  nodeStatusUri,
  nodeUpdateUri,
} from "./types.ts";

const OP_KEY = "abc123def456";
const NODE_KEY = "nodekey789abc";
const NODE_ID = "node-1";
const NETWORK_ID = "net-42";

Deno.test("nodeConfigUri produces correct URI", () => {
  assertEquals(
    nodeConfigUri(OP_KEY, NODE_ID),
    `mutable://accounts/${OP_KEY}/nodes/${NODE_ID}/config`,
  );
});

Deno.test("nodeStatusUri produces correct URI (node key only)", () => {
  assertEquals(
    nodeStatusUri(NODE_KEY),
    `mutable://accounts/${NODE_KEY}/status`,
  );
});

Deno.test("nodeMetricsUri produces correct URI (node key only)", () => {
  assertEquals(
    nodeMetricsUri(NODE_KEY),
    `mutable://accounts/${NODE_KEY}/metrics`,
  );
});

Deno.test("nodeUpdateUri produces correct URI", () => {
  assertEquals(
    nodeUpdateUri(OP_KEY, NODE_ID),
    `mutable://accounts/${OP_KEY}/nodes/${NODE_ID}/update`,
  );
});

Deno.test("networkManifestUri produces correct URI", () => {
  assertEquals(
    networkManifestUri(OP_KEY, NETWORK_ID),
    `mutable://accounts/${OP_KEY}/networks/${NETWORK_ID}`,
  );
});

Deno.test("URI helpers handle empty strings", () => {
  assertEquals(nodeConfigUri("", ""), "mutable://accounts//nodes//config");
  assertEquals(nodeStatusUri(""), "mutable://accounts//status");
  assertEquals(nodeMetricsUri(""), "mutable://accounts//metrics");
  assertEquals(networkManifestUri("", ""), "mutable://accounts//networks/");
});

Deno.test("URI helpers handle special characters in IDs", () => {
  const opKey = "aabbccdd";
  const nodeId = "node-with-dashes";
  assertEquals(
    nodeConfigUri(opKey, nodeId),
    "mutable://accounts/aabbccdd/nodes/node-with-dashes/config",
  );
});
