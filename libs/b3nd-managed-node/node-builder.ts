/**
 * Node builder for managed nodes.
 *
 * Constructs NodeProtocolInterface clients from BackendSpec arrays,
 * using Store + MessageDataClient (envelope-aware protocol wrapper).
 */

import {
  HttpClient,
  type NodeProtocolInterface,
} from "@bandeira-tech/b3nd-sdk";
import { MessageDataClient } from "../b3nd-rig/mod.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import type { BackendResolver } from "../b3nd-rig/backend-factory.ts";
import type { BackendSpec } from "./types.ts";

/**
 * Build an array of clients from backend specifications.
 *
 * External storage backends (postgres, mongo, sqlite, fs, etc.) are provided
 * via the `backends` array — each BackendResolver maps URL protocols to Stores.
 */
export async function buildClientsFromSpec(
  specs: BackendSpec[],
  backends: BackendResolver[] = [],
): Promise<NodeProtocolInterface[]> {
  const clients: NodeProtocolInterface[] = [];

  for (const spec of specs) {
    // Built-in: memory
    if (spec.type === "memory") {
      clients.push(new MessageDataClient(new MemoryStore()));
      continue;
    }

    // Built-in: http
    if (spec.type === "http") {
      clients.push(new HttpClient({ url: spec.url }));
      continue;
    }

    // Try registered backends by matching protocol
    const parsed = new URL(spec.url);
    const protocol = parsed.protocol;
    const resolver = backends.find((b) => b.protocols.includes(protocol));

    if (resolver) {
      const store = await resolver.resolve(spec.url);
      clients.push(new MessageDataClient(store));
      continue;
    }

    throw new Error(
      `Unsupported backend type: ${spec.type}. ` +
        `Register a BackendResolver for "${protocol}" protocol.`,
    );
  }

  return clients;
}
