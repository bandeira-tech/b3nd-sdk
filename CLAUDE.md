# B3nd SDK — Agent Instructions

## Before Pushing

A git pre-push hook runs `deno check` on entry points and test files.
If it fails, fix the type errors before pushing.

You can run the same checks manually:

```bash
deno check src/mod.ts libs/*/mod.ts
```

## Protocol Philosophy

URIs express **behavior** (mutable/immutable, open/accounts), NOT meaning.
Higher-level features are workflows + data structures on canonical programs.

- DO use `mutable://accounts`, `immutable://inbox`, `blob://open`, etc.
- DO NOT invent new `protocol://hostname` programs for app features.

## Architecture

- Deno monorepo: `libs/` (packages), `apps/` (services), `tests/` (E2E)
- Workspace config in root `deno.json`
- SDK exports from `src/mod.ts`, re-exports from `libs/`
- Web rig: `apps/b3nd-web-rig/` (React + Vite + Tailwind)
- Inspector: `apps/sdk-inspector/` (Hono server, writes test data to B3nd)
- Dashboard reads from B3nd via active backend URL (no WebSocket)
