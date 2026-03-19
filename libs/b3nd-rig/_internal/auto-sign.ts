/**
 * @module
 * Auto-sign — wraps MessageData payloads with identity signatures.
 */

import type { Identity } from "../identity.ts";
import type { MessageData } from "../../b3nd-msg/data/types.ts";

/**
 * Sign a MessageData payload with the given identity.
 * Adds the identity's auth entry to the message's auth array.
 */
export async function autoSign<V>(
  data: MessageData<V>,
  identity: Identity,
): Promise<MessageData<V>> {
  const authEntry = await identity.sign(data.payload);
  return {
    auth: [...(data.auth || []), authEntry],
    payload: data.payload,
  };
}
