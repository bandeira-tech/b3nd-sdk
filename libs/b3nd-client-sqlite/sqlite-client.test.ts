/**
 * SqliteClient Tests
 *
 * Tests the SQLite client implementation using the shared test suite.
 * Uses Deno's built-in SQLite via `jsr:@db/sqlite` with in-memory databases.
 */

/// <reference lib="deno.ns" />

import {
  SqliteClient,
  type SqliteExecutor,
  type SqliteExecutorResult,
} from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";

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

const DEFAULT_PROGRAMS = [
  "store://users",
  "store://files",
  "store://pagination",
];

function createClient(): SqliteClient {
  const executor = new DenoSqliteExecutor(":memory:");
  return new SqliteClient(
    {
      path: ":memory:",
      tablePrefix: "b3nd",
    },
    executor,
  );
}

runSharedSuite("SqliteClient", {
  happy: () => createClient(),
});

runNodeSuite("SqliteClient", {
  happy: () => createClient(),
});
