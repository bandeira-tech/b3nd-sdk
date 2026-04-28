# 10. Auth lives where your protocol says

The framework has no `auth` field. The Rig does not verify
signatures. Where authentication evidence lives in a tuple — and what
counts as acceptable evidence — is a protocol concern. The SDK ships
canon helpers, programs compose them, the framework stays out.

## Why the framework doesn't pick a location

`MessageData` puts `auth: Signature[]` on the envelope alongside
`inputs` and `outputs`. That works for `MessageData`. It is not the
only shape worth supporting.

A protocol that uses URI-namespaced ownership
(`mutable://accounts/{pubkey}/...`) might prefer to derive the
expected signer from the URI itself — the program reads the pubkey
from the path, fetches the signature from the payload, verifies. No
envelope needed.

A protocol that writes signed records directly (without envelopes)
might put a `signature` field inside the payload object alongside the
data. Different shape, different program.

A protocol that uses capability tokens instead of signatures might
put a `capabilityToken` field somewhere — inside the payload, in a
header field of the payload, or encoded in the URI — and verify it
against an issuer registry.

A protocol that uses no authentication might omit auth entirely and
rely on transport-level trust (the connection itself authenticates
the peer).

All four are legitimate. None should be privileged by the framework.
Programs read whatever auth evidence the protocol prescribes, from
wherever the protocol prescribes it. The framework hands the program
a tuple; the program does the rest.

## What the SDK ships as canon

A small set of composable recognizer helpers, each focused on one
common shape:

```ts
// SDK canon

export const verifyAuthInPayload = async (
  out: Output,
  expected: { pubkey: string },
): Promise<boolean> => {
  const [, payload] = out;
  const env = payload as { auth?: Signature[] };
  if (!env?.auth?.length) return false;
  return verifySignatures(env.auth, env, expected);
};

export const verifyAuthFromUriPubkey = async (
  out: Output,
): Promise<boolean> => {
  const [uri, payload] = out;
  const pubkey = uri.split("/")[3]; // mutable://accounts/{pubkey}/...
  const sig = (payload as { signature?: string })?.signature;
  if (!pubkey || !sig) return false;
  return verifySignature(sig, payload, pubkey);
};

export const verifyAuthByCapabilityToken = async (
  out: Output,
  registry: TokenRegistry,
): Promise<boolean> => {
  const [, payload] = out;
  const token = (payload as { capability?: string })?.capability;
  if (!token) return false;
  return registry.isValid(token);
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
schemas, not balances, not anything. Verification is what programs
are for. The framework runs programs deterministically against every
tuple. A protocol that doesn't install an authentication-verifying
program isn't authenticated; a protocol that does install one is.

This is the same posture as any other policy. There is no "the
framework checks balances" — programs check balances. There is no
"the framework checks rate limits" — programs (or hooks, for
direction-level limits) check rate limits. Authentication is one
more policy in the same shape.

The benefit is that "what's authenticated, where, by whom, against
what key model" is fully visible by reading the protocol's program
list. No hidden framework defaults to surprise you.

## The canonical signing pattern

Signing canon is two SDK pieces — `Identity` (key management) and
`message` (envelope construction):

```ts
import { Identity, message } from "@bandeira-tech/b3nd-sdk";

const id = await Identity.fromSeed("my-secret");

const outputs: Output[] = [
  ["mutable://app/users/alice", { name: "Alice" }],
];

const auth = [await id.sign({ inputs: [], outputs })];
const envelope = await message({ auth, inputs: [], outputs });

await rig.send([envelope]);
```

The application owns the signing step explicitly: `id.sign(...)` to
produce the signature, `message(...)` to build the canonical
envelope, `rig.send([envelope])` to dispatch. The Rig sees one
envelope tuple. `messageDataProgram` classifies it.
`messageDataHandler` decomposes it. Programs registered on the
output URIs (or programs the application installed to verify
`payload.auth`) run during decomposition or after.

A protocol that uses a different auth shape skips the envelope step
entirely. URI-pubkey protocols sign the payload and inline the
signature; capability-token protocols inline the token; transport-
trust protocols sign nothing. The Rig dispatches whatever tuples it
is given. Whether those tuples carry auth and where the auth lives is
the application's choice and the program's verification.

## The Rig is identity-blind

The Rig has no signer, no key, no concept of "trusted caller." It
takes `Output[]` and dispatches. A protocol author who wants
`rig.send` to refuse unauthenticated tuples installs a program that
classifies them as `"rejected"` with a "missing auth" error. The
pipeline rejects, the caller sees a clear error, the gate is visible
in the program registry.

## What's coming next

Part V — walkthroughs. Two end-to-end examples. The first is a UTXO
ledger: balances, conservation, signatures, deletion of consumed
inputs. The second is a multi-channel ad fan-out: one envelope, three
publishers, demonstrating connection routing without the framework
knowing anything about ad campaigns.
