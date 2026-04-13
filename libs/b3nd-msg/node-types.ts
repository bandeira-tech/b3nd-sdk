/**
 * @b3nd/sdk/msg Types
 * Core types for message layer
 *
 * @deprecated Use Program/CodeHandler from b3nd-core instead.
 * These types remain for transitional compatibility.
 */

import type {
  Message,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  ReadResult,
  ReceiveResult,
} from "../b3nd-core/types.ts";

// Re-export Message from core — no local override
export type { Message } from "../b3nd-core/types.ts";

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
 * @deprecated Use Program from b3nd-core instead.
 *
 * @param msg - The message [uri, values, data] to validate
 * @param read - Function to read state for validation (read-only)
 * @returns Validation result
 */
export type MessageValidator = (
  msg: Message,
  read: <T>(uri: string) => Promise<ReadResult<T>>,
) => Promise<{ valid: boolean; error?: string }>;

/**
 * Configuration for creating a message node
 *
 * @deprecated Use Rig (L6) instead.
 */
export interface MessageNodeConfig {
  validate: MessageValidator;
  read: NodeProtocolReadInterface;
  peers: NodeProtocolInterface[];
}

/**
 * Message node interface
 *
 * @deprecated Use Rig (L6) instead.
 */
export interface MessageNode {
  /**
   * Receive and process a batch of messages
   * 1. Validates each message
   * 2. If valid, propagates to all peers
   * 3. Returns acceptance results
   */
  receive(msgs: Message[]): Promise<ReceiveResult[]>;

  cleanup(): Promise<void>;
}
