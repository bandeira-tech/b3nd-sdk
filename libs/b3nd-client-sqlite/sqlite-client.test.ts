/**
 * SqliteClient Tests
 *
 * Tests the SQLite client implementation using the shared test suite.
 * Uses an in-memory SQLite database via Deno's native FFI bindings.
 */

/// <reference lib="deno.ns" />

import { SqliteClient } from "./mod.ts";
import type { SqliteExecutor, SqliteExecutorResult } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import type { PersistenceRecord, Schema } from "../b3nd-core/types.ts";
import { generateSqliteSchema } from "./schema.ts";
import { Database } from "jsr:@db/sqlite@0.12";

/**
 * SqliteExecutor backed by @db/sqlite — Deno's native SQLite bindings.
 */
class DenoSqliteExecutor implements SqliteExecutor {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    // Enable WAL mode for better concurrent read performance
    this.db.exec("PRAGMA journal_mode=WAL");
  }

  query(sql: string, args?: unknown[]): SqliteExecutorResult {
    // For statements that return rows (SELECT)
    if (sql.trimStart().toUpperCase().startsWith("SELECT")) {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(args ?? []) as any[]) as unknown[];
      return { rows, rowCount: rows.length };
    }

    // For statements that modify data or create schema
    if (
      sql.trimStart().toUpperCase().startsWith("CREATE") ||
      sql.trimStart().startsWith("--")
    ) {
      // Schema SQL may contain multiple statements — use exec for those
      this.db.exec(sql);
      return { rows: [], rowCount: 0 };
    }

    // INSERT, UPDATE, DELETE — use run()
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(args ?? []) as any[]);
    return {
      rows: [],
      rowCount: typeof result === "number" ? result : this.db.changes,
    };
  }

  transaction<T>(fn: (tx: SqliteExecutor) => T): T {
    let result: T;
    // SQLite transactions are serial — use BEGIN/COMMIT/ROLLBACK directly
    this.db.exec("BEGIN");
    try {
      result = fn(this);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return result;
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

  // Initialize schema before creating client
  const schemaSQL = generateSqliteSchema("b3nd");
  executor.query(schemaSQL);

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
