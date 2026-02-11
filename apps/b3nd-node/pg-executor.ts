import { Client } from "npm:pg";

export interface SqlExecutorResult {
  rows: unknown[];
  rowCount?: number;
}
export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
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
  };
}
