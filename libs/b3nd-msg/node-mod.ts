/**
 * @module
 * B3nd Message Layer
 *
 * The governance layer for b3nd. All state changes go through messages,
 * which go through validation. There is no external "write to URI" — only
 * "submit msg".
 *
 * ## The Model
 *
 * Everything is `[uri, data]`. Messages and stored data have the same shape.
 *
 * ```
 * Three operations:
 * 1. SUBMIT MSG  →  validate, propagate
 * 2. READ URI    →  retrieve stored data
 * 3. (internal)  →  data nodes store what they choose
 * ```
 *
 * ## Two Node Types
 *
 * **MSG NODE**: Receives msgs, validates, propagates to peers
 * - validate: fn(msg, read) → valid/invalid
 * - read: how to read state (points to data nodes)
 * - peers: where to propagate (other msg nodes, data nodes)
 *
 * **DATA NODE**: Listens to msg stream, stores what it chooses, serves reads
 * - subscribe: where to get msgs from
 * - filter: which msgs/outputs to materialize
 * - storage: where to persist
 * - serve: read API for clients
 *
 * @example Basic usage
 * ```typescript
 * import { createMessageNode } from "b3nd/msg"
 * import { createMemoryClient, firstMatchSequence } from "b3nd/clients"
 *
 * // Define a validator
 * const myValidator = async (msg, read) => {
 *   const [uri, data] = msg
 *   // Validate signature, check balances, etc.
 *   return { valid: true }
 * }
 *
 * // Create the node
 * const node = createMessageNode({
 *   validate: myValidator,
 *   read: createMemoryClient({ schema: { "hash://sha256": hashValidator() } }),
 *   peers: [
 *     createMemoryClient({ schema: { "hash://sha256": hashValidator() } })
 *   ]
 * })
 *
 * // Submit via send()
 * const result = await send({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [["utxo://bob/1", 50]],
 * }, node)
 * ```
 */

// Types (new names)
export type {
  Message,
  MessageNode,
  MessageNodeConfig,
  MessageValidator,
  SubmitResult,
} from "./node-types.ts";

// Deprecated type aliases
export type {
  Transaction,
  TransactionNode,
  TransactionNodeConfig,
  TransactionValidator,
} from "./node-types.ts";

// Node implementation (new name + deprecated alias)
export { createMessageNode, createTransactionNode } from "./node.ts";
