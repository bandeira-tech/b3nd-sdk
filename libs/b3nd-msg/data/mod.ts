/**
 * @module
 * B3nd Message Data Convention
 *
 * Data is always `{ inputs: string[], outputs: Output[] }`. Every
 * message carries this shape.
 *
 * @example UTXO-style transfer using `send()`
 * ```typescript
 * import { send } from "@bandeira-tech/b3nd-sdk";
 *
 * await send({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", { fire: 50 }, null],
 *     ["utxo://alice/2", { fire: 30 }, null],
 *     ["fees://pool", { fire: 1 }, null],
 *   ],
 * }, client);
 * ```
 */

export type { MessageData, StateMessage } from "./types.ts";
export { message } from "./message.ts";
export { send, type SendResult } from "./send.ts";
export {
  isMessageData,
  messageDataHandler,
  messageDataProgram,
} from "./canon.ts";
