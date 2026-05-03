# 10. Auth lives where your protocol says

Authentication is a protocol policy, expressed by programs. Where
the auth evidence lives in a tuple — payload field, URI segment,
capability token, or none at all — is the protocol's choice. The
SDK ships canon recognizers; programs compose them.

## The four common shapes

| Shape | Where the evidence lives | Recognizer |
|---|---|---|
| Envelope-style (`MessageData`) | `payload.auth: Signature[]` | `verifyAuthInPayload(out, { pubkey })` |
| URI-namespaced ownership | Pubkey encoded in URI; signature in payload | `verifyAuthFromUriPubkey(out)` |
| Capability token | A token field in the payload | `verifyAuthByCapabilityToken(out, registry)` |
| Transport-trust | The connection authenticates the peer | (no recognizer; trust the link) |

Each is one line in a program.

## Composing in a program

A program calls the recognizer that matches the protocol's
convention and returns a code:

```ts
import { verifyAuthFromUriPubkey } from "@bandeira-tech/b3nd-sdk";

const accountsProgram: Program = async (out) => {
  const ok = await verifyAuthFromUriPubkey(out);
  return ok
    ? { code: "valid" }
    : { code: "rejected", error: "signature did not verify against URI pubkey" };
};

const rig = new Rig({
  routes: { ... },
  programs: { "mutable://accounts": accountsProgram },
});
```

A protocol can chain multiple recognizers — say, require a valid
signature *and* an unexpired capability token — by calling each in
sequence and returning early on the first failure.

## The signing flow (caller side)

Two SDK pieces produce signed envelope tuples: `Identity` (key
management) and `message` (envelope construction):

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

`id.sign(intent)` returns `{ pubkey, signature }`. `message(data)`
builds the content-addressed envelope at `hash://sha256/{computed}`.
`rig.send([envelope])` runs the pipeline: with `messageDataProgram`
+ `messageDataHandler` registered (Ch 8), the handler decomposes
the envelope into its outputs.

For URI-pubkey or capability-token shapes, skip the envelope and
inline auth in the payload directly:

```ts
// URI-pubkey shape — pubkey in the URI, signature in the payload
const data = { profile, signature: await id.sign(profile) };
await rig.send([
  [`mutable://accounts/${id.pubkey}/profile`, data],
]);
```

## The rig is identity-blind

The rig dispatches whatever tuples it's given. A protocol that
wants `rig.send` to refuse unauthenticated tuples installs a
program that classifies them as `"rejected"`. The pipeline rejects,
the caller sees a clear error, the gate is visible in the program
registry — not buried in a framework default.

## What's coming next

Part V — walkthroughs. A UTXO ledger end-to-end (balances,
conservation, signatures, input deletion), then a multi-channel ad
fan-out (one envelope, three publishers via connection routing).
