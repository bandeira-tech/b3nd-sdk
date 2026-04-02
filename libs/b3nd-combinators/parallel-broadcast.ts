import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";

export function parallelBroadcast(
  clients: NodeProtocolInterface[],
): NodeProtocolInterface {
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
      // deno-lint-ignore no-explicit-any
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

    async read<T>(uris: string | string[]): Promise<ReadResult<T>[]> {
      // Read from the first client only; composition for reads is handled by firstMatchSequence
      return clients[0].read<T>(uris);
    },

    async status(): Promise<StatusResult> {
      return clients[0].status();
    },
  };
}
