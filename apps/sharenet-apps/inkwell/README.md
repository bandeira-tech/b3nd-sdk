# inkwell

A tiny blog on the sharenet protocol. Each post is:

- An immutable body at `hash://sha256/{hex}` (content-addressed, dedup'd).
- A signed pointer at `link://sharenet/inkwell/{author}/posts/{slug}`.
- A shared-feed entry at `mutable://sharenet/inkwell/shared/{author}/feed/{slug}`.

Republishing keeps old versions available at their original hash while
advancing the link pointer — B3nd's canonical "mutable reference over
immutable content" pattern.

## Try it

```bash
export SHARENET_NODE_URL=http://localhost:9942
deno task cli publish hello "Hello world" "First post on sharenet"
deno task cli read hello
deno task cli feed
```
