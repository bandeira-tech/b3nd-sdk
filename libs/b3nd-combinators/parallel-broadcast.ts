import type {
  ConditionalWriteOptions,
  DeleteResult,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
} from "../b3nd-core/types.ts";

export function parallelBroadcast(
  clients: (NodeProtocolWriteInterface & NodeProtocolReadInterface)[],
): NodeProtocolWriteInterface & NodeProtocolReadInterface {
  if (!clients || clients.length === 0) {
    throw new Error("clients array is required and cannot be empty");
  }

  return {
    async receive<D>(msg: Message<D>): Promise<ReceiveResult> {
      const results = await Promise.allSettled(
        clients.map((c) => c.receive(msg)),
      );
      const [uri] = msg;
      const rejected = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (rejected) {
        const err = rejected.reason instanceof Error
          ? rejected.reason.message
          : String(rejected.reason);
        console.warn(`[broadcast] Client threw on ${uri}: ${err}`);
        return { accepted: false, error: err };
      }
      const failures = results.filter((r: any) =>
        r.status === "fulfilled" && r.value?.accepted === false
      ) as PromiseFulfilledResult<ReceiveResult>[];
      if (failures.length) {
        const err = failures[0].value.error || "Broadcast failed";
        console.warn(
          `[broadcast] ${failures.length}/${clients.length} client(s) rejected ${uri}: ${err}`,
        );
        return { accepted: false, error: err };
      }
      return { accepted: true };
    },

    async receiveIf<D>(msg: Message<D>, options: ConditionalWriteOptions): Promise<ReceiveResult> {
      const results = await Promise.allSettled(
        clients.map((c) => c.receiveIf(msg, options)),
      );
      const [uri] = msg;
      const rejected = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (rejected) {
        const err = rejected.reason instanceof Error
          ? rejected.reason.message
          : String(rejected.reason);
        console.warn(`[broadcast] Client threw on receiveIf ${uri}: ${err}`);
        return { accepted: false, error: err };
      }
      const failures = results.filter((r: any) =>
        r.status === "fulfilled" && r.value?.accepted === false
      ) as PromiseFulfilledResult<ReceiveResult>[];
      if (failures.length) {
        const err = failures[0].value.error || "Broadcast receiveIf failed";
        return { accepted: false, error: err, version: failures[0].value.version };
      }
      const success = (results[0] as PromiseFulfilledResult<ReceiveResult>).value;
      return { accepted: true, version: success.version };
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
