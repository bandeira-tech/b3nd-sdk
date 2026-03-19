/**
 * @module
 * Environment-based configuration loader for b3nd Rig.
 *
 * Follows 12-factor app principles — all config comes from env vars.
 * Returns a RigConfig suitable for `Rig.init()`.
 *
 * @example
 * ```typescript
 * import { Rig, loadConfigFromEnv } from "@b3nd/rig";
 *
 * // Reads BACKEND_URL, IDENTITY_SEED, etc.
 * const config = loadConfigFromEnv();
 * const rig = await Rig.init(config);
 * ```
 *
 * ## Supported environment variables
 *
 * | Variable | Description | Example |
 * |----------|-------------|---------|
 * | `BACKEND_URL` | Backend URL(s), comma-separated for multi-backend | `https://node.b3nd.net` |
 * | `IDENTITY_SEED` | Deterministic seed for Identity.fromSeed() | `my-app-secret-seed` |
 */

import type { RigConfig } from "./types.ts";

/** Options for customizing env var names. */
export interface LoadConfigOptions {
  /** Env var name for backend URL(s). Default: `BACKEND_URL` */
  backendUrlVar?: string;
  /** Env var name for identity seed. Default: `IDENTITY_SEED` */
  identitySeedVar?: string;
  /** Custom env getter (for testing). Defaults to Deno.env.get / process.env */
  getEnv?: (key: string) => string | undefined;
}

/**
 * Load a RigConfig from environment variables.
 *
 * Returns a partial config — caller can merge with additional options
 * before passing to `Rig.init()`.
 *
 * @throws If BACKEND_URL is not set and no fallback is provided.
 */
export function loadConfigFromEnv(
  options?: LoadConfigOptions,
): RigConfig & { identitySeed?: string } {
  const backendUrlVar = options?.backendUrlVar ?? "BACKEND_URL";
  const identitySeedVar = options?.identitySeedVar ?? "IDENTITY_SEED";

  const getEnv = options?.getEnv ?? defaultGetEnv;

  const backendUrl = getEnv(backendUrlVar);
  const identitySeed = getEnv(identitySeedVar);

  if (!backendUrl) {
    throw new Error(
      `loadConfigFromEnv: ${backendUrlVar} is required. ` +
        `Set it to a b3nd backend URL (e.g., "memory://", "https://node.b3nd.net").`,
    );
  }

  // Support comma-separated URLs for multi-backend
  const urls = backendUrl.split(",").map((u) => u.trim()).filter(Boolean);
  const use = urls.length === 1 ? urls[0] : urls;

  const config: RigConfig & { identitySeed?: string } = { use };

  // Attach seed as a hint — caller uses Identity.fromSeed() with it
  if (identitySeed) {
    config.identitySeed = identitySeed;
  }

  return config;
}

/** Default env getter — works in Deno and Node.js */
function defaultGetEnv(key: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  if (typeof g.Deno !== "undefined") {
    return g.Deno.env.get(key);
  }
  if (typeof g.process !== "undefined") {
    return g.process.env[key];
  }
  return undefined;
}
