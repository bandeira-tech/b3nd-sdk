/**
 * SimpleClient — bare NodeProtocolInterface over a Store.
 *
 * No protocol awareness. receive() writes the message at its URI.
 * No envelope decomposition, no input deletion, no output fan-out.
 *
 * Use this when you want raw b3nd storage without any protocol
 * semantics — the data shape is entirely up to the caller.
 *
 * @example
 * ```typescript
 * import { SimpleClient } from "@bandeira-tech/b3nd-sdk";
 * import { MemoryStore } from "@bandeira-tech/b3nd-sdk";
 *
 * const store = new MemoryStore();
 * const client = new SimpleClient(store);
 *
 * // Writes the message at "mutable://app/config"
 * await client.receive([
 *   ["mutable://app/config", {}, { theme: "dark" }],
 * ]);
 *
 * // Reads it back
 * const results = await client.read("mutable://app/config");
 * ```
 */

import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  StatusResult,
  Store,
} from "./types.ts";

export class SimpleClient implements NodeProtocolInterface {
  readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const entries = msgs.map(([uri, values, data]) => ({
      uri,
      values: values || {},
      data,
    }));

    const writeResults = await this.store.write(entries);

    return writeResults.map((r) => ({
      accepted: r.success,
      error: r.error,
    }));
  }

  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    return this.store.read<T>(uriList);
  }

  observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    if (!this.store.observe) {
      throw new Error(
        "SimpleClient.observe: underlying store does not support observe",
      );
    }
    return this.store.observe<T>(pattern, signal);
  }

  status(): Promise<StatusResult> {
    return this.store.status();
  }
}
