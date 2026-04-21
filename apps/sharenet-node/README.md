# sharenet-node

Reference operator node for the [sharenet protocol](../sharenet-protocol/).
Wraps the sharenet schema into a runnable b3nd node with multi-backend
replication.

## Run

```bash
OPERATORS=<operator-pubkey-hex> \
BACKEND_URL=memory://,sqlite:///tmp/sharenet.db \
PORT=9942 \
deno task start
```

Writes broadcast to every backend in `BACKEND_URL`; reads try them in
order. To add another replica, just append a URL — no code change, no
restart of the apps.

## Env

| Variable             | Default        | Meaning                                   |
| -------------------- | -------------- | ----------------------------------------- |
| `PORT`               | `9942`         | HTTP listen port                          |
| `CORS_ORIGIN`        | `*`            | CORS allow-origin                         |
| `BACKEND_URL`        | `memory://`    | Comma-separated store URLs                |
| `OPERATORS`          | (empty)        | Comma-separated operator pubkeys (hex)    |
| `MAX_MUTABLE_BYTES`  | `65536`        | Per-write cap for `mutable://` payloads   |
| `MAX_BLOB_BYTES`     | `2097152`      | Per-write cap for `hash://` blobs         |
