/**
 * @module
 * createValidatedClient - Convenience for wiring validation into a FunctionalClient.
 *
 * Lives in compose because it depends on the Validator type.
 */

import {
  FunctionalClient,
  type FunctionalClientConfig,
} from "../b3nd-core/functional-client.ts";
import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  Validator,
} from "../b3nd-core/types.ts";

/**
 * Create a FunctionalClient that validates before writing.
 *
 * Wiring:
 * - receive → validate each msg → write.receive(msgs)
 * - read/status → delegated to config.read
 *
 * @example
 * ```typescript
 * const client = createValidatedClient({
 *   write: parallelBroadcast(clients),
 *   read: firstMatchSequence(clients),
 *   validate: msgSchema(schema),
 * });
 * ```
 */
export function createValidatedClient(config: {
  write: NodeProtocolInterface;
  read: NodeProtocolInterface;
  validate: Validator;
}): FunctionalClient {
  const { write, read, validate } = config;

  const readFn = async <T = unknown>(
    u: string,
  ): Promise<ReadResult<T>> => {
    const results = await read.read<T>(u);
    return results[0] ?? { success: false, error: "No results" } as ReadResult<T>;
  };

  const fnConfig: FunctionalClientConfig = {
    async receive(msgs: Message[]): Promise<ReceiveResult[]> {
      const results: ReceiveResult[] = [];

      for (const msg of msgs) {
        const [uri] = msg;

        // Basic URI validation
        if (!uri || typeof uri !== "string") {
          results.push({ accepted: false, error: "Message URI is required" });
          continue;
        }

        // Run validation — top-level message, no upstream
        try {
          const validationResult = await validate(msg, undefined, readFn);
          if (!validationResult.valid) {
            results.push({
              accepted: false,
              error: validationResult.error || "Validation failed",
            });
            continue;
          }
        } catch (error) {
          results.push({
            accepted: false,
            error: `Validation error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          continue;
        }

        // Forward valid message to write backend
        try {
          const writeResults = await write.receive([msg]);
          results.push(writeResults[0] ?? { accepted: false, error: "No result" });
        } catch (error) {
          results.push({
            accepted: false,
            error: `Processing error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }

      return results;
    },

    read: (uris) => read.read(uris),
    status: () => read.status(),
  };

  return new FunctionalClient(fnConfig);
}
