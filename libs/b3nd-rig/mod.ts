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
 * import { Rig, Identity, connection, createClientFromUrl } from "@b3nd/rig";
 *
 * const client = await createClientFromUrl("https://node.b3nd.net");
 * const rig = new Rig({
 *   connections: [connection(client, { receive: ["*"], read: ["*"] })],
 * });
 *
 * const id = await Identity.fromSeed("my-secret");
 * // Identity drives, rig delivers
 * const session = id.rig(rig);
 * await session.send({
 *   inputs: [],
 *   outputs: [["mutable://app/key", {}, { hello: "world" }]],
 * });
 *
 * // Read (no identity needed)
 * const results = await rig.read("mutable://app/key");
 * ```
 */

// Core
export { Identity } from "./identity.ts";
export type { ExportedIdentity } from "./identity.ts";
export { AuthenticatedRig } from "./authenticated-rig.ts";
export { Rig } from "./rig.ts";
export type {
  ElasticsearchExecutorFactory,
  HandlerOptions,
  MongoExecutorFactory as MongoExecutor,
  PostgresExecutorFactory as PostgresExecutor,
  RigConfig,
  RigInfo,
  S3ExecutorFactory as S3Executor,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";

// Program model — re-exported from core for convenience
export type {
  CodeHandler,
  Output,
  Program,
  ProgramResult,
} from "../b3nd-core/types.ts";

// Hooks (immutable after init — throw to reject, observe to audit)
export type {
  AfterHook,
  BeforeHook,
  HooksConfig,
  ReadCtx,
  ReceiveCtx,
  RigHooks,
  SendCtx,
} from "./hooks.ts";
export { resolveHooks, runAfter, runBefore } from "./hooks.ts";

// Events
export type { EventHandler, RigEvent, RigEventName } from "./events.ts";
export { RigEventEmitter } from "./events.ts";

// Reactions — local write-reactions (fire-and-forget pattern matching)
export type { ReactionHandler } from "./reactions.ts";
export { matchPattern, ReactionRegistry } from "./reactions.ts";

// Connections — the single filtering primitive
export { connection } from "./connection.ts";
export type { Connection, ConnectionPatterns } from "./connection.ts";

// HTTP API — standalone function for serving a rig over HTTP
export { createRigHandler, httpApi } from "./http.ts";
export type { HttpApiOptions, RigHandlerOptions } from "./http.ts";

// Backend factory
export {
  createClientFromUrl,
  createClientResolver,
  createStoreFromUrl,
  createStoreResolver,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
export type { BackendFactoryOptions, StoreClientConstructor } from "./backend-factory.ts";
