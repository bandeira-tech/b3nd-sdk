/**
 * MessageDataClient — message-aware NodeProtocolInterface over a Store.
 *
 * Knows about the B3nd message convention: data is
 * `{ inputs: string[], outputs: [uri, values, data][] }`.
 *
 * For each received message:
 * 1. Writes the message itself at its URI (hash://sha256/...)
 * 2. Deletes each input URI
 * 3. Writes each output [uri, values, data]
 *
 * This is the ONE implementation that replaces the envelope logic
 * previously duplicated across every storage client. Any Store
 * can be wrapped with MessageDataClient to get full message behavior.
 *
 * The framework accepts any data on outputs, but a *message* is the
 * one that carries the { inputs, outputs } payload. SimpleClient
 * stores data as-is; MessageDataClient decomposes messages.
 *
 * Observe is implemented at the client layer via `ObserveEmitter`:
 * - the envelope write emits `(uri, data)`
 * - each output write emits `(outUri, outData)`
 * - each input delete emits `(inputUri, null)`
 *
 * @example
 * ```typescript
 * import { MessageDataClient, MemoryStore } from "@bandeira-tech/b3nd-sdk";
 *
 * const store = new MemoryStore();
 * const client = new MessageDataClient(store);
 *
 * // Message-aware: decomposes envelope, deletes inputs, writes outputs
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
import { ObserveEmitter } from "./observe-emitter.ts";

export class MessageDataClient extends ObserveEmitter
  implements NodeProtocolInterface {
  readonly store: Store;

  constructor(store: Store) {
    super();
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

    this._emit(uri, data);

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
        const deleteResults = await this.store.delete(inputs);
        const deleted: string[] = [];
        for (let i = 0; i < deleteResults.length; i++) {
          if (deleteResults[i].success) deleted.push(inputs[i]);
        }
        this._emitDeletes(deleted);
      }

      // Write outputs
      if (outputs.length > 0) {
        const entries = outputs.map(([outUri, outValues, outData]) => ({
          uri: outUri,
          values: outValues || {},
          data: outData,
        }));
        const writeResults = await this.store.write(entries);
        for (let i = 0; i < writeResults.length; i++) {
          if (writeResults[i].success) {
            this._emit(entries[i].uri, entries[i].data);
          }
        }
      }
    }

    return { accepted: true };
  }

  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    return this.store.read<T>(uriList);
  }

  status(): Promise<StatusResult> {
    return this.store.status();
  }
}
