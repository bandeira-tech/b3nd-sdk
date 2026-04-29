# B3nd Monorepo — Agent Reference

## Completion Protocol

Every session that changes code: `deno check src/mod.ts libs/*/mod.ts` → commit
→ push. Pre-push hook blocks on type-check failure. Never leave uncommitted
work.

## Key Commands

- `make dev` — full env (postgres + node :9942 + rig :5555 + inspector :5556)
- `deno task test` — **the command CI runs**
  (`deno test --allow-all libs/b3nd-*/`). Run this before opening any PR that
  touches the wire primitive, `libs/b3nd-msg`, `libs/b3nd-core`, or anything
  cross-cutting.
- `make test` / `make test t=<path>` — local convenience wrappers (skip
  postgres/mongo/localstorage libs).
- `make test-unit` — **fast local subset only** (`b3nd-client-memory`,
  `b3nd-wallet`, `b3nd-network`, `b3nd-managed-node`). Does NOT verify
  CI-readiness; CI will still fail on libs this skips. Never use it as your
  final pre-PR check.
- `deno check src/mod.ts libs/*/mod.ts` — type-check all entry points

## Structure

Deno monorepo: `libs/` (SDK modules), `apps/` (deployables), `skills/` (agent
knowledge). SDK entry: `src/mod.ts` (JSR), `src/mod.web.ts` (NPM). Packages:
`@bandeira-tech/b3nd-sdk` (JSR), `@bandeira-tech/b3nd-web` (NPM).

This repo is the **umbrella** — it re-exports foundation packages that live in
their own repos:

- [`bandeira-tech/b3nd-core`](https://github.com/bandeira-tech/b3nd-core) →
  `@bandeira-tech/b3nd-core` (framework foundation: types, rig, network)
- [`bandeira-tech/b3nd-canon`](https://github.com/bandeira-tech/b3nd-canon) →
  `@bandeira-tech/b3nd-canon` (protocol toolkit: msg, hash, auth, encrypt)
- [`bandeira-tech/b3nd-servers`](https://github.com/bandeira-tech/b3nd-servers)
  → `@bandeira-tech/b3nd-server-http` and `@bandeira-tech/b3nd-grpc`

When making framework-level changes, the source of truth is in the
corresponding repo — not in this monorepo's `libs/`. See `README.md` →
Ecosystem, and `skills/b3nd/SKILL.md` for the broader picture.

## Code Principles

1. Composition over inheritance —
   `createValidatedClient({ write, read, validate })`
2. No ENV in components — explicit parameters, no default values
3. Errors bubble up — never suppress. Let callers handle.
4. Client-level responsibility — clients handle MessageData unpacking
5. Minimize abstractions — use JS knowledge, stay fresh on deps

## Skills

Read `skills/b3nd/` for SDK API, protocol design, node operations, and
cookbooks. After any SDK change, update the relevant skill file so agents use
correct imports.
