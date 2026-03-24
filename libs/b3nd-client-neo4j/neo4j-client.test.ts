/**
 * Neo4jClient Tests
 *
 * Tests the Neo4j client implementation using the shared test suite.
 * Uses an in-memory executor that simulates Neo4j Cypher operations
 * including graph relationships (CHILD_OF, PRODUCES, CONSUMES).
 */

/// <reference lib="deno.ns" />

import {
  Neo4jClient,
  type Neo4jExecutor,
  type GraphNode,
  type ProvenanceResult,
} from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";
import { assertEquals } from "@std/assert";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";

// ── In-memory Neo4j executor ───────────────────────────────────────────

interface MemNode {
  uri: string;
  data: string | null;
  timestamp: number;
  createdAt: number;
  updatedAt: number;
}

interface MemEdge {
  from: string;
  to: string;
  type: string;
}

/**
 * In-memory Neo4jExecutor that simulates Neo4j Cypher operations.
 * Supports nodes, relationships, and basic Cypher pattern matching.
 */
class MemoryNeo4jExecutor implements Neo4jExecutor {
  readonly nodes = new Map<string, MemNode>();
  readonly edges: MemEdge[] = [];

  async run(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    // MATCH single by uri — read data
    if (
      cypher.includes("{uri: $uri}") &&
      cypher.includes("RETURN") &&
      !cypher.includes("PRODUCES") &&
      !cypher.includes("CONSUMES") &&
      !cypher.includes("CHILD_OF") &&
      !cypher.includes("-[r*")
    ) {
      const uri = params?.uri as string;
      const node = this.nodes.get(uri);
      if (!node) return [];
      return [{ uri: node.uri, data: node.data, timestamp: node.timestamp }];
    }

    // MATCH by uri IN $uris
    if (cypher.includes("n.uri IN $uris")) {
      const uris = params?.uris as string[];
      return uris
        .map((u) => this.nodes.get(u))
        .filter(Boolean)
        .map((n) => ({
          uri: n!.uri,
          data: n!.data,
          timestamp: n!.timestamp,
        }));
    }

    // MATCH with STARTS WITH (list + count)
    if (cypher.includes("STARTS WITH")) {
      const prefix = params?.prefix as string;
      const pattern = params?.pattern as string | undefined;

      let matches = [...this.nodes.values()].filter(
        (n) => n.uri.startsWith(prefix) && n.data !== null,
      );

      // data IS NOT NULL filter (for list queries)
      if (cypher.includes("n.data IS NOT NULL")) {
        matches = matches.filter((n) => n.data !== null);
      }

      if (pattern) {
        const regex = new RegExp(pattern);
        matches = matches.filter((n) => regex.test(n.uri));
      }

      // count query
      if (cypher.includes("count(n)")) {
        return [{ total: matches.length }];
      }

      // Sort
      if (cypher.includes("n.timestamp")) {
        matches.sort((a, b) =>
          cypher.includes("DESC")
            ? b.timestamp - a.timestamp
            : a.timestamp - b.timestamp
        );
      } else {
        matches.sort((a, b) =>
          cypher.includes("DESC")
            ? b.uri.localeCompare(a.uri)
            : a.uri.localeCompare(b.uri)
        );
      }

      // Pagination
      const offset = (params?.offset as number) ?? 0;
      const limit = (params?.limit as number) ?? 50;
      const paginated = matches.slice(offset, offset + limit);

      return paginated.map((n) => ({ uri: n.uri }));
    }

    // PRODUCES traversal: envelope → target
    if (cypher.includes("[:PRODUCES]->") && cypher.includes("target:Record")) {
      const uri = params?.uri as string;
      const producers = this.edges
        .filter((e) => e.type === "PRODUCES" && e.to === uri)
        .map((e) => ({ envelopeUri: e.from }));
      return producers;
    }

    // PRODUCES traversal: envelope → outputs
    if (
      cypher.includes("[:PRODUCES]->") &&
      cypher.includes("output:Record")
    ) {
      const uri = params?.uri as string;
      const outputs = this.edges
        .filter((e) => e.type === "PRODUCES" && e.from === uri)
        .map((e) => ({ outputUri: e.to }));
      return outputs;
    }

    // CONSUMES traversal: envelope → inputs
    if (cypher.includes("[:CONSUMES]->") && cypher.includes("input:Record")) {
      const uri = params?.uri as string;
      const inputs = this.edges
        .filter((e) => e.type === "CONSUMES" && e.from === uri)
        .map((e) => ({ inputUri: e.to }));
      return inputs;
    }

    // CHILD_OF ancestors: start -[:CHILD_OF*]-> ancestor
    if (
      cypher.includes("[:CHILD_OF*") &&
      cypher.includes("ancestor:Record")
    ) {
      const uri = params?.uri as string;
      const results: { uri: string; depth: number }[] = [];
      const visited = new Set<string>();
      let current = uri;
      let depth = 0;
      while (depth < 10) {
        const parent = this.edges.find(
          (e) => e.type === "CHILD_OF" && e.from === current,
        );
        if (!parent || visited.has(parent.to)) break;
        depth++;
        visited.add(parent.to);
        current = parent.to;
        results.push({ uri: parent.to, depth });
      }
      return results;
    }

    // CHILD_OF descendants: descendant -[:CHILD_OF*]-> start
    if (
      cypher.includes("[:CHILD_OF*") &&
      cypher.includes("descendant:Record")
    ) {
      const uri = params?.uri as string;
      const results: { uri: string; depth: number }[] = [];

      // BFS to find all descendants
      const queue: { nodeUri: string; depth: number }[] = [
        { nodeUri: uri, depth: 0 },
      ];
      const visited = new Set<string>([uri]);

      while (queue.length > 0) {
        const { nodeUri, depth } = queue.shift()!;
        // Find all nodes that have CHILD_OF edge pointing to this node
        for (const edge of this.edges) {
          if (
            edge.type === "CHILD_OF" &&
            edge.to === nodeUri &&
            !visited.has(edge.from)
          ) {
            visited.add(edge.from);
            results.push({ uri: edge.from, depth: depth + 1 });
            queue.push({ nodeUri: edge.from, depth: depth + 1 });
          }
        }
      }

      results.sort((a, b) => a.depth - b.depth);
      return results;
    }

    // Related: all relationships from start
    if (cypher.includes("-[r*1..")) {
      const uri = params?.uri as string;
      const results: { uri: string; rel: string; depth: number }[] = [];
      const visited = new Set<string>([uri]);

      // Simple BFS through all edges (undirected)
      const queue: { nodeUri: string; depth: number }[] = [
        { nodeUri: uri, depth: 0 },
      ];

      while (queue.length > 0) {
        const { nodeUri, depth } = queue.shift()!;
        if (depth >= 3) continue;

        for (const edge of this.edges) {
          const neighbor =
            edge.from === nodeUri
              ? edge.to
              : edge.to === nodeUri
                ? edge.from
                : null;
          if (neighbor && !visited.has(neighbor)) {
            visited.add(neighbor);
            results.push({ uri: neighbor, rel: edge.type, depth: depth + 1 });
            queue.push({ nodeUri: neighbor, depth: depth + 1 });
          }
        }
      }

      results.sort((a, b) => a.depth - b.depth);
      return results;
    }

    // RETURN 1 (ping)
    if (cypher.includes("RETURN 1")) {
      return [{ result: 1 }];
    }

    return [];
  }

