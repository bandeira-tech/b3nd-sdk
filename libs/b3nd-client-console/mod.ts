import {
  Errors,
  type DeleteResult,
  type Message,
  type NodeProtocolWriteInterface,
  type NodeStatus,
  type ReceiveResult,
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
 * This client implements `NodeProtocolWriteInterface` and has no read capabilities.
 * It prints received data to stdout.
 *
 * Useful for debugging, auditing, and piping protocol traffic to the terminal.
 *
 * @example
 * ```typescript
 * const client = new ConsoleClient({});
 *
 * await client.receive(["mutable://logs/entry-1", { level: "info", msg: "hello" }]);
 * // Console output: [b3nd] RECEIVE mutable://logs/entry-1 {"level":"info","msg":"hello"}
 * ```
 */
export class ConsoleClient implements NodeProtocolWriteInterface {
  private readonly label: string;
  private readonly log: (message: string) => void;

  constructor(config: ConsoleClientConfig) {
    this.label = config.label ?? "b3nd";
    this.log = config.logger ?? console.log;
  }

  public async receive<D = unknown>(
    msg: Message<D>,
  ): Promise<ReceiveResult> {
    const [uri, data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    this.log(
      `[${this.label}] RECEIVE ${uri} ${safeStringify(data)}`,
    );

    return { accepted: true };
  }

  public delete(uri: string): Promise<DeleteResult> {
    if (!uri || typeof uri !== "string") {
      return Promise.resolve({
        success: false,
        error: "URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "URI is required"),
      });
    }

    this.log(`[${this.label}] DELETE ${uri}`);
    return Promise.resolve({ success: true });
  }

  public status(): Promise<NodeStatus> {
    return Promise.resolve({ healthy: true });
  }

  public cleanup(): Promise<void> {
    return Promise.resolve();
  }
}
