/**
 * Send a content-addressed message to a client.
 *
 * Builds the envelope, hashes it, and sends it in one call.
 * The URI is `hash://sha256/{hex}` — replay-protected and tamper-proof.
 *
 * @example
 * ```typescript
 * import { send } from "@bandeira-tech/b3nd-sdk";
 *
 * const result = await send({
 *   inputs: [],
 *   outputs: [
 *     ["mutable://open/config", { theme: "dark" }],
 *   ],
 * }, client);
 *
 * console.log(result.uri);      // "hash://sha256/{hex}"
 * console.log(result.accepted); // true
 * ```
 */

import type { Message, ReceiveResult } from "../../b3nd-core/types.ts";
import type { MessageData } from "./types.ts";
import { message } from "./message.ts";

export interface SendResult extends ReceiveResult {
  /** The content-addressed URI of the envelope: hash://sha256/{hex} */
  uri: string;
}

/**
 * Build a content-addressed message envelope and send it.
 *
 * @param data - MessageData with inputs, outputs, and optional auth
 * @param client - Any object with a batch `receive()` method
 * @returns The envelope URI and receive result
 */
export async function send(
  data: MessageData,
  client: { receive: (msgs: Message[]) => Promise<ReceiveResult[]> },
): Promise<SendResult> {
  const msg = await message(data);
  const results = await client.receive([msg]);
  return { uri: msg[0], ...results[0] };
}
