/**
 * @module
 * Transaction data detection utilities
 */

import type { TransactionData } from "./types.ts";

/**
 * Type guard detecting TransactionData shape
 *
 * Checks that data is an object with:
 * - `inputs`: string[]
 * - `outputs`: [string, unknown][]
 *
 * @example
 * ```typescript
 * if (isTransactionData(data)) {
 *   // data is TransactionData
 *   for (const [uri, value] of data.outputs) {
 *     await backend.receive([uri, value]);
 *   }
 * }
 * ```
 */
export function isTransactionData(data: unknown): data is TransactionData {
  return (
    data !== null &&
    typeof data === "object" &&
    Array.isArray((data as TransactionData).inputs) &&
    Array.isArray((data as TransactionData).outputs) &&
    (data as TransactionData).outputs.every(
      (o: unknown) =>
        Array.isArray(o) && o.length === 2 && typeof o[0] === "string",
    )
  );
}
