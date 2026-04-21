# sharenet protocol

A private, multi-tenant b3nd protocol: one shared node runs many app
backends. Operators curate an on-network app registry; every user owns a
pubkey-scoped namespace inside each app; large payloads live in the
content-addressed `hash://` store and are referenced by signed links.

## Namespace

| URI pattern                                             | Writer                  | Notes                             |
| ------------------------------------------------------- | ----------------------- | --------------------------------- |
| `app://registry/{appId}`                                | Network operator        | App manifest, signed              |
| `mutable://sharenet/{appId}/users/{pubkey}/...`         | `{pubkey}`              | Per-user private-by-default state |
| `mutable://sharenet/{appId}/shared/{pubkey}/...`        | `{pubkey}`              | App-wide feed, origin-stamped     |
| `hash://sha256/{hex}`                                   | Anyone                  | Write-once, hash-verified blobs   |
| `link://sharenet/{appId}/{pubkey}/...`                  | `{pubkey}`              | Signed pointer to a `hash://` URI |

## Using it

Operators build and mount the schema:

```typescript
import { createSchema } from "@sharenet/protocol";

const schema = createSchema({
  operators: [OPERATOR_PUBKEY],
  maxMutableBytes: 64 * 1024,
  maxBlobBytes: 2 * 1024 * 1024,
});
```

App developers register and use:

```typescript
import { Identity } from "@b3nd/rig";
import { registerApp, SharenetSession } from "@sharenet/protocol";

await registerApp(rig, operator, {
  appId: "listify",
  name: "Listify",
  ownerPubkey: owner.pubkey,
  version: 1,
});

const alice = await Identity.fromSeed("alice");
const s = new SharenetSession(rig, "listify", alice);
await s.setItem("lists/groceries", { items: ["milk"] });
```

See `apps/sharenet-apps/` for three worked examples (list management,
blog, encrypted chat) and `apps/sharenet-stress/` for an end-to-end
signing → storage → replication stress harness.
