import type { BackendResolver } from "@bandeira-tech/b3nd-core/rig";
import { SqliteStore } from "@bandeira-tech/b3nd-stores/sqlite";
import { createSqliteExecutor } from "../sqlite-executor.ts";

export function sqliteBackend(): BackendResolver {
  return {
    protocols: ["sqlite:"],
    resolve: (url) => {
      const parsed = new URL(url);
      const path = parsed.pathname === "/:memory:"
        ? ":memory:"
        : parsed.pathname;
      const executor = createSqliteExecutor(path);
      return new SqliteStore("b3nd", executor);
    },
  };
}
