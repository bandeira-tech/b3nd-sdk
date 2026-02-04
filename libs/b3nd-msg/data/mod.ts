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
 * - **Blob storage with payment**: blob output + fee output in same msg
 * - **Atomic swaps**: multiple inputs/outputs in single message
 * - **Cross-output validation**: fee validators can check sibling outputs
 *
 * ## Program Validators
 *
 * Just like the data node has schema validators for programs, the message
 * layer can run program validators against outputs:
 *
 * @example Fee requirement for blob storage
 * ```typescript
 * import { createOutputValidator } from "b3nd/msg-data"
 *
 * const validator = createOutputValidator({
 *   schema: {
 *     "immutable://blob": async (ctx) => {
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
 * @example User message with UTXO model
 * ```typescript
 * const userMsg: StateMessage = [
 *   "msg://alice/transfer/42",
 *   {
 *     sig: "user-sig-123",
 *     inputs: ["utxo://alice/1"],
 *     outputs: [
 *       ["utxo://bob/99", 50],
 *       ["utxo://alice/2", 30],
 *       ["fees://pool", 1]
 *     ]
 *   }
 * ]
 * ```
 *
 * @example Block message referencing user messages
 * ```typescript
 * const blockMsg: StateMessage = [
 *   "msg://firecat/block/1000",
 *   {
 *     sig: "validator-sig",
 *     inputs: [
 *       "msg://firecat/block/999",  // Previous block
 *       "msg://alice/transfer/42",   // User msgs in this block
 *       "msg://bob/transfer/15"
 *     ],
 *     outputs: [
 *       ["block://firecat/1000", { merkleRoot: "...", timestamp: 1234567890 }]
 *     ]
 *   }
 * ]
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
