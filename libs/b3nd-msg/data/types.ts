/**
 * @b3nd/sdk/msg-data Types
 * Level 2: The Inputs/Outputs Convention
 *
 * A standard way to structure message data for state transitions.
 * This is a convention, not a requirement. Protocols that want explicit
 * state transitions use it. Others don't.
 */

import type { Message } from "../node-types.ts";

/**
 * Standard message data structure for state transitions
 *
 * @example
 * ```typescript
 * const data: MessageData = {
 *   payload: {
 *     inputs: ["utxo://alice/1", "utxo://alice/2"],
 *     outputs: [
 *       ["utxo://bob/99", 50],
 *       ["utxo://alice/3", 30],
 *       ["fees://pool", 1]
 *     ]
 *   }
 * }
 * ```
 */
export interface MessageData<V = unknown> {
  /**
   * Optional auth attestations (signatures, etc.)
   * Protocols decide whether auth is required.
   */
  auth?: Array<{ pubkey: string; signature: string }>;

  /**
   * Payload containing inputs and outputs
   */
  payload: {
    /**
     * URIs consumed or referenced by this message
     * Semantics (consumed vs referenced) are protocol-defined
     */
    inputs: string[];

    /**
     * URIs produced with their values
     * Each output is [uri, value]
     */
    outputs: [uri: string, value: V][];
  };
}

/** @deprecated Use `MessageData` instead */
export type TransactionData<V = unknown> = MessageData<V>;

/**
 * A message with the inputs/outputs data convention
 */
export type StateMessage<V = unknown> = Message<MessageData<V>>;

/** @deprecated Use `StateMessage` instead */
export type StateTransaction<V = unknown> = StateMessage<V>;

/**
 * Extended validation context for messages using the inputs/outputs convention
 * Provides access to message context during program validation
 */
export interface MessageValidationContext<V = unknown> {
  /**
   * The URI being validated
   */
  uri: string;

  /**
   * The value being written to the URI
   */
  value: V;

  /**
   * All inputs from the message
   */
  inputs: string[];

  /**
   * All outputs from the message (for cross-output validation)
   */
  outputs: [uri: string, value: V][];

  /**
   * Read function for state lookups
   */
  read: <T>(
    uri: string,
  ) => Promise<{ success: boolean; record?: { data: T }; error?: string }>;
}

/** @deprecated Use `MessageValidationContext` instead */
export type TransactionValidationContext<V = unknown> =
  MessageValidationContext<
    V
  >;

/**
 * Program validator for outputs in messages using the inputs/outputs convention
 *
 * @example Fee requirement validator
 * ```typescript
 * const hashValidator: ProgramValidator = async (ctx) => {
 *   // Find fee output in the same message
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
  ctx: MessageValidationContext<V>,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program prefixes to validators
 *
 * @example
 * ```typescript
 * const schema: ProgramSchema = {
 *   "hash://sha256": hashValidator,
 *   "mutable://accounts": accountValidator,
 *   "fees://pool": feeValidator
 * }
 * ```
 */
export type ProgramSchema<V = unknown> = Record<string, ProgramValidator<V>>;
