/**
 * @b3nd/sdk/txn-data Types
 * Level 2: The Inputs/Outputs Convention
 *
 * A standard way to structure transaction data for state transitions.
 * This is a convention, not a requirement. Protocols that want explicit
 * state transitions use it. Others don't.
 */

import type { Transaction } from "../txn/types.ts";

/**
 * Standard transaction data structure for state transitions
 *
 * @example
 * ```typescript
 * const data: TransactionData = {
 *   inputs: ["utxo://alice/1", "utxo://alice/2"],
 *   outputs: [
 *     ["utxo://bob/99", 50],
 *     ["utxo://alice/3", 30],
 *     ["fees://pool", 1]
 *   ]
 * }
 * ```
 */
export interface TransactionData<V = unknown> {
  /**
   * URIs consumed or referenced by this transaction
   * Semantics (consumed vs referenced) are protocol-defined
   */
  inputs: string[];

  /**
   * URIs produced with their values
   * Each output is [uri, value]
   */
  outputs: [uri: string, value: V][];
}

/**
 * A transaction with the inputs/outputs data convention
 */
export type StateTransaction<V = unknown> = Transaction<TransactionData<V>>;

/**
 * Extended validation context for transactions using the inputs/outputs convention
 * Provides access to transaction context during program validation
 */
export interface TransactionValidationContext<V = unknown> {
  /**
   * The URI being validated
   */
  uri: string;

  /**
   * The value being written to the URI
   */
  value: V;

  /**
   * All inputs from the transaction
   */
  inputs: string[];

  /**
   * All outputs from the transaction (for cross-output validation)
   */
  outputs: [uri: string, value: V][];

  /**
   * Read function for state lookups
   */
  read: <T>(
    uri: string,
  ) => Promise<{ success: boolean; record?: { data: T }; error?: string }>;
}

/**
 * Program validator for outputs in transactions using the inputs/outputs convention
 *
 * @example Fee requirement validator
 * ```typescript
 * const blobValidator: ProgramValidator = async (ctx) => {
 *   // Find fee output in the same transaction
 *   const feeOutput = ctx.outputs.find(([uri]) => uri.startsWith("fees://"))
 *   const requiredFee = Math.ceil(ctx.value.length / 1024) // 1 token per KB
 *
 *   if (!feeOutput || feeOutput[1] < requiredFee) {
 *     return { valid: false, error: "insufficient_fee" }
 *   }
 *
 *   return { valid: true }
 * }
 * ```
 */
export type ProgramValidator<V = unknown> = (
  ctx: TransactionValidationContext<V>,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program prefixes to validators
 *
 * @example
 * ```typescript
 * const schema: ProgramSchema = {
 *   "immutable://blob": blobValidator,
 *   "mutable://accounts": accountValidator,
 *   "fees://pool": feeValidator
 * }
 * ```
 */
export type ProgramSchema<V = unknown> = Record<string, ProgramValidator<V>>;
