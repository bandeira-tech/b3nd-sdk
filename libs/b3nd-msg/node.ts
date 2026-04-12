/**
 * Message Node Implementation
 *
 * Creates a message node that:
 * 1. Receives messages
 * 2. Validates via the provided validator (read-only)
 * 3. Propagates valid messages to all peers
 *
 * @deprecated Use Rig (L6) instead.
 */

import type { Message, ReadResult, ReceiveResult } from "../b3nd-core/types.ts";
import type {
  MessageNode,
  MessageNodeConfig,
} from "./node-types.ts";

/**
 * Create a message node
 *
 * @deprecated Use Rig (L6) instead.
 */
export function createMessageNode(
  config: MessageNodeConfig,
): MessageNode {
  if (!config) throw new Error("config is required");
  if (!config.validate) throw new Error("validate function is required");
  if (!config.read) throw new Error("read interface is required");
  if (!config.peers) throw new Error("peers array is required");

  const { validate, read, peers } = config;

  return {
    async receive(msgs: Message[]): Promise<ReceiveResult[]> {
      const results: ReceiveResult[] = [];

      for (const msg of msgs) {
        results.push(await receiveOne(msg));
      }

      return results;
    },

    async cleanup(): Promise<void> {
      // No-op
    },
  };

  async function receiveOne(msg: Message): Promise<ReceiveResult> {
    const [uri] = msg;

    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    // Validate via the validator (read-only)
    try {
      const readFn = async <T = unknown>(u: string): Promise<ReadResult<T>> => {
        const results = await read.read<T>(u);
        return results[0] ?? { success: false, error: "No results" } as ReadResult<T>;
      };
      const validation = await validate(msg, readFn);

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

    // Propagate to all peers as a batch of one
    const propagationResults = await Promise.allSettled(
      peers.map((peer) =>
        peer.receive([msg]).then((r) => r[0]).catch((err) => ({
          accepted: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      ),
    );

    const anyAccepted = propagationResults.some(
      (result) =>
        result.status === "fulfilled" &&
        result.value &&
        "accepted" in result.value &&
        result.value.accepted,
    );

    if (!anyAccepted && peers.length > 0) {
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
  }
}
