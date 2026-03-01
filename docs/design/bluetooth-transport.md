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

## Usage

### Basic usage with mock (for development/testing)

```typescript
import { BluetoothClient, MockBluetoothTransport } from "@bandeira-tech/b3nd-client-bluetooth";

const transport = new MockBluetoothTransport();
const client = new BluetoothClient({ transport });

await client.receive(["store://users/alice/profile", { name: "Alice" }]);
const result = await client.read("store://users/alice/profile");
// result.record.data === { name: "Alice" }

await client.cleanup();
```

### Web Bluetooth (browser)

```typescript
import { BluetoothClient, type BluetoothTransport } from "@bandeira-tech/b3nd-client-bluetooth";

// B3nd service UUID — nodes advertise this
const B3ND_SERVICE_UUID = "b3nd0001-0000-1000-8000-00805f9b34fb";
const B3ND_CHAR_UUID    = "b3nd0002-0000-1000-8000-00805f9b34fb";

class WebBluetoothTransport implements BluetoothTransport {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private msgHandler: ((data: string) => void) | null = null;
  private errHandler: ((error: Error) => void) | null = null;
  private dcHandler: (() => void) | null = null;
  connected = false;

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [B3ND_SERVICE_UUID] }],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      this.dcHandler?.();
    });

    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(B3ND_SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(B3ND_CHAR_UUID);

    // Subscribe to notifications for responses
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener("characteristicvaluechanged", (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      const text = new TextDecoder().decode(value);
      this.msgHandler?.(text);
    });

    this.connected = true;
  }

  async send(data: string) {
    const encoded = new TextEncoder().encode(data);
    await this.characteristic!.writeValueWithResponse(encoded);
  }

  onMessage(handler: (data: string) => void) { this.msgHandler = handler; }
  onError(handler: (error: Error) => void) { this.errHandler = handler; }
  onDisconnect(handler: () => void) { this.dcHandler = handler; }

  async disconnect() {
    this.device?.gatt?.disconnect();
    this.connected = false;
  }
}

// Usage
const transport = new WebBluetoothTransport();
const client = new BluetoothClient({ transport });
// Now use client.receive(), client.read(), etc. — same as HTTP or WS
```

### Native Bluetooth (Deno/Node with noble or similar)

```typescript
import { BluetoothClient, type BluetoothTransport } from "@bandeira-tech/b3nd-client-bluetooth";

class RfcommTransport implements BluetoothTransport {
  private socket: any; // noble/bleno socket
  private msgHandler: ((data: string) => void) | null = null;
  connected = false;

  constructor(private address: string, private channel: number) {}

  async connect() {
    // Use your preferred native BT library
    // Example with hypothetical RFCOMM:
    this.socket = await nativeBluetooth.connect(this.address, this.channel);
    this.socket.on("data", (buf: Buffer) => {
      this.msgHandler?.(buf.toString("utf-8"));
    });
    this.connected = true;
  }

  async send(data: string) {
    this.socket.write(Buffer.from(data, "utf-8"));
  }

  onMessage(h: (data: string) => void) { this.msgHandler = h; }
  onError(h: (error: Error) => void) { this.socket?.on("error", h); }
  onDisconnect(h: () => void) { this.socket?.on("close", h); }

  async disconnect() {
    this.socket?.destroy();
    this.connected = false;
  }
}
```

## Configuration

```typescript
interface BluetoothClientConfig {
  transport: BluetoothTransport;   // Required — inject your transport
  timeout?: number;                // Default: 30000ms (BT can be slow)
  reconnect?: {
    enabled: boolean;              // Default: true
    maxAttempts?: number;          // Default: 5
    interval?: number;             // Default: 1000ms
    backoff?: "linear" | "exponential";  // Default: exponential
  };
}
```

## Testing

The `MockBluetoothTransport` runs an in-memory B3nd node. It passes the full shared test suite (30+ tests covering CRUD, pagination, binary data, batch reads, validation errors, and connection errors).

```bash
deno test --allow-all libs/b3nd-client-bluetooth/
```

Three mock transports are provided:

| Transport | Behavior |
|-----------|----------|
| `MockBluetoothTransport` | Happy path — accepts all writes, stores in memory |
| `FailingBluetoothTransport` | Always fails to connect |
| `ValidationFailingBluetoothTransport` | Rejects writes missing a `name` field |

## Composability

Because `BluetoothClient` implements `NodeProtocolInterface`, it composes with everything in the SDK:

```typescript
import { BluetoothClient, MockBluetoothTransport } from "@bandeira-tech/b3nd-client-bluetooth";
import { parallelBroadcast } from "@bandeira-tech/b3nd-combinators";
import { HttpClient } from "@bandeira-tech/b3nd-client-http";

// Write to both a Bluetooth peer AND an HTTP server
const btClient = new BluetoothClient({ transport: new WebBluetoothTransport() });
const httpClient = new HttpClient({ url: "https://node.fire.cat" });
const combined = parallelBroadcast([btClient, httpClient]);

// Same interface — receive, read, list, etc.
await combined.receive(["store://users/alice/profile", { name: "Alice" }]);
```

## FIPS Integration Path

The `BluetoothTransport` interface is the exact seam where FIPS mesh networking could plug in. A `FipsTransport` would implement the same interface, routing B3nd messages through the FIPS mesh instead of direct Bluetooth:

```typescript
class FipsTransport implements BluetoothTransport {
  // Route messages through FIPS mesh to a remote B3nd node
  // FIPS handles peer discovery, encryption, and multi-hop routing
  // B3nd handles data semantics, schema validation, and persistence
}
```

This is the transport-agnostic design in action: swap the transport, keep the protocol.
