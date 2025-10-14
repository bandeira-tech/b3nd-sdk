import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

export interface SqlExecutorResult { rows: unknown[]; rowCount?: number }
export interface SqlExecutor { query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult> }

export async function createPostgresExecutor(databaseUrl: string): Promise<SqlExecutor> {
  const client = new Client(databaseUrl);
  await client.connect();

  return {
    async query(sql: string, args?: unknown[]) {
      const res = await client.queryObject({ text: sql, args: args as any[] | undefined });
      return { rows: res.rows as unknown[], rowCount: (res as any).rowCount };
    },
  };
}

