# 15. Encrypted batch reads with mixed plaintext

The smallest of the operational items. The fix is essentially one
function-body change. Worth its own chapter only because it touches a
common pattern callers will hit on day one.

## The problem

`AuthenticatedRig.readEncryptedMany` takes a list of URIs and returns
their decrypted contents:

```ts
// libs/b3nd-rig/authenticated-rig.ts (current)
async readEncryptedMany<T>(uris: readonly string[]): Promise<(T | null)[]> {
  if (uris.length === 0) return [];
  return Promise.all(uris.map((uri) => this.readEncrypted<T>(uri)));
}
```

`readEncrypted` throws if the URI's stored data isn't an encrypted
envelope. `Promise.all` propagates the first rejection, so a single
non-encrypted entry in the batch aborts the entire call — even though
all the sibling URIs were perfectly readable.

This is a problem because the most common app shape is "fetch a
collection that mixes cleartext metadata with encrypted payloads under
the same prefix." A user profile might have `profile/displayName`
cleartext, `profile/email` cleartext, `profile/secrets/2fa-key`
encrypted. A single `readEncryptedMany` call against the prefix can't
work — it throws on the first cleartext URI it encounters.

The current API forces callers to pre-partition their URIs by content
shape, which they can't do without reading each one first. The batch
helper defeats its own purpose.

## The proposal

Change the return type to a tagged-result variant, so each URI's
outcome is reported independently:

```ts
type EncryptedReadOutcome<T> =
  | { kind: "decrypted"; value: T }
  | { kind: "missing" }
  | { kind: "plaintext"; value: unknown }
  | { kind: "error"; error: string };

async readEncryptedMany<T>(
  uris: readonly string[],
): Promise<EncryptedReadOutcome<T>[]> {
  if (uris.length === 0) return [];
  return Promise.all(uris.map(async (uri) => {
    try {
      const v = await this.readEncrypted<T>(uri);
      if (v === null) return { kind: "missing" as const };
      return { kind: "decrypted" as const, value: v };
    } catch (e) {
      // Distinguish "not encrypted" from "decrypt failed" by re-reading
      // the raw payload and inspecting its shape.
      const raw = await this.rig.readData(uri);
      if (raw !== null && !looksEncrypted(raw)) {
        return { kind: "plaintext" as const, value: raw };
      }
      return { kind: "error" as const, error: (e as Error).message };
    }
  }));
}
```

Four outcomes per URI:

- **`decrypted`** — the URI held an encrypted envelope and decryption
  succeeded.
- **`missing`** — the URI has no data.
- **`plaintext`** — the URI held a non-encrypted payload. The raw
  payload is returned as `value: unknown`; the caller decides what to do
  with it (display as cleartext, ignore, treat as error).
- **`error`** — the URI held an encrypted envelope but decryption
  failed (wrong key, malformed ciphertext, truncated data). The error
  message is preserved.

The caller narrows on `kind` and handles each case as it sees fit:

```ts
const outcomes = await authRig.readEncryptedMany<Secret>(profileKeys);
for (const outcome of outcomes) {
  switch (outcome.kind) {
    case "decrypted": render(outcome.value); break;
    case "plaintext": renderCleartext(outcome.value); break;
    case "missing":   /* skip */ break;
    case "error":     logDecryptError(outcome.error); break;
  }
}
```

## Why not the alternative shapes

Three alternatives were considered. None of them are wrong; the tagged
variant just covers more cases.

**Silent skip — return `null` for non-encrypted entries.** Lossy. The
caller can't distinguish "URI doesn't exist" from "URI exists but isn't
encrypted." Both look like `null`. Common apps need to render
plaintext-as-plaintext, not skip it.

**Throw a `BatchError` containing per-URI outcomes.** Idiomatically
worse than returning the outcomes — callers have to wrap in try/catch
to get at the data they came for. The batch helper exists to avoid
per-call ceremony.

**Drop the helper; let callers compose `readMany` + `decrypt`.**
Smallest API surface but pushes the boilerplate onto every caller.
Most apps end up reimplementing the same loop. Better to ship the
helper once, correctly.

## Why not also rename

The current name is `readEncryptedMany`. We considered renaming to
something like `readMaybeEncryptedMany` to advertise the new mixed
behavior. Rejected — the name describes intent (read URIs that may hold
encrypted data) and the new return type makes the mixed behavior
visible at the call site. A rename would force every caller to migrate
twice (once for the name, once for the return type). Once is enough.

## What about a `readEncryptedManyStrict`?

If demand appears for the old throw-on-any-failure semantic — an app
that genuinely wants the call to fail if any URI is non-encrypted —
ship it as a separate variant later. For 1.0, the tagged variant
covers the common cases. The strict variant is one wrapper around the
tagged variant if needed.

## API impact

Breaking. Return type changes from `(T | null)[]` to
`EncryptedReadOutcome<T>[]`. Callers must narrow on `kind`. The change
is mechanical — no caller can avoid touching the code, but every
caller's update is the same shape: replace the tuple destructure with a
switch on `kind`.

## What changed in this chapter

- `readEncryptedMany` returns a tagged variant
  (`{ kind: "decrypted" | "missing" | "plaintext" | "error", ... }[]`).
- Mixed-plaintext batches no longer throw; each URI's outcome is
  reported independently.
- The helper's name stays — `readEncryptedMany`.
- A future strict variant is a follow-up if real demand appears.

## What's coming next

Nothing — that's the whole RFC. The README's sequencing block
explains how the implementation lands: Parts I–IV as one cohesive
architectural PR, then chapters 13, 14, and 15 as small independent
PRs in any order.

If you read straight through, thanks for reading. If you jumped to a
chapter, the README is the way back.
