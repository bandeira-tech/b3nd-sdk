/**
 * @module
 * b3nd Rig — the universal harness.
 *
 * Single import for working with the b3nd network.
 * Convention over configuration.
 *
 * @example
 * ```typescript
 * import { Rig, Identity } from "@b3nd/rig";
 *
 * const id = await Identity.fromSeed("my-secret");
 * const rig = await Rig.init({
 *   identity: id,
 *   use: "https://node.b3nd.net",
 * });
 *
 * // Auto-signed send
 * await rig.send({
 *   inputs: [],
 *   outputs: [["mutable://app/key", { hello: "world" }]],
 * });
 *
 * // Read
 * const result = await rig.read("mutable://app/key");
 * ```
 */

export { Identity } from "./identity.ts";
export { Rig } from "./rig.ts";
export type {
  MongoExecutorFactory as MongoExecutor,
  PostgresExecutorFactory as PostgresExecutor,
  RigConfig,
} from "./types.ts";

// URI utilities
export { uri } from "./uri.ts";
export type { ParsedUri, UriProtocol } from "./uri.ts";

// Environment config loader
export { loadConfigFromEnv } from "./env.ts";
export type { LoadConfigOptions } from "./env.ts";

// Error classification helpers
export {
  classifyError,
  isAuthError,
  isConflictError,
  isNotFoundError,
  isTransientError,
  isValidationError,
} from "./errors.ts";
