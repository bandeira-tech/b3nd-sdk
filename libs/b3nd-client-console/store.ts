/**
 * ConsoleStore — a write-only debug/audit Store.
 *
 * Logs write and delete operations to stdout (or a custom logger).
 * Read always fails — this store is for inspection, not retrieval.
 *
 * Useful for debugging, auditing, and piping storage traffic to the terminal.
 *
 * @example
 * ```typescript
 * import { ConsoleStore } from "@bandeira-tech/b3nd-sdk";
 *
 * const store = new ConsoleStore("debug");
 *
 * await store.write([
 *   { uri: "mutable://app/config", values: { fire: 10 }, data: { theme: "dark" } },
 * ]);
 * // Console output: [debug] WRITE mutable://app/config values={"fire":10} data={"theme":"dark"}
 * ```
 */

import type {
  DeleteResult,
  ReadResult,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
} from "../b3nd-core/types.ts";

/**
 * Safely serialize data for console output.
 * Falls back to a placeholder if JSON.stringify throws (circular refs, BigInt, etc.).
 */
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return "[unserializable]";
  }
}

export class ConsoleStore implements Store {
  private readonly label: string;
  private readonly log: (message: string) => void;

  constructor(label?: string, logger?: (msg: string) => void) {
    this.label = label ?? "b3nd";
    this.log = logger ?? console.log;
  }

  // ── Write ────────────────────────────────────────────────────────

  async write(entries: StoreEntry[]): Promise<StoreWriteResult[]> {
    const results: StoreWriteResult[] = [];

    for (const entry of entries) {
      const valuesStr = safeStringify(entry.values);
      const dataStr = safeStringify(entry.data);
      this.log(
        `[${this.label}] WRITE ${entry.uri} values=${valuesStr} data=${dataStr}`,
      );
      results.push({ success: true });
    }

    return results;
  }

  // ── Read ─────────────────────────────────────────────────────────

  read<T = unknown>(uris: string[]): Promise<ReadResult<T>[]> {
    return Promise.resolve(
      uris.map(() =>
        ({
          success: false,
          error: "ConsoleStore is write-only",
        }) as ReadResult<T>
      ),
    );
  }

  // ── Delete ───────────────────────────────────────────────────────

  async delete(uris: string[]): Promise<DeleteResult[]> {
    const results: DeleteResult[] = [];

    for (const uri of uris) {
      this.log(`[${this.label}] DELETE ${uri}`);
      results.push({ success: true });
    }

    return results;
  }

  // ── Status ───────────────────────────────────────────────────────

  status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      message: "ConsoleStore is operational",
    });
  }

  capabilities(): StoreCapabilities {
    return {
      atomicBatch: false,
      observe: false,
      binaryData: false,
    };
  }
}
