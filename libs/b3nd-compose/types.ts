/**
 * @module
 * B3nd Unified Node Type System
 *
 * Core types for the unified node architecture where all state changes
 * flow through a single `receive(msg)` interface.
 */

import type {
  ListOptions,
  ListResult,
  ReadMultiResult,
  ReadResult,
} from "../b3nd-core/types.ts";

/**
 * Message: the minimal primitive
 *
 * A tuple of [uri, data]. URIs all the way down.
 * The URI is the message's identity. The data is the message's content.
 *
 * @example
 * ```typescript
 * // A user message
 * const msg: Message = ["mutable://users/alice/profile", { name: "Alice" }]
 *
 * // A transfer message
 * const msg: Message = ["msg://alice/transfer/42", { inputs: [...], outputs: [...] }]
 * ```
 */
export type Message<D = unknown> = [uri: string, data: D];

/** @deprecated Use `Message` instead */
export type Transaction<D = unknown> = Message<D>;

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
 * @deprecated Use `NodeProtocolInterface` from b3nd-core instead.
 * Use `createValidatedClient()` to create validated clients.
 */
export interface Node {
  receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult>;
  cleanup(): Promise<void>;
}

/**
 * Validator function
 *
 * Pure function: same inputs → same result. Side effects happen downstream.
 * The validator cannot write — everything needed for validation must exist
 * in the transaction or be readable from current state.
 *
 * @param msg - The message to validate
 * @param read - Function to read state for validation (read-only)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const myValidator: Validator = async (msg, read) => {
 *   const [uri, data] = msg
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
  msg: Message<D>,
  read: <T>(uri: string) => Promise<ReadResult<T>>,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Processor function
 *
 * @deprecated Use `NodeProtocolInterface.receive()` directly, or pass clients to `createValidatedClient`.
 */
export type Processor<D = unknown> = (
  msg: Message<D>,
) => Promise<{ success: boolean; error?: string }>;

/**
 * Configuration for creating a node
 *
 * @deprecated Use `createValidatedClient({ write, read, validate })` instead.
 */
export interface NodeConfig<D = unknown> {
  /**
   * How to read state for validation
   * Can be any ReadInterface (memory, postgres, http, composite, etc.)
   */
  read: ReadInterface;

  /**
   * Optional validator for incoming messages
   * If not provided, all messages are accepted
   */
  validate?: Validator<D>;

  /**
   * Optional processor for validated messages
   * If not provided, messages are accepted but not persisted
   */
  process?: Processor<D>;
}
