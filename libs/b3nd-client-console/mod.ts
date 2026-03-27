import {
  Errors,
  type DeleteResult,
  type HealthStatus,
  type Message,
  type NodeProtocolWriteInterface,
  type ReceiveResult,
  type Schema,
} from "../b3nd-core/types.ts";

/**
 * Configuration for ConsoleClient
 */
export interface ConsoleClientConfig {
  /**
   * Schema mapping protocol://hostname to validators.
   *
   * Keys MUST be in format: "protocol://hostname"
   * Examples: "mutable://accounts", "immutable://data"
   */
  schema: Schema;

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
 * Validate schema key format
 * Keys must be in format: "protocol://hostname"
 */
function validateSchemaKey(key: string): boolean {
  return /^[a-z]+:\/\/[a-z0-9-]+$/.test(key);
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
 * It validates incoming messages against the schema and prints accepted data to stdout.
 *
 * Useful for debugging, auditing, and piping protocol traffic to the terminal.
 *
 * @example
 * ```typescript
 * const client = new ConsoleClient({
 *   schema: {
 *     "mutable://logs": async () => ({ valid: true }),
 *   },
 * });
 *
 * await client.receive(["mutable://logs/entry-1", { level: "info", msg: "hello" }]);
 * // Console output: [b3nd] RECEIVE mutable://logs/entry-1 {"level":"info","msg":"hello"}
 * ```
 */
export class ConsoleClient implements NodeProtocolWriteInterface {
  private readonly schema: Schema;
  private readonly label: string;
  private readonly log: (message: string) => void;

  constructor(config: ConsoleClientConfig) {
    const invalidKeys = Object.keys(config.schema).filter(
      (key) => !validateSchemaKey(key),
    );
    if (invalidKeys.length > 0) {
      throw new Error(
        `Invalid schema key format: ${
          invalidKeys.map((k) => `"${k}"`).join(", ")
        }. ` +
          `Keys must be in "protocol://hostname" format (e.g., "mutable://accounts", "immutable://data").`,
      );
    }

    this.schema = config.schema;
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

    const url = URL.parse(uri);
    if (!url) {
      return {
        accepted: false,
        error: "Invalid URI format",
        errorDetail: Errors.invalidUri(uri, "Invalid URI format"),
      };
    }

    const program = `${url.protocol}//${url.hostname}`;
    const validator = this.schema[program];

    if (!validator) {
      return {
        accepted: false,
        error: "Program not found",
        errorDetail: Errors.invalidSchema(uri, "Program not found"),
      };
    }

    const validation = await validator({
      uri,
      value: data,
      read: () =>
        Promise.resolve({
          success: false as const,
          error: "ConsoleClient has no read capability",
        }),
    });

    if (!validation.valid) {
      const error = validation.error || "Validation failed";
      this.log(
        `[${this.label}] REJECTED ${uri} ${error}`,
      );
      return {
        accepted: false,
        error,
        errorDetail: Errors.invalidSchema(uri, error),
      };
    }

    this.log(
      `[${this.label}] RECEIVE ${uri} ${safeStringify(data)}`,
    );

    return { accepted: true };
  }

  public async delete(uri: string): Promise<DeleteResult> {
    if (!uri || typeof uri !== "string") {
      return {
        success: false,
        error: "URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "URI is required"),
      };
    }

    const url = URL.parse(uri);
    if (!url) {
      return {
        success: false,
        error: "Invalid URI format",
        errorDetail: Errors.invalidUri(uri, "Invalid URI format"),
      };
    }

    const program = `${url.protocol}//${url.hostname}`;
    if (!this.schema[program]) {
      return {
        success: false,
        error: "Program not found",
        errorDetail: Errors.invalidSchema(uri, "Program not found"),
      };
    }

    this.log(`[${this.label}] DELETE ${uri}`);
    return { success: true };
  }

  public health(): Promise<HealthStatus> {
    return Promise.resolve({ status: "healthy" });
  }

  public getSchema(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.schema));
  }

  public cleanup(): Promise<void> {
    return Promise.resolve();
  }
}
