/**
 * @module
 * B3nd Message Data Convention (Level 2)
 *
 * A standard way to structure message data for state transitions.
 * This is a **convention**, not a requirement. Protocols that want explicit
 * state transitions use it. Others don't.
 *
 * ## The Convention
 *
 * ```typescript
 * type MessageData = {
 *   inputs: string[]                         // URIs consumed/referenced
 *   outputs: [uri: string, value: unknown][] // URIs produced with values
 * }
 * ```
 *
 * ## Why Inputs/Outputs?
 *
 * This pattern enables:
 * - **UTXO-style transfers**: inputs consumed, outputs created
 * - **Hash storage with payment**: hash output + fee output in same msg
 * - **Atomic swaps**: multiple inputs/outputs in single message
 * - **Cross-output validation**: fee validators can check sibling outputs
 *
 * ## Program Validators
 *
 * Just like the data node has schema validators for programs, the message
 * layer can run program validators against outputs:
 *
 * @example Fee requirement for hash storage
 * ```typescript
 * import { createOutputValidator } from "b3nd/msg-data"
 *
 * const validator = createOutputValidator({
 *   schema: {
 *     "hash://sha256": async (ctx) => {
 *       // Find fee output in the same message
 *       const feeOutput = ctx.outputs.find(([uri]) => uri.startsWith("fees://"))
 *       const requiredFee = Math.ceil(ctx.value.length / 1024) // 1 token per KB
 *
 *       if (!feeOutput || feeOutput[1] < requiredFee) {
 *         return { valid: false, error: "insufficient_fee" }
 *       }
 *
 *       return { valid: true }
 *     }
 *   }
 * })
 * ```
 *
 * @example UTXO-style transfer using send()
 * ```typescript
 * import { send } from "@bandeira-tech/b3nd-sdk";
 *
 * await send({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [
 *     ["utxo://bob/99", 50],
 *     ["utxo://alice/2", 30],
 *     ["fees://pool", 1],
 *   ],
 * }, client);
 * // Envelope stored at hash://sha256/{hex} — replay-protected
 * ```
 */

// Types (new names)
export type {
  MessageData,
  MessageValidationContext,
  ProgramSchema,
  ProgramValidator,
  StateMessage,
} from "./types.ts";

// Deprecated type aliases
export type {
  StateTransaction,
  TransactionData,
  TransactionValidationContext,
} from "./types.ts";

// Validators
export {
  combineValidators,
  createOutputValidator,
  extractProgram,
} from "./validators.ts";

// Detection (new name + deprecated alias)
export { isMessageData, isTransactionData } from "./detect.ts";

// Content-addressed message constructor + sender
export { message } from "./message.ts";
export { send, type SendResult } from "./send.ts";
