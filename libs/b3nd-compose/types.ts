/**
 * @module
 * B3nd Compose Type System
 *
 * Re-exports core types and defines compose-specific helpers.
 */

import type { Message, ReadResult, Validator } from "../b3nd-core/types.ts";

// Re-export core validation types as canonical
export type {
  Message,
  Output,
  ReadFn,
  Schema,
  ValidationResult,
  Validator,
} from "../b3nd-core/types.ts";

/**
 * Read interface - subset of node capabilities for reading state.
 * Matches the `read` method of `NodeProtocolInterface`.
 */
export interface ReadInterface {
  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]>;
}

/**
 * Processor function
 *
 * @deprecated Use `NodeProtocolInterface.receive()` directly.
 */
export type Processor<D = unknown> = (
  msg: Message<D>,
) => Promise<{ success: boolean; error?: string }>;

/**
 * @deprecated Use `NodeProtocolInterface` from b3nd-core instead.
 */
export interface Node {
  receive(msgs: Message[]): Promise<{ accepted: boolean; error?: string }[]>;
  cleanup(): Promise<void>;
}

/**
 * @deprecated Use `createValidatedClient()` instead.
 */
export interface NodeConfig {
  read: ReadInterface;
  validate?: Validator;
  process?: Processor;
}
