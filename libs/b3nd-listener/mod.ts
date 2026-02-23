/**
 * B3nd Listener — Compose primitives for backend services.
 *
 * Two primitives:
 *
 * - `respondTo(handler, config)` — Wraps a handler as a compose Processor.
 *   Handles decrypt → call → encrypt → sign → route.
 *
 * - `connect(client, config)` — Transport that bridges a processor to
 *   a remote Firecat node via polling.
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
 * @example Embedded in a custom node
 * ```typescript
 * import { when, parallel } from "b3nd-compose";
 *
 * const processor = respondTo(myHandler, { identity, client: storageClient });
 * const node = createValidatedClient({
 *   write: parallel(storageClient, when(isAuthRequest, processor)),
 *   read: storageClient,
 *   validate: msgSchema(schema),
 * });
 * ```
 */

import type {
  NodeProtocolInterface,
  ListItem,
} from "../b3nd-core/types.ts";
import {
  encrypt,
  decrypt,
  verify,
  createAuthenticatedMessageWithHex,
  type EncryptedPayload,
  type KeyPair,
  type EncryptionKeyPair,
} from "../b3nd-encrypt/mod.ts";

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
 * A connection to a remote Firecat node.
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
    client: NodeProtocolInterface;
  },
): (msg: [string, unknown]) => Promise<{ success: boolean; error?: string }> {
  const { identity, client } = config;

  return async (msg: [string, unknown]): Promise<{ success: boolean; error?: string }> => {
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
      return { success: false, error: "Message is neither signed nor encrypted" };
    }

    // 2. Decrypt
    const decrypted = await decrypt(
      encryptedPayload,
      identity.encryptionKeyPair.privateKey,
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
    const encryptedResponse = await encrypt(response, decrypted.clientPublicKeyHex);

    // 6. Sign
    const signedResponse = await createAuthenticatedMessageWithHex(
      encryptedResponse,
      identity.signingKeyPair.publicKeyHex,
      identity.signingKeyPair.privateKeyHex,
    );

    // 7. Write to replyTo
    await client.receive([decrypted.replyTo, signedResponse]);

    return { success: true };
  };
}

// ── connect ──────────────────────────────────────────────────────────

/**
 * Bridge a processor to a remote Firecat node via polling.
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
  client: NodeProtocolInterface,
  config: {
    prefix: string;
    processor: (msg: [string, unknown]) => Promise<{ success: boolean; error?: string }>;
    pollIntervalMs?: number;
    onError?: (error: Error, uri: string) => void;
  },
): Connection {
  const { prefix, processor, pollIntervalMs = 1000, onError } = config;
  const processed = new Set<string>();

  async function poll(): Promise<number> {
    const listResult = await client.list(prefix);
    if (!listResult.success) return 0;

    let count = 0;
    for (const item of (listResult as { success: true; data: ListItem[] }).data) {
      if (processed.has(item.uri)) continue;

      const readResult = await client.read(item.uri);
      if (!readResult.success || !readResult.record) continue;

      try {
        const result = await processor([item.uri, readResult.record.data]);
        if (result.success) {
          processed.add(item.uri);
          count++;
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)), item.uri);
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
    return () => { running = false; };
  }

  return { poll, start };
}

// ── Client helpers ───────────────────────────────────────────────────

/**
 * Write an encrypted request to a handler's inbox.
 * This is what a client calls to send a request.
 */
export async function writeRequest<T>(params: {
  client: NodeProtocolInterface;
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

  const encrypted = await encrypt(requestPayload, listenerEncryptionPublicKeyHex);

  if (signingKeyPair) {
    const signed = await createAuthenticatedMessageWithHex(
      encrypted,
      signingKeyPair.publicKeyHex,
      signingKeyPair.privateKeyHex,
    );
    await client.receive([inboxUri, signed]);
  } else {
    await client.receive([inboxUri, encrypted]);
  }
}

/**
 * Read and decrypt a response from a handler's outbox.
 * This is what a client calls after sending a request.
 */
export async function readResponse<T>(params: {
  client: NodeProtocolInterface;
  responseUri: string;
  clientEncryptionPrivateKey: CryptoKey;
  listenerPublicKeyHex?: string;
}): Promise<{ data: T; verified: boolean } | null> {
  const { client, responseUri, clientEncryptionPrivateKey, listenerPublicKeyHex } = params;

  const readResult = await client.read(responseUri);
  if (!readResult.success || !readResult.record) return null;

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

    const data = await decrypt(signed.payload, clientEncryptionPrivateKey) as T;
    return { data, verified };
  }

  if (isEncryptedPayload(raw)) {
    const data = await decrypt(raw as EncryptedPayload, clientEncryptionPrivateKey) as T;
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
