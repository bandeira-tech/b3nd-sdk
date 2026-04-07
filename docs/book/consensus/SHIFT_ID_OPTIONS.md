# Shift ID: Design Options

> The shift ID is a session-scoped work identity. It proves a worker saw recent
> network state, binds their work to a temporal window, and prevents
> replay/spam. This document evaluates concrete options.

## Requirements

A shift ID must:

1. **Prove authorship** — only the holder of `workerKey` can produce it
2. **Prove recency** — references a recent block, so work can't be pre-computed
   on stale state
3. **Be non-replayable** — can't reuse someone else's shift ID
4. **Be verifiable in a `ValidationFn`** — decomposable and checkable using only
   `read()` and crypto primitives available in Deno/browser
5. **Tolerate network lag** — a node 10 blocks behind can still produce a valid
   shift
6. **Be cheap to produce** — retail hardware, poor infrastructure,
   battery-powered devices

Non-requirements (deferred to stake/authorization):

- Sybil resistance (shift ID proves identity, not authorization — authorization
  is checked separately via roster/stake reads)
- Role encoding (determined by which URI the worker writes to, not by the shift
  ID itself)

---

## Option A: Signed Block Reference

```
shiftID = sign(workerPrivKey, blockHash)
```

**Structure:** The shift ID is an Ed25519 signature over a recent block's
content hash.

**Verification:**

```typescript
// Extract from URI: .../{shiftID}/...
// The worker pubkey is also in the URI path

// 1. The shiftID is a signature — verify it was signed by workerKey
//    But over WHICH blockHash? The validator doesn't know.
```

**Problem:** The validator can't verify the signature without knowing which
block hash was signed. The shift ID doesn't carry the block reference — it IS
the signature, so the block number is lost.

**Fix:** Encode the block number alongside:

```
shiftID = blockNumber + "_" + sign(workerPrivKey, blockHash)
```

Now the validator can:

1. Extract `blockNumber` from the shift ID
2. Read `immutable://consensus/{era}/{blockNumber}/` to get the block hash
3. Verify the signature over that block hash
4. Check `currentBlock - blockNumber < SHIFT_TTL_BLOCKS`

**Pros:**

- Simple — one signature, one block reference
- Cheap — no proof-of-work, just a sign operation
- Deterministic — same worker + same block = same shift ID (idempotent)

**Cons:**

- Deterministic is a double-edged sword: a worker produces exactly one shift per
  block. If they need multiple shifts (e.g., for different pending items), they
  reuse the same shift ID. Is that a problem?
- No spam cost — producing a shift is free (just a signature). Sybil resistance
  must come entirely from the authorization layer (roster/stake)
- The shift ID is long (64-byte signature + block number)

---

## Option B: Signed Block + Nonce (Proof-of-Work Lite)

```
shiftID = blockNumber + "_" + nonce + "_" + sign(workerPrivKey, blockHash + nonce)
```

**Verification:**

```typescript
const [blockNum, nonce, signature] = parseShiftID(shiftID);
const blockHash = await readBlockHash(blockNum);
const payload = blockHash + nonce;

// 1. Verify signature
assert(await verify(workerKey, signature, payload));

// 2. Check difficulty: hash(signature) must have N leading zeros
const sigHash = await sha256(signature);
assert(sigHash.startsWith("0".repeat(DIFFICULTY)));

// 3. Check staleness
assert(currentBlock - blockNum < SHIFT_TTL_BLOCKS);
```

**Pros:**

- Spam cost — finding a valid nonce takes work (tunable via DIFFICULTY)
- Each nonce produces a unique shift ID — worker can have multiple shifts per
  block
- Proves the worker actually computed something, not just signed

**Cons:**

- Proof-of-work is philosophically questionable — burns energy, favors powerful
  hardware, hurts the warzone/retail goal
- Difficulty tuning is a governance problem — too easy = spam, too hard =
  exclusion
- More complex to implement and verify
- Nonce search time is unpredictable — a node might get unlucky

---

## Option C: Signed Block + Counter

```
shiftID = blockNumber + "_" + counter + "_" + sign(workerPrivKey, blockHash + counter)
```

Where `counter` is a sequential integer (0, 1, 2, ...) per worker per block.

**Verification:**

```typescript
const [blockNum, counter, signature] = parseShiftID(shiftID);
const blockHash = await readBlockHash(blockNum);

// 1. Verify signature
assert(await verify(workerKey, signature, blockHash + counter));

// 2. Check staleness
assert(currentBlock - blockNum < SHIFT_TTL_BLOCKS);

// 3. Check counter hasn't been used before
const existing = await read(
  `immutable://shift/${workerKey}/${blockNum}/${counter}`,
);
assert(!existing.success); // write-once — prevents reuse
```

**Pros:**

- Deterministic — no randomness, no proof-of-work
- Cheap — one signature per shift
- Multiple shifts per block — increment counter
- Write-once shift registration prevents reuse

**Cons:**

- Requires a `immutable://shift/` registry to track used counters — more state
- Counter doesn't add spam cost — producing shifts is still free (delegation to
  stake/roster for anti-spam)
- Validators need to read shift registry — adds a read dependency

---

## Option D: Hash of Signed Block (Short ID)

```
shiftID = blockNumber + "_" + sha256(sign(workerPrivKey, blockHash + salt))
```

