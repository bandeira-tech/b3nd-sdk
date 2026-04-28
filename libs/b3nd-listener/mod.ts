/**
 * B3nd Listener — Compose primitives for backend services.
 *
 * Two primitives:
 *
 * - `respondTo(handler, config)` — Wraps a handler as a compose Processor.
 *   Handles decrypt → call → encrypt → sign → route.
 *
 * - `connect(client, config)` — Transport that bridges a processor to
 *   a remote node via polling.
 *
 * The handler is the portable unit. `respondTo` makes it composable.
 * `connect` provides transport. They compose independently.
 *
 * @example Standalone listener (remote connection)
 * ```typescript
 * const processor = respondTo(myHandler, { identity, client });
 * const connection = connect(client, { prefix: inboxPrefix, processor });
 * connection.start();
 * ```
 *
 * @example Embedded in a Rig — route inbox writes to the handler via
 * a program + handler pair that delegates to the processor.
 * ```typescript
 * import { Rig, connection } from "@bandeira-tech/b3nd-sdk";
 *
 * const processor = respondTo(myHandler, { identity, client: storageClient });
 *
 * const rig = new Rig({
 *   connections: [connection(storageClient, { receive: ["*"], read: ["*"] })],
 *   programs: {
 *     "mutable://inbox": async () => ({ code: "inbox-request" }),
 *   },
 *   handlers: {
 *     "inbox-request": (msg, _broadcast, _read) => processor(msg),
 *   },
 * });
 * ```
 */

import type { ProtocolInterfaceNode, ReadResult } from "@bandeira-tech/b3nd-core";
import {
  createAuthenticatedMessageWithHex,
  decrypt,
  encrypt,
  type EncryptedPayload,
  type EncryptionKeyPair,
  type KeyPair,
  verify,
} from "@bandeira-tech/b3nd-canon/encrypt";

// ── Types ────────────────────────────────────────────────────────────

/**
 * What the handler sees — decrypted request data plus context.
 * No envelope concerns (clientPublicKeyHex, replyTo are handled by respondTo).
 */
export interface HandlerRequest<T = unknown> {
  /** Decrypted request data */
  data: T;
  /** The URI the request was read from */
  uri: string;
  /** Request ID extracted from the URI */
  requestId: string;
  /** Public key of the sender (if signed and verified) */
  senderPublicKeyHex?: string;
}

/**
 * A handler — the portable unit of backend logic.
 * Takes a request, returns a response. Knows nothing about transport or encryption.
 */
export type Handler<TReq = unknown, TRes = unknown> = (
  request: HandlerRequest<TReq>,
) => Promise<TRes>;

/**
 * Identity — signing and encryption keypairs for a service.
 */
export interface Identity {
  signingKeyPair: KeyPair;
  encryptionKeyPair: EncryptionKeyPair;
}

/**
 * A connection to a remote node.
 */
export interface Connection {
  /** Poll once, process all pending messages. Returns count processed. */
  poll(): Promise<number>;
  /** Start polling loop. Returns stop function. */
  start(): () => void;
}

// ── Internal types ───────────────────────────────────────────────────

interface SignedInboxMessage {
  auth: Array<{ pubkey: string; signature: string }>;
  payload: EncryptedPayload;
}

interface InboxRequestPayload<T = unknown> {
  data: T;
  clientPublicKeyHex: string;
  replyTo: string;
}

// ── respondTo ────────────────────────────────────────────────────────

/**
 * Wrap a handler as a compose-compatible processor.
 *
 * Handles the full request/response envelope:
 * 1. Extract encrypted payload (signed or unsigned)
 * 2. Decrypt with identity's encryption key
 * 3. Build HandlerRequest (data + context, no envelope)
 * 4. Call the handler
 * 5. Encrypt the response to the client's public key
 * 6. Sign with identity's signing key
 * 7. Write to the replyTo URI via client
 *
 * The returned function is structurally compatible with b3nd compose's
 * Processor type: `(msg: Message) => Promise<{ success, error? }>`.
 *
 * @example
 * ```typescript
 * const processor = respondTo(vaultHandler, { identity, client });
 *
 * // In a node's receive pipeline:
 * when(isAuthRequest, processor)
 *
 * // Or with connect for remote polling:
 * connect(remoteNode, { prefix, processor })
 * ```
 */
