/**
 * @module
 * B3nd Transaction Layer
 *
 * The governance layer for b3nd. All state changes go through transactions,
 * which go through validation. There is no external "write to URI" — only
 * "submit txn".
 *
 * ## The Model
 *
 * Everything is `[uri, data]`. Transactions and stored data have the same shape.
 *
 * ```
 * Three operations:
 * 1. SUBMIT TXN  →  validate, propagate
 * 2. READ URI    →  retrieve stored data
 * 3. (internal)  →  data nodes store what they choose
 * ```
 *
 * ## Two Node Types
 *
 * **TXN NODE**: Receives txns, validates, propagates to peers
 * - validate: fn(txn, read) → valid/invalid
 * - read: how to read state (points to data nodes)
 * - peers: where to propagate (other txn nodes, data nodes)
 *
 * **DATA NODE**: Listens to txn stream, stores what it chooses, serves reads
 * - subscribe: where to get txns from
 * - filter: which txns/outputs to materialize
 * - storage: where to persist
 * - serve: read API for clients
 *
 * @example Basic usage
 * ```typescript
 * import { createTransactionNode } from "b3nd/txn"
 * import { createMemoryClient, firstMatchSequence } from "b3nd/clients"
 *
 * // Define a validator
 * const myValidator = async (tx, read) => {
 *   const [uri, data] = tx
 *   // Validate signature, check balances, etc.
 *   return { valid: true }
 * }
 *
 * // Create the node
 * const node = createTransactionNode({
 *   validate: myValidator,
 *   read: createMemoryClient({ schema: { "txn://test": async () => ({ valid: true }) } }),
 *   peers: [
 *     createMemoryClient({ schema: { "txn://test": async () => ({ valid: true }) } })
 *   ]
 * })
 *
 * // Submit a transaction
 * const result = await node.receive([
 *   "txn://alice/transfer/42",
 *   { sig: "...", inputs: ["utxo://alice/1"], outputs: [["utxo://bob/1", 50]] }
 * ])
 * ```
 */

// Types
export type {
  SubmitResult,
  Transaction,
  TransactionNode,
  TransactionNodeConfig,
  TransactionValidator,
} from "./types.ts";

// Node implementation
export { createTransactionNode } from "./node.ts";
