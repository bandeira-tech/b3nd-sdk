# Bluetooth Transport for B3nd

B3nd is transport-agnostic. The `BluetoothClient` brings the full `NodeProtocolInterface` over Bluetooth, enabling B3nd nodes to operate without any internet infrastructure — device-to-device, over RFCOMM or BLE GATT.

## Architecture

```
┌──────────────┐                        ┌──────────────┐
│   App Layer  │                        │   App Layer  │
│  (Firecat)   │                        │  (Firecat)   │
├──────────────┤                        ├──────────────┤
│ BluetoothClient                       │ B3nd Node    │
│  (NodeProtocol                        │  (MemoryClient│
│   Interface) │                        │   /Postgres)  │
├──────────────┤    JSON over BT        ├──────────────┤
│  Transport   │ ◄────────────────────► │  Transport   │
│  (injectable)│    RFCOMM / BLE GATT   │  (listener)  │
└──────────────┘                        └──────────────┘
     Phone                                Raspberry Pi
```

The key insight: **the transport is injectable**. `BluetoothClient` doesn't know or care whether it's talking over Web Bluetooth in a browser, native RFCOMM in Deno/Node, or a mock in tests. It only needs something that implements `BluetoothTransport`.

## bluetooth:// URL Scheme

Bluetooth backends are specified with the `bluetooth://` URL scheme. All connection complexity (pairing, discovery, GATT negotiation) is **frontloaded** by `createBluetoothTransport()` before the client is instantiated.

### URL Format

```
bluetooth://<address>[:<channel>][?option=value&...]
```

### Examples

| URL | What happens |
|-----|-------------|
| `bluetooth://mock` | In-memory mock transport (testing/dev) |
| `bluetooth://AA:BB:CC:DD:EE:FF` | Connect to paired device (auto-detect transport) |
| `bluetooth://AA:BB:CC:DD:EE:FF:3` | RFCOMM channel 3 on paired device |
| `bluetooth://web` | Web Bluetooth (browser, triggers device picker) |
| `bluetooth://web?service=b3nd0001&name=MyNode` | Web Bluetooth with service/name filters |
| `bluetooth://AA:BB:CC:DD:EE:FF?transport=ble&timeout=60000` | Force BLE transport, 60s timeout |

### Query Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `timeout` | `30000` | Connection timeout in milliseconds |
| `service` | — | BLE service UUID filter (Web Bluetooth) |
| `name` | — | Device name filter (Web Bluetooth) |
| `transport` | auto | Force transport: `rfcomm`, `ble`, `web`, `mock` |

## Using bluetooth:// in B3nd Apps

### App Server Node (BACKEND_URL)

```bash
# Bluetooth backend (testing)
BACKEND_URL=bluetooth://mock PORT=9942 CORS_ORIGIN=* deno run --allow-all apps/b3nd-node/mod.ts

# Mixed: write to Postgres + replicate to Bluetooth peer
BACKEND_URL=postgresql://localhost/b3nd,bluetooth://AA:BB:CC:DD:EE:FF:3 \
  PORT=9942 CORS_ORIGIN=* deno run --allow-all apps/b3nd-node/mod.ts
```

### CLI (bnd conf node)

```bash
# Configure CLI to talk to a Bluetooth node
bnd conf node bluetooth://AA:BB:CC:DD:EE:FF:3

# Or for local testing
bnd conf node bluetooth://mock

# Then use normally — all commands go over Bluetooth
bnd write mutable://open/hello '{"msg": "from bluetooth"}'
bnd read mutable://open/hello
```

### SDK Inspector (B3ND_URL)

```bash
# Persist test results to a Bluetooth node
B3ND_URL=bluetooth://mock B3ND_URI=mutable://open/inspector \
  deno run --allow-all apps/sdk-inspector/mod.ts
```

### Managed Node Config

```json
{
  "configVersion": 1,
  "name": "edge-node",
  "backends": [
    { "type": "memory", "url": "memory://" },
    { "type": "bluetooth", "url": "bluetooth://AA:BB:CC:DD:EE:FF:3", "options": { "timeout": 60000 } }
  ]
}
```

## Transport Factory System

Real Bluetooth connections require platform-specific code (Web Bluetooth API, noble, bleno, etc). The transport factory registry lets you plug in your platform's implementation.

### Registering a Transport Factory

```typescript
import { registerBluetoothTransport } from "@bandeira-tech/b3nd-sdk";

// Register before creating clients
registerBluetoothTransport("rfcomm", async (spec) => {
  // spec.address = "AA:BB:CC:DD:EE:FF"
  // spec.channel = 3
  // spec.timeout = 30000

  const socket = await myNativeBtLib.connect(spec.address, spec.channel);
  const transport = new MyRfcommTransport(socket);
  await transport.connect();
  return transport;
});

// Now bluetooth:// URLs with MAC addresses will use your factory
const transport = await createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF:3");
```

### Built-in Factories

| Type | When Used | What It Does |
|------|-----------|-------------|
| `mock` | `bluetooth://mock` | In-memory B3nd node, always available, no real Bluetooth |

### Registering Web Bluetooth (Browser)

