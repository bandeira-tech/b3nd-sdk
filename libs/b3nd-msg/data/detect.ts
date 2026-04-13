/**
 * @module
 * Message data detection utilities
 *
 * @deprecated In the new primitive, data is always { inputs, outputs }.
 * There is no need to detect the shape — it's guaranteed by the architecture.
 * This module is kept for transitional compatibility only.
 */

import type { MessageData } from "./types.ts";

/**
 * Type guard detecting MessageData shape.
 *
 * @deprecated Data is always { inputs, outputs } in the new primitive.
 * This guard is no longer needed — remove call sites that branch on it.
 */
export function isMessageData(data: unknown): data is MessageData {
  if (data === null || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.inputs) &&
    Array.isArray(d.outputs) &&
    (d.outputs as unknown[]).every(
      (o: unknown) =>
        Array.isArray(o) && o.length === 3 && typeof o[0] === "string",
    )
  );
}
