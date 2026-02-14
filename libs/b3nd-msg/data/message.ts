/**
 * Content-addressed message envelope constructor.
 *
 * Builds a MessageData payload and returns a `[hash://sha256/{hex}, payload]`
 * tuple. Prefer `send()` for the common case — it calls `message()` internally.
 *
 * @example
 * ```typescript
 * import { message } from "@bandeira-tech/b3nd-sdk";
 *
 * // Low-level: build tuple, then send manually
 * const [uri, payload] = await message({
 *   outputs: [["mutable://open/config", { theme: "dark" }]],
 * });
 * await client.receive([uri, payload]);
 *
 * // High-level: use send() instead
 * import { send } from "@bandeira-tech/b3nd-sdk";
 * await send({ outputs: [["mutable://open/config", { theme: "dark" }]] }, client);
 * ```
 */

import type { MessageData } from "./types.ts";
import type { Message } from "../node-types.ts";
import { computeSha256, generateHashUri } from "../../b3nd-hash/mod.ts";

/**
 * Build a content-addressed message envelope.
 *
 * @param data - Message payload with outputs (and optional inputs)
 * @returns A `[hash://sha256/{hex}, MessageData]` tuple
 */
export async function message<V = unknown>(
  data: { inputs?: string[]; outputs: [uri: string, value: V][] },
): Promise<Message<MessageData<V>>> {
  const payload: MessageData<V> = {
    inputs: data.inputs ?? [],
    outputs: data.outputs,
  };
  const hash = await computeSha256(payload);
  const uri = generateHashUri(hash);
  return [uri, payload];
}
