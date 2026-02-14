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
 * const [uri, data] = await message({
 *   payload: {
 *     inputs: [],
 *     outputs: [["mutable://open/config", { theme: "dark" }]],
 *   },
 * });
 * await client.receive([uri, data]);
 *
 * // High-level: use send() instead
 * import { send } from "@bandeira-tech/b3nd-sdk";
 * await send({ payload: { inputs: [], outputs: [["mutable://open/config", { theme: "dark" }]] } }, client);
 * ```
 */

import type { MessageData } from "./types.ts";
import type { Message } from "../node-types.ts";
import { computeSha256, generateHashUri } from "../../b3nd-hash/mod.ts";

/**
 * Build a content-addressed message envelope.
 *
 * @param data - Canonical MessageData with payload (and optional auth)
 * @returns A `[hash://sha256/{hex}, MessageData]` tuple
 */
export async function message<V = unknown>(
  data: MessageData<V>,
): Promise<Message<MessageData<V>>> {
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);
  return [uri, data];
}
