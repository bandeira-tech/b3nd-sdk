/**
 * @module
 * B3nd Unified Node System
 *
 * The unified architecture where all state changes flow through a single
 * `receive(tx)` interface. Behavior emerges from composition of validators
 * and processors.
 *
 * ## Core Concept
 *
 * Everything is `[uri, data]`. Transactions and stored data have the same shape.
 * There is no external "write to URI" — only "receive transaction".
 *
 * ```
 * Three operations:
 * 1. RECEIVE TXN  →  validate, process
 * 2. READ URI     →  retrieve stored data
 * 3. (internal)   →  clients persist what they choose
 * ```
 *
 * @example Basic node
 * ```typescript
 * import { createNode, schema, parallel } from "@bandeira-tech/b3nd-sdk/node"
 *
 * const node = createNode({
 *   read: memoryClient,
 *   validate: schema(SCHEMA),
 *   process: parallel(memoryClient)
 * })
 *
 * await node.receive(["mutable://users/alice", { name: "Alice" }])
 * ```
 *
 * @example Multiple backends
 * ```typescript
 * import { createNode, parallel, firstMatch } from "@bandeira-tech/b3nd-sdk/node"
 *
 * const node = createNode({
 *   read: firstMatch(postgres, replica),
 *   validate: schema(SCHEMA),
 *   process: parallel(postgres, replica)
 * })
 * ```
 */

import type {
  Node,
  NodeConfig,
  ReceiveResult,
  Transaction,
} from "./types.ts";

// Re-export types
export type {
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
  ReceiveResult,
  Transaction,
  Validator,
} from "./types.ts";

// Re-export composition utilities
export { all, any, parallel, firstMatch, pipeline, seq } from "./composition.ts";

// Re-export built-in validators
export {
  accept,
  format,
  reject,
  requireFields,
  schema,
  txnSchema,
  uriPattern,
} from "./validators.ts";

// Re-export built-in processors
export { emit, log, noop, when } from "./processors.ts";

/**
 * Create a unified node
 *
 * @param config - Node configuration with read, validate, and process
 * @returns Node instance
 *
 * @example
 * ```typescript
 * const node = createNode({
 *   read: memoryClient,
 *   validate: schema(SCHEMA),
 *   process: parallel(memoryClient)
 * })
 *
 * const result = await node.receive(["mutable://users/alice", { name: "Alice" }])
 * if (result.accepted) {
 *   console.log("Transaction accepted")
 * }
 * ```
 */
export function createNode<D = unknown>(config: NodeConfig<D>): Node {
  if (!config) throw new Error("config is required");
  if (!config.read) throw new Error("read interface is required");

  const { read, validate, process } = config;

  return {
    async receive<T = unknown>(tx: Transaction<T>): Promise<ReceiveResult> {
      const [uri] = tx;

      // 1. Basic URI validation
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Transaction URI is required" };
      }

      // 2. Run validation pipeline if provided
      if (validate) {
        try {
          const validationResult = await (validate as unknown as typeof validate)(
            tx as unknown as Transaction<D>,
            read.read.bind(read)
          );

          if (!validationResult.valid) {
            return {
              accepted: false,
              error: validationResult.error || "Validation failed",
            };
          }
        } catch (error) {
          return {
            accepted: false,
            error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      // 3. Run process pipeline if provided
      if (process) {
        try {
          const processResult = await (process as unknown as typeof process)(
            tx as unknown as Transaction<D>
          );

          if (!processResult.success) {
            return {
              accepted: false,
              error: processResult.error || "Processing failed",
            };
          }
        } catch (error) {
          return {
            accepted: false,
            error: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return { accepted: true };
    },

    async cleanup(): Promise<void> {
      // No resources to clean up by default
      // Individual processors/validators handle their own cleanup
    },
  };
}
