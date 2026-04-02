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
import type { NodeProtocolInterface, ReadResult, Validator } from "../b3nd-core/types.ts";

/**
 * Create a FunctionalClient that validates before writing.
 *
 * Wiring:
 * - receive → validate(msg, read.read) → write.receive(msg)
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

  const fnConfig: FunctionalClientConfig = {
    async receive(msg) {
      const [uri] = msg;

      // Basic URI validation
      if (!uri || typeof uri !== "string") {
        return { accepted: false, error: "Message URI is required" };
      }

      // Run validation — top-level message, no upstream
      try {
        const readFn = async <T = unknown>(u: string): Promise<ReadResult<T>> => {
          const results = await read.read<T>(u);
          return results[0] ?? { success: false, error: "No results" } as ReadResult<T>;
        };
        const validationResult = await validate(msg, undefined, readFn);
        if (!validationResult.valid) {
          return {
            accepted: false,
            error: validationResult.error || "Validation failed",
          };
        }
      } catch (error) {
        return {
          accepted: false,
          error: `Validation error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }

      // Forward to write backend
      try {
        return await write.receive(msg);
      } catch (error) {
        return {
          accepted: false,
          error: `Processing error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },

    read: (uris) => read.read(uris),
    status: () => read.status(),
  };

  return new FunctionalClient(fnConfig);
}