export function respondTo<TReq = unknown, TRes = unknown>(
  handler: Handler<TReq, TRes>,
  config: {
    identity: Identity;
    client: ProtocolInterfaceNode;
  },
): (msg: [string, unknown]) => Promise<{ success: boolean; error?: string }> {
  const { identity, client } = config;

  return async (
    msg: [string, unknown],
  ): Promise<{ success: boolean; error?: string }> => {
    const [uri, raw] = msg;

    // 1. Extract encrypted payload (handle signed or unsigned)
    let encryptedPayload: EncryptedPayload;
    let senderPublicKeyHex: string | undefined;

    if (isSignedMessage(raw)) {
      const signed = raw as SignedInboxMessage;
      encryptedPayload = signed.payload;

      if (signed.auth.length > 0) {
        const sigValid = await verify(
          signed.auth[0].pubkey,
          signed.auth[0].signature,
          signed.payload,
        );
        if (sigValid) {
          senderPublicKeyHex = signed.auth[0].pubkey;
        }
      }
    } else if (isEncryptedPayload(raw)) {
      encryptedPayload = raw as EncryptedPayload;
    } else {
      return {
        success: false,
        error: "Message is neither signed nor encrypted",
      };
    }

    // 2. Decrypt
    const decrypted = JSON.parse(
      new TextDecoder().decode(
        await decrypt(
          encryptedPayload,
          identity.encryptionKeyPair.privateKey,
        ),
      ),
    ) as InboxRequestPayload<TReq>;

    if (!decrypted.clientPublicKeyHex || !decrypted.replyTo) {
      return { success: false, error: "Missing clientPublicKeyHex or replyTo" };
    }

    // 3. Build handler request (no envelope concerns)
    const requestId = uri.split("/").pop() || "";
    const request: HandlerRequest<TReq> = {
      data: decrypted.data,
      uri,
      requestId,
      senderPublicKeyHex,
    };

    // 4. Call handler
    const response = await handler(request);

    // 5. Encrypt response to client
    const encryptedResponse = await encrypt(
      new TextEncoder().encode(JSON.stringify(response)),
      decrypted.clientPublicKeyHex,
    );

    // 6. Sign
    const signedResponse = await createAuthenticatedMessageWithHex(
      encryptedResponse,
      identity.signingKeyPair.publicKeyHex,
      identity.signingKeyPair.privateKeyHex,
    );

    // 7. Write to replyTo
    await client.receive([[decrypted.replyTo, signedResponse]]);

    return { success: true };
  };
}

// ── connect ──────────────────────────────────────────────────────────

/**
 * Bridge a processor to a remote node via polling.
 *
 * Watches the node for messages at a URI prefix, reads new messages,
 * and passes them to the processor. Tracks processed URIs to avoid
 * duplicates.
 *
 * @example
 * ```typescript
 * const processor = respondTo(handler, { identity, client });
 * const connection = connect(client, {
 *   prefix: `mutable://data/vault/${pubkey}/inbox`,
 *   processor,
 *   pollIntervalMs: 2000,
 * });
 *
 * const stop = connection.start();
 * ```
 */
