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
    async receive(msgs: Message[]): Promise<ReceiveResult[]> {
      // Broadcast the entire batch to all clients in parallel
      const allResults = await Promise.allSettled(
        clients.map((c) => c.receive(msgs)),
      );

      // Check for rejected promises
      const rejected = allResults.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (rejected) {
        const err = rejected.reason instanceof Error
          ? rejected.reason.message
          : String(rejected.reason);
        console.warn(`[broadcast] Client threw: ${err}`);
        return msgs.map(() => ({ accepted: false, error: err }));
      }

      // Use the first client's results as baseline, check for failures
      const fulfilled = allResults.filter(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<ReceiveResult[]>[];

      if (fulfilled.length === 0) {
        return msgs.map(() => ({ accepted: false, error: "No client responded" }));
      }

      // Return first client's results (all clients got the same batch)
      return fulfilled[0].value;
    },

    async read<T>(uris: string | string[]): Promise<ReadResult<T>[]> {
      // Read from the first client only; composition for reads is handled by firstMatchSequence
      return clients[0].read<T>(uris);
    },

    // deno-lint-ignore require-yield
    async *observe<T = unknown>(
      _pattern: string,
      _signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      // Combinators don't implement observe — use connections instead.
    },

    async status(): Promise<StatusResult> {
      return clients[0].status();
    },
  };
}
