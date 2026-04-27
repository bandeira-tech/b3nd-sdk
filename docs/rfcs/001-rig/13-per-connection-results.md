# 13. Per-connection result granularity

Three issues remain that are independent of the unifying architecture
in Parts I–IV. This is the first.

## The problem

When a tuple is broadcast to N connections that all accept it, the Rig
collapses the N per-connection `ReceiveResult`s into one. The current
collapse rule is "first non-accepted wins; if all accepted, return the
first":

```ts
// libs/b3nd-rig/rig.ts (current)
const writeResults = await Promise.all(
  matching.map((s) => s.client.receive([msg]).then((r) => r[0])),
);
const failed = writeResults.find((r) => !r.accepted);
results.push(failed ?? writeResults[0]);
```

That collapse hides information operators need. If primary accepted but
mirror-1 rejected and mirror-2 accepted, the caller sees one result —
`{ accepted: false, error: "mirror-1's error" }` — and has no way to
know that the write *did* land on the primary and on mirror-2. Whether
to retry, reconcile, or accept the partial state becomes guesswork.

The same call collapses information for the inverse case: if primary
*rejected* and mirror-1 accepted (which can happen if a mirror has
weaker validation, or if there's a stale primary), the caller sees
`{ accepted: false }` and might assume the write landed nowhere.
Reality: it landed on the mirror, possibly in a state that diverges
from the primary forever.

## The proposal

Two changes, both small. Together they keep the simple case simple and
make the detailed case detailed.

### Change 1 — keep the per-connection results

`ReceiveResult` gains an optional `perConnection` field. The aggregated
top-level `accepted` and `error` survive (so existing callers keep
working at the field-name level), but the per-connection breakdown is
attached underneath.

```ts
type ReceiveResult = {
  accepted: boolean;
  error?: string;
  perConnection?: Array<{
    connectionId: string;
    accepted: boolean;
    error?: string;
  }>;
};
```

The Rig populates `perConnection` whenever a tuple was broadcast to more
than one connection. For single-connection broadcasts, the field is
omitted (no information lost; the top-level `accepted`/`error` already
covers it).

`connectionId` comes from the connection's identifier — proposed: an
optional `id` field on `connection({ id?, receive, read, observe })`,
defaulting to a stable hash of the patterns + a sequence number if
omitted. Operators who care about identifying connections name them;
operators who don't, see auto-IDs they can still distinguish.

### Change 2 — explicit broadcast policy

A `broadcastPolicy` enum on `RigConfig` (or per-connection, see below)
that decides how `perConnection` collapses into the top-level
`accepted`. Three values, all sensible:

```ts
type BroadcastPolicy =
  | "all-or-nothing"   // accepted iff every connection accepted
  | "best-effort"      // accepted iff any connection accepted
  | "any-success";     // accepted iff any connection accepted (alias for best-effort, kept for clarity)
```

Default: `"all-or-nothing"`. This matches the most defensive intuition
("if you said it succeeded, the write is durable everywhere it could
be"). The current behavior — first-fail-wins — is approximately
all-or-nothing already; this just makes the policy explicit.

Operators with replication topologies where partial writes are
acceptable (a primary plus a best-effort cache mirror) set
`broadcastPolicy: "best-effort"`. The cache going down doesn't fail the
write to the primary.

### Optional: per-connection policy

A finer-grained extension would put policy on individual connections,
treating them as required vs. best-effort:

```ts
connection(primary, { receive: ["mutable://*"], required: true });
connection(mirror,  { receive: ["mutable://*"], required: false });
```

The Rig then says "accepted iff every required connection accepted" and
ignores best-effort failures in the top-level result (still recording
them in `perConnection`). This is more expressive than the global
policy but adds shape to the connection API. We propose it as
optional: ship the global policy first, add per-connection if demand
appears.

## API impact

Breaking only in the observable sense. The top-level shape stays the
same — `accepted: boolean`, `error?: string`. Callers destructuring
those fields keep working. Callers that want to inspect per-connection
detail check `result.perConnection`.

The default policy change ("all-or-nothing" instead of today's
implicit first-fail-wins) is functionally close to the current behavior;
the difference shows up when there's a partial success, where the new
default is louder about it.

`connection()` gains an optional `id` param. No existing call breaks;
auto-IDs cover unnamed connections.

`RigConfig` gains an optional `broadcastPolicy` field. Default
`"all-or-nothing"`.

## What changed in this chapter

- `ReceiveResult` gains an optional `perConnection` array surfacing
  per-connection outcomes.
- `RigConfig` gains an optional `broadcastPolicy` enum
  (`"all-or-nothing" | "best-effort" | "any-success"`), default
  `"all-or-nothing"`.
- `connection()` gains an optional `id` parameter for naming
  connections in the per-connection output.
- A future per-connection `required` flag is left as an optional
  follow-up.

## What's coming next

Chapter 14 — list-read federation. Today a trailing-slash read returns
results from the first matching connection only, even if other
connections hold items at the same prefix. We propose making federation
the default for list reads with an explicit opt-out.
