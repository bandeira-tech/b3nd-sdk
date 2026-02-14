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
 *   payload: {
 *     inputs: [],
 *     outputs: [
 *       ["mutable://open/config", { theme: "dark" }],
 *       ["hash://sha256/abc123...", data],
 *     ],
 *   },
 * }, client);
 *
 * console.log(result.uri);      // "hash://sha256/{hex}"
 * console.log(result.accepted); // true
 * ```
 */

import type { ReceiveResult } from "../../b3nd-core/types.ts";
import type { MessageData } from "./types.ts";
import { message } from "./message.ts";

export interface SendResult extends ReceiveResult {
  /** The content-addressed URI of the envelope: hash://sha256/{hex} */
  uri: string;
}

/**
 * Build a content-addressed message envelope and send it.
 *
 * @param data - Canonical MessageData with payload (and optional auth)
 * @param client - Any object with a `receive()` method
 * @returns The envelope URI and receive result
 */
export async function send<V = unknown>(
  data: MessageData<V>,
  client: { receive: (msg: [string, unknown]) => Promise<ReceiveResult> },
): Promise<SendResult> {
  const [uri, envelope] = await message(data);
  const result = await client.receive([uri, envelope]);
  return { uri, ...result };
}
