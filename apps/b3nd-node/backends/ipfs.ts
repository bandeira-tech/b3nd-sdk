import type { BackendResolver } from "@bandeira-tech/b3nd-core/rig";
import { IpfsStore } from "@bandeira-tech/b3nd-stores/ipfs";
import { createIpfsExecutor } from "../ipfs-executor.ts";

export function ipfsBackend(): BackendResolver {
  return {
    protocols: ["ipfs:"],
    resolve: (url) => {
      const parsed = new URL(url);
      const apiUrl = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ":5001"
      }${parsed.pathname}`;
      const executor = createIpfsExecutor(apiUrl);
      return new IpfsStore(executor);
    },
  };
}
