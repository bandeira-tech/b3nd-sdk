/**
 * @module
 * Types for the message data convention.
 *
 * Data is always `{ inputs: string[], outputs: Output[] }`. Every
 * message carries this shape.
 */

import type { Message, Output } from "../../b3nd-core/types.ts";

/**
 * Standard message data structure.
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
 * };
 * ```
 */
export interface MessageData {
  /**
   * Optional auth attestations (signatures, etc.).
   * Protocols decide whether auth is required.
   */
  auth?: Array<{ pubkey: string; signature: string }>;

  /** URIs consumed or referenced by this message. */
  inputs: string[];

  /** Outputs produced — each is `[uri, values, data]`. */
  outputs: Output[];
}

/** A Message<MessageData> — a message carrying the inputs/outputs data. */
export type StateMessage = Message<MessageData>;
