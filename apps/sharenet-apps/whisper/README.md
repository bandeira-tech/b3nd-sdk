# whisper

End-to-end encrypted chat on the sharenet protocol. Exercises the
encryption + shared-feed + replication paths.

- Profiles at `mutable://sharenet/whisper/shared/{pubkey}/profile`
  publish each user's X25519 encryption key.
- Messages at `mutable://sharenet/whisper/shared/{sender}/inbox/{recipient-enc-pubkey}/{msgId}`
  are encrypted with X25519 + AES-GCM for the recipient.
- Envelopes are still Ed25519-signed by the sender — the schema rejects
  spoofed writes.

## Try it

```bash
# Alice
export USER_SEED=alice
deno task cli profile "Alice"

# Bob
export USER_SEED=bob
deno task cli profile "Bob"

# Alice looks up Bob's profile and sends a DM
export USER_SEED=alice
deno task cli lookup <bob-pubkey>
deno task cli send <bob-pubkey> "hi there"

# Bob reads
export USER_SEED=bob
deno task cli inbox
```
