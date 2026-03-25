// Neo4j executor for Neo4jClient, following the same pattern as the Postgres
// and Mongo executors. Uses the official Neo4j JavaScript driver via npm.
// This module is installation-specific so the core SDK stays decoupled from
// any concrete driver.

import neo4j from "npm:neo4j-driver";

import type { Neo4jExecutor } from "@bandeira-tech/b3nd-sdk/client-neo4j";

export async function createNeo4jExecutor(
  connectionString: string,
  database: string,
): Promise<Neo4jExecutor> {
  const driver = neo4j.driver(connectionString);
  await driver.verifyConnectivity();

  return {
    async run(cypher, params) {
      const session = driver.session({ database });
      try {
        const result = await session.run(cypher, params);
        return result.records.map((record) => {
          const obj: Record<string, unknown> = {};
          for (const key of record.keys) {
            const val = record.get(key);
            // Convert Neo4j Integer to JS number
            obj[key] = neo4j.isInt(val) ? val.toNumber() : val;
          }
          return obj;
        });
      } finally {
        await session.close();
      }
    },

    async write(cypher, params) {
      const session = driver.session({ database });
      try {
        const result = await session.run(cypher, params);
        const counters = result.summary.counters.updates();
        return {
          nodesCreated: counters.nodesCreated,
          nodesDeleted: counters.nodesDeleted,
          propertiesSet: counters.propertiesSet,
          relationshipsCreated: counters.relationshipsCreated,
          relationshipsDeleted: counters.relationshipsDeleted,
        };
      } finally {
        await session.close();
      }
    },

    async transaction<T>(fn: (tx: Neo4jExecutor) => Promise<T>): Promise<T> {
      const session = driver.session({ database });
      try {
        return await session.executeWrite(async (tx) => {
          const txExecutor: Neo4jExecutor = {
            async run(cypher, params) {
              const result = await tx.run(cypher, params);
              return result.records.map((record) => {
                const obj: Record<string, unknown> = {};
                for (const key of record.keys) {
                  const val = record.get(key);
                  obj[key] = neo4j.isInt(val) ? val.toNumber() : val;
                }
                return obj;
              });
            },
            async write(cypher, params) {
              const result = await tx.run(cypher, params);
              const counters = result.summary.counters.updates();
              return {
                nodesCreated: counters.nodesCreated,
                nodesDeleted: counters.nodesDeleted,
                propertiesSet: counters.propertiesSet,
              };
            },
            ping: async () => true,
          };
          return await fn(txExecutor);
        });
      } finally {
        await session.close();
      }
    },

    async ping() {
      const session = driver.session({ database });
      try {
        await session.run("RETURN 1");
        return true;
      } finally {
        await session.close();
      }
    },

    async cleanup() {
      await driver.close();
    },
  };
}
