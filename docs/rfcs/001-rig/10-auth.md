# 10. Auth lives where your protocol says

The framework has no `auth` field. The Rig does not verify signatures.
Where authentication evidence lives in a tuple — and what counts as
acceptable evidence — is a protocol concern. The SDK ships canon
helpers, programs compose them, the framework stays out.

## Why the framework doesn't pick a location

`MessageData` puts `auth: Signature[]` on the envelope alongside
`inputs` and `outputs`. That works for `MessageData`. It is not the only
shape worth supporting.

A protocol that uses URI-namespaced ownership (`mutable://accounts/{pubkey}/...`)
might prefer to derive the expected signer from the URI itself — the
program reads the pubkey from the path, fetches the signature from the
payload, verifies. No envelope needed.

A protocol that writes signed records directly (without envelopes) might
put a `signature` field inside the payload object alongside the data.
Different shape, different program.

A protocol that uses capability tokens instead of signatures might put a
`capabilityToken` field somewhere — payload, values, header — and verify
it against an issuer registry.

A protocol that uses no authentication might omit auth entirely and rely
on transport-level trust (the connection itself authenticates the peer).

All four are legitimate. None should be privileged by the framework. The
proposal: programs read whatever auth evidence the protocol prescribes,
from wherever the protocol prescribes it. The framework hands the
program a tuple; the program does the rest.

## What the SDK ships as canon

A small set of composable recognizer helpers, each focused on one
common shape:

```ts
// SDK canon

export const verifyAuthInPayload = async (
  out: Output,
  expected: { pubkey: string },
): Promise<boolean> => {
  const payload = out[2] as { auth?: Signature[] };
  if (!payload?.auth?.length) return false;
  return verifySignatures(payload.auth, payload, expected);
};

export const verifyAuthFromUriPubkey = async (
  out: Output,
): Promise<boolean> => {
  const [uri, , payload] = out;
  const pubkey = uri.split("/")[3]; // mutable://accounts/{pubkey}/...
  const sig = (payload as { signature?: string })?.signature;
  if (!pubkey || !sig) return false;
  return verifySignature(sig, payload, pubkey);
};

export const verifyAuthInValues = async (
  out: Output,
): Promise<boolean> => {
  const [, values, payload] = out;
  const sig = (values as Record<string, unknown>).signature;
  if (typeof sig !== "string") return false;
  return verifySignature(sig, payload, /* recover pubkey somehow */ "");
};
```

Programs compose the helper that matches their convention:

```ts
const accountsProgram: Program = async (out) => {
  const ok = await verifyAuthFromUriPubkey(out);
  return ok
    ? { code: "valid" }
    : { code: "rejected", error: "signature did not verify against URI pubkey" };
};
```

The helpers are tested in isolation and reused across protocols. The
program decides which helper to invoke and what code to return for
which outcome. The framework never sees the auth.

## Why this is layering, not abdication

A reader new to the framework might worry: "if the framework doesn't
verify signatures, how do I know my writes are authenticated?" The
answer is that the framework verifies *nothing* — not signatures, not
schemas, not balances, not anything. Verification is what programs are
for. The framework runs programs deterministically against every tuple.
A protocol that doesn't install an authentication-verifying program
isn't authenticated; a protocol that does install one is.

This is the same posture as any other policy. There is no "the framework
checks balances" — programs check balances. There is no "the framework
checks rate limits" — programs (or hooks, for direction-level limits)
check rate limits. Authentication is one more policy in the same shape.

The benefit is that "what's authenticated, where, by whom, against what
key model" is fully visible by reading the protocol's program list. No
hidden framework defaults to surprise you.

## What `AuthenticatedRig.send` becomes

`AuthenticatedRig` is an SDK convenience layered above `Rig`. Its job is
to package the common case — "I have an identity, I want to sign and
send a `MessageData` envelope" — into one call:

```ts
class AuthenticatedRig {
  constructor(public identity: Identity, public rig: Rig) {}

  async send(intent: { inputs: string[]; outputs: Output[] }) {
    const auth = await this.identity.sign(intent);
    const envelope = await message({ ...intent, auth: [auth] });
    return this.rig.send([envelope]);
  }

  async sendEncrypted(...) { /* ... */ }
}
```

The `AuthenticatedRig` wraps an Identity and a Rig and produces signed
envelope tuples that the Rig can dispatch. It puts auth in
`payload.auth` (the `MessageData` convention) because that's what the
canonical `messageDataProgram` expects.

A protocol that uses a *different* auth shape uses a different
authenticated wrapper. The SDK can ship a few — `AuthenticatedRig`,
`UriPubkeyAuthRig`, `CapabilityTokenAuthRig` — or protocols can roll
their own.

The Rig itself remains identity-blind. It dispatches whatever tuples
it's given. Whether those tuples carry auth and where the auth lives is
the wrapper's choice and the program's verification.

## What this fixes from the original report

The original report flagged "rig.send is identity-blind" as a surprise.
After the changes in this RFC, it remains identity-blind — and
deliberately so. What changes is that the surprise dissolves. The Rig
isn't pretending to be authenticated. The pipeline runs uniformly, and
the protocol's program is what enforces auth, not a hidden gate inside
`send`.

A protocol author who wants `rig.send` to refuse unauthenticated tuples
installs a program that classifies them as `"rejected"` with a "missing
auth" error. The pipeline rejects, the caller sees a clear error, the
gate is visible in the program registry. The footgun goes away because
the location of the policy is no longer ambiguous.

## What changed in this chapter

- The framework has no `auth` field and verifies nothing.
- Auth lives in the URL, the values, or the payload — wherever the
  protocol prescribes.
- The SDK ships canon recognizer helpers (`verifyAuthInPayload`,
  `verifyAuthFromUriPubkey`, etc.). Programs compose the helper that
  matches their convention.
- `AuthenticatedRig` is an SDK-canon convenience wrapper that signs and
  produces `MessageData` envelopes. Protocols that want different auth
  shapes ship their own wrappers.
- The "rig.send is identity-blind" surprise dissolves: the Rig is
  honestly identity-blind, and policy lives visibly in programs.

## What's coming next

Part V — walkthroughs. Two end-to-end examples. The first is a UTXO
ledger: balances, conservation, signatures, deletion of consumed inputs.
The second is a multi-channel ad fan-out: one envelope, three publishers,
demonstrating connection routing without the framework knowing anything
about ad campaigns.
