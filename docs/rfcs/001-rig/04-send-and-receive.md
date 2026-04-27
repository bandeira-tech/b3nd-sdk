# 4. Send and receive — direction is observability

`send` and `receive` are the two methods most callers will ever touch.
They're also the easiest to misunderstand. The proposal is to make them
mean exactly one thing each, and to make the difference between them
purely observational.

## The current code's mistake

Today, `rig.receive()` runs the program pipeline and `rig.send()` does not.
That asymmetry was the surprise that started this whole RFC. A protocol
author writes a balance-conservation program, registers it on
`mutable://accounts`, watches it reject malformed receives in tests, ships
to production, and discovers that `session.send()` — the path real users
actually take — has been silently bypassing the program for months.

The mistake was conflating two questions:

1. **Where did this tuple originate?** From the host application, or from a
   peer?
2. **Should this tuple be validated?**

Today the code answers both with the same flag. `receive` means "from
elsewhere, validate" and `send` means "from here, don't validate." That's
two policies forced into one switch. The proposal separates them.

## The proposal

`send` and `receive` are direction labels. They both run the same pipeline
— the `process → handle → react` triple from the previous chapter. The
only difference is which hooks fire and which events emit.

```ts
class Rig {
  async send(outs: Output[]): Promise<ReceiveResult[]> {
    return this._pipeline(outs, "send");
  }

  async receive(outs: Output[]): Promise<ReceiveResult[]> {
    return this._pipeline(outs, "receive");
  }

  private async _pipeline(
    outs: Output[],
    direction: "send" | "receive",
  ): Promise<ReceiveResult[]> {
    await this._beforeHooks(direction, outs);
    const results: ReceiveResult[] = [];
    const programResults = await this.process(outs);
    for (let i = 0; i < outs.length; i++) {
      try {
        if (programResults[i].error) {
          results.push({ accepted: false, error: programResults[i].error });
          this._emit(`${direction}:error`, outs[i], programResults[i].error);
          continue;
        }
        // handle returns Output[] — what the handler wants emitted.
        const emissions = await this.handle(outs[i], programResults[i]);
        // Rig broadcasts those through connection routing (no programs).
        await this._broadcast(emissions);
        // Then reactions fire on each emission's URI; their returns
        // flow back through rig.send (full pipeline).
        await this._react(emissions);
        results.push({ accepted: true });
        this._emit(`${direction}:success`, outs[i]);
      } catch (e) {
        results.push({ accepted: false, error: String(e) });
        this._emit(`${direction}:error`, outs[i], e);
      }
    }
    await this._afterHooks(direction, outs, results);
    return results;
  }

  // Internal — see chapter 6.
  private async _broadcast(outs: Output[]): Promise<void> { /* connection routing */ }

  // Internal — see chapter 7. Each matching reaction returns Output[];
  // those go through this.send(reactionEmissions) for full classification.
  private async _react(outs: Output[]): Promise<void> { /* match patterns; rig.send returns */ }
}
```

The body is the same. The hooks and events differ.

## What direction means

`send` is the host application acting as the origin: "I produced this tuple
and I'm putting it on the wire." It corresponds to a button click, a job
running, a worker emitting state, the application's identity signing
something. Subscribers to `send:success` know the host application is
responsible for what arrived.

`receive` is the host application accepting state from elsewhere: "I got
this tuple from a peer, an inbound HTTP request, an upstream sync, an
imported file." Subscribers to `receive:success` know the host did not
originate this content.

The pipeline body doesn't care. Programs run regardless. Handlers run
regardless. Reactions fire regardless. The protocol's validation rules
apply uniformly.

The hooks let host code participate in the difference. A `beforeSend` hook
might attach an `Origin` header, encrypt with the host's identity, or
record the user gesture that triggered the action. A `beforeReceive` hook
might apply rate limiting per peer, record a sync cursor, or strip
peer-specific metadata. These are operational concerns, not validation
concerns. Validation lives in programs.

## The `auth` and signing question

A natural question: if `send` doesn't differ in policy, where does signing
happen?

It happens in `AuthenticatedRig.send`, which is a thin layer above
`Rig.send`. The flow is:

