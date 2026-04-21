# listify

A per-user list/todo app on the sharenet protocol. Demonstrates the
"lots of small signed writes" path — every item toggle is a new signed
envelope that replicates across every configured backend.

Each user stores:

    mutable://sharenet/listify/users/{pubkey}/lists/_index       → { lists: [...] }
    mutable://sharenet/listify/users/{pubkey}/lists/{listId}     → TodoList

## Try it

Start the node (see `apps/sharenet-node/README.md`), register the app,
then drive it from the CLI:

```bash
export SHARENET_NODE_URL=http://localhost:9942
deno task cli create "groceries"
deno task cli add <listId> "buy milk"
deno task cli ls
```