export function connect(
  client: ProtocolInterfaceNode,
  config: {
    prefix: string;
    processor: (
      msg: [string, unknown],
    ) => Promise<{ success: boolean; error?: string }>;
    pollIntervalMs?: number;
    onError?: (error: Error, uri: string) => void;
  },
): Connection {
  const { prefix, processor, pollIntervalMs = 1000, onError } = config;
  const processed = new Set<string>();

  async function poll(): Promise<number> {
    // Trailing-slash read = list all under prefix
    const listPrefix = prefix.endsWith("/") ? prefix : prefix + "/";
    const listResults = await client.read(listPrefix);

    let count = 0;
    for (const item of listResults) {
      const itemUri = item.uri;
      if (!itemUri || !item.success) continue;
      if (processed.has(itemUri)) continue;

      const readResults = await client.read(itemUri);
      const readResult = readResults[0];
      if (!readResult?.success || !readResult.record) continue;

      try {
        const result = await processor([itemUri, readResult.record.data]);
        if (result.success) {
          processed.add(itemUri);
          count++;
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)), itemUri);
      }
    }
    return count;
  }

  function start(): () => void {
    let running = true;
    (async () => {
      while (running) {
        try {
          await poll();
        } catch {
          // poll-level errors swallowed; per-message errors go to onError
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    })();
    return () => {
      running = false;
    };
  }

  return { poll, start };
}

// ── Client helpers ───────────────────────────────────────────────────

/**
 * Write an encrypted request to a handler's inbox.
 * This is what a client calls to send a request.
 */
export async function writeRequest<T>(params: {
  client: ProtocolInterfaceNode;
  listenerEncryptionPublicKeyHex: string;
  inboxUri: string;
  data: T;
  clientEncryptionPublicKeyHex: string;
  replyToUri: string;
  signingKeyPair?: KeyPair;
}): Promise<void> {
  const {
    client,
    listenerEncryptionPublicKeyHex,
    inboxUri,
    data,
    clientEncryptionPublicKeyHex,
    replyToUri,
    signingKeyPair,
  } = params;

  const requestPayload: InboxRequestPayload<T> = {
    data,
    clientPublicKeyHex: clientEncryptionPublicKeyHex,
    replyTo: replyToUri,
  };

  const encrypted = await encrypt(
    new TextEncoder().encode(JSON.stringify(requestPayload)),
    listenerEncryptionPublicKeyHex,
  );

  if (signingKeyPair) {
    const signed = await createAuthenticatedMessageWithHex(
      encrypted,
      signingKeyPair.publicKeyHex,
      signingKeyPair.privateKeyHex,
    );
    await client.receive([[inboxUri, signed]]);
  } else {
    await client.receive([[inboxUri, encrypted]]);
  }
}

/**
 * Read and decrypt a response from a handler's outbox.
 * This is what a client calls after sending a request.
 */
export async function readResponse<T>(params: {
  client: ProtocolInterfaceNode;
  responseUri: string;
  clientEncryptionPrivateKey: CryptoKey;
  listenerPublicKeyHex?: string;
}): Promise<{ data: T; verified: boolean } | null> {
  const {
    client,
    responseUri,
    clientEncryptionPrivateKey,
    listenerPublicKeyHex,
  } = params;

  const readResults = await client.read(responseUri);
  const readResult = readResults[0];
  if (!readResult?.success || !readResult.record) return null;

  const raw = readResult.record.data;

  if (isSignedMessage(raw)) {
    const signed = raw as SignedInboxMessage;
    let verified = false;

    if (listenerPublicKeyHex && signed.auth.length > 0) {
      verified = await verify(
        signed.auth[0].pubkey,
        signed.auth[0].signature,
        signed.payload,
      );
      verified = verified && signed.auth[0].pubkey === listenerPublicKeyHex;
    }

    const data = JSON.parse(
      new TextDecoder().decode(
        await decrypt(signed.payload, clientEncryptionPrivateKey),
      ),
    ) as T;
    return { data, verified };
  }

  if (isEncryptedPayload(raw)) {
    const data = JSON.parse(
      new TextDecoder().decode(
        await decrypt(raw as EncryptedPayload, clientEncryptionPrivateKey),
      ),
    ) as T;
    return { data, verified: false };
  }

  return null;
}

// ── Type guards ──────────────────────────────────────────────────────

function isSignedMessage(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "auth" in raw &&
    "payload" in raw &&
    Array.isArray((raw as SignedInboxMessage).auth)
  );
}

function isEncryptedPayload(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "data" in raw &&
    "nonce" in raw
  );
}
