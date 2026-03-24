/**
 * Neo4jClient Tests
 *
 * Tests the Neo4j client implementation using the shared test suite.
 * Uses an in-memory executor that simulates Neo4j Cypher operations.
 */

/// <reference lib="deno.ns" />

import { Neo4jClient, type Neo4jExecutor } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";

/**
 * In-memory Neo4jExecutor that simulates Neo4j Cypher operations.
 * Stores nodes as a Map keyed by uri.
 */
class MemoryNeo4jExecutor implements Neo4jExecutor {
  private readonly store = new Map<
    string,
    { uri: string; data: string; timestamp: number; createdAt: number; updatedAt: number }
  >();

  async run(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    // MATCH single by uri
    if (cypher.includes("{uri: $uri}") && cypher.includes("RETURN")) {
      const uri = params?.uri as string;
      const node = this.store.get(uri);
      if (!node) return [];
      return [{ uri: node.uri, data: node.data, timestamp: node.timestamp }];
    }

    // MATCH by uri IN $uris
    if (cypher.includes("n.uri IN $uris")) {
      const uris = params?.uris as string[];
      return uris
        .map((u) => this.store.get(u))
        .filter(Boolean)
        .map((n) => ({ uri: n!.uri, data: n!.data, timestamp: n!.timestamp }));
    }

    // MATCH with STARTS WITH (list + count)
    if (cypher.includes("STARTS WITH")) {
      const prefix = params?.prefix as string;
      const pattern = params?.pattern as string | undefined;

      let matches = [...this.store.values()].filter((n) =>
        n.uri.startsWith(prefix)
      );

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
  }> {
    // MERGE (upsert)
    if (cypher.includes("MERGE")) {
      const uri = params?.uri as string;
      const data = params?.data as string;
      const ts = params?.ts as number;
      const now = Date.now();
      const existing = this.store.has(uri);
      this.store.set(uri, {
        uri,
        data,
        timestamp: ts,
        createdAt: existing ? this.store.get(uri)!.createdAt : now,
        updatedAt: now,
      });
      return {
        nodesCreated: existing ? 0 : 1,
        propertiesSet: existing ? 3 : 5,
      };
    }

    // DELETE
    if (cypher.includes("DELETE")) {
      const uri = params?.uri as string;
      const existed = this.store.delete(uri);
      return { nodesDeleted: existed ? 1 : 0 };
    }

    // CREATE CONSTRAINT / CREATE INDEX (schema init)
    if (cypher.includes("CREATE CONSTRAINT") || cypher.includes("CREATE INDEX")) {
      return {};
    }

    return {};
  }

  async transaction<T>(fn: (tx: Neo4jExecutor) => Promise<T>): Promise<T> {
    // Simple passthrough — the in-memory store is already consistent
    return fn(this);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async cleanup(): Promise<void> {
    this.store.clear();
  }
}

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
