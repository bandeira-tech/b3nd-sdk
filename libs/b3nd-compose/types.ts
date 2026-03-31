/**
 * @module
 * B3nd Compose Type System
 *
 * Re-exports core types and defines compose-specific helpers.
 */

import type {
  ListOptions,
  ListResult,
  ReadMultiResult,
  ReadResult,
  Message,
  Validator,
} from "../b3nd-core/types.ts";

// Re-export core validation types as canonical
export type {
  Output,
  Message,
  Validator,
  ValidationResult,
  ReadFn,
  Schema,
} from "../b3nd-core/types.ts";

/**
 * Read interface - subset of node capabilities for reading state
 */
export interface ReadInterface {
  read<T = unknown>(uri: string): Promise<ReadResult<T>>;
  readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
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
  receive<D = unknown>(msg: Message<D>): Promise<{ accepted: boolean; error?: string }>;
  cleanup(): Promise<void>;
}

/**
 * @deprecated Use `createValidatedClient()` instead.
 */
export interface NodeConfig<D = unknown> {
  read: ReadInterface;
  validate?: Validator;
  process?: Processor<D>;
}
