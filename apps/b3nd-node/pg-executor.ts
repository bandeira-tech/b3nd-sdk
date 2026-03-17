import { Client } from "npm:pg";

export interface SqlExecutorResult {
  rows: unknown[];
  rowCount?: number;
}
export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
}

export async function createPostgresExecutor(
  databaseUrl: string,
): Promise<SqlExecutor> {
  const client = new Client(databaseUrl);
  await client.connect();

  return {
    async query(sql: string, args?: unknown[]) {
      const res = await client.query(sql, args as unknown[]);
      return { rows: res.rows as unknown[], rowCount: (res as any).rowCount };
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      await client.query("BEGIN");
      try {
        const txExecutor: SqlExecutor = {
          query: async (sql, args) => {
            const res = await client.query(sql, args as unknown[]);
            return { rows: res.rows as unknown[], rowCount: (res as any).rowCount };
          },
          transaction: () => {
            throw new Error("Nested transactions not supported");
          },
        };
        const result = await fn(txExecutor);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  };
}
