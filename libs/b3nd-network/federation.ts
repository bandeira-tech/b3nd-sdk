/**
 * @module
 * `createFederation(peers, policy?)` — construct the **remote-client
 * primitive**.
 *
 * The returned `Federation` is a `NodeProtocolInterface`, consumed as a
 * rig connection: `connection(federation, patterns)`. Writes fan out per
 * `Policy.send`, reads delegate by strategy, observe merges peer streams.
 *
 * Federation is NOT a `Network` — it deliberately lacks the `peers` /
 * `policy` / `originId` fields to prevent accidental composition with
 * `work(rig, ...)`. If you want Mode 3 (full participant), construct a
 * `Network` for `work()` and a `Federation` for `connection()` from the
 * same inputs — two objects, two roles, never the same object used
 * twice.
 */

import type {
  Message,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import { flood } from "./policies/flood.ts";
import { buildSpec } from "./network.ts";
import type { Federation, OutboundCtx, Peer, Policy } from "./types.ts";

/**
 * Build a Federation from peers and a Policy (defaults to `flood()`).
 *
 * @example
 * ```ts
 * import { createFederation, peer } from "@bandeira-tech/b3nd-sdk/network";
 * import { Rig, connection } from "@bandeira-tech/b3nd-sdk";
 *
 * const fed = createFederation([peer(clientB, { id: "B" }), peer(clientC, { id: "C" })]);
 * const rig = new Rig({
 *   connections: [connection(fed, { receive: ["mutable://*"], read: ["mutable://*"] })],
 * });
 * ```
 */
export function createFederation(
  peers: Peer[],
  policy: Policy = flood(),
): Federation {
  const spec = buildSpec(peers, policy);
  const { originId, peers: frozenPeers } = spec;
  const readStrategy = policy.read ?? "first-match";

  return {
    // ── receive ──────────────────────────────────────────────────────

    async receive(msgs: Message[]): Promise<ReceiveResult[]> {
      if (msgs.length === 0) return [];
      const ctx: OutboundCtx = { originId };

      await Promise.all(frozenPeers.map(async (p) => {
        const transformed = policy.send ? policy.send(msgs, p, ctx) : msgs;
        if (transformed.length === 0) return;
        await p.client.receive(transformed);
      }));

      // The Federation reports success per *input* message — we fanned
      // out to the peers the policy selected. Transport-level failures
      // throw and propagate; wrap individual peers with a best-effort
      // decorator for rejection tolerance.
      return msgs.map(() => ({ accepted: true }));
    },

    // ── read ─────────────────────────────────────────────────────────

    async read<T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      if (uriList.length === 0) return [];

      if (readStrategy === "first-match") {
        let lastErr: string | undefined;
        for (const p of frozenPeers) {
          try {
            const results = await p.client.read<T>(uriList);
            if (results.some((r) => r.success)) return results;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
          }
        }
        return uriList.map(() => ({
          success: false,
          error: lastErr ?? "no peer returned a match",
        } as ReadResult<T>));
      }

      // merge-unique: fan out in parallel, first successful hit per URI wins.
      const merged = new Map<string, ReadResult<T>>();
      const settled = await Promise.allSettled(
        frozenPeers.map((p) => p.client.read<T>(uriList)),
      );
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const r of s.value) {
          const key = r.uri ?? uriList[0];
          if (r.success && !merged.has(key)) merged.set(key, r);
        }
      }
      return uriList.map((u) => {
        for (const [, r] of merged) if (r.uri === u) return r;
        return { success: false, error: "not found" } as ReadResult<T>;
      });
    },

    // ── observe ──────────────────────────────────────────────────────

    async *observe<T = unknown>(
      pattern: string,
      signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      const queue: ReadResult<T>[] = [];
      let wake: (() => void) | null = null;

      const forwarders = frozenPeers.map(async (p) => {
        try {
          for await (const r of p.client.observe<T>(pattern, signal)) {
            queue.push(r);
            const w = wake;
            if (w) {
              wake = null;
              w();
            }
          }
        } catch {
          // Per-peer observe errors are swallowed — one broken peer
          // should not tear down the merged stream. The signal is still
          // the mechanism the caller uses to stop everything.
        }
      });

      const onAbort = () => {
        const w = wake;
        if (w) {
          wake = null;
          w();
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        while (true) {
          while (queue.length > 0) yield queue.shift()!;
          if (signal.aborted) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        await Promise.allSettled(forwarders);
      }
    },

    // ── status ───────────────────────────────────────────────────────

    async status(): Promise<StatusResult> {
      const settled = await Promise.allSettled(
        frozenPeers.map((p) => p.client.status()),
      );
      let healthy = 0;
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value.status === "healthy") healthy++;
      }
      const total = frozenPeers.length;
      return {
        status: healthy === total
          ? "healthy"
          : healthy > 0
          ? "degraded"
          : "unhealthy",
        message: `${healthy}/${total} peers healthy`,
        details: {
          originId,
          peerCount: total,
          healthyPeers: healthy,
        },
      };
    },
  };
}
