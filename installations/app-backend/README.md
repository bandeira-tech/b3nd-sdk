## App Backend Installation

A minimal backend that lets app owners register an app (origins, actions, and keys) and exposes a public API for frontends to invoke actions. Each action validates the payload and writes to a configured b3nd backend path, signing as the app account and optionally encrypting.

Endpoints
- `GET  /api/v1/health`
- `POST /api/v1/apps/register` — Register app config: origins, actions, and keys
- `POST /api/v1/apps/:appKey/schema` — Update actions schema
- `POST /api/v1/app/:appKey/:action` — Invoke action with payload

Action Schema (simplified)
```json
[
  {
    "action": "registerForReceiveUpdates",
    "validation": { "stringValue": { "format": "email" } },
    "write": {
      "encrypted": "immutable://accounts/:key/subscribers/updates/:signature"
    }
  }
]
```

Notes
- `:key` is replaced by the app's account public key.
- `:signature` is a deterministic hash of the payload string.
- If `write.encrypted` is provided, payload is signed with the app account key and encrypted to the app's encryption public key.
- Otherwise, the payload is signed only and written in clear.

Configuration (env)
- `PORT` (default 8844)
- `DATA_NODE_URL` (default http://localhost:8842)
- `SERVER_IDENTITY_PRIVATE_KEY_PEM` / `SERVER_IDENTITY_PUBLIC_KEY_HEX`
- `SERVER_ENCRYPTION_PRIVATE_KEY_PEM` / `SERVER_ENCRYPTION_PUBLIC_KEY_HEX`

Storage (b3nd)
- App configs are stored encrypted at `mutable://accounts/{serverPublicKey}/apps/{appKey}`.

## Container image

Build an OCI image:
```bash
cd installations/app-backend
docker build -t b3nd-app-backend -f Dockerfile .
```

Run with required configuration:
```bash
docker run --rm -p 8844:8844 \
  -e PORT=8844 \
  -e DATA_NODE_URL=http://backend:8842 \
  -e WALLET_SERVER_URL=http://wallet:8843 \
  -e WALLET_API_BASE_PATH=/api/v1 \
  -e SERVER_IDENTITY_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" \
  -e SERVER_IDENTITY_PUBLIC_KEY_HEX=your_ed25519_pubkey_hex \
  -e SERVER_ENCRYPTION_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" \
  -e SERVER_ENCRYPTION_PUBLIC_KEY_HEX=your_x25519_pubkey_hex \
  b3nd-app-backend
```

Mount volumes or pass additional env vars as needed (for example, to align with your deployment’s endpoints). Per-app Google client IDs are stored in each app profile; no server-wide Google OAuth configuration is used.