```typescript
import { registerBluetoothTransport } from "@bandeira-tech/b3nd-sdk";

registerBluetoothTransport("web", async (spec) => {
  const device = await navigator.bluetooth.requestDevice({
    filters: spec.serviceUuid
      ? [{ services: [spec.serviceUuid] }]
      : spec.nameFilter
        ? [{ name: spec.nameFilter }]
        : [{ services: ["b3nd0001-0000-1000-8000-00805f9b34fb"] }],
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService("b3nd0001-0000-1000-8000-00805f9b34fb");
  const char = await service.getCharacteristic("b3nd0002-0000-1000-8000-00805f9b34fb");
  await char.startNotifications();

  // Build a transport wrapping the GATT characteristic...
  const transport = new WebBluetoothGattTransport(device, char);
  return transport;
});
```

## BluetoothTransport Interface

```typescript
interface BluetoothTransport {
  connect(): Promise<void>;
  send(data: string): Promise<void>;
  onMessage(handler: (data: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onDisconnect(handler: () => void): void;
  disconnect(): Promise<void>;
  readonly connected: boolean;
}
```

This is intentionally minimal. The transport handles:
- Connection lifecycle (pair, connect, disconnect)
- Sending/receiving UTF-8 strings (the client handles JSON serialization)
- Error and disconnection events

The transport does NOT handle:
- Message framing (JSON messages are complete strings)
- Request routing (the client matches responses by ID)
- Reconnection logic (the client handles this)

## Wire Protocol

Same as the WebSocket client — JSON request/response with correlation IDs:

```typescript
// Request (client → node)
{ id: "uuid", type: "receive", payload: { tx: ["store://users/alice", { name: "Alice" }] } }

// Response (node → client)
{ id: "uuid", success: true, data: { accepted: true } }
```

All 7 operation types are supported: `receive`, `read`, `readMulti`, `list`, `delete`, `health`, `getSchema`.

## Testing

### Automated Tests

```bash
# All Bluetooth tests (client + connector + URL parsing)
deno test --allow-all libs/b3nd-client-bluetooth/

# Just the client (shared protocol suite)
deno test --allow-all libs/b3nd-client-bluetooth/bluetooth-client.test.ts

# Just the connector (URL parsing, factory registry, end-to-end)
deno test --allow-all libs/b3nd-client-bluetooth/connect.test.ts
```

### Test Coverage

**bluetooth-client.test.ts** — 35 tests:
- Full shared NodeProtocolInterface suite (CRUD, scalars, binary, pagination, batch reads)
- Validation error handling
- Connection error handling
- Transport injection, health reporting, reconnection config, cleanup

**connect.test.ts** — 12 tests:
- URL parsing (mock, web, MAC address, channels, query params, edge cases)
- Transport connector (mock round-trip, factory registration, error handling)
- End-to-end: URL string → connected transport → client → full CRUD cycle

### Mock Transports

| Transport | Behavior |
|-----------|----------|
| `MockBluetoothTransport` | Happy path — accepts all writes, stores in memory |
| `FailingBluetoothTransport` | Always fails to connect |
| `ValidationFailingBluetoothTransport` | Rejects writes missing a `name` field |

### Testing a Real Device

To test with actual Bluetooth hardware:

1. Register your transport factory (rfcomm/ble)
2. Pair the device at the OS level
3. Run with a real `bluetooth://` URL

```typescript
// In your test setup:
registerBluetoothTransport("rfcomm", myRfcommFactory);

// Then any test using bluetooth://AA:BB:CC:DD:EE:FF will hit real hardware
const transport = await createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF:3");
const client = new BluetoothClient({ transport });

// The shared test suite works with any client:
runSharedSuite("BluetoothClient (real device)", {
  happy: () => client,
});
```

## Composability

Because `BluetoothClient` implements `NodeProtocolInterface`, it composes with everything in the SDK:

```typescript
import { BluetoothClient, parallelBroadcast, HttpClient, createBluetoothTransport } from "@bandeira-tech/b3nd-sdk";

// Write to both a Bluetooth peer AND an HTTP server
const btTransport = await createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF:3");
const btClient = new BluetoothClient({ transport: btTransport });
const httpClient = new HttpClient({ url: "https://node.fire.cat" });
const combined = parallelBroadcast([btClient, httpClient]);

// Same interface — receive, read, list, etc.
await combined.receive(["store://users/alice/profile", { name: "Alice" }]);
```

## FIPS Integration Path

The `BluetoothTransport` interface is the exact seam where FIPS mesh networking plugs in. A `FipsTransport` implements the same interface, routing B3nd messages through the FIPS mesh instead of direct Bluetooth:

```typescript
registerBluetoothTransport("fips", async (spec) => {
  // spec.address = FIPS node_addr or fd00::/8 IPv6
  const fipsMesh = await connectToFipsMesh();
  const transport = new FipsMeshTransport(fipsMesh, spec.address);
  await transport.connect();
  return transport;
});

// Now works via FIPS mesh:
const transport = await createBluetoothTransport("bluetooth://fips-node-addr?transport=fips");
const client = new BluetoothClient({ transport });
```

This is the transport-agnostic design in action: swap the transport, keep the protocol.