1. The application calls `authRig.send([out, out, out])`.
2. `AuthenticatedRig` builds the canonical `MessageData` envelope (or
   whatever protocol payload shape the application chose), signs it with
   the identity's key, and produces the resulting `Output[]` to actually
   put on the wire.
3. `AuthenticatedRig` calls `rig.send(theseOuts)` underneath.
4. `Rig.send` runs the pipeline. Programs see the signed tuples. Programs
   that need to verify signatures verify them. Programs that don't, don't.

`AuthenticatedRig` is signing canon. `Rig` is the pipeline. Neither knows
about the other beyond the wire-tuple shape.

Same applies to encryption: `AuthenticatedRig.sendEncrypted` produces
already-encrypted `Output[]` and hands them to `rig.send`. The Rig
dispatches them like any other tuples. Programs that want to refuse
unencrypted writes check the payload shape themselves.

## What about `rig.send` signature change?

Today: `rig.send(data: MessageData) → SendResult`. The data is a
single envelope; the return is a single result with the envelope's hash URI.

Proposed: `rig.send(outs: Output[]) → ReceiveResult[]`. Parallel to
`receive`. Multiple tuples in, multiple results out. No envelope concept,
no automatic content addressing.

This is breaking. Every existing caller of `rig.send` migrates. Most
callers will migrate via the new `AuthenticatedRig.send` (which keeps the
ergonomic `{ inputs, outputs }` API at the auth layer where it belongs).
Callers that want the old envelope-with-hash behavior call `message(data)`
to produce the envelope tuple, then `rig.send([envelope])`. The
`message()` helper exists today; it stays, just stops being implicit.

The hash URI a caller used to get from `SendResult.uri` is now derived from
the envelope tuple they constructed:

```ts
// before
const result = await rig.send({ inputs, outputs, auth });
console.log(result.uri); // "hash://sha256/..."

// after
const envelope = await message({ inputs, outputs, auth });
const [envelopeUri] = envelope;
const [result] = await rig.send([envelope]);
console.log(envelopeUri); // "hash://sha256/..."
```

Three lines instead of two. Worth it for the loss of hidden behavior.

## The hook surface

```ts
type Hooks = {
  beforeSend?:    (outs: Output[]) => Promise<void> | void;
  afterSend?:     (outs: Output[], results: ReceiveResult[]) => Promise<void> | void;
  beforeReceive?: (outs: Output[]) => Promise<void> | void;
  afterReceive?:  (outs: Output[], results: ReceiveResult[]) => Promise<void> | void;
};
```

Two pairs. No `beforeProcess`/`afterProcess` or `beforeHandle`/`afterHandle`
— observation at the pipeline-phase level is what events and reactions are
for. The hook layer is the direction-level boundary, period.

Hooks throw to abort. A `beforeSend` hook that throws stops the pipeline
for that batch and surfaces the error. This is intentional — hooks are
operational policy (rate limit, auth check, telemetry), and operational
policy needs to be able to refuse.

## The event surface

```
send:success      receive:success
send:error        receive:error
```

Four events, fired per-tuple. Subscribers attach to one or both directions
according to what they care about. A WebSocket replication system
subscribes to `send:success` to forward outbound tuples to peers. A
metrics dashboard subscribes to `*:error` to count failures.

That's the whole observability surface for direction. Reactions (chapter
3) handle URI-pattern observation; hooks handle direction-level interception;
events handle direction-level notification. Each role has one mechanism.

## What changed in this chapter

- `rig.send(outs: Output[])` and `rig.receive(outs: Output[])` are the two
  direction-flavored entry points to the pipeline. Same body.
- The asymmetry where programs only fire on `receive` is fixed by running
  the pipeline uniformly.
- `rig.send`'s old envelope-and-hash-URI return goes away; envelope
  construction moves to `message()` (helper) or `AuthenticatedRig.send`
  (signing canon).
- The hook surface stays at the direction level: `beforeSend`/`afterSend`,
  `beforeReceive`/`afterReceive`. No process/handle hooks.
- Events at the direction level: `send:success|error`,
  `receive:success|error`. Pattern-matched observation lives in reactions.

## What's coming next

Part III opens with handlers — what they're for, why they own the
"interpretation" role, and why their `broadcast` argument is the only
fan-out mechanism in the whole framework.
