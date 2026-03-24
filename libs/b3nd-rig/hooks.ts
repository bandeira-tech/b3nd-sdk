/**
 * @module
 * Hook types and runners for the Rig.
 *
 * Hooks are synchronous pipelines that run IN the operation:
 * - Pre-hooks can abort or mutate the operation context
 * - Post-hooks can transform the result
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
 * Pre-hook return value:
 * - `void` / `undefined` → continue with original context
 * - `{ abort: true, reason? }` → stop the operation
 * - `{ ctx }` → continue with a replacement context
 */
export type PreHookResult =
  | void
  | undefined
  | { abort: true; reason?: string }
  | { ctx: HookContext };

/** Pre-hook function. Runs before the operation. */
export type PreHook = (
  ctx: HookContext,
) => PreHookResult | Promise<PreHookResult>;

/**
 * Post-hook function. Runs after the operation.
 * Return a value to replace the result, or void to pass through.
 */
export type PostHook = (
  ctx: HookContext,
  result: unknown,
) => unknown | void | Promise<unknown | void>;

/** The full set of hook chains for all operations. */
export interface HookChains {
  send: { pre: PreHook[]; post: PostHook[] };
  receive: { pre: PreHook[]; post: PostHook[] };
  read: { pre: PreHook[]; post: PostHook[] };
  list: { pre: PreHook[]; post: PostHook[] };
  delete: { pre: PreHook[]; post: PostHook[] };
}

// ── Factories ──

/** Create empty hook chains. */
export function createHookChains(): HookChains {
  return {
    send: { pre: [], post: [] },
    receive: { pre: [], post: [] },
    read: { pre: [], post: [] },
    list: { pre: [], post: [] },
    delete: { pre: [], post: [] },
  };
}

// ── Runners ──

/** Result of running pre-hooks. */
export type PreHookRunResult =
  | { aborted: true; reason?: string }
  | { aborted: false; ctx: HookContext };

/**
 * Run pre-hooks sequentially.
 *
 * Stops at the first abort. Each hook can optionally replace
 * the context for downstream hooks.
 */
export async function runPreHooks(
  hooks: PreHook[],
  ctx: HookContext,
): Promise<PreHookRunResult> {
  let current = ctx;
  for (const hook of hooks) {
    const result = await hook(current);
    if (result == null) continue;
    if ("abort" in result && result.abort) {
      return { aborted: true, reason: result.reason };
    }
    if ("ctx" in result && result.ctx) {
      current = result.ctx;
    }
  }
  return { aborted: false, ctx: current };
}

/**
 * Run post-hooks sequentially.
 *
 * Each hook can transform the result. If a hook returns
 * `undefined` or `void`, the previous result passes through.
 */
export async function runPostHooks(
  hooks: PostHook[],
  ctx: HookContext,
  result: unknown,
): Promise<unknown> {
  let current = result;
  for (const hook of hooks) {
    const transformed = await hook(ctx, current);
    if (transformed !== undefined) {
      current = transformed;
    }
  }
  return current;
}
