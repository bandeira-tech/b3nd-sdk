/**
 * Node builder for managed nodes.
 *
 * Constructs ProtocolInterfaceNode clients from BackendSpec arrays.
 * Built-ins: memory (SaveClient over MemoryStore from b3nd-save) and
 * http (HttpClient from b3nd-move). For other backends (postgres,
 * mongo, sqlite, fs, ...), callers should construct a SaveClient over
 * the appropriate b3nd-save store directly and inject it.
 */

import type { ProtocolInterfaceNode } from "@bandeira-tech/b3nd-core";
import { HttpClient } from "@bandeira-tech/b3nd-move/http/client";
import { mapToBytes, SaveClient } from "@bandeira-tech/b3nd-save/clients";
import { MemoryStore } from "@bandeira-tech/b3nd-save/memory";
import { BYTES_ENTITY } from "@bandeira-tech/b3nd-save";
import type { BackendSpec } from "./types.ts";

/**
 * Build an array of clients from backend specifications.
 *
 * Only the built-in `memory` and `http` spec types are handled here.
 * Other backends must be wired by the caller via a pre-built
 * `SaveClient` over the desired b3nd-save store.
 */
export function buildClientsFromSpec(
  specs: BackendSpec[],
): ProtocolInterfaceNode[] {
  const clients: ProtocolInterfaceNode[] = [];

  for (const spec of specs) {
    if (spec.type === "memory") {
      clients.push(new SaveClient(mapToBytes, BYTES_ENTITY, new MemoryStore()));
      continue;
    }

    if (spec.type === "http") {
      clients.push(new HttpClient({ url: spec.url }));
      continue;
    }

    throw new Error(
      `Unsupported backend type: ${spec.type}. ` +
        `Construct a SaveClient over the appropriate b3nd-save store ` +
        `and inject it directly.`,
    );
  }

  return clients;
}
