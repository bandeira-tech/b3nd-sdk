/**
 * @module
 * Composer — wires multiple clients into a single composed client.
 *
 * Convention:
 * - 1 client → pass through directly
 * - 2+ clients → parallelBroadcast for writes, firstMatchSequence for reads
 * - With schema → createValidatedClient wraps the composed client
 */

import type { NodeProtocolInterface, Schema } from "../../b3nd-core/types.ts";
import { parallelBroadcast } from "../../b3nd-combinators/parallel-broadcast.ts";
import { firstMatchSequence } from "../../b3nd-combinators/first-match-sequence.ts";
import { createValidatedClient } from "../../b3nd-compose/validated-client.ts";
import { msgSchema } from "../../b3nd-compose/validators.ts";

/**
 * Compose resolved clients into a single NodeProtocolInterface.
 */
export function composeClients(
  clients: NodeProtocolInterface[],
  schema?: Schema,
): NodeProtocolInterface {
  if (clients.length === 0) {
    throw new Error("At least one backend client is required");
  }

  // Single client — direct pass-through (or validated if schema provided)
  if (clients.length === 1) {
    if (!schema) return clients[0];
    return createValidatedClient({
      write: clients[0],
      read: clients[0],
      validate: msgSchema(schema),
    });
  }

  // Multiple clients — compose
  const write = parallelBroadcast(clients);
  const read = firstMatchSequence(clients);

  if (!schema) {
    // No schema — use firstMatchSequence for reads, parallelBroadcast for writes
    // Return the write combinator (which also has read from first client)
    // but override read operations to use firstMatchSequence
    return createValidatedClient({
      write,
      read,
      // Accept-all validator when no schema
      validate: async () => ({ valid: true }),
    });
  }

  return createValidatedClient({
    write,
    read,
    validate: msgSchema(schema),
  });
}
