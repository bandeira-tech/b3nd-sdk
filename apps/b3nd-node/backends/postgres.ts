import type { BackendResolver } from "@b3nd/rig";
import { PostgresStore } from "@bandeira-tech/b3nd-stores/postgres";
import { createPostgresExecutor } from "../pg-executor.ts";

export function postgresBackend(): BackendResolver {
  return {
    protocols: ["postgresql:", "postgres:"],
    resolve: async (url) => {
      const executor = await createPostgresExecutor(url);
      return new PostgresStore("b3nd", executor);
    },
  };
}
