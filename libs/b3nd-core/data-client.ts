/**
 * DataClient — envelope-aware NodeProtocolInterface over a Store.
 *
 * Knows about the B3nd envelope convention: data is
 * `{ inputs: string[], outputs: [uri, values, data][] }`.
 *
 * For each received message:
 * 1. Writes the message itself at its URI (hash://sha256/...)
 * 2. Deletes each input URI
 * 3. Writes each output [uri, values, data]
 *
 * This is the ONE implementation that replaces the envelope logic
 * previously duplicated across every storage client. Any Store
 * can be wrapped with DataClient to get full protocol behavior.
 *
 * Named "DataClient" because it only wraps Stores (local data backends),
 * not transport peers like HTTP or WebSocket.
 *
 * @example
 * ```typescript
 * import { DataClient } from "@bandeira-tech/b3nd-sdk";
 * import { MemoryStore } from "@bandeira-tech/b3nd-sdk";
 *
 * const store = new MemoryStore();
 * const client = new DataClient(store);
 *
 * // Protocol-aware: decomposes envelope, deletes inputs, writes outputs
 * await client.receive([
 *   ["hash://sha256/abc...", {}, {
 *     inputs: ["mutable://tokens/1"],
 *     outputs: [
 *       ["mutable://tokens/2", { fire: 50 }, null],
 *       ["mutable://tokens/3", { fire: 30 }, null],
 *     ],
 *   }],
 * ]);
 * ```
 */

import type {
  Message,
  NodeProtocolInterface,
  Output,
  ReadResult,
  ReceiveResult,
  StatusResult,
  Store,
} from "./types.ts";

export class DataClient implements NodeProtocolInterface {
  readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(await this._receiveOne(msg));
    }

    return results;
  }

  private async _receiveOne(msg: Message): Promise<ReceiveResult> {
    const [uri, values, data] = msg;

    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    // Always persist the envelope at its URI
    const envelopeWrite = await this.store.write([
      { uri, values: values || {}, data },
    ]);

    if (!envelopeWrite[0].success) {
      return { accepted: false, error: envelopeWrite[0].error };
    }

    // Decompose if data follows the { inputs, outputs } convention
    const msgData = data as { inputs?: unknown; outputs?: unknown } | null;
    const isEnvelope = msgData != null &&
      typeof msgData === "object" &&
      Array.isArray(msgData.inputs) &&
      Array.isArray(msgData.outputs);

    if (isEnvelope) {
      const inputs = msgData!.inputs as string[];
      const outputs = msgData!.outputs as Output[];

      // Delete inputs
      if (inputs.length > 0) {
        await this.store.delete(inputs);
      }

      // Write outputs
      if (outputs.length > 0) {
        const entries = outputs.map(([outUri, outValues, outData]) => ({
          uri: outUri,
          values: outValues || {},
          data: outData,
        }));
        await this.store.write(entries);
      }
    }

    return { accepted: true };
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
        "DataClient.observe: underlying store does not support observe",
      );
    }
    return this.store.observe<T>(pattern, signal);
  }

  status(): Promise<StatusResult> {
    return this.store.status();
  }
}
