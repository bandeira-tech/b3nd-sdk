/**
 * Bluetooth Transport Connector
 *
 * Frontloads all Bluetooth connection complexity:
 *   1. Parse bluetooth:// URL into device address, channel, and options
 *   2. Resolve the appropriate transport (Web Bluetooth, RFCOMM, mock)
 *   3. Connect and return a ready-to-use BluetoothTransport
 *
 * The BluetoothClient constructor receives an already-connected transport,
 * so all pairing/discovery/GATT negotiation happens HERE, before the client
 * is ever instantiated.
 *
 * URL format:
 *   bluetooth://<address>[:<channel>][?option=value&...]
 *
 * Examples:
 *   bluetooth://mock                              → MockBluetoothTransport (testing)
 *   bluetooth://AA:BB:CC:DD:EE:FF                 → RFCOMM to paired device
 *   bluetooth://AA:BB:CC:DD:EE:FF:3               → RFCOMM channel 3
 *   bluetooth://web                               → Web Bluetooth (browser prompt)
 *   bluetooth://web?service=b3nd&name=MyNode      → Web Bluetooth with filters
 *   bluetooth://AA:BB:CC:DD:EE:FF?timeout=60000   → Custom timeout
 *
 * Options (query params):
 *   timeout    - Connection timeout in ms (default: 30000)
 *   service    - BLE service UUID filter (for web bluetooth)
 *   name       - Device name filter (for web bluetooth)
 *   transport  - Force transport type: "rfcomm" | "ble" | "mock"
 */

import type { BluetoothTransport } from "./mod.ts";
import { MockBluetoothTransport } from "./mod.ts";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

export interface BluetoothConnectionSpec {
  /** Raw address from URL hostname (MAC address, "web", or "mock") */
  address: string;

  /** RFCOMM channel number (from URL port), or undefined for BLE */
  channel?: number;

  /** Connection timeout in ms */
  timeout: number;

  /** BLE service UUID filter */
  serviceUuid?: string;

  /** Device name filter */
  nameFilter?: string;

  /** Forced transport type */
  transportType: "rfcomm" | "ble" | "web" | "mock" | "auto";
}

/**
 * Parse a bluetooth:// URL into a connection spec.
 *
 * Handles MAC addresses (which contain colons) by detecting the pattern
 * and separating the channel number from the address.
 */
