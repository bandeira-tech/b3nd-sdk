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
 * const rig = await Rig.connect("https://node.b3nd.net");
 * const id = await Identity.fromSeed("my-secret");
 *
 * // Identity drives, rig delivers
 * const session = id.rig(rig);
 * await session.send({
 *   inputs: [],
 *   outputs: [["mutable://app/key", { hello: "world" }]],
 * });
 *
 * // Read (no identity needed)
 * const result = await rig.read("mutable://app/key");
 * ```
 */

// Core
export { Identity } from "./identity.ts";
export type { ExportedIdentity } from "./identity.ts";
export { AuthenticatedRig } from "./authenticated-rig.ts";
export { Rig } from "./rig.ts";
export type {
  HandlerOptions,
  ElasticsearchExecutorFactory,
  MongoExecutorFactory as MongoExecutor,
  PostgresExecutorFactory as PostgresExecutor,
  S3ExecutorFactory as S3Executor,
  RigConfig,
  RigInfo,
  ServeOptions,
  SubscribeHandler,
  SubscribeOptions,
  Unsubscribe,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";

// Hooks (immutable after init — throw to reject, observe to audit)
export type {
  AfterHook,
  BeforeHook,
  DeleteCtx,
  HooksConfig,
  ListCtx,
  ReadCtx,
  ReceiveCtx,
  RigHooks,
  SendCtx,
} from "./hooks.ts";
export { resolveHooks, runAfter, runBefore } from "./hooks.ts";

// Events
export type { EventHandler, RigEvent, RigEventName } from "./events.ts";
export { RigEventEmitter } from "./events.ts";

// Observe
export type { ObserveHandler } from "./observe.ts";
export { matchPattern, ObserveRegistry } from "./observe.ts";

// Client filtering — declare what URIs each client accepts
export { clientAccepts, withFilter } from "./filter.ts";
export type { FilteredClient, FilterPatterns } from "./filter.ts";

// HTTP handler — thin adapter for serving a rig over HTTP
export { createRigHandler } from "./http-handler.ts";
export type { RigHandlerOptions } from "./http-handler.ts";

// Backend factory
export {
  createClientFromUrl,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
export type { BackendFactoryOptions } from "./backend-factory.ts";
