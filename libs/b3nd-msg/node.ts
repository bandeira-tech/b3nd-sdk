/**
 * Message Node Implementation
 *
 * Creates a message node that:
 * 1. Receives messages
 * 2. Validates via the provided validator (read-only)
 * 3. Propagates valid messages to all peers
 *
 * The node does not write directly — it validates and propagates.
 * Peers (including data nodes) receive the full message and decide
 * what to store.
 */

import type {
  Message,
  MessageNode,
  MessageNodeConfig,
  SubmitResult,
} from "./node-types.ts";

/**
 * Create a message node
 *
 * @deprecated Use `createValidatedClient()` from b3nd-compose instead.
 */
export function createMessageNode<D = unknown>(
  config: MessageNodeConfig<D>,
): MessageNode<D> {
  if (!config) throw new Error("config is required");
  if (!config.validate) throw new Error("validate function is required");
  if (!config.read) throw new Error("read interface is required");
  if (!config.peers) throw new Error("peers array is required");

  const { validate, read, peers } = config;

  return {
    async receive(msg: Message<D>): Promise<SubmitResult> {
      const [uri, data] = msg;

      // 1. Basic validation: must have URI
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Message URI is required" };
      }

      // 2. Validate via the validator (read-only)
      // The validator can read state but cannot write
      try {
        const validation = await validate(msg, read.read.bind(read));

        if (!validation.valid) {
          return {
            accepted: false,
            error: validation.error || "Validation failed",
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

      // 3. Propagate to all peers
      // Full message transmitted — no transformation
      // Peers receive [uri, data] complete
      const propagationResults = await Promise.allSettled(
        peers.map((peer) =>
          peer.receive(msg).catch((err) => ({
            accepted: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        ),
      );

      // Check if at least one peer accepted
      const anyAccepted = propagationResults.some(
        (result) =>
          result.status === "fulfilled" &&
          result.value &&
          "accepted" in result.value &&
          result.value.accepted,
      );

      if (!anyAccepted && peers.length > 0) {
        // Collect errors from failed propagations
        const errors = propagationResults
          .map((result, i) => {
            if (result.status === "rejected") {
              return `peer[${i}]: ${result.reason}`;
            }
            if (
              result.status === "fulfilled" && result.value &&
              !result.value.accepted
            ) {
              return `peer[${i}]: ${result.value.error || "rejected"}`;
            }
            return null;
          })
          .filter(Boolean);

        return {
          accepted: false,
          error: `All peers rejected: ${errors.join("; ")}`,
        };
      }

      return { accepted: true };
    },

    async cleanup(): Promise<void> {
      // Cleanup all peers
      await Promise.all(
        peers.map((peer) => peer.cleanup().catch(() => {})),
      );

      // Cleanup read interface
      await read.cleanup().catch(() => {});
    },
  };
}

/** @deprecated Use `createMessageNode` instead */
export const createTransactionNode = createMessageNode;
