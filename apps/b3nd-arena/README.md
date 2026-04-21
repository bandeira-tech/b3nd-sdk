# B3nd Arena

A sample **b3nd protocol + game** for high-frequency multiplayer backends on a
private network. Seven programs cover rooms, players, 20Hz position ticks,
shots, chat, scores, and kill feed. A small browser client drives them from a
2D arena shooter.

This is a worked example of how to use b3nd as a game backend — the protocol
itself is ~250 lines, the server is ~100, and the browser client speaks the
raw HTTP API so nothing needs bundling.

```
apps/b3nd-arena/
├── schema.ts            gaming protocol (seven programs)
├── schema.test.ts       validator tests
├── server.ts            private-network node + static game server
├── deno.json            tasks + workspace imports
└── static/
    ├── index.html       game UI
    ├── b3nd.js          thin b3nd client (fetch + EventSource)
    └── game.js          game logic (WASD + mouse arena shooter)
```

## Quick start

```bash
# Run the private-network node and the game on the same port.
deno task --config apps/b3nd-arena/deno.json start

# …or, from inside the arena folder:
cd apps/b3nd-arena
deno task start       # listens on http://0.0.0.0:9942

# Open the game in two browser windows or two different machines on the LAN:
open http://localhost:9942/
open http://localhost:9942/?room=alpha
```

Each browser tab generates its own pubkey, joins the arena, and shows up as a
coloured circle. WASD to move, mouse to aim, left-click to shoot, <kbd>Enter</kbd>
to chat.

### On a LAN

Run the server on one host, point browsers on other machines at its IP:

```bash
HOST=0.0.0.0 PORT=9942 deno task start
# other machines:
open http://192.168.1.23:9942/?room=alpha
```

### Swap the backend

The server uses `MemoryStore` by default — match restarts wipe state. To
persist matches, replace the store in `server.ts`:

```ts
import { PostgresStore } from "@bandeira-tech/b3nd-sdk";
const client = new MessageDataClient(new PostgresStore("arena", executor));
```

Or compose backends (memory cache + postgres durability) using
`parallelBroadcast` / `firstMatchSequence`. The schema stays the same.

## The protocol

Seven programs, each keyed by `scheme://hostname` per b3nd conventions:

| Program           | URI template                                          | Rate        |
|-------------------|-------------------------------------------------------|-------------|
| `room://arena`    | `room://arena/{roomId}/config`                        | rare        |
| `player://arena`  | `player://arena/{roomId}/{pubkey}`                    | on join/leave |
| `tick://arena`    | `tick://arena/{roomId}/{pubkey}/{seq}`                | **20 Hz**   |
| `shot://arena`    | `shot://arena/{roomId}/{pubkey}/{shotId}`             | on fire     |
| `chat://arena`    | `chat://arena/{roomId}/{msgId}`                       | on send     |
| `score://arena`   | `score://arena/{roomId}/{pubkey}`                     | on change   |
| `kill://arena`    | `kill://arena/{roomId}/{killId}`                      | on death    |

### Hot-path design

`tick://` and `shot://` are the hot paths — they flow at `N_players × 20Hz`
(position updates) plus whatever the trigger finger can do (shots). Their
validators are deliberately **O(1)**:

* No cross-program `read()` calls — positions don't need to consult state.
* No signature verification — on a private LAN the transport is trusted.
* Tight payload caps (`tickDataMaxBytes = 160`) so clients can't saturate
  the pipe with a bloated frame.
* Short field names (`p`, `r`, `t`, `hp`, `o`, `d`, `w`) — every byte on
  every frame.
* Owner pubkey sits in the URI path — filtering and ordering become pure
  string work.

If a public deployment needs authenticity, the same URIs accept
`authValidation()` from `@bandeira-tech/b3nd-sdk/auth` as an overlay. The
message shape doesn't change.

### Observing the hot paths

SSE is already wired by the rig's HTTP API. The browser subscribes to each
program's room prefix:

```js
const es = new EventSource("/api/v1/observe/tick/arena/alpha");
es.addEventListener("write", (e) => {
  const { uri, data } = JSON.parse(e.data);   // tick://arena/alpha/{pk}/{seq}, { t, p, r, hp }
});
```

A subscriber attaches once per prefix and the server fans every matching
`receive:success` event out to it, plus a backlog on connect so late joiners
see the current world state.

## Tests

```bash
cd apps/b3nd-arena
deno task test
```

Validator tests cover happy-path writes, shape rejections, boundary limits,
and an end-to-end `MessageDataClient + MemoryStore` round-trip through the
full schema.

## Reusing the schema

The schema module is a plain b3nd `Schema` export. Run it under the stock
b3nd node instead of the embedded server if you just want the network and not
the game:

```bash
BACKEND_URL=memory:// \
PORT=9942 \
CORS_ORIGIN=* \
SCHEMA_MODULE=$(pwd)/apps/b3nd-arena/schema.ts \
deno run -A apps/b3nd-node/mod.ts
```

Point any b3nd client at `http://localhost:9942` and you have a validated
arena backend — no client code from this folder required.

## Limits

The schema enforces conservative caps that work for a demo match; adjust
`LIMITS` in `schema.ts` to fit your deployment:

| Limit                 | Default | Notes                                       |
|-----------------------|---------|---------------------------------------------|
| `roomNameMax`         | 40      | characters                                  |
| `playerNameMax`       | 24      | characters                                  |
| `chatTextMax`         | 240     | characters                                  |
| `maxPlayersHardCap`   | 64      | per room                                    |
| `tickDataMaxBytes`    | 160     | JSON-serialized tick payload                |
| `shotDataMaxBytes`    | 160     | JSON-serialized shot payload                |
| `worldHalfExtent`     | 10000   | sanity bound on position coordinates        |

## Trust model

Client-authoritative — each client resolves hits against itself and posts
its own score updates on death. Appropriate for a LAN demo; wrong for
anything adversarial. Hardening in order of effort:

1. Add `authValidation()` to `player://`, `chat://`, `score://` — signatures
   prove the writer owns the pubkey under which the record lives.
2. Move hit resolution server-side by adding a `tick://`-consuming handler
   that writes authoritative `kill://` records.
3. Push to a three-party exchange pattern (see
   `skills/b3nd/DESIGN_EXCHANGE.md`) when matches start mattering.
