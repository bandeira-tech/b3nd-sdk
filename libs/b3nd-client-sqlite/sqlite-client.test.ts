/**
 * SqliteClient Tests
 *
 * Tests the SQLite client implementation using the shared test suite.
 * Uses Deno's built-in SQLite via `jsr:@db/sqlite` with in-memory databases.
 */

/// <reference lib="deno.ns" />

import { SqliteClient, type SqliteExecutor, type SqliteExecutorResult } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";

import { Database } from "jsr:@db/sqlite@0.12";

class DenoSqliteExecutor implements SqliteExecutor {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
  }

  query(sql: string, args?: unknown[]): SqliteExecutorResult {
    const stmt = this.db.prepare(sql);

    // Determine if the statement returns rows (SELECT, RETURNING, etc.)
    const sqlTrimmed = sql.trim().toUpperCase();
    const isSelect = sqlTrimmed.startsWith("SELECT") ||
      sqlTrimmed.includes("RETURNING");

    // deno-lint-ignore no-explicit-any
    const params = (args ?? []) as any[];

    if (isSelect) {
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    } else {
      const changes = stmt.run(...params);
      return { rows: [], rowCount: changes };
    }
  }

  transaction<T>(fn: (tx: SqliteExecutor) => T): T {
    const txFn = this.db.transaction(() => {
      return fn(this);
    });
    return txFn();
  }

  cleanup(): void {
    this.db.close();
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

function createClient(schema: Schema): SqliteClient {
  const executor = new DenoSqliteExecutor(":memory:");
  return new SqliteClient(
    {
      path: ":memory:",
      schema,
      tablePrefix: "b3nd",
    },
    executor,
  );
}

runSharedSuite("SqliteClient", {
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
