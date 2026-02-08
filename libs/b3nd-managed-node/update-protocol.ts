/**
 * Software update protocol for managed nodes.
 *
 * Checks for updates published at:
 *   mutable://accounts/{operatorPubKeyHex}/nodes/{nodeId}/update
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@b3nd/encrypt";
import type { EncryptedPayload } from "@b3nd/encrypt";
import type { ModuleUpdate } from "./types.ts";
import { nodeUpdateUri } from "./types.ts";

export interface UpdateCheckResult {
  available: boolean;
  update?: ModuleUpdate;
}

export interface UpdateCheckerOptions {
  client: NodeProtocolInterface;
  operatorPubKeyHex: string;
  nodeId: string;
  intervalMs: number;
  onUpdateAvailable: (update: ModuleUpdate) => Promise<void>;
  onError?: (error: Error) => void;
  nodeEncryptionPrivateKey?: CryptoKey;
}

export interface UpdateChecker {
  /** Check for updates immediately */
  check(): Promise<UpdateCheckResult>;
  /** Start periodic checking */
  start(): void;
  /** Stop periodic checking */
  stop(): void;
}

export function createUpdateChecker(opts: UpdateCheckerOptions): UpdateChecker {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastVersion: string | null = null;

  async function check(): Promise<UpdateCheckResult> {
    const uri = nodeUpdateUri(opts.operatorPubKeyHex, opts.nodeId);

    try {
      const result = await opts.client.read(uri);
      if (!result.success || !result.record) {
        return { available: false };
      }

      const data = result.record.data as any;
      if (!data) return { available: false };

      // Determine if payload is encrypted
      let payload: unknown;
      if (data.auth && data.payload) {
        const payloadObj = data.payload as Record<string, unknown>;
        const isEncrypted = typeof payloadObj.data === "string" &&
          typeof payloadObj.nonce === "string";

        if (isEncrypted && opts.nodeEncryptionPrivateKey) {
          // Verify signature over encrypted payload first
          let verified = false;
          for (const entry of data.auth) {
            if (entry.pubkey === opts.operatorPubKeyHex) {
              const ok = await verify(entry.pubkey, entry.signature, data.payload);
              if (ok) {
                verified = true;
                break;
              }
            }
          }
          if (!verified) return { available: false };

          // Decrypt
          const { decrypt } = await import("@b3nd/encrypt");
          payload = await decrypt(
            data.payload as EncryptedPayload,
            opts.nodeEncryptionPrivateKey,
          );
        } else {
          // Plaintext signed message
          let verified = false;
          for (const entry of data.auth) {
            if (entry.pubkey === opts.operatorPubKeyHex) {
              const ok = await verify(entry.pubkey, entry.signature, data.payload);
              if (ok) {
                verified = true;
                break;
              }
            }
          }
          if (!verified) return { available: false };
          payload = data.payload;
        }
      } else {
        payload = data;
      }

      const update = payload as ModuleUpdate;
      if (!update.version || !update.moduleUrl) {
        return { available: false };
      }

      if (update.version !== lastVersion) {
        lastVersion = update.version;
        return { available: true, update };
      }

      return { available: false };
    } catch {
      return { available: false };
    }
  }

  async function poll() {
    try {
      const result = await check();
      if (result.available && result.update) {
        await opts.onUpdateAvailable(result.update);
      }
    } catch (error) {
      if (opts.onError) {
        opts.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  return {
    check,
    start() {
      if (timer) return;
      timer = setInterval(poll, opts.intervalMs);
      poll();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
