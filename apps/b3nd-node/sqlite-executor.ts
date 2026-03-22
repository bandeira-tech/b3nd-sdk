// SQLite executor for SqliteClient, following the same pattern as the Postgres
// and Mongo executors. Uses Deno's built-in FFI-based SQLite via @db/sqlite.
// This module is installation-specific so the core SDK stays decoupled from
// any concrete driver.

import { Database, type BindValue } from "jsr:@db/sqlite@0.12";

import type { SqliteExecutor, SqliteExecutorResult } from "@bandeira-tech/b3nd-sdk/client-sqlite";

export function createSqliteExecutor(path: string): SqliteExecutor {
  const db = new Database(path);

  // Enable WAL mode for better concurrent read performance
  db.exec("PRAGMA journal_mode=WAL");

  return {
    query(sql: string, args?: unknown[]): SqliteExecutorResult {
      const stmt = db.prepare(sql);
      // Detect if the statement returns rows (SELECT, RETURNING, etc.)
      const isQuery = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);

      if (isQuery) {
        const rows = stmt.all(...((args ?? []) as BindValue[])) as Record<string, unknown>[];
        return { rows, rowCount: rows.length };
      } else {
        stmt.run(...((args ?? []) as BindValue[]));
        return { rows: [], rowCount: db.changes };
      }
    },

    transaction<T>(fn: (tx: SqliteExecutor) => T): T {
      let result: T;
      db.exec("BEGIN");
      try {
        const txExecutor: SqliteExecutor = {
          query(sql: string, args?: unknown[]): SqliteExecutorResult {
            const stmt = db.prepare(sql);
            const isQuery = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
            if (isQuery) {
              const rows = stmt.all(...((args ?? []) as BindValue[])) as Record<string, unknown>[];
              return { rows, rowCount: rows.length };
            } else {
              stmt.run(...((args ?? []) as BindValue[]));
              return { rows: [], rowCount: db.changes };
            }
          },
          transaction: () => {
            throw new Error("Nested transactions not supported");
          },
        };
        result = fn(txExecutor);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return result;
    },

    cleanup() {
      db.close();
    },
  };
}
