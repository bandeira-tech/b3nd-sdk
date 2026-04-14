import {
  Errors,
  type Message,
  type NodeProtocolInterface,
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
} from "../b3nd-core/types.ts";

/**
 * Configuration for ConsoleClient
 */
export interface ConsoleClientConfig {
  /**
   * Optional label prefix for console output (default: "b3nd")
   */
  label?: string;

  /**
   * Optional custom logger (defaults to console.log)
   */
  logger?: (message: string) => void;
}

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

/**
 * ConsoleClient — a write-only client that logs received messages to the console.
 *
 * This client implements `NodeProtocolInterface` with stub read.
 * It prints received data to stdout.
 *
 * Useful for debugging, auditing, and piping protocol traffic to the terminal.
 *
 * @example
 * ```typescript
 * const client = new ConsoleClient({});
 *
 * await client.receive([["mutable://logs/entry-1", {}, { inputs: [], outputs: [] }]]);
 * // Console output: [b3nd] RECEIVE mutable://logs/entry-1 values={} {"inputs":[],"outputs":[]}
 * ```
 */
export class ConsoleClient implements NodeProtocolInterface {
  private readonly label: string;
  private readonly log: (message: string) => void;

  constructor(config: ConsoleClientConfig) {
    this.label = config.label ?? "b3nd";
    this.log = config.logger ?? console.log;
  }

  public async receive(
    msgs: Message[],
  ): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      const [uri, values, data] = msg;

      if (!uri || typeof uri !== "string") {
        results.push({
          accepted: false,
          error: "Message URI is required",
          errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
        });
        continue;
      }

      const valuesStr = values && Object.keys(values).length > 0
        ? ` values=${JSON.stringify(values)}`
        : "";
      this.log(
        `[${this.label}] RECEIVE ${uri}${valuesStr} ${safeStringify(data)}`,
      );

      results.push({ accepted: true });
    }

    return results;
  }

  public read<T = unknown>(_uris: string | string[]): Promise<ReadResult<T>[]> {
    return Promise.resolve([]);
  }

  // deno-lint-ignore require-yield
  async *observe<T = unknown>(
    _pattern: string,
    _signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Not implemented — observe requires transport-specific support.
  }

  public status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      schema: [],
    });
  }
}

// Store implementation (new pattern — prefer over ConsoleClient)
export { ConsoleStore } from "./store.ts";
