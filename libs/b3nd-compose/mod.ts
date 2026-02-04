/**
 * @module
 * B3nd Composition System
 *
 * Validators, processors, and composition utilities for building
 * validated clients. Use `createValidatedClient()` as the primary
 * entry point for wiring validation into a client.
 *
 * ## Core Concept
 *
 * Everything is `[uri, data]`. Messages and stored data have the same shape.
 * There is no external "write to URI" — only "receive message".
 *
 * ```
 * Three operations:
 * 1. RECEIVE MSG  →  validate, process
 * 2. READ URI     →  retrieve stored data
 * 3. (internal)   →  clients persist what they choose
 * ```
 *
 * @example Using createValidatedClient
 * ```typescript
 * import { createValidatedClient, msgSchema } from "@bandeira-tech/b3nd-sdk"
 * import { parallelBroadcast, firstMatchSequence } from "@bandeira-tech/b3nd-sdk"
 *
 * const client = createValidatedClient({
 *   write: parallelBroadcast(clients),
 *   read: firstMatchSequence(clients),
 *   validate: msgSchema(schema),
 * })
 *
 * await client.receive(["mutable://users/alice", { name: "Alice" }])
 * ```
 */

import type { Message, Node, NodeConfig, ReceiveResult } from "./types.ts";

// Re-export types
export type {
  Message,
  /** @deprecated Use Validator from compose types directly */
  Node,
  /** @deprecated Use FunctionalClientConfig instead */
  NodeConfig,
  /** @deprecated Use Processor functions directly */
  Processor,
  /** @deprecated Use NodeProtocolReadInterface from core instead */
  ReadInterface,
  ReceiveResult,
  /** @deprecated Use `Message` instead */
  Transaction,
  Validator,
} from "./types.ts";

// Re-export composition utilities
export {
  all,
  any,
  /** @deprecated Use firstMatchSequence from b3nd-combinators instead */
  firstMatch,
  /** @deprecated Use parallelBroadcast from b3nd-combinators, or pass clients to createValidatedClient */
  parallel,
  /** @deprecated Use createValidatedClient with sequential logic instead */
  pipeline,
  seq,
} from "./composition.ts";

// Re-export built-in validators
export {
  accept,
  format,
  msgSchema,
  reject,
  requireFields,
  schema,
  txnSchema,
  uriPattern,
} from "./validators.ts";

// Re-export built-in processors
export {
  /** @deprecated Use emit callbacks directly */
  emit,
  /** @deprecated Use console.log directly */
  log,
  /** @deprecated No-op is no longer needed */
  noop,
  /** @deprecated Use conditional logic directly */
  when,
} from "./processors.ts";

// Validated client convenience
export { createValidatedClient } from "./validated-client.ts";

/**
 * Create a unified node
 *
 * @deprecated Use `createValidatedClient()` instead.
 *
 * @example Migration:
 * ```typescript
 * // Before:
 * const node = createNode({
 *   read: firstMatch(client),
 *   validate: msgSchema(schema),
 *   process: parallel(client),
 * })
 *
 * // After:
 * const client = createValidatedClient({
 *   write: parallelBroadcast(clients),
 *   read: firstMatchSequence(clients),
 *   validate: msgSchema(schema),
 * })
 * ```
 */
export function createNode<D = unknown>(config: NodeConfig<D>): Node {
  if (!config) throw new Error("config is required");
  if (!config.read) throw new Error("read interface is required");

  const { read, validate, process } = config;

  return {
    async receive<T = unknown>(msg: Message<T>): Promise<ReceiveResult> {
      const [uri] = msg;

      // 1. Basic URI validation
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Message URI is required" };
      }

      // 2. Run validation pipeline if provided
      if (validate) {
        try {
          const validationResult =
            await (validate as unknown as typeof validate)(
              msg as unknown as Message<D>,
              read.read.bind(read),
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
            error: `Validation error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      }

      // 3. Run process pipeline if provided
      if (process) {
        try {
          const processResult = await (process as unknown as typeof process)(
            msg as unknown as Message<D>,
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
            error: `Processing error: ${
              error instanceof Error ? error.message : String(error)
            }`,
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
