/**
 * @b3nd/sdk/txn Types
 * Core types for transaction layer
 */

import type {
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  ReadResult,
} from "../src/types.ts";

/**
 * Transaction: the minimal primitive
 *
 * A tuple of [uri, data]. URIs all the way down.
 * The URI is the transaction's identity. The data is the transaction's content.
 *
 * @example
 * ```typescript
 * // A user transaction
 * ["txn://alice/transfer/42", { inputs: [...], outputs: [...] }]
 *
 * // A block transaction
 * ["txn://firecat/block/1000", { prev: "txn://firecat/block/999", txns: [...] }]
 * ```
 */
export type Transaction<D = unknown> = [uri: string, data: D];

/**
 * Result of a transaction submission
 */
export interface SubmitResult {
  accepted: boolean;
  error?: string;
}

/**
 * Transaction validator function
 *
 * Pure function: same inputs → same result. Side effects happen downstream.
 * The validator cannot write — everything needed for validation must exist
 * in the transaction or be readable from current state.
 *
 * @param tx - The transaction to validate
 * @param read - Function to read state for validation (read-only)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const myValidator: TransactionValidator = async (tx, read) => {
 *   const [uri, data] = tx
 *
 *   // Read state for validation
 *   const balance = await read("accounts://alice/balance")
 *
 *   if (!balance.success || balance.record.data < data.amount) {
 *     return { valid: false, error: "insufficient_balance" }
 *   }
 *
 *   return { valid: true }
 * }
 * ```
 */
export type TransactionValidator<D = unknown> = (
  tx: Transaction<D>,
  read: <T>(uri: string) => Promise<ReadResult<T>>,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Configuration for creating a transaction node
 *
 * A txn node has two concerns:
 * 1. Read — how to read state for validation (operator's choice)
 * 2. Peers — where to propagate valid txns (txn nodes, data nodes, any client)
 *
 * @example
 * ```typescript
 * const config: TransactionNodeConfig = {
 *   validate: myValidator,
 *   read: firstMatchSequence([
 *     createMemoryClient(),
 *     createPostgresClient("postgres://...")
 *   ]),
 *   peers: [
 *     createWebSocketClient("ws://txn-node-a:8843"),
 *     createPostgresClient("postgres://...")
 *   ]
 * }
 * ```
 */
export interface TransactionNodeConfig<D = unknown> {
  /**
   * Validator function for incoming transactions
   */
  validate: TransactionValidator<D>;

  /**
   * How to read state for validation
   * Can be any NodeProtocolReadInterface (memory, postgres, http, composite, etc.)
   */
  read: NodeProtocolReadInterface;

  /**
   * Where to propagate valid transactions
   * Can be remote txn nodes, local storage, anything with NodeProtocolInterface
   * When a txn node propagates to a postgres peer, that postgres becomes a data node storing txns
   */
  peers: NodeProtocolInterface[];
}

/**
 * Transaction node interface
 *
 * Receives transactions, validates them, and propagates to peers.
 * The only external API for submitting transactions.
 *
 * @example
 * ```typescript
 * const node = createTransactionNode(config)
 *
 * const result = await node.receive([
 *   "txn://alice/transfer/42",
 *   { inputs: [...], outputs: [...] }
 * ])
 *
 * if (!result.accepted) {
 *   console.log("Transaction rejected:", result.error)
 * }
 * ```
 */
export interface TransactionNode<D = unknown> {
  /**
   * Receive and process a transaction
   * 1. Validates the transaction
   * 2. If valid, propagates to all peers
   * 3. Returns acceptance result
   */
  receive(tx: Transaction<D>): Promise<SubmitResult>;

  /**
   * Cleanup resources (close connections, etc.)
   */
  cleanup(): Promise<void>;
}
