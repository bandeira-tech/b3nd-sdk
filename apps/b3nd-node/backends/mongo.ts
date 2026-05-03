import type { BackendResolver } from "@bandeira-tech/b3nd-core/rig";
import { MongoStore } from "@bandeira-tech/b3nd-stores/mongo";
import { createMongoExecutor } from "../mongo-executor.ts";

export function mongoBackend(): BackendResolver {
  return {
    protocols: ["mongodb:", "mongodb+srv:"],
    resolve: async (url) => {
      const parsed = new URL(url);
      const dbName = parsed.pathname.replace(/^\//, "") || "b3nd";
      const collectionName = "b3nd_data";
      const executor = await createMongoExecutor(url, dbName, collectionName);
      return new MongoStore(collectionName, executor);
    },
  };
}
