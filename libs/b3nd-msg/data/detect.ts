/**
 * @module
 * Message data detection utilities
 */

import type { MessageData } from "./types.ts";

/**
 * Type guard detecting MessageData shape
 *
 * Checks that data is an object with:
 * - `inputs`: string[]
 * - `outputs`: [string, unknown][]
 *
 * @example
 * ```typescript
 * if (isMessageData(data)) {
 *   // data is MessageData
 *   for (const [uri, value] of data.outputs) {
 *     await backend.receive([uri, value]);
 *   }
 * }
 * ```
 */
export function isMessageData(data: unknown): data is MessageData {
  return (
    data !== null &&
    typeof data === "object" &&
    Array.isArray((data as MessageData).inputs) &&
    Array.isArray((data as MessageData).outputs) &&
    (data as MessageData).outputs.every(
      (o: unknown) =>
        Array.isArray(o) && o.length === 2 && typeof o[0] === "string",
    )
  );
}

/** @deprecated Use `isMessageData` instead */
export const isTransactionData = isMessageData;
