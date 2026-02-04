import type {
  DeleteResult,
  ListOptions,
  ListResult,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
  Transaction,
} from "../b3nd-core/types.ts";

export function parallelBroadcast(
  clients: (NodeProtocolWriteInterface & NodeProtocolReadInterface)[],
): NodeProtocolWriteInterface & NodeProtocolReadInterface {
  if (!clients || clients.length === 0) {
    throw new Error("clients array is required and cannot be empty");
  }

  return {
    async receive<D>(tx: Transaction<D>): Promise<ReceiveResult> {
      const results = await Promise.allSettled(
        clients.map((c) => c.receive(tx)),
      );
      const rejected = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (rejected) {
        return {
          accepted: false,
          error: rejected.reason instanceof Error
            ? rejected.reason.message
            : String(rejected.reason),
        };
      }
      const failures = results.filter((r: any) =>
        r.status === "fulfilled" && r.value?.accepted === false
      ) as PromiseFulfilledResult<ReceiveResult>[];
      if (failures.length) {
        return {
          accepted: false,
          error: failures[0].value.error || "Broadcast failed",
        };
      }
      return { accepted: true };
    },

    async read<T>(uri: string): Promise<ReadResult<T>> {
      // Read from the first client only; composition for reads is handled by firstMatchSequence
      return clients[0].read(uri);
    },

    async readMulti<T>(uris: string[]): Promise<ReadMultiResult<T>> {
      // Read from the first client only
      return clients[0].readMulti(uris);
    },

    async list(uri: string, options?: ListOptions): Promise<ListResult> {
      return clients[0].list(uri, options);
    },

    async delete(uri: string): Promise<DeleteResult> {
      const results = await Promise.allSettled(
        clients.map((c) => c.delete(uri)),
      );
      const rejected = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (rejected) {
        return {
          success: false,
          error: rejected.reason instanceof Error
            ? rejected.reason.message
            : String(rejected.reason),
        };
      }
      const failures = results.filter((r: any) =>
        r.status === "fulfilled" && r.value?.success === false
      ) as PromiseFulfilledResult<DeleteResult>[];
      if (failures.length) {
        return {
          success: false,
          error: failures[0].value.error || "Broadcast delete failed",
        };
      }
      return { success: true };
    },

    async health() {
      return clients[0].health();
    },
    async getSchema() {
      return clients[0].getSchema();
    },
    async cleanup() {
      await Promise.all(clients.map((c) => c.cleanup()));
    },
  };
}
