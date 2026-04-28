/**
 * @module
 * Canonical program + handler for the `MessageData` payload convention.
 *
 * `MessageData` is one specific protocol payload shape — `{ inputs,
 * outputs, auth? }`. The Rig itself has no awareness of it. Protocols
 * that want envelope semantics opt in by registering these two pieces:
 *
 *   - `messageDataProgram` — classifies tuples whose payload looks like
 *     a `MessageData` envelope as `{ code: "msgdata:valid" }`. Other
 *     tuples get `{ code: "ok" }` (default-dispatch passthrough).
 *
 *   - `messageDataHandler` — the canonical decomposition. Returns the
 *     envelope tuple itself, then each declared output, then a
 *     null-payload tuple per consumed input. The Rig dispatches each
 *     emission through connection routing.
 *
 * @example Wire them up
 * ```typescript
 * import { Rig, connection } from "@bandeira-tech/b3nd-sdk/rig";
 * import {
 *   DataStoreClient,
 *   MemoryStore,
 *   messageDataProgram,
 *   messageDataHandler,
 * } from "@bandeira-tech/b3nd-sdk";
 *
 * const rig = new Rig({
 *   connections: [
 *     connection(
 *       new DataStoreClient(new MemoryStore()),
 *       { receive: ["*"], read: ["*"] },
 *     ),
 *   ],
 *   programs: { "hash://sha256": messageDataProgram },
 *   handlers: { "msgdata:valid": messageDataHandler },
 * });
 * ```
 */

import type {
  CodeHandler,
  Output,
  Program,
} from "../../b3nd-core/types.ts";
import type { MessageData } from "./types.ts";

/** True if the payload looks like a `MessageData` envelope. */
export function isMessageData(payload: unknown): payload is MessageData {
  if (payload === null || typeof payload !== "object") return false;
  const candidate = payload as { inputs?: unknown; outputs?: unknown };
  return Array.isArray(candidate.inputs) && Array.isArray(candidate.outputs);
}

/**
 * Canonical program for the `MessageData` envelope shape.
 *
 * Returns `{ code: "msgdata:valid" }` for tuples whose payload is a
 * MessageData envelope. Returns `{ code: "ok" }` otherwise (which
 * makes default-dispatch persist the tuple as-is).
 *
 * Pure: no protocol-level checks beyond shape recognition. Protocols
 * that need signature verification or input-existence checks layer
 * their own programs at the relevant URI prefixes.
 */
// deno-lint-ignore require-await
export const messageDataProgram: Program = async (out) => {
  const [, payload] = out;
  if (isMessageData(payload)) return { code: "msgdata:valid" };
  return { code: "ok" };
};

/**
 * Canonical handler for `MessageData` envelopes.
 *
 * Returns the constituent emissions:
 *
 *   - the envelope tuple itself (audit trail)
 *   - each declared output, as-is
 *   - each declared input as `[uri, null]` (deletion signal — see
 *     `DataStoreClient` for the wire convention)
 *
 * Pure: no broadcast call. The Rig dispatches what's returned through
 * connection routing.
 */
// deno-lint-ignore require-await
export const messageDataHandler: CodeHandler = async (out) => {
  const [, payload] = out;
  if (!isMessageData(payload)) return [out];
  const inputDeletions: Output[] = payload.inputs.map(
    (uri) => [uri, null] as Output,
  );
  return [out, ...payload.outputs, ...inputDeletions];
};
