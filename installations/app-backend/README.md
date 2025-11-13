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
- `APP_PORT` (default 3003)
- `DATA_NODE_URL` (default http://localhost:8080)
- `SERVER_IDENTITY_PRIVATE_KEY_PEM` / `SERVER_IDENTITY_PUBLIC_KEY_HEX`
- `SERVER_ENCRYPTION_PRIVATE_KEY_PEM` / `SERVER_ENCRYPTION_PUBLIC_KEY_HEX`

Storage (b3nd)
- App configs are stored encrypted at `mutable://accounts/{serverPublicKey}/apps/{appKey}`.