export function parseBluetoothUrl(url: string): BluetoothConnectionSpec {
  if (!url.startsWith("bluetooth://")) {
    throw new Error(
      `Invalid Bluetooth URL: must start with bluetooth:// (got: ${url})`,
    );
  }

  const afterScheme = url.slice("bluetooth://".length);

  // Split query string
  const [hostPart, queryString] = afterScheme.split("?", 2);
  const params = new URLSearchParams(queryString ?? "");

  // Parse address and optional channel
  let address: string;
  let channel: number | undefined;

  // Check for MAC address pattern (XX:XX:XX:XX:XX:XX or XX:XX:XX:XX:XX:XX:N)
  const macMatch = hostPart.match(
    /^([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?::(\d+))?$/,
  );
  if (macMatch) {
    address = macMatch[1].toUpperCase();
    channel = macMatch[2] ? parseInt(macMatch[2], 10) : undefined;
  } else {
    // Simple hostname: "mock", "web", etc.
    address = hostPart.toLowerCase();
  }

  // Determine transport type
  let transportType: BluetoothConnectionSpec["transportType"] = "auto";
  const forcedTransport = params.get("transport");
  if (forcedTransport) {
    if (!["rfcomm", "ble", "web", "mock"].includes(forcedTransport)) {
      throw new Error(`Invalid transport type: ${forcedTransport}`);
    }
    transportType = forcedTransport as BluetoothConnectionSpec["transportType"];
  } else if (address === "mock") {
    transportType = "mock";
  } else if (address === "web") {
    transportType = "web";
  } else if (channel !== undefined) {
    transportType = "rfcomm";
  }

  return {
    address,
    channel,
    timeout: parseInt(params.get("timeout") ?? "30000", 10),
    serviceUuid: params.get("service") ?? undefined,
    nameFilter: params.get("name") ?? undefined,
    transportType,
  };
}

// ---------------------------------------------------------------------------
// Transport factory registry
// ---------------------------------------------------------------------------

/**
 * Factory function that creates and connects a BluetoothTransport.
 * Receives the parsed connection spec. Must return a connected transport.
 */
export type BluetoothTransportFactory = (
  spec: BluetoothConnectionSpec,
) => Promise<BluetoothTransport>;

/**
 * Registry of transport factories by type.
 *
 * Register custom factories for your platform:
 *   registerBluetoothTransport("rfcomm", myRfcommFactory);
 *   registerBluetoothTransport("ble", myBleFactory);
 *   registerBluetoothTransport("web", myWebBluetoothFactory);
 */
const transportFactories = new Map<string, BluetoothTransportFactory>();

export function registerBluetoothTransport(
  type: string,
  factory: BluetoothTransportFactory,
): void {
  transportFactories.set(type, factory);
}

// Built-in: mock transport (always available)
registerBluetoothTransport("mock", async (_spec) => {
  const transport = new MockBluetoothTransport();
  await transport.connect();
  return transport;
});

// ---------------------------------------------------------------------------
// Main connector function
// ---------------------------------------------------------------------------

/**
 * Create a connected Bluetooth transport from a bluetooth:// URL.
 *
 * This is the primary entry point. All connection complexity is
 * frontloaded here — the returned transport is ready to use.
 *
 * @param url - bluetooth:// URL string
 * @returns Connected BluetoothTransport ready for BluetoothClient
 * @throws Error if URL is invalid, transport type unsupported, or connection fails
 *
 * @example
 * ```typescript
 * // Testing
 * const transport = await createBluetoothTransport("bluetooth://mock");
 * const client = new BluetoothClient({ transport });
 *
 * // Native RFCOMM (after registering factory)
 * registerBluetoothTransport("rfcomm", myRfcommFactory);
 * const transport = await createBluetoothTransport("bluetooth://AA:BB:CC:DD:EE:FF:3");
 *
 * // Web Bluetooth (after registering factory)
 * registerBluetoothTransport("web", myWebBluetoothFactory);
 * const transport = await createBluetoothTransport("bluetooth://web?service=b3nd");
 * ```
 */
export async function createBluetoothTransport(
  url: string,
): Promise<BluetoothTransport> {
  const spec = parseBluetoothUrl(url);

  // Resolve transport type for "auto"
  let resolvedType = spec.transportType;
  if (resolvedType === "auto") {
    // Try to auto-detect: if we have a MAC address, prefer rfcomm > ble
    if (spec.address.match(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/)) {
      if (transportFactories.has("rfcomm")) {
        resolvedType = "rfcomm";
      } else if (transportFactories.has("ble")) {
        resolvedType = "ble";
      } else {
        throw new Error(
          `No Bluetooth transport registered for device ${spec.address}. ` +
            `Register one with registerBluetoothTransport("rfcomm", factory) or ` +
            `registerBluetoothTransport("ble", factory).`,
        );
      }
    } else {
      throw new Error(
        `Cannot auto-detect transport for address "${spec.address}". ` +
          `Use bluetooth://mock, bluetooth://web, or a MAC address.`,
      );
    }
  }

  const factory = transportFactories.get(resolvedType);
  if (!factory) {
    const available = [...transportFactories.keys()].join(", ") || "(none)";
    throw new Error(
      `No Bluetooth transport factory registered for type "${resolvedType}". ` +
        `Available: ${available}. ` +
        `Register one with registerBluetoothTransport("${resolvedType}", factory).`,
    );
  }

  const transport = await factory(spec);

  if (!transport.connected) {
    throw new Error(
      `Transport factory for "${resolvedType}" returned a disconnected transport. ` +
        `Factory must call connect() before returning.`,
    );
  }

  return transport;
}
