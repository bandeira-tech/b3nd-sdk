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
import type { NodeProtocolInterface, ReadResult } from "../b3nd-core/types.ts";
import type { Validator } from "./types.ts";

/**
 * Create a FunctionalClient that validates before writing.
 *
 * Wiring:
 * - receive → validate(msg, read.read) → write.receive(msg)
 * - read/readMulti/list → delegated to config.read
 * - delete/health/getSchema/cleanup → delegated to config.write
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

      // Run validation
      try {
        const readFn = <T = unknown>(uri: string): Promise<ReadResult<T>> =>
          read.read<T>(uri);
        const validationResult = await validate(msg, readFn);
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

    read: (uri) => read.read(uri),
    readMulti: (uris) => read.readMulti(uris),
    list: (uri, options) => read.list(uri, options),
    delete: (uri) => write.delete(uri),
    health: () => read.health(),
    getSchema: () => read.getSchema(),
    async cleanup() {
      await write.cleanup();
      await read.cleanup();
    },
  };

  return new FunctionalClient(fnConfig);
}
