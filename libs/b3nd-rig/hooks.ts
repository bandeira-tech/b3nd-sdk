/**
 * @module
 * Hook types and runners for the Rig.
 *
 * Security model:
 * - Pre-hooks THROW to reject an operation. The caller must catch explicitly.
 *   No silent aborts — if validation fails, it's an exception.
 * - Post-hooks OBSERVE but cannot modify the result. They can throw if
 *   a post-condition is violated, or return metadata for diagnostics.
 * - Hooks are immutable after init. Want different hooks? Create a new rig.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

import type { ListOptions } from "../b3nd-core/types.ts";
import type { Identity } from "./identity.ts";

// ── Types ──

/** The five hookable operations. */
export type HookableOp = "send" | "receive" | "read" | "list" | "delete";

/** Context for a send hook. */
export interface SendHookContext {
  op: "send";
  envelope: { inputs: string[]; outputs: [string, unknown][] };
  identity: Identity | null;
}

/** Context for a receive hook. */
export interface ReceiveHookContext {
  op: "receive";
  uri: string;
  data: unknown;
}

/** Context for a read hook. */
export interface ReadHookContext {
  op: "read";
  uri: string;
}

/** Context for a list hook. */
export interface ListHookContext {
  op: "list";
  uri: string;
  options?: ListOptions;
}

/** Context for a delete hook. */
export interface DeleteHookContext {
  op: "delete";
  uri: string;
}

/** Discriminated union of all hook contexts. */
export type HookContext =
  | SendHookContext
  | ReceiveHookContext
  | ReadHookContext
  | ListHookContext
  | DeleteHookContext;

/**
 * Pre-hook function. Runs before the operation.
 *
 * - Return `void` to allow the operation to proceed unchanged.
 * - Return `{ ctx }` to replace the context for downstream hooks.
 * - **Throw** to reject the operation. The exception propagates to the caller.
 */
export type PreHook = (
  ctx: Readonly<HookContext>,
) => void | { ctx: HookContext } | Promise<void | { ctx: HookContext }>;

/**
 * Post-hook function. Runs after the operation completes.
 *
 * Post-hooks **cannot** modify the result — the operation's return value
 * is immutable. Use post-hooks for:
 * - Logging / auditing (return void)
 * - Diagnostics (return metadata object — available via events)
 * - Enforcement (throw if a post-condition is violated)
 */
export type PostHook = (
  ctx: Readonly<HookContext>,
  result: unknown,
) => void | Promise<void>;

/** The full set of hook chains for all operations. Frozen after init. */
export interface HookChains {
  readonly send: {
    readonly pre: readonly PreHook[];
    readonly post: readonly PostHook[];
  };
  readonly receive: {
    readonly pre: readonly PreHook[];
    readonly post: readonly PostHook[];
  };
  readonly read: {
    readonly pre: readonly PreHook[];
    readonly post: readonly PostHook[];
  };
  readonly list: {
    readonly pre: readonly PreHook[];
    readonly post: readonly PostHook[];
  };
  readonly delete: {
    readonly pre: readonly PreHook[];
    readonly post: readonly PostHook[];
  };
}

// ── Factories ──

/** Create hook chains from config. Freezes the result — no mutation after init. */
export function createHookChains(
  config?: Partial<
    Record<HookableOp, { pre?: PreHook[]; post?: PostHook[] }>
  >,
): HookChains {
  const ops: HookableOp[] = ["send", "receive", "read", "list", "delete"];
  const chains: Record<
    string,
    { pre: readonly PreHook[]; post: readonly PostHook[] }
  > = {};

  for (const op of ops) {
    const entry = config?.[op];
    chains[op] = Object.freeze({
      pre: Object.freeze(entry?.pre ? [...entry.pre] : []),
      post: Object.freeze(entry?.post ? [...entry.post] : []),
    });
  }

  return Object.freeze(chains) as unknown as HookChains;
}

// ── Runners ──

/**
 * Run pre-hooks sequentially. Returns the (possibly replaced) context.
 *
 * **Throws** if any pre-hook throws — this is the rejection mechanism.
 * The caller is expected to let the exception propagate or catch it
 * explicitly if they want to handle the rejection.
 */
export async function runPreHooks(
  hooks: readonly PreHook[],
  ctx: HookContext,
): Promise<HookContext> {
  let current = ctx;
  for (const hook of hooks) {
    const result = await hook(current);
    if (result != null && "ctx" in result && result.ctx) {
      current = result.ctx;
    }
  }
  return current;
}

/**
 * Run post-hooks sequentially. The result is passed as read-only context.
 *
 * Post-hooks cannot modify the result. They can:
 * - Observe (return void)
 * - Throw if a post-condition is violated
 */
export async function runPostHooks(
  hooks: readonly PostHook[],
  ctx: HookContext,
  result: unknown,
): Promise<void> {
  for (const hook of hooks) {
    await hook(ctx, result);
  }
}
