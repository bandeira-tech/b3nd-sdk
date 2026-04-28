/**
 * @module
 * B3nd Message Data Convention
 *
 * Data is always `{ inputs: string[], outputs: Output[] }`. Every
 * message carries this shape.
 *
 * @example Building a content-addressed message envelope
 * ```typescript
 * import { message } from "@bandeira-tech/b3nd-sdk/msg";
 *
 * const envelope = await message({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", { fire: 50 }, null],
 *     ["utxo://alice/2", { fire: 30 }, null],
 *     ["fees://pool", { fire: 1 }, null],
 *   ],
 * });
 * await client.receive([envelope]);
 * ```
 */

export type { MessageData, StateMessage } from "./types.ts";
export { message } from "./message.ts";
export {
  isMessageData,
  messageDataHandler,
  messageDataProgram,
} from "./canon.ts";
