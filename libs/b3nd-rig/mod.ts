/**
 * @module
 * b3nd Rig — the universal harness for b3nd networks.
 *
 * Identity, connection, send/receive, and observation.
 * For the full toolkit (hash, encrypt, message layer),
 * use the bundle: `@bandeira-tech/b3nd-web` or `@bandeira-tech/b3nd-sdk`.
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

// Core
export { Identity } from "./identity.ts";
export type { ExportedIdentity } from "./identity.ts";
export { Rig } from "./rig.ts";
export type {
  HandlerOptions,
  ElasticsearchExecutorFactory,
  MongoExecutorFactory as MongoExecutor,
  PostgresExecutorFactory as PostgresExecutor,
  RigConfig,
  RigInfo,
  ServeOptions,
  Unsubscribe,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";

// Hooks (immutable after init — throw to reject, observe to audit)
export type {
  DeleteHookContext,
  HookableOp,
  HookChains,
  HookContext,
  ListHookContext,
  PostHook,
  PreHook,
  ReadHookContext,
  ReceiveHookContext,
  SendHookContext,
} from "./hooks.ts";
export { createHookChains, runPostHooks, runPreHooks } from "./hooks.ts";

// Events
export type { EventHandler, RigEvent, RigEventName } from "./events.ts";
export { RigEventEmitter } from "./events.ts";

// Observe
export type { ObserveHandler } from "./observe.ts";
export { matchPattern, ObserveRegistry } from "./observe.ts";

// Backend factory
export {
  createClientFromUrl,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
export type { BackendFactoryOptions } from "./backend-factory.ts";
