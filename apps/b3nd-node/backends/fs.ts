import type { BackendResolver } from "@bandeira-tech/b3nd-core/rig";
import { FsStore } from "@bandeira-tech/b3nd-stores/fs";
import { createFsExecutor } from "../fs-executor.ts";

export function fsBackend(): BackendResolver {
  return {
    protocols: ["file:"],
    resolve: (url) => {
      const rootDir = new URL(url).pathname;
      const executor = createFsExecutor(rootDir);
      return new FsStore(rootDir, executor);
    },
  };
}
