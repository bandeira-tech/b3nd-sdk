# B3nd Monorepo — Agent Reference

## Completion Protocol
Every session that changes code: `deno check src/mod.ts libs/*/mod.ts` → commit → push.
Pre-push hook blocks on type-check failure. Never leave uncommitted work.

## Key Commands
- `make dev` — full env (postgres + node :9942 + rig :5555 + inspector :5556)
- `make test` / `make test t=<path>` — run tests (`make test-unit` for no-db)
- `deno check src/mod.ts libs/*/mod.ts` — type-check all entry points

## Structure
Deno monorepo: `libs/` (SDK modules), `apps/` (deployables), `skills/` (agent knowledge).
SDK entry: `src/mod.ts` (JSR), `src/mod.web.ts` (NPM). Packages: `@bandeira-tech/b3nd-sdk` (JSR), `@bandeira-tech/b3nd-web` (NPM).

## Code Principles
1. Composition over inheritance — `createValidatedClient({ write, read, validate })`
2. No ENV in components — explicit parameters, no default values
3. Errors bubble up — never suppress. Let callers handle.
4. Client-level responsibility — clients handle MessageData unpacking
5. Minimize abstractions — use JS knowledge, stay fresh on deps

## Skills
Read `skills/b3nd/` for SDK API, Firecat patterns, protocol design, node operations, and cookbooks.
After any SDK change, update the relevant skill file so agents use correct imports.
