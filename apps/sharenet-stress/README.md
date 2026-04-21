# sharenet-stress

End-to-end stress harness for the sharenet protocol. Boots an in-process
rig with two replicated backends, registers the three sample apps, and
drives them concurrently:

- **listify** — many small signed writes (lists + items)
- **inkwell** — `hash://` blobs + signed `link://` pointers + shared feed
- **whisper** — X25519 encrypted messages across a ring of users

The harness asserts:

- every signed envelope was accepted by the schema;
- each user sees the right number of their own lists;
- the app-wide feed contains every publisher's posts;
- each recipient decrypts exactly the messages addressed to them;
- `app://registry` entries exist on *both* backends (replication).

## Run

```bash
deno task run
```

Knobs (env vars):

| Variable          | Default | What it controls                      |
| ----------------- | ------- | ------------------------------------- |
| `USERS`           | `4`     | Number of signing identities          |
| `LISTS_PER_USER`  | `2`     | listify lists per user                |
| `ITEMS_PER_LIST`  | `5`     | listify items per list                |
| `POSTS_PER_USER`  | `3`     | inkwell posts per author              |
| `CHATS_PER_PAIR`  | `4`     | whisper DMs per sender→receiver pair  |
