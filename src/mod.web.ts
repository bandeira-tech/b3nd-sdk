/**
 * @bandeira-tech/b3nd-web — the browser bundle.
 *
 * Single import for everything: rig, identity, hash, encrypt,
 * clients, message layer, and core types.
 *
 * Individual tools have their own packages (`@b3nd/rig`, subpath exports).
 * This bundle is the convergence — all tools, one import.
 */

export * from "./core.ts";
export * from "./canon.ts";
