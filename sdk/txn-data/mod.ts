/**
 * @module
 * B3nd Transaction Data Convention (Level 2)
 *
 * A standard way to structure transaction data for state transitions.
 * This is a **convention**, not a requirement. Protocols that want explicit
 * state transitions use it. Others don't.
 *
 * ## The Convention
 *
 * ```typescript
 * type TransactionData = {
 *   inputs: string[]                         // URIs consumed/referenced
 *   outputs: [uri: string, value: unknown][] // URIs produced with values
 * }
 * ```
 *
 * ## Why Inputs/Outputs?
 *
 * This pattern enables:
 * - **UTXO-style transfers**: inputs consumed, outputs created
 * - **Blob storage with payment**: blob output + fee output in same txn
 * - **Atomic swaps**: multiple inputs/outputs in single transaction
 * - **Cross-output validation**: fee validators can check sibling outputs
 *
 * ## Program Validators
 *
 * Just like the data node has schema validators for programs, the transaction
 * layer can run program validators against outputs:
 *
 * @example Fee requirement for blob storage
 * ```typescript
 * import { createOutputValidator } from "b3nd/txn-data"
 *
 * const validator = createOutputValidator({
 *   schema: {
 *     "immutable://blob": async (ctx) => {
 *       // Find fee output in the same transaction
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
 * @example User transaction with UTXO model
 * ```typescript
 * const userTxn: StateTransaction = [
 *   "txn://alice/transfer/42",
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
 * @example Block transaction referencing user transactions
 * ```typescript
 * const blockTxn: StateTransaction = [
 *   "txn://firecat/block/1000",
 *   {
 *     sig: "validator-sig",
 *     inputs: [
 *       "txn://firecat/block/999",  // Previous block
 *       "txn://alice/transfer/42",   // User txns in this block
 *       "txn://bob/transfer/15"
 *     ],
 *     outputs: [
 *       ["block://firecat/1000", { merkleRoot: "...", timestamp: 1234567890 }]
 *     ]
 *   }
 * ]
 * ```
 */

// Types
export type {
  TransactionData,
  StateTransaction,
  TransactionValidationContext,
  ProgramValidator,
  ProgramSchema,
} from "./types.ts";

// Validators
export {
  extractProgram,
  createOutputValidator,
  combineValidators,
} from "./validators.ts";

// Detection
export { isTransactionData } from "./detect.ts";
