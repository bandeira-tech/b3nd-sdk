/**
 * Content-addressed message envelope constructor.
 *
 * Builds a MessageData payload and returns a `[hash://sha256/{hex}, {}, data]`
 * 3-tuple. Prefer `send()` for the common case — it calls `message()` internally.
 *
 * @example
 * ```typescript
 * import { message } from "@bandeira-tech/b3nd-sdk";
 *
 * const msg = await message({
 *   inputs: [],
 *   outputs: [["mutable://open/config", {}, { theme: "dark" }]],
 * });
 * // msg = ["hash://sha256/abc...", {}, { inputs: [], outputs: [...] }]
 *
 * await client.receive([msg]);
 * ```
 */

import type { MessageData } from "./types.ts";
import type { Message } from "../../b3nd-core/types.ts";
import { computeSha256, generateHashUri } from "../../b3nd-hash/mod.ts";

/**
 * Build a content-addressed message envelope.
 *
 * @param data - MessageData with inputs, outputs, and optional auth
 * @returns A `[hash://sha256/{hex}, {}, MessageData]` 3-tuple
 */
export async function message(
  data: MessageData,
): Promise<Message<MessageData>> {
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);
  return [uri, {}, data];
}
