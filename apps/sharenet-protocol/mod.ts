/**
 * @module
 * sharenet — a private DePIN protocol for running many app backends on
 * shared b3nd infrastructure.
 *
 * Three roles:
 *
 * - **Operators** stand up sharenet nodes (see `apps/sharenet-node/`) and
 *   maintain the registry of approved apps.
 * - **App owners** register apps via {@link registerApp} and build their
 *   backend logic with {@link SharenetSession}.
 * - **End users** authenticate with an {@link Identity} and own pubkey-
 *   scoped namespaces inside each app.
 *
 * See `schema.ts` for the validator schema, `sdk.ts` for the app-facing
 * API, and `uris.ts` for the canonical URI layout.
 */

export { type AppManifest, createSchema, type SharenetConfig } from "./schema.ts";
export {
  getAppManifest,
  registerApp,
  SharenetSession,
} from "./sdk.ts";
export {
  assertAppId,
  assertPubkey,
  linkUri,
  registryUri,
  sharedListUri,
  sharedUri,
  userListUri,
  userUri,
} from "./uris.ts";
