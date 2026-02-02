/**
 * @module
 * B3nd Unified Node Type System
 *
 * Core types for the unified node architecture where all state changes
 * flow through a single `receive(tx)` interface.
 */

import type {
  ListOptions,
  ListResult,
  ReadMultiResult,
  ReadResult,
} from "../types.ts";

/**
 * Transaction: the minimal primitive
 *
 * A tuple of [uri, data]. URIs all the way down.
 * The URI is the transaction's identity. The data is the transaction's content.
 *
 * @example
 * ```typescript
 * // A user transaction
 * const tx: Transaction = ["mutable://users/alice/profile", { name: "Alice" }]
 *
 * // A transfer transaction
 * const tx: Transaction = ["txn://alice/transfer/42", { inputs: [...], outputs: [...] }]
 * ```
 */
export type Transaction<D = unknown> = [uri: string, data: D];

/**
 * Result of a receive operation
 */
export interface ReceiveResult {
  accepted: boolean;
  error?: string;
}

/**
 * Read interface - subset of node capabilities for reading state
 */
export interface ReadInterface {
  read<T = unknown>(uri: string): Promise<ReadResult<T>>;
  readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
}

/**
 * Unified Node interface
 *
 * The single entry point for all state changes. Nodes receive transactions
 * and decide what to do with them based on their configuration.
 *
 * @example
 * ```typescript
 * const node: Node = createNode({
 *   read: memoryClient,
 *   validate: schema(SCHEMA),
 *   process: store(memoryClient)
 * })
 *
 * const result = await node.receive(["mutable://users/alice", { name: "Alice" }])
 * ```
 */
export interface Node {
  receive<D = unknown>(tx: Transaction<D>): Promise<ReceiveResult>;
  cleanup(): Promise<void>;
}

/**
 * Validator function
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
 * const myValidator: Validator = async (tx, read) => {
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
export type Validator<D = unknown> = (
  tx: Transaction<D>,
  read: <T>(uri: string) => Promise<ReadResult<T>>
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Processor function
 *
 * Processes a validated transaction. Can perform side effects like storing
 * data, forwarding to other nodes, emitting events, etc.
 *
 * @param tx - The transaction to process
 * @returns Processing result
 *
 * @example
 * ```typescript
 * const myProcessor: Processor = async (tx) => {
 *   const [uri, data] = tx
 *   await database.insert({ uri, data, ts: Date.now() })
 *   return { success: true }
 * }
 * ```
 */
export type Processor<D = unknown> = (
  tx: Transaction<D>
) => Promise<{ success: boolean; error?: string }>;

/**
 * Configuration for creating a node
 *
 * @example
 * ```typescript
 * const config: NodeConfig = {
 *   read: memoryClient,
 *   validate: seq(uriPattern(/^mutable:\/\//), schema(SCHEMA)),
 *   process: broadcast(store(postgres), forward(replica))
 * }
 * ```
 */
export interface NodeConfig<D = unknown> {
  /**
   * How to read state for validation
   * Can be any ReadInterface (memory, postgres, http, composite, etc.)
   */
  read: ReadInterface;

  /**
   * Optional validator for incoming transactions
   * If not provided, all transactions are accepted
   */
  validate?: Validator<D>;

  /**
   * Optional processor for validated transactions
   * If not provided, transactions are accepted but not persisted
   */
  process?: Processor<D>;
}