The shift ID is a hash of the signature, not the signature itself. The full
signature is stored separately.

**Verification:** The worker writes the full proof to a known URI:

```
immutable://shift/{workerKey}/{shiftID} → {
  blockNumber,
  signature: sign(workerPrivKey, blockHash + salt),
  salt
}
```

Wait — this puts JSON in the value. Let's fix that with URI-first design:

```
immutable://shift/{workerKey}/{blockNumber}/{salt} → signature
```

The shift ID becomes: `sha256(workerKey + blockNumber + salt + signature)` — a
short, unique, verifiable identifier. The validator reconstructs by reading the
shift URI.

**Pros:**

- Short — 32-byte hex hash instead of 64-byte signature + metadata
- Clean separation — shift ID is a handle, proof is at its own URI
- The shift proof URI (`immutable://shift/{worker}/{block}/{salt} → signature`)
  follows B3nd conventions perfectly

**Cons:**

- Two-step verification — validator reads the shift URI to get the proof, then
  verifies
- Requires the shift proof to be written before any work references it —
  ordering dependency
- More complex than Options A/C

---

## Option E: No Shift ID — Use Message Auth Directly

What if there's no separate shift ID at all? The worker's message auth field
already proves authorship:

```typescript
hash://sha256/{msgHash} → {
  auth: [{ pubkey: workerKey, signature: "..." }],
  payload: {
    inputs: ["immutable://consensus/{era}/{block}/..."],  // references recent block
    outputs: [
      ["immutable://attestation/{contentHash}/{workerKey}", true]
    ]
  }
}
```

The "shift" is implicit: the message references a recent block as input. The
validator checks:

1. Message auth proves worker identity (standard auth check)
2. Message inputs include a recent block reference (staleness check)
3. Worker is on the roster (authorization check)

**Verification:**

```typescript
// In attestationValidator:
const workerKey = extractSegment(uri, 2); // attestation/{content}/{worker}

// Auth: message must be signed by worker
assert(message.auth[0]?.pubkey === workerKey);

// Recency: message must reference a recent block as input
const blockInputs = message.payload.inputs.filter((i) =>
  i.startsWith("immutable://consensus/")
);
assert(blockInputs.length > 0);
const blockNum = extractBlockNumber(blockInputs[0]);
assert(currentBlock - blockNum < SHIFT_TTL_BLOCKS);

// Authorization: worker on roster
const roster = await read(`mutable://roster/validator/${workerKey}`);
assert(roster.success);
```

**Pros:**

- No new concept — uses existing B3nd primitives (auth, inputs, reads)
- No shift registration — no extra state
- Simple — validator checks auth + input recency + roster membership
- The message IS the proof — nothing to decompose or reconstruct
- Cheapest option — no extra signatures, no nonces, no counters

**Cons:**

- No reusable session identity — each message proves itself independently. No
  way to say "this batch of work is from the same shift"
- "Current block" problem remains — `currentBlock` is needed for staleness, but
  who defines it?
- Shift-based reward claiming becomes harder — rewards would go to the worker
  directly, not to an ephemeral shift session

---

## Comparison

| Property                 |   A (signed block)   |       B (+ nonce PoW)       |    C (+ counter)    | D (hash, proof at URI) | E (no shift, auth only) |
| ------------------------ | :------------------: | :-------------------------: | :-----------------: | :--------------------: | :---------------------: |
| Spam cost                |         none         |         tunable PoW         |        none         |          none          |          none           |
| Multiple shifts/block    |          no          |             yes             |         yes         |          yes           |           n/a           |
| Verifiable in validator  | yes (with block ref) |             yes             | yes (with registry) |  yes (with proof URI)  |           yes           |
| Extra state needed       |         none         |            none             |   shift registry    |    shift proof URIs    |          none           |
| Complexity               |         low          |            high             |       medium        |         medium         |         lowest          |
| Short ID                 | no (sig + blocknum)  | no (sig + nonce + blocknum) |         no          |   yes (32-byte hash)   |           n/a           |
| Retail-hardware friendly |         yes          |    depends on difficulty    |         yes         |          yes           |           yes           |
| Warzone friendly         |         yes          |       no (PoW timing)       |         yes         |          yes           |           yes           |

---

## Recommendation

**Option E first, Option D if sessions matter.**

Option E eliminates the shift ID concept entirely for the first implementation.
Auth + input recency + roster membership gives you everything you need: identity
proof, temporal binding, and authorization. It uses only existing B3nd
primitives — no new concepts, no extra state, no framework changes.

The "current block" problem doesn't go away, but it becomes simpler: the
validator checks "does this message reference a block that exists?" via
`read()`, not "what is the current block number?" The staleness window becomes:
"the referenced block must be within N blocks of the latest block this node has
seen" — and "latest block this node has seen" is just
`list("immutable://consensus/{era}/")` sorted descending.

If session-scoped work identity turns out to matter (for reward batching,
shift-based scheduling, or work deduplication), Option D adds it cleanly: the
worker registers a shift proof at
`immutable://shift/{worker}/{block}/{salt} → signature`, and references that
shift URI in subsequent work messages as an input. The shift ID is the hash of
that URI's components — short, verifiable, and stored in the URI namespace.

Option B (proof-of-work) should be avoided. It contradicts the accessibility
goals, and spam resistance is better handled by stake/roster authorization —
which the design already requires anyway.
