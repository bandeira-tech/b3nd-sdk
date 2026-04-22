/**
 * @module
 * B3nd Composition System
 *
 * Validators, processors, and composition utilities for building
 * validated clients. Use `createValidatedClient()` as the primary
 * entry point for wiring validation into a client.
 *
 * The message primitive is [uri, values, data] where data is always
 * { inputs: string[], outputs: Output[] }.
 */

import type { Message, Validator } from "../b3nd-core/types.ts";
import type { Node, NodeConfig } from "./types.ts";

// Re-export types
export type {
  Message,
  Output,
  ReadFn,
  Schema,
  ValidationResult,
  Validator,
} from "../b3nd-core/types.ts";
export type {
  /** @deprecated */
  Node,
  /** @deprecated */
  NodeConfig,
  /** @deprecated */
  Processor,
  /** @deprecated */
  ReadInterface,
} from "./types.ts";

// Re-export composition utilities
export {
  all,
  any,
  /** @deprecated Use `flood(peers)` from b3nd-sdk/network instead */
  firstMatch,
  /** @deprecated Use `flood(peers)` from b3nd-sdk/network, or pass clients to createValidatedClient */
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
 */
export function createNode(config: NodeConfig): Node {
  if (!config) throw new Error("config is required");
  if (!config.read) throw new Error("read interface is required");

  const { read, validate, process } = config;

  return {
    async receive(
      msgs: Message[],
    ): Promise<{ accepted: boolean; error?: string }[]> {
      const results: { accepted: boolean; error?: string }[] = [];

      for (const msg of msgs) {
        const [uri] = msg;

        if (!uri || typeof uri !== "string") {
          results.push({ accepted: false, error: "Message URI is required" });
          continue;
        }

        // Validation
        if (validate) {
          try {
            const validationResult = await validate(
              msg,
              undefined,
              async <T = unknown>(u: string) => {
                const readResults = await read.read<T>(u);
                return readResults[0] ??
                  {
                    success: false,
                    error: "No results",
                  } as import("../b3nd-core/types.ts").ReadResult<T>;
              },
            );

            if (!validationResult.valid) {
              results.push({
                accepted: false,
                error: validationResult.error || "Validation failed",
              });
              continue;
            }
          } catch (error) {
            results.push({
              accepted: false,
              error: `Validation error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            continue;
          }
        }

        // Processing
        if (process) {
          try {
            const processResult = await process(msg);
            if (!processResult.success) {
              results.push({
                accepted: false,
                error: processResult.error || "Processing failed",
              });
              continue;
            }
          } catch (error) {
            results.push({
              accepted: false,
              error: `Processing error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            continue;
          }
        }

        results.push({ accepted: true });
      }

      return results;
    },

    async cleanup(): Promise<void> {
      // No resources to clean up by default
    },
  };
}
