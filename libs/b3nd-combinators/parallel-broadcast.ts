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

      // Collect fulfilled results
      const fulfilled = allResults.filter(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<ReceiveResult[]>[];

      if (fulfilled.length === 0) {
        return msgs.map(() => ({ accepted: false, error: "No client responded" }));
      }

      // Merge results: if ANY backend rejects a message, the message is rejected
      return msgs.map((_, i) => {
        for (const f of fulfilled) {
          if (f.value[i] && !f.value[i].accepted) {
            return f.value[i];
          }
        }
        return fulfilled[0].value[i];
      });
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
