/**
 * @b3nd/sdk/msg-data Types
 * The Inputs/Outputs Convention
 *
 * In the new primitive, data is ALWAYS { inputs, outputs }.
 * This is not optional — every message carries this shape.
 */

import type { Message, Output, ReadResult } from "../../b3nd-core/types.ts";

/**
 * Standard message data structure
 *
 * @example
 * ```typescript
 * const data: MessageData = {
 *   inputs: ["utxo://alice/1", "utxo://alice/2"],
 *   outputs: [
 *     ["utxo://bob/99", { fire: 50 }, null],
 *     ["utxo://alice/3", { fire: 30 }, null],
 *     ["fees://pool", { fire: 1 }, null],
 *   ],
 * }
 * ```
 */
export interface MessageData {
  /**
   * Optional auth attestations (signatures, etc.)
   * Protocols decide whether auth is required.
   */
  auth?: Array<{ pubkey: string; signature: string }>;

  /**
   * URIs consumed or referenced by this message
   */
  inputs: string[];

  /**
   * Outputs produced — each is [uri, values, data]
   */
  outputs: Output[];
}

/**
 * A message with the inputs/outputs data convention
 */
export type StateMessage = Message<MessageData>;

/**
 * Extended validation context for messages using the inputs/outputs convention.
 * Provides access to message context during program validation.
 *
 * @deprecated Use Program from b3nd-core — programs receive the full Output
 * and call sub-programs directly via scoped routing.
 */
export interface MessageValidationContext {
  /** The URI being validated */
  uri: string;

  /** The values on this output */
  values: Record<string, number>;

  /** The data on this output */
  data: unknown;

  /** All inputs from the message */
  inputs: string[];

  /** All outputs from the message (for cross-output validation) */
  outputs: Output[];

  /** Read function for state lookups */
  read: <T>(
    uri: string,
  ) => Promise<ReadResult<T>>;
}

/**
 * Program validator for outputs in messages using the inputs/outputs convention.
 *
 * @deprecated Use Program from b3nd-core instead.
 */
export type ProgramValidator = (
  ctx: MessageValidationContext,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program prefixes to validators.
 *
 * @deprecated Use Record<string, Program> from b3nd-core instead.
 */
export type ProgramSchema = Record<string, ProgramValidator>;