  async write(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<{
    nodesCreated?: number;
    nodesDeleted?: number;
    propertiesSet?: number;
    relationshipsCreated?: number;
    relationshipsDeleted?: number;
  }> {
    // MERGE Record (upsert)
    if (
      cypher.includes("MERGE (n:Record {uri: $uri})") &&
      cypher.includes("SET n.data")
    ) {
      const uri = params?.uri as string;
      const data = params?.data as string;
      const ts = params?.ts as number;
      const now = Date.now();
      const existing = this.nodes.has(uri);
      this.nodes.set(uri, {
        uri,
        data,
        timestamp: ts,
        createdAt: existing ? this.nodes.get(uri)!.createdAt : now,
        updatedAt: now,
      });
      return {
        nodesCreated: existing ? 0 : 1,
        propertiesSet: existing ? 3 : 5,
      };
    }

    // CHILD_OF edge creation
    if (cypher.includes("[:CHILD_OF]")) {
      const childUri = params?.childUri as string;
      const parentUri = params?.parentUri as string;
      const ts = params?.ts as number;
      const now = Date.now();

      // Ensure parent node exists (stub)
      if (!this.nodes.has(parentUri)) {
        this.nodes.set(parentUri, {
          uri: parentUri,
          data: null,
          timestamp: ts,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Add edge if not duplicate
      const exists = this.edges.some(
        (e) =>
          e.from === childUri && e.to === parentUri && e.type === "CHILD_OF",
      );
      if (!exists) {
        this.edges.push({ from: childUri, to: parentUri, type: "CHILD_OF" });
        return { relationshipsCreated: 1 };
      }
      return {};
    }

    // PRODUCES edge creation
    if (cypher.includes("[:PRODUCES]")) {
      const envelopeUri = params?.envelopeUri as string;
      const outputUri = params?.outputUri as string;
      const exists = this.edges.some(
        (e) =>
          e.from === envelopeUri &&
          e.to === outputUri &&
          e.type === "PRODUCES",
      );
      if (!exists) {
        this.edges.push({
          from: envelopeUri,
          to: outputUri,
          type: "PRODUCES",
        });
        return { relationshipsCreated: 1 };
      }
      return {};
    }

    // CONSUMES edge creation
    if (cypher.includes("[:CONSUMES]")) {
      const envelopeUri = params?.envelopeUri as string;
      const inputUri = params?.inputUri as string;
      const ts = params?.ts as number;
      const now = Date.now();

      // Ensure input node exists (stub)
      if (!this.nodes.has(inputUri)) {
        this.nodes.set(inputUri, {
          uri: inputUri,
          data: null,
          timestamp: ts,
          createdAt: now,
          updatedAt: now,
        });
      }

      const exists = this.edges.some(
        (e) =>
          e.from === envelopeUri &&
          e.to === inputUri &&
          e.type === "CONSUMES",
      );
      if (!exists) {
        this.edges.push({
          from: envelopeUri,
          to: inputUri,
          type: "CONSUMES",
        });
        return { relationshipsCreated: 1 };
      }
      return {};
    }

    // DETACH DELETE
    if (cypher.includes("DETACH DELETE")) {
      const uri = params?.uri as string;
      const existed = this.nodes.delete(uri);
      // Remove all edges involving this node
      const edgesBefore = this.edges.length;
      for (let i = this.edges.length - 1; i >= 0; i--) {
        if (this.edges[i].from === uri || this.edges[i].to === uri) {
          this.edges.splice(i, 1);
        }
      }
      return {
        nodesDeleted: existed ? 1 : 0,
        relationshipsDeleted: edgesBefore - this.edges.length,
      };
    }

    // DELETE (plain)
    if (cypher.includes("DELETE")) {
      const uri = params?.uri as string;
      const existed = this.nodes.delete(uri);
      return { nodesDeleted: existed ? 1 : 0 };
    }

    // CREATE CONSTRAINT / CREATE INDEX (schema init)
    if (
      cypher.includes("CREATE CONSTRAINT") ||
      cypher.includes("CREATE INDEX")
    ) {
      return {};
    }

    return {};
  }

  async transaction<T>(fn: (tx: Neo4jExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async cleanup(): Promise<void> {
    this.nodes.clear();
    this.edges.length = 0;
  }
}

// ── Test helpers ───────────────────────────────────────────────────────

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async (
    { value, read }: { value: unknown; read: unknown },
  ) => {
    if (validator) {
      return validator(value);
    }
    const _ = read as <T = unknown>(
      uri: string,
    ) => Promise<{ success: boolean; record?: PersistenceRecord<T> }>;
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator,
    "store://pagination": defaultValidator,
    "hash://sha256": defaultValidator,
  };
}

function createClient(schema: Schema): Neo4jClient {
  const executor = new MemoryNeo4jExecutor();
  return new Neo4jClient(
    {
      connectionString: "bolt://localhost:7687",
      schema,
      database: "neo4j",
    },
    executor,
  );
}

function createClientWithExecutor(
  schema: Schema,
): { client: Neo4jClient; executor: MemoryNeo4jExecutor } {
  const executor = new MemoryNeo4jExecutor();
  const client = new Neo4jClient(
    {
      connectionString: "bolt://localhost:7687",
      schema,
      database: "neo4j",
    },
    executor,
  );
  return { client, executor };
}

// ── Shared test suites ────────────────────────────────────────────────

runSharedSuite("Neo4jClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});

runNodeSuite("Neo4jClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});

// ── URI hierarchy tests ───────────────────────────────────────────────

Deno.test("Neo4jClient - CHILD_OF edges created on receive", async () => {
  const { client, executor } = createClientWithExecutor(createSchema());

  await client.receive(["store://users/alice", { name: "Alice" }]);

  // Should have CHILD_OF edge from store://users/alice → store://users
  const childEdges = executor.edges.filter((e) => e.type === "CHILD_OF");
  assertEquals(childEdges.length, 1);
  assertEquals(childEdges[0].from, "store://users/alice");
  assertEquals(childEdges[0].to, "store://users");
});

Deno.test("Neo4jClient - deep URI creates multi-level hierarchy", async () => {
  const { client, executor } = createClientWithExecutor(createSchema());

  await client.receive([
    "store://files/docs/2024/report.txt",
    { content: "..." },
  ]);

  const childEdges = executor.edges.filter((e) => e.type === "CHILD_OF");
  // store://files/docs/2024/report.txt → store://files/docs/2024
  assertEquals(childEdges.length, 1);
  assertEquals(childEdges[0].from, "store://files/docs/2024/report.txt");
  assertEquals(childEdges[0].to, "store://files/docs/2024");
});

Deno.test("Neo4jClient - ancestors() traverses CHILD_OF upward", async () => {
  const { client, executor } = createClientWithExecutor(createSchema());

  // Manually create a deeper hierarchy in the executor
  await client.receive(["store://users/alice", { name: "Alice" }]);
  // Simulate deeper hierarchy: users/alice → users → (root)
  // The receive already creates alice → users. Add users → store://users stub
  // Actually, parentUri("store://users") returns undefined (only 1 segment), so no more edges.

  const result = await client.ancestors("store://users/alice");
  assertEquals(result.success, true);
  assertEquals(result.nodes.length, 1);
  assertEquals(result.nodes[0].uri, "store://users");
  assertEquals(result.nodes[0].depth, 1);
});

Deno.test("Neo4jClient - descendants() traverses CHILD_OF downward", async () => {
  const { client } = createClientWithExecutor(createSchema());

  await client.receive(["store://users/alice", { name: "Alice" }]);
  await client.receive(["store://users/bob", { name: "Bob" }]);

  const result = await client.descendants("store://users");
  assertEquals(result.success, true);
  assertEquals(result.nodes.length, 2);

  const uris = result.nodes.map((n) => n.uri).sort();
  assertEquals(uris, ["store://users/alice", "store://users/bob"]);
});

Deno.test("Neo4jClient - parent stubs excluded from list", async () => {
  const { client } = createClientWithExecutor(createSchema());

  await client.receive(["store://users/alice", { name: "Alice" }]);

  // store://users is a stub (no data) — should not appear in list
  const listResult = await client.list("store://");
  assertEquals(listResult.success, true);
  if (!listResult.success) throw new Error("unreachable");
  // Only alice should appear, not the stub "store://users"
  const uris = listResult.data.map((item) => item.uri);
  assertEquals(uris.includes("store://users"), false);
  assertEquals(uris.includes("store://users/alice"), true);
});

// ── Provenance tests ──────────────────────────────────────────────────

Deno.test("Neo4jClient - MessageData creates PRODUCES and CONSUMES edges", async () => {
  const { client, executor } = createClientWithExecutor(createSchema());

  // Write an input first
  await client.receive([
    "store://users/alice",
    { name: "Alice", balance: 100 },
  ]);

  // Now write a MessageData envelope that consumes alice and produces bob
  const envelope = {
    payload: {
      inputs: ["store://users/alice"],
      outputs: [
        ["store://users/bob", { name: "Bob", balance: 50 }] as [
          string,
          unknown,
        ],
      ],
    },
  };

  await client.receive(["hash://sha256/abc123", envelope]);

  // Check PRODUCES edge: envelope → bob
  const producesEdges = executor.edges.filter((e) => e.type === "PRODUCES");
  assertEquals(producesEdges.length, 1);
  assertEquals(producesEdges[0].from, "hash://sha256/abc123");
  assertEquals(producesEdges[0].to, "store://users/bob");

  // Check CONSUMES edge: envelope → alice
  const consumesEdges = executor.edges.filter((e) => e.type === "CONSUMES");
  assertEquals(consumesEdges.length, 1);
  assertEquals(consumesEdges[0].from, "hash://sha256/abc123");
  assertEquals(consumesEdges[0].to, "store://users/alice");
});

Deno.test("Neo4jClient - provenance() returns producer and relations", async () => {
  const { client } = createClientWithExecutor(createSchema());

  await client.receive([
    "store://users/alice",
    { name: "Alice", balance: 100 },
  ]);

  const envelope = {
    payload: {
      inputs: ["store://users/alice"],
      outputs: [
        ["store://users/bob", { name: "Bob", balance: 50 }] as [
          string,
          unknown,
        ],
      ],
    },
  };

  await client.receive(["hash://sha256/tx1", envelope]);

  // Query provenance of the output
  const bobProv = await client.provenance("store://users/bob");
  assertEquals(bobProv.success, true);
  assertEquals(bobProv.producedBy, "hash://sha256/tx1");

  // Query provenance of the envelope
  const envProv = await client.provenance("hash://sha256/tx1");
  assertEquals(envProv.success, true);
  assertEquals(envProv.produces, ["store://users/bob"]);
  assertEquals(envProv.consumes, ["store://users/alice"]);

  // Query provenance of the input (no producer)
  const aliceProv = await client.provenance("store://users/alice");
  assertEquals(aliceProv.success, true);
  assertEquals(aliceProv.producedBy, undefined);
});

// ── Related traversal tests ───────────────────────────────────────────

Deno.test("Neo4jClient - related() finds connected nodes", async () => {
  const { client } = createClientWithExecutor(createSchema());

  await client.receive([
    "store://users/alice",
    { name: "Alice", balance: 100 },
  ]);

  const envelope = {
    payload: {
      inputs: ["store://users/alice"],
      outputs: [
        ["store://users/bob", { name: "Bob", balance: 50 }] as [
          string,
          unknown,
        ],
      ],
    },
  };

  await client.receive(["hash://sha256/tx1", envelope]);

  // From the envelope, should find alice (CONSUMES), bob (PRODUCES), and hierarchy nodes
  const result = await client.related("hash://sha256/tx1");
  assertEquals(result.success, true);

  const relatedUris = result.nodes.map((n) => n.uri).sort();
  // Should include at minimum: alice (consumed) and bob (produced)
  assertEquals(relatedUris.includes("store://users/alice"), true);
  assertEquals(relatedUris.includes("store://users/bob"), true);
});

Deno.test("Neo4jClient - delete removes node and relationships", async () => {
  const { client, executor } = createClientWithExecutor(createSchema());

  await client.receive(["store://users/alice", { name: "Alice" }]);
  await client.receive(["store://users/bob", { name: "Bob" }]);

  // Both should have CHILD_OF edges
  assertEquals(
    executor.edges.filter((e) => e.type === "CHILD_OF").length,
    2,
  );

  // Delete alice — should remove her node AND her CHILD_OF edge
  const result = await client.delete("store://users/alice");
  assertEquals(result.success, true);

  assertEquals(executor.nodes.has("store://users/alice"), false);
  assertEquals(
    executor.edges.filter((e) => e.from === "store://users/alice").length,
    0,
  );
  // Bob's edge should still be there
  assertEquals(
    executor.edges.filter((e) => e.type === "CHILD_OF").length,
    1,
  );
});
