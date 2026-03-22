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
export type { ExportedIdentity } from "./identity.ts";
export {
  createClientFromUrl,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
export type { BackendFactoryOptions } from "./backend-factory.ts";
export { Rig } from "./rig.ts";
export type {
  MongoExecutorFactory as MongoExecutor,
  PostgresExecutorFactory as PostgresExecutor,
  RigConfig,
  ServeOptions,
} from "./types.ts";
