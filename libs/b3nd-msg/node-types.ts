/**
 * @b3nd/sdk/msg Types
 * Core types for message layer
 */

import type {
  NodeProtocolInterface,
  NodeProtocolReadInterface,
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
 * // A content-addressed message envelope (via send())
 * ["hash://sha256/abc...", { inputs: [...], outputs: [...] }]
 *
 * // A simple resource write
 * ["mutable://open/config", { theme: "dark" }]
 * ```
 */
export type Message<D = unknown> = [uri: string, data: D];

/** @deprecated Use `Message` instead */
export type Transaction<D = unknown> = Message<D>;

/**
 * Result of a message submission
 */
export interface SubmitResult {
  accepted: boolean;
  error?: string;
}

/**
 * Message validator function
 *
 * Pure function: same inputs → same result. Side effects happen downstream.
 * The validator cannot write — everything needed for validation must exist
 * in the message or be readable from current state.
 *
 * @param msg - The message to validate
 * @param read - Function to read state for validation (read-only)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const myValidator: MessageValidator = async (msg, read) => {
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
export type MessageValidator<D = unknown> = (
  msg: Message<D>,
  read: <T>(uri: string) => Promise<ReadResult<T>>,
) => Promise<{ valid: boolean; error?: string }>;

/** @deprecated Use `MessageValidator` instead */
export type TransactionValidator<D = unknown> = MessageValidator<D>;

/**
 * Configuration for creating a message node
 *
 * A msg node has two concerns:
 * 1. Read — how to read state for validation (operator's choice)
 * 2. Peers — where to propagate valid msgs (msg nodes, data nodes, any client)
 *
 * @example
 * ```typescript
 * const config: MessageNodeConfig = {
 *   validate: myValidator,
 *   read: firstMatchSequence([
 *     createMemoryClient(),
 *     createPostgresClient("postgres://...")
 *   ]),
 *   peers: [
 *     createWebSocketClient("ws://msg-node-a:8843"),
 *     createPostgresClient("postgres://...")
 *   ]
 * }
 * ```
 */
export interface MessageNodeConfig<D = unknown> {
  /**
   * Validator function for incoming messages
   */
  validate: MessageValidator<D>;

  /**
   * How to read state for validation
   * Can be any NodeProtocolReadInterface (memory, postgres, http, composite, etc.)
   */
  read: NodeProtocolReadInterface;

  /**
   * Where to propagate valid messages
   * Can be remote msg nodes, local storage, anything with NodeProtocolInterface
   * When a msg node propagates to a postgres peer, that postgres becomes a data node storing msgs
   */
  peers: NodeProtocolInterface[];
}

/** @deprecated Use `MessageNodeConfig` instead */
export type TransactionNodeConfig<D = unknown> = MessageNodeConfig<D>;

/**
 * Message node interface
 *
 * Receives messages, validates them, and propagates to peers.
 * The only external API for submitting messages.
 *
 * @example
 * ```typescript
 * const node = createMessageNode(config)
 *
 * const result = await send({
 *   inputs: [...], outputs: [...]
 * }, node)
 *
 * if (!result.accepted) {
 *   console.log("Message rejected:", result.error)
 * }
 * ```
 */
export interface MessageNode<D = unknown> {
  /**
   * Receive and process a message
   * 1. Validates the message
   * 2. If valid, propagates to all peers
   * 3. Returns acceptance result
   */
  receive(msg: Message<D>): Promise<SubmitResult>;

  /**
   * Cleanup resources (close connections, etc.)
   */
  cleanup(): Promise<void>;
}

/** @deprecated Use `MessageNode` instead */
export type TransactionNode<D = unknown> = MessageNode<D>;
