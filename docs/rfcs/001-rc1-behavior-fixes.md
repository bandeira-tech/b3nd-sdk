# RFC 001 — RC1 Behavioral Fixes

**Status:** Proposal
**Target:** pre-1.0 (RC1)
**Author:** SDK maintainers

This RFC proposes code-level fixes for the surprising behaviors identified during pre-1.0 exploration. No backwards-compatibility constraints; breaking changes are acceptable. No code is changed in this PR — implementation PRs follow.

---

## Table of contents

1. [Programs fire on `rig.receive()` only, not `rig.send()`](#1-programs-fire-on-rigreceive-only-not-rigsend)
2. [`rig.send()` is identity-blind](#2-rigsend-is-identity-blind)
3. [`MessageDataClient` decomposes envelope outputs into its own `Store`, not through Rig routing](#3-messagedataclient-decomposes-envelope-outputs-into-its-own-store-not-through-rig-routing)
4. [`rig.receive()` replica broadcast collapses per-connection results](#4-rigreceive-replica-broadcast-collapses-per-connection-results)
5. [`rig.read()` trailing-slash federation is first-match only](#5-rigread-trailing-slash-federation-is-first-match-only)
6. [`readEncryptedMany` throws on any non-encrypted entry](#6-readencryptedmany-throws-on-any-non-encrypted-entry)
7. [`Output` `values` slot is under-documented and oddly named](#7-output-values-slot-is-under-documented-and-oddly-named)
8. [Out of scope](#out-of-scope)
9. [Sequencing](#sequencing)

---

## 1. Programs fire on `rig.receive()` only, not `rig.send()`

### Current behavior
`Rig.send()` at `libs/b3nd-rig/rig.ts:166` accepts pre-authenticated `MessageData` and dispatches directly to connection routing. The trust-list `Program` pipeline lives under `_runProgram` around `libs/b3nd-rig/rig.ts:313`, which is only invoked from `receive()`. Programs that enforce invariants (e.g., balance conservation, rate limits, ACL checks) therefore silently do not run for authenticated writes.

```ts
// Programs fire:
await rig.receive([["app://ledger/txs/1", {}, data]]); // runs _runProgram

// Programs do NOT fire:
const signed = await identity.sign({ inputs: [...], outputs: [...] });
await rig.send({ auth: [signed], inputs: [...], outputs: [...] }); // skips _runProgram entirely
```

### Why it surprises
"Programs are the one pipeline" (per the recent compose/validator retirement) is the design promise. Users reasonably expect `send()` — the *authenticated* path — to be at least as policed as `receive()`. Today it's strictly *less* policed.

### Options
- **A.** *Run programs on each envelope output during `send()`*: uniform policy, modest plumbing.
- **B.** *Document send() as post-policy (only signatures enforced)*: no code change, but cements the footgun.
- **C.** *Move programs to a higher-level orchestrator outside Rig*: cleanest layering, largest refactor.

### Recommendation
**A. Run programs on each output during `send()`.** The `Program` signature already accepts `upstream`; we pass the envelope as `upstream` so programs have the full authenticated context. This gives one policy surface and resolves the "authenticated writes escape validation" trap before 1.0. Option C is attractive long-term but too invasive for RC1.

### API impact
No signature change to `send()`. `Program` contract unchanged — we merely invoke it at a new call site. Behaviorally breaking for any deployment that relied on programs *not* firing on `send()`; we expect that reliance to be a bug, not a feature.

### Implementation sketch
```ts
async send(data: MessageData): Promise<SendResult> {
  // ... existing beforeSend hook
  for (const out of messageData.outputs) {
    const [uri] = out;
    const program = this._findProgram(uri);
    if (program) {
      await program({
        output: out,
        upstream: messageData, // full envelope as upstream context
        read: this.read.bind(this),
      });
    }
  }
  // ... then existing dispatch
}
```

---

## 2. `rig.send()` is identity-blind

### Current behavior
`Rig.send()` at `libs/b3nd-rig/rig.ts:166` accepts `MessageData` that *includes* an `auth` array of signatures, but does not verify those signatures cover the payload. Any caller can construct `{ auth: [garbage], inputs, outputs }` and the rig will dispatch it. Authentication enforcement is deferred to whichever connection / program happens to check — and most don't.

```ts
await rig.send({
  auth: [{ signer: "did:example:alice", signature: "AAAA" }], // not verified
  inputs: [],
  outputs: [["app://ledger/txs/1", {}, { amount: 100 }]],
});
// dispatches regardless
```

### Why it surprises
The method's name, parameter shape (`auth` is mandatory in the type), and docstring example (`await identity.sign(...)`) all imply "this is the authenticated write path." Callers assume forged signatures are rejected at the boundary. They are not.

### Options
- **A.** *Verify `auth` in `rig.send()`*: closes the hole, adds a crypto dependency on the base `Rig`.
- **B.** *Make `rig.send()` explicitly unauthenticated; only `AuthenticatedRig.send()` is trusted*: honest layering, requires renaming or removing `auth` from `MessageData` at the base level.
- **C.** *Program-level `requireAuth` helper*: opt-in, keeps core uncoupled, but recreates the "did you remember to wire it?" footgun.

### Recommendation
**B. Split the surface.** Base `Rig.send()` becomes `sendRaw()` (or drops the `auth` field entirely); `AuthenticatedRig.send()` remains the trusted entry point and is the only one that produces / verifies `auth`. This keeps crypto out of the core and makes the threat model explicit in the type system. This pairs naturally with #1: the validation story belongs to the authenticated layer.

### API impact
Breaking. `MessageData` at the core layer loses `auth`; that field migrates to an `AuthenticatedMessageData` type in `b3nd-rig-auth` (or equivalent). Callers using the base `Rig` to send pre-signed messages must switch to `AuthenticatedRig`. This is the intended migration, not a regression.

### Implementation sketch
```ts
// libs/b3nd-core/types.ts
export type MessageData = { inputs: string[]; outputs: Output[] };

// libs/b3nd-rig/authenticated-rig.ts
export type AuthenticatedMessageData = MessageData & { auth: Signature[] };

class AuthenticatedRig extends Rig {
  async send(data: AuthenticatedMessageData) {
    await this.verify(data); // throws on bad sig
    return super.send(data);
  }
}
```

---

## 3. `MessageDataClient` decomposes envelope outputs into its own `Store`, not through Rig routing

### Current behavior
`libs/b3nd-core/message-data-client.ts` lines ~75-128 (`_receiveOne`) detect the `{ inputs, outputs }` envelope shape and decompose it: inputs are deleted from `this.store` and outputs are written to `this.store`. The `Rig`'s connection routing is bypassed entirely for decomposed outputs.

```ts
// Given rig with two connections:
//   - conn A accepts "mutable://*"
//   - conn B accepts "log://*"
await rig.receive([["envelope://tx/1", {}, {
  inputs: [],
  outputs: [
    ["mutable://app/state", {}, 42],
    ["log://app/audit", {}, { ts: 1 }],
  ],
}]]);
// Both outputs land in whichever Store backs the envelope's client.
// They do NOT fan out: conn B never sees the log entry.
```
(See `libs/b3nd-core/message-data-client.ts:75-128` for the decomposition loop.)

### Why it surprises
Rig's selling point is that connection patterns compose a heterogeneous storage topology. Envelopes — the primary mechanism for multi-output writes — quietly break that composition. A feature advertised as "just works across backends" doesn't.

### Options
- **A.** *Move decomposition up to the Rig*: decomposed outputs re-enter connection-pattern routing as nested `receive()` calls; preserves per-URI routing.
- **B.** *Per-client decomposition with cross-client callback*: keep it in the client but let it call back into the Rig for non-local URIs; more plumbing, preserves client autonomy.
- **C.** *Disallow cross-backend envelopes*: reject envelopes whose outputs span connections; simplest, but cripples real workflows.

### Recommendation
**A. Decompose at the Rig layer.** The envelope write to its own URI still goes to the matching connection, but the `{ inputs, outputs }` fan-out is unwound by the Rig and re-dispatched per-URI. This restores the "patterns route everything" invariant. `MessageDataClient` loses its decomposition branch and becomes a thin single-URI store adapter.

### API impact
Breaking for callers that used `MessageDataClient` as a standalone envelope processor outside a Rig — that role becomes the Rig's. The client's public surface shrinks. No Rig-facing signature changes.

### Implementation sketch
```ts
// libs/b3nd-rig/rig.ts — inside receive(), after connection dispatch
for (const msg of msgs) {
  const [, , data] = msg;
  if (isEnvelopeShape(data)) {
    if (data.inputs.length) await this._dispatchDeletes(data.inputs);
    if (data.outputs.length) await this.receive(data.outputs); // recursive, routes per-URI
  }
}
// MessageDataClient._receiveOne drops its envelope branch.
```

---

## 4. `rig.receive()` replica broadcast collapses per-connection results

### Current behavior
At `libs/b3nd-rig/rig.ts:798-819`, `createConnectionDispatch.receive()` broadcasts each message to all matching connections via `Promise.all`, then reduces the per-connection `ReceiveResult[]` to a single result via `results.find((r) => !r.accepted) ?? results[0]`. The caller sees one result; which replica failed and why is discarded.

```ts
// Two matching connections. A succeeds, B fails.
const [r] = await rig.receive([["mutable://x", {}, 1]]);
// r.accepted === false, r.error from B. Success on A is invisible.
// Or: A fails, B succeeds → r.accepted === false. App has no way to know
// the write partially landed.
```

### Why it surprises
Distributed writes have partial-failure modes; squashing them to a single result prevents callers from implementing *any* policy — retry, reconcile, ignore — intelligently. The default also isn't clearly documented as "first-fail wins."

### Options
- **A.** *Return structured per-connection results*: `{ accepted, perConnection: [{ id, accepted, error? }, ...] }`. Most information, slight shape change.
- **B.** *Add a policy enum `"all-or-nothing" | "best-effort" | "any-success"` with default*: small API, covers common cases, hides detail.
- **C.** *Both — structured results plus a convenience policy*: maximum flexibility, slightly larger surface.

### Recommendation
**C. Both.** Return structured per-connection results by default, and expose a `broadcastPolicy` option on `Rig` / `connection()` that collapses the result according to a well-known rule. Default policy is `"all-or-nothing"` — conservative, matches user intuition that "accepted means durable everywhere." Callers that want the old behavior pick `"any-success"`.

### API impact
Breaking: `ReceiveResult` gains an optional `perConnection` field; the collapsed `accepted` flag depends on policy. Callers destructuring the top-level shape continue to work; callers inspecting `.error` semantically may see different errors depending on policy.

### Implementation sketch
```ts
type ReceiveResult = {
  accepted: boolean;
  error?: string;
  perConnection?: Array<{ connectionId: string; accepted: boolean; error?: string }>;
};
type BroadcastPolicy = "all-or-nothing" | "best-effort" | "any-success";

async receive(msgs) {
  // ... per-connection Promise.all as today
  const collapsed = collapse(writeResults, this._policy);
  return { ...collapsed, perConnection: writeResults };
}
```

---

## 5. `rig.read()` trailing-slash federation is first-match only

### Current behavior
At `libs/b3nd-rig/rig.ts:822-856`, list-style reads (trailing-slash URIs like `mutable://app/items/`) iterate connections in declaration order and stop at the first one that accepts the prefix — even if that connection returns an empty array. Other backends holding items at the same prefix are ignored.

```ts
// conn A: has mutable://app/items/1
// conn B: has mutable://app/items/2
const results = await rig.read("mutable://app/items/");
// results === [{ uri: "mutable://app/items/1", ... }]
// Item 2 is silently missing.
```

### Why it surprises
A trailing slash reads as "give me everything under this prefix." Users don't expect it to mean "pick one backend arbitrarily and ask only it." Point reads being first-match makes sense (one URI → one answer); list reads being first-match does not.

### Options
- **A.** *Always federate list reads*: merge across all matching connections; simplest mental model, small perf cost.
- **B.** *Add a `{ federate: true }` option, default `false`*: backwards-compatible-ish, but keeps the surprising default.
- **C.** *Add a `{ federate: true }` option, default `true` for list reads*: best of both, breaking only in the "silently shadowed" case.

### Recommendation
**C. Federate list reads by default, with an explicit opt-out.** A trailing slash reads as a prefix query, and prefix queries should see everything. Point reads remain first-match. Callers who want the old first-match list behavior pass `{ federate: false }`.

### API impact
Breaking in the observable sense: list reads now return more results. Signature gains an options bag: `read(uris, { federate?: boolean })`. De-duplication across backends is left to callers for RC1 (see Out of scope).

### Implementation sketch
```ts
async read(uris, opts = {}) {
  const federate = opts.federate ?? true;
  for (const uri of uriList) {
    const isList = uri.endsWith("/");
    if (isList && federate) {
      const merged = [];
      for (const s of connections) {
        if (!s.accepts("read", uri.slice(0, -1))) continue;
        merged.push(...(await s.client.read(uri)));
      }
      allResults.push(...merged);
      continue;
    }
    // ... existing first-match path
  }
}
```

---

## 6. `readEncryptedMany` throws on any non-encrypted entry

### Current behavior
`libs/b3nd-rig/authenticated-rig.ts` around lines 170-180 implements `readEncryptedMany` as `Promise.all(uris.map(u => readEncrypted(u)))`. `readEncrypted` throws on a URI whose content isn't an encrypted envelope. `Promise.all` propagates the first rejection, so a single cleartext entry aborts the entire batch — even though the siblings were perfectly readable.

```ts
await rig.authenticatedRig.readEncryptedMany([
  "mutable://app/meta/title",       // cleartext metadata
  "mutable://app/secrets/key",      // encrypted
]);
// throws on the first URI; the second is never returned.
```

### Why it surprises
The common pattern is "fetch a mixed bag of keys, some of which happen to be encrypted." The current helper forces callers to pre-partition URIs by content shape, which they can't do without reading them first — defeating the purpose of the batch helper.

### Options
- **A.** *Tagged-result variant*: return `(T | null | { error: string })[]` so callers can inspect per-URI outcomes.
- **B.** *Silent skip*: return `null` for non-encrypted entries. Lossy — can't distinguish "missing" from "not encrypted."
- **C.** *Drop the helper; let callers compose `readMany` + `decrypt`*: smallest surface, pushes cost onto users.

### Recommendation
**A. Tagged-result variant.** Change the return type to `(T | null | { error: string })[]`. Preserves batch semantics, surfaces per-entry failures, and doesn't require callers to pre-sort URIs. Option C is tempting but we'd end up reinventing the helper in every app.

### API impact
Breaking: return type changes from `(T | null)[]` to `(T | null | { error: string })[]`. Callers must narrow with an `in` check or `instanceof`-style guard. Consider an additional `readEncryptedManyStrict` for the "throw on any failure" semantics if demand exists.

### Implementation sketch
```ts
async readEncryptedMany<T>(
  uris: readonly string[],
): Promise<(T | null | { error: string })[]> {
  if (uris.length === 0) return [];
  return Promise.all(uris.map(async (uri) => {
    try { return await this.readEncrypted<T>(uri); }
    catch (e) { return { error: (e as Error).message }; }
  }));
}
```

---

## 7. `Output` `values` slot is under-documented and oddly named

### Current behavior
`libs/b3nd-core/types.ts:127` defines `Output<T> = [uri, values: Record<string, number>, data: T]`. The docstring calls `values` "conserved quantities" in one line; everywhere else in the SDK and examples, callers write `{}`. The UTXO-style ledger semantics — that programs treat these as balances conserved across inputs/outputs — is not surfaced in the type, the name, or the tutorials.

```ts
// Idiomatic use in examples and tests:
[["mutable://app/x", {}, data]]
// Real UTXO use (nowhere documented at the type):
[["ledger://acct/alice", { USD: 100 }, null]]
```

### Why it surprises
A required positional slot with an enigmatic name that 99% of callers fill with `{}` is friction. Worse, the few who *do* need it (ledger programs) have to reverse-engineer the semantics from the handful of internal programs that read it. The name `values` collides with JS's `Object.values` and offers no hint of "UTXO-style conserved quantity."

### Options
- **A.** *Rename `values` → `quantities` and expand the type docstring*: self-documenting, breaking at the name level.
- **B.** *Add a 2-arg overload/helper `output(uri, data)` that fills `quantities: {}`*: ergonomic for the common case, leaves the 3-arg tuple unchanged.
- **C.** *Both*: rename for clarity, plus helper for the empty case.

### Recommendation
**C. Rename and add a helper.** Rename the field to `quantities` and extend the docstring to explicitly describe UTXO conservation. Add an `output(uri, data)` helper that produces `[uri, {}, data]` so the common case reads clean. Field rename is a breaking change; we swallow it pre-1.0 in exchange for a decade of clearer code.

### API impact
Breaking: tuple shape is structural so this is a name-only change at the type level, but any caller using named destructuring (`const [uri, values, data] = out`) is fine, and any caller typing `Output` explicitly by field name must rename. A codemod is trivial. Helper adds a new export.

### Implementation sketch
```ts
// libs/b3nd-core/types.ts
export type Output<T = unknown> = [
  uri: string,
  /** UTXO-style conserved quantities. Programs verify sum(inputs) == sum(outputs). Use {} when unused. */
  quantities: Record<string, number>,
  data: T,
];

export function output<T>(uri: string, data: T): Output<T> {
  return [uri, {}, data];
}
// Usage: output("mutable://app/x", data)  // vs  ["mutable://app/x", {}, data]
```

---

## Out of scope

- Connection-level de-duplication for federated list reads (#5). Callers may see duplicate URIs across backends; a dedup layer is post-1.0.
- Full replacement of `ReceiveResult` with a discriminated-union error type (#4). Structured `perConnection` is enough for RC1.
- Codemods / migration tooling for the `values`→`quantities` rename (#7). A sed-level rewrite is fine pre-1.0.
- Observable-side (`observe()`) federation parity with the new `read()` federation (#5). Tracked separately.
- Revisiting the `MessageData.auth` wire format (#2). This RFC moves the field; the format itself is deferred.

## Sequencing

Suggested implementation order for follow-up PRs. Each issue lands in its own PR; later issues assume earlier landings.

1. **#7** (`Output.values` → `quantities` + helper) — pure rename + additive helper, no behavioral change. Land first; unblocks clean diffs in later PRs.
2. **#2** (split `Rig.send` vs `AuthenticatedRig.send`) — foundational layering change; must precede #1 so programs run at the right layer.
3. **#1** (programs fire on `send()`) — builds on #2; programs run inside `AuthenticatedRig.send()`.
4. **#3** (Rig-level envelope decomposition) — depends on #1/#2 since decomposed outputs should be re-dispatched through the authenticated path where applicable.
5. **#4** (per-connection `ReceiveResult` + policy) — independent of 1-3 but touches the same dispatch code; land after #3 to avoid merge conflict.
6. **#5** (list-read federation) — independent; can land in parallel with #4.
7. **#6** (`readEncryptedMany` tagged results) — smallest surface; land last as a polish PR.
