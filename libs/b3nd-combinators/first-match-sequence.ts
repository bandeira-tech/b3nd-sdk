import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";

export function firstMatchSequence(
  clients: NodeProtocolInterface[],
): NodeProtocolInterface {
  if (!clients || clients.length === 0) {
    throw new Error("clients array is required and cannot be empty");
  }

  return {
    async receive<D>(msg: Message<D>): Promise<ReceiveResult> {
      // Try each client until one accepts the message
      let lastError: string | undefined;
      for (const c of clients) {
        const res = await c.receive<D>(msg);
        if (res.accepted) return res;
        lastError = res.error;
      }
      return {
        accepted: false,
        error: lastError || "No client accepted message",
      };
    },

    async read<T>(uris: string | string[]): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      const allResults: ReadResult<T>[] = [];

      for (const uri of uriList) {
        let found = false;
        for (const c of clients) {
          const results = await c.read<T>(uri);
          if (results.length > 0 && results.some((r) => r.success)) {
            allResults.push(...results);
            found = true;
            break;
          }
        }
        if (!found) {
          allResults.push({ success: false, error: `Not found: ${uri}` });
        }
      }

      return allResults;
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
