/**
 * Transaction Node Implementation
 *
 * Creates a transaction node that:
 * 1. Receives transactions
 * 2. Validates via the provided validator (read-only)
 * 3. Propagates valid transactions to all peers
 *
 * The node does not write directly — it validates and propagates.
 * Peers (including data nodes) receive the full transaction and decide
 * what to store.
 */

import type { Transaction, TransactionNode, TransactionNodeConfig, SubmitResult } from "./types.ts";

/**
 * Create a transaction node
 *
 * @param config - Node configuration with validator, read interface, and peers
 * @returns TransactionNode instance
 *
 * @example
 * ```typescript
 * import { createTransactionNode } from "b3nd/txn"
 * import { firstMatchSequence, createMemoryClient, createPostgresClient } from "b3nd/clients"
 *
 * const node = createTransactionNode({
 *   validate: myValidator,
 *   read: firstMatchSequence([
 *     createMemoryClient(),
 *     createPostgresClient("postgres://...")
 *   ]),
 *   peers: [
 *     createWebSocketClient("ws://txn-node-a:8843"),
 *     createPostgresClient("postgres://...")
 *   ]
 * })
 *
 * // Submit a transaction
 * const result = await node.receive([
 *   "txn://alice/transfer/42",
 *   { sig: "...", inputs: [...], outputs: [...] }
 * ])
 * ```
 */
export function createTransactionNode<D = unknown>(
  config: TransactionNodeConfig<D>
): TransactionNode<D> {
  if (!config) throw new Error("config is required");
  if (!config.validate) throw new Error("validate function is required");
  if (!config.read) throw new Error("read interface is required");
  if (!config.peers) throw new Error("peers array is required");

  const { validate, read, peers } = config;

  return {
    async receive(tx: Transaction<D>): Promise<SubmitResult> {
      const [uri, data] = tx;

      // 1. Basic validation: must have URI
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Transaction URI is required" };
      }

      // 2. Validate via the validator (read-only)
      // The validator can read state but cannot write
      try {
        const validation = await validate(tx, read.read.bind(read));

        if (!validation.valid) {
          return {
            accepted: false,
            error: validation.error || "Validation failed",
          };
        }
      } catch (error) {
        return {
          accepted: false,
          error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // 3. Propagate to all peers
      // Full transaction transmitted — no transformation
      // Peers receive [uri, data] complete
      const propagationResults = await Promise.allSettled(
        peers.map((peer) =>
          peer.receive(tx).catch((err) => ({
            accepted: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        )
      );

      // Check if at least one peer accepted
      const anyAccepted = propagationResults.some(
        (result) =>
          result.status === "fulfilled" &&
          result.value &&
          "accepted" in result.value &&
          result.value.accepted
      );

      if (!anyAccepted && peers.length > 0) {
        // Collect errors from failed propagations
        const errors = propagationResults
          .map((result, i) => {
            if (result.status === "rejected") {
              return `peer[${i}]: ${result.reason}`;
            }
            if (result.status === "fulfilled" && result.value && !result.value.accepted) {
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
        peers.map((peer) => peer.cleanup().catch(() => {}))
      );

      // Cleanup read interface
      await read.cleanup().catch(() => {});
    },
  };
}
