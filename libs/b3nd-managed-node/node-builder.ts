/**
 * Node builder for managed nodes.
 *
 * Constructs ProtocolInterfaceNode clients from BackendSpec arrays,
 * using Store + DataStoreClient (null-aware Store adapter).
 */

import {
  HttpClient,
  type ProtocolInterfaceNode,
} from "@bandeira-tech/b3nd-sdk";
import { DataStoreClient } from "../b3nd-rig/mod.ts";
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
): Promise<ProtocolInterfaceNode[]> {
  const clients: ProtocolInterfaceNode[] = [];

  for (const spec of specs) {
    // Built-in: memory
    if (spec.type === "memory") {
      clients.push(new DataStoreClient(new MemoryStore()));
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
      clients.push(new DataStoreClient(store));
      continue;
    }

    throw new Error(
      `Unsupported backend type: ${spec.type}. ` +
        `Register a BackendResolver for "${protocol}" protocol.`,
    );
  }

  return clients;
}
